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
