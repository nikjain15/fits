/**
 * The direct hosted path.
 *
 * Routing is PINNED, not left to the router: fallbacks off, a fixed provider
 * order where one is configured, and quantization constrained. That is not
 * fussiness -- an unpinned router silently changes the artifact under test
 * between calls, and a pass rate averaged over two different artifacts is
 * exactly the confidently-wrong number this product exists to prevent.
 *
 * Field names verified against https://openrouter.ai/docs/features/provider-routing
 * and https://openrouter.ai/docs/api-reference/overview on 2026-08-28:
 *   provider.allow_fallbacks   boolean, default true -> we send false
 *   provider.order             string[] of provider slugs, tried in order
 *   provider.quantizations     string[] e.g. ["fp16"], ["int4"]
 *   provider.data_collection    "allow" | "deny"
 *   usage.include              request usage accounting
 * The response's top-level `model` is what actually served the request. There is
 * no documented top-level `provider` field; we read one if present and record
 * "unknown" if not, because the absence is itself a finding worth publishing.
 *
 * The model list is NOT hardcoded. `listModels()` queries the live catalog and
 * the size-class resolution happens against what actually exists, so a class
 * whose model has been withdrawn is recorded as unavailable rather than dropped.
 */
import { ProviderError, assertHonest, type CompletionReply, type CompletionRequest, type Provider } from "./index.ts";
import { httpFetch } from "../net.ts";
import { secret, redact } from "../secrets.ts";

const BASE = "https://openrouter.ai/api/v1";

export interface CatalogEntry {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  supported_parameters?: string[];
}

let catalog: Map<string, CatalogEntry> | null = null;

function key(): string {
  const k = secret("OPENROUTER_API_KEY");
  if (!k) {
    throw new ProviderError(
      "OPENROUTER_API_KEY is not set. Looked in the environment, ~/.fits.env and the " +
      "macOS keychain. The hosted lane cannot run; affected cells are recorded as " +
      "not-run and nothing is fabricated.",
      "provider",
    );
  }
  return k;
}

export async function listModels(): Promise<Map<string, CatalogEntry>> {
  if (catalog) return catalog;
  const r = await httpFetch(`${BASE}/models`, { headers: { authorization: `Bearer ${key()}` } });
  if (!r.ok) throw new ProviderError(`openrouter /models ${r.status}`, "provider");
  const j = (await r.json()) as { data: CatalogEntry[] };
  catalog = new Map(j.data.map((m) => [m.id, m]));
  return catalog;
}

/** Pinned routing preferences, per model id. Anything not listed gets the
 *  defaults below, which are still fallback-free. */
const PIN: Record<string, { order?: string[]; quantizations?: string[] }> = {};

export const openrouter: Provider = {
  id: "openrouter",
  lane: "hosted",

  /**
   * A hosted endpoint behind a stable model id can change underneath you with no
   * version bump and no notice -- which is worse than local staleness, because
   * nothing signals it. There is no weight digest to read, so the digest here is
   * a fingerprint of the catalog entry. It moves when the listed context length
   * or pricing moves; genuine silent swaps are caught by the canary suite
   * instead (see engine/src/canary.ts).
   */
  async digest(modelId) {
    const c = await listModels();
    const e = c.get(modelId);
    if (!e) return "absent";
    const s = `${e.id}|${e.context_length}|${e.pricing.prompt}|${e.pricing.completion}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return `cat-${(h >>> 0).toString(16)}`;
  },

  price(modelId) {
    const e = catalog?.get(modelId);
    if (!e) return { inputPerMTok: 0, outputPerMTok: 0 };
    return {
      inputPerMTok: Number(e.pricing.prompt) * 1e6,
      outputPerMTok: Number(e.pricing.completion) * 1e6,
    };
  },

  async complete(modelId, req: CompletionRequest): Promise<CompletionReply> {
    const pin = PIN[modelId] ?? {};
    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: req.maxTokens,
      messages: [{ role: "system", content: req.system }, ...req.messages],
      usage: { include: true },
      provider: {
        // The whole point. A fallback is a substitution we would not otherwise
        // see, and it is the same failure as a swapped backup model on a cap hit.
        allow_fallbacks: false,
        ...(pin.order ? { order: pin.order } : {}),
        ...(pin.quantizations ? { quantizations: pin.quantizations } : {}),
      },
    };
    if (req.temperature !== undefined) {
      body.temperature = req.temperature;
      body.top_p = 1;
      body.seed = req.seed ?? 7;
    }
    if (req.disableReasoning) body.reasoning = { enabled: false };

    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 180_000);
    let res: Response;
    try {
      res = await httpFetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e: any) {
      throw new ProviderError(redact(`openrouter network: ${e?.message ?? e}${e?.cause ? ` (${e.cause.code ?? e.cause.message ?? e.cause})` : ""}`), "network");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      // 429 is the provider saying "slow down", which is backpressure, not a
      // network fault. Classifying it as network gave it the short socket-retry
      // backoff (1.5s doubling) and it exhausted every attempt against a
      // provider-side limit that needed tens of seconds — 7 rows on mistral-nemo
      // landed in BORING as a result, blaming the model for our pacing.
      if (res.status === 429) throw new ProviderError(redact(`rate limited: ${txt.slice(0, 160)}`), "backpressure");
      /**
       * 402 is two completely different conditions wearing one status code, and
       * conflating them cost the prior experiment its frontier ceiling — 8 of 60
       * cases ended with no ceiling data at all.
       *
       *   "…given your current in-flight requests. Retry after in-flight
       *    requests settle."   -> BACKPRESSURE. Credit reserved against
       *    concurrent calls, not credit spent. Plenty may remain ($7.91 did when
       *    this first fired). Retryable, and NOT a verdict about the model.
       *
       *   anything else        -> genuinely out of credit. Retrying spins
       *    forever and every subsequent cell is void, so it stops the run.
       */
      if (res.status === 402) {
        if (/in-flight|in flight|settle/i.test(txt)) {
          throw new ProviderError(redact(`credit reserved against in-flight requests: ${txt.slice(0, 160)}`), "backpressure");
        }
        throw new ProviderError(redact(`out of credit: ${txt.slice(0, 200)}`), "out_of_credit");
      }
      if (/context|too long|maximum.*token/i.test(txt)) {
        throw new ProviderError(`context: ${txt.slice(0, 200)}`, "context_overflow");
      }
      throw new ProviderError(redact(`openrouter ${res.status}: ${txt.slice(0, 200)}`), "provider");
    }

    const j = (await res.json()) as any;
    const u = j?.usage ?? {};
    const p = openrouter.price(modelId);
    const inTok = u.prompt_tokens ?? 0;
    const outTok = u.completion_tokens ?? 0;

    const reply: CompletionReply = {
      text: j?.choices?.[0]?.message?.content ?? "",
      served_model: j?.model ?? "",
      // Undocumented but present on some responses. Absence is recorded, never
      // filled in with an assumption about who served it.
      served_provider: j?.provider ?? "unknown",
      quantization: (pin.quantizations?.[0]) ?? "unknown",
      // OpenRouter does not run a response cache for us, but a gateway in front
      // of it might. If any field ever claims a cache hit, believe it.
      cached: Boolean(j?.cached ?? j?.cache_hit ?? u?.cache_hit ?? false),
      latency_ms: Date.now() - t0,
      context_window: catalog?.get(modelId)?.context_length ?? 0,
      input_tokens: inTok,
      output_tokens: outTok,
      cost_usd:
        typeof u.cost === "number"
          ? u.cost
          : (inTok / 1e6) * p.inputPerMTok + (outTok / 1e6) * p.outputPerMTok,
    };
    assertHonest(modelId, reply);
    return reply;
  },
};
