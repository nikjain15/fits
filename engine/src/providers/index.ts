/**
 * One interface, three adapters. Which one runs a cell is DATA, recorded on
 * every row, never a global setting.
 *
 * The two assertions in this file are the most important code in the repo.
 *
 * 1. A CACHED RESPONSE IS NOT A MEASUREMENT. Fits runs the same prompt many
 *    times on purpose; the spread across those repeats IS the measurement. A
 *    gateway that serves one stored answer N times collapses that spread to zero
 *    and produces a fabricated rate with a fake-tight interval. We do not trust
 *    configuration to have caching off -- we assert `cached === false` on every
 *    single response and abort the cell if one comes back cached.
 *
 * 2. A SUBSTITUTED MODEL IS NOT THE MODEL YOU ASKED FOR. If a spend cap trips
 *    and the gateway swaps in a backup, or a router falls back to another
 *    provider, the measurement of X quietly becomes a measurement of Y with no
 *    error raised. We compare served_model to the requested id on every call and
 *    discard the cell on mismatch, recording both names. The two are never
 *    blended.
 *
 * Both apply identically to OpenRouter's own provider fallback.
 */

export interface CompletionRequest {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
  temperature?: number;
  seed?: number;
  disableReasoning?: boolean;
}

export interface CompletionReply {
  text: string;
  /** What ACTUALLY answered, as the provider reports it. */
  served_model: string;
  served_provider: string;
  /** Read from the provider where it will say; "unknown" is recorded as-is and
   *  never replaced with a guess. */
  quantization: string;
  /** MUST be false. Any true value aborts the cell. */
  cached: boolean;
  latency_ms: number;
  /** The context window this call was sent into, so the caller can assert the
   *  prompt fitted. 0 where the provider does not expose one. */
  context_window: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface Provider {
  id: "conduit" | "openrouter" | "ollama";
  lane: "hosted" | "local";
  /** Weight digest (local) or endpoint fingerprint (hosted). Rows expire when
   *  this changes. Never expire by time alone. */
  digest(modelId: string): Promise<string>;
  complete(modelId: string, req: CompletionRequest): Promise<CompletionReply>;
  /** Per-million-token prices, for the dry-run estimate and the spend ledger. */
  price(modelId: string): { inputPerMTok: number; outputPerMTok: number };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "context_overflow"
      | "provider"
      | "network"
      /** The gateway asking us to wait — retryable, and not a model verdict. */
      | "backpressure"
      /** Genuinely out of money. Never retried; stops the run. */
      | "out_of_credit"
      | "cached_response"
      | "provider_substitution",
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Applied to every response from every adapter, without exception. */
export function assertHonest(requestedId: string, r: CompletionReply): void {
  if (r.cached) {
    throw new ProviderError(
      `provider returned a CACHED response for ${requestedId}. A cached answer is ` +
      `not a measurement: it collapses the repeat-run spread this product is built ` +
      `on. Turn response caching off at the gateway and re-run this cell.`,
      "cached_response",
    );
  }
  if (!servedMatches(requestedId, r.served_model)) {
    throw new ProviderError(
      `provider substitution: asked for "${requestedId}", served by ` +
      `"${r.served_model}". This cell measures the served model, not the requested ` +
      `one, and the two are never blended. Cell discarded.`,
      "provider_substitution",
    );
  }
}

/**
 * Providers report served model names with harmless decoration: OpenRouter
 * appends a routing suffix (":free", ":nitro", ":floor"), Ollama echoes the tag
 * verbatim. Anything beyond that is a different model and must fail.
 */
export function servedMatches(requested: string, served: string): boolean {
  if (!served) return false; // silence is not agreement
  const norm = (s: string) => s.trim().toLowerCase().replace(/:(free|nitro|floor|extended)$/i, "");
  return norm(requested) === norm(served);
}

/**
 * Retry transient faults, and ONLY transient faults.
 *
 * FITS.md §11.6 records that an early run of the prior experiment showed 16.5%
 * BORING and every single one was its own rate-limiting and connection handling
 * rather than anything about the corpus. The zero-BORING result that settled
 * assumption #6 was only earned by chasing those out. This build reproduced the
 * fault immediately on its first hosted call — 3 of 7 runs came back 429 — and a
 * grid launched in that state would have spent the whole budget measuring
 * OpenRouter's rate limiter.
 *
 * What is retried: 429 and network faults. Both are ours to absorb.
 * What is NOT: context overflow (a real finding about the skill), a cached
 * response, and a provider substitution. Retrying those would paper over exactly
 * the three things the harness exists to catch.
 */
export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const kind = e instanceof ProviderError ? e.kind : "";
      // `backpressure` is the gateway telling us to wait, not a fault: OpenRouter
      // answers 402 "would exceed your available credits given your current
      // in-flight requests — retry after in-flight requests settle" when the
      // RESERVED total across concurrent calls exceeds the balance, even with
      // plenty of credit left. It is retryable and it is not a model verdict;
      // recording it as BORING (36 rows on the first grid) blamed the frontier
      // for our own concurrency. `out_of_credit` is the genuinely different one
      // and is never retried — it stops the run.
      if (kind !== "network" && kind !== "backpressure") throw e;
      if (i === attempts - 1) break;
      // Full jitter. A fixed backoff synchronises every worker onto the same
      // retry instant and re-trips the limit that caused the wait.
      // Backpressure needs a longer wait than a dropped socket: the point is to
      // let other in-flight requests settle, which takes seconds, not milliseconds.
      /**
       * Bounded on purpose. An earlier, more patient ladder (8 attempts, up to
       * 60s each) meant one persistently rate-limited model could hold a worker
       * for five minutes per cell — four workers spent eighteen minutes on
       * `mistral-nemo-12b` and landed nothing. Riding out a momentary collision
       * is worth a minute; riding out a provider that simply will not serve us
       * is not, and the circuit breaker upstream is the right answer to that.
       */
      const base = kind === "backpressure"
        ? Math.min(20_000, 4_000 * 2 ** i)
        : Math.min(15_000, 1_500 * 2 ** i);
      await new Promise((r) => setTimeout(r, Math.random() * base + 250));
    }
  }
  throw last;
}
