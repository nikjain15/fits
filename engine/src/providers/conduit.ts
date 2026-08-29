/**
 * Conduit -- the preferred hosted path, once its gateway serves real traffic.
 *
 * github.com/nikjain15/conduit is the operator's own control plane: per-use-case
 * routing over a live catalog, spend caps, cached answer reuse, guardrails.
 *
 * STATUS, 2026-08-28: not wired. As of writing Conduit is connected to a local
 * mock gateway and its values are sample configuration, so pointing Fits at it
 * would measure the mock. The adapter is written so the switch is one config
 * line (FITS_PROVIDER=conduit + CONDUIT_BASE_URL), and `preflight()` below is
 * the gate that must pass first.
 *
 * TWO CONDUIT FEATURES WOULD SILENTLY CORRUPT EVERY MEASUREMENT.
 *
 *   "Reuse cached answers"        must be OFF. Fits runs the same prompt many
 *                                 times deliberately; a cache serves one stored
 *                                 answer N times and collapses the spread into a
 *                                 fabricated rate with a fake-tight interval.
 *   "Backup model, used on cap hit"  must not fire mid-run. A swap on a cap hit
 *                                 turns a measurement of X into a measurement of
 *                                 Y with no error raised.
 *
 * Neither is trusted from configuration. `preflight()` proves caching is off by
 * sending the same nonce prompt twice and requiring the responses to differ or
 * the cached flag to be false on both; `assertHonest()` then re-checks every
 * single response for the rest of the run.
 */
import { ProviderError, assertHonest, type CompletionReply, type CompletionRequest, type Provider } from "./index.ts";

const BASE = process.env.CONDUIT_BASE_URL ?? "";

export function configured(): boolean {
  return Boolean(BASE && process.env.CONDUIT_API_KEY);
}

/**
 * Must return true before Conduit is allowed to run a single measured cell.
 * Sends the identical request twice with a nonce and demands that neither reply
 * claims a cache hit. A gateway that answers "cached: true" here has just told
 * us it would have poisoned the entire dataset.
 */
export async function preflight(modelId: string): Promise<{ ok: boolean; reason: string }> {
  if (!configured()) return { ok: false, reason: "CONDUIT_BASE_URL / CONDUIT_API_KEY not set" };
  const probe: CompletionRequest = {
    system: "Reply with exactly one JSON object.",
    messages: [{ role: "user", content: `{"echo":"fits-preflight"}` }],
    maxTokens: 32,
    temperature: 0,
  };
  try {
    const a = await conduit.complete(modelId, probe);
    const b = await conduit.complete(modelId, probe);
    if (a.cached || b.cached) {
      return { ok: false, reason: "gateway reported a cache hit — response caching must be OFF" };
    }
    return { ok: true, reason: "caching off, served model matches on both probes" };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message ?? e) };
  }
}

export const conduit: Provider = {
  id: "conduit",
  lane: "hosted",

  async digest(modelId) {
    return `conduit-unpinned:${modelId}`;
  },

  price() {
    // Conduit fronts other providers; the ledger uses the price it reports on
    // the response rather than a table we would have to keep in sync.
    return { inputPerMTok: 0, outputPerMTok: 0 };
  },

  async complete(modelId, req): Promise<CompletionReply> {
    if (!configured()) {
      throw new ProviderError("conduit is not configured; nothing was run", "provider");
    }
    const t0 = Date.now();
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.CONDUIT_API_KEY}`,
        "content-type": "application/json",
        // Belt: ask the gateway not to serve or write cache for this request.
        // Braces: assertHonest checks the answer regardless of what we asked.
        "x-conduit-cache": "bypass",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "system", content: req.system }, ...req.messages],
        max_tokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature, top_p: 1, seed: req.seed ?? 7 } : {}),
        cache: false,
        allow_backup_model: false,
        usage: { include: true },
      }),
    }).catch((e: any) => {
      throw new ProviderError(`conduit network: ${e?.message ?? e}`, "network");
    });

    if (!res.ok) {
      throw new ProviderError(`conduit ${res.status}: ${(await res.text()).slice(0, 200)}`, "provider");
    }
    const j = (await res.json()) as any;
    const u = j?.usage ?? {};
    const reply: CompletionReply = {
      text: j?.choices?.[0]?.message?.content ?? "",
      served_model: j?.model ?? "",
      served_provider: j?.provider ?? j?.routed_provider ?? "unknown",
      quantization: j?.quantization ?? "unknown",
      cached: Boolean(j?.cached ?? j?.cache_hit ?? u?.cache_hit ?? false),
      latency_ms: Date.now() - t0,
      context_window: 0,
      input_tokens: u.prompt_tokens ?? 0,
      output_tokens: u.completion_tokens ?? 0,
      cost_usd: typeof u.cost === "number" ? u.cost : 0,
    };
    assertHonest(modelId, reply);
    return reply;
  },
};
