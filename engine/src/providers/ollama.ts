/**
 * The local ground-truth lane.
 *
 * This is the ONLY lane that may report latency, and the only one where the
 * artifact under test is the one a user would actually pull. A hosted fp16
 * result and the q4_K_M someone downloads to a laptop are different artifacts
 * with different pass rates; publishing the hosted number as a min-spec for the
 * local artifact would reintroduce the same overclaim one level down, invisibly.
 *
 * Ollama has no response cache and no model substitution: it loads the tag you
 * name or it errors. `cached` is therefore genuinely false rather than assumed,
 * and served_model is echoed back by the API. The assertions in ./index.ts still
 * run on every response -- an adapter that cannot lie is not a reason to stop
 * checking, it is the control that proves the check works.
 */
import { ProviderError, assertHonest, type CompletionReply, type CompletionRequest, type Provider } from "./index.ts";

const BASE = process.env.OLLAMA_HOST ?? "http://localhost:11434";

interface TagEntry {
  name: string;
  digest: string;
  details?: { quantization_level?: string; parameter_size?: string; family?: string };
}

let tagCache: Map<string, TagEntry> | null = null;

/**
 * Context window per local model, pinned rather than inherited.
 *
 * These are the models' own advertised windows, held below the maximum where the
 * KV cache would not fit alongside the weights in 16GB. A window that is too
 * small silently truncates; a window that is too large evicts the weights and
 * measures swap. Both are measurement faults, not model properties.
 */
const CONTEXT: Record<string, number> = {
  "gemma2:2b": 8192,                    // gemma-2 ships an 8k window
  "qwen2.5:7b-instruct-q4_K_M": 16384,  // 32k available; 16k holds the largest skill in the corpus
};
export function contextWindow(modelId: string): number {
  return CONTEXT[modelId] ?? Number(process.env.FITS_NUM_CTX ?? 8192);
}

async function tags(): Promise<Map<string, TagEntry>> {
  if (tagCache) return tagCache;
  const r = await fetch(`${BASE}/api/tags`).catch((e) => {
    throw new ProviderError(`ollama unreachable at ${BASE}: ${e}`, "network");
  });
  if (!r.ok) throw new ProviderError(`ollama /api/tags ${r.status}`, "provider");
  const j = (await r.json()) as { models: TagEntry[] };
  tagCache = new Map(j.models.map((m) => [m.name, m]));
  return tagCache;
}

export const ollama: Provider = {
  id: "ollama",
  lane: "local",

  /** The weight digest. When it changes the weights changed, and every row
   *  produced against the old digest is stale and gets re-queued. */
  async digest(modelId) {
    const t = await tags();
    const e = t.get(modelId);
    if (!e) throw new ProviderError(`model not pulled locally: ${modelId}`, "provider");
    return e.digest.slice(0, 16);
  },

  price() {
    return { inputPerMTok: 0, outputPerMTok: 0 }; // electricity is not billed here
  },

  async complete(modelId, req: CompletionRequest): Promise<CompletionReply> {
    const t = await tags();
    const meta = t.get(modelId);
    const t0 = Date.now();
    const numCtx = contextWindow(modelId);

    const body = {
      model: modelId,
      stream: false,
      // Deterministic decoding. Anything else measures decode settings rather
      // than the model, which is exactly the confound this harness exists to
      // avoid (see the lfm-2.5 exclusion in the prior experiment).
      options: {
        temperature: req.temperature ?? 0,
        seed: req.seed ?? 7,
        top_p: 1,
        num_predict: req.maxTokens,
        // SILENT TRUNCATION IS THE HAZARD HERE. Ollama's default context window
        // is small, and an oversized prompt is TRUNCATED rather than rejected --
        // so a 41,000-character skill file would be quietly cut in half and we
        // would publish a pass rate for a skill the model never saw. That is the
        // same class of failure as a substituted model: a measurement of
        // something other than what was asked for, with no error raised.
        //
        // So the window is pinned explicitly, and the reply is checked against
        // it below. A skill that does not fit is a real finding -- context
        // overflow is one of the three things BORING is for -- but it has to be
        // reported as overflow, never as a low score.
        num_ctx: numCtx,
      },
      messages: [
        { role: "system", content: req.system },
        ...req.messages,
      ],
    };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 300_000);
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e: any) {
      throw new ProviderError(`ollama chat failed: ${e?.message ?? e}`, "network");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      if (/context|too (long|large)|exceed/i.test(txt)) {
        throw new ProviderError(`ollama ${res.status}: ${txt.slice(0, 200)}`, "context_overflow");
      }
      throw new ProviderError(`ollama ${res.status}: ${txt.slice(0, 200)}`, "provider");
    }

    const j = (await res.json()) as any;

    // The truncation check. prompt_eval_count is what was ACTUALLY evaluated, so
    // a prompt that filled the window to the brim was almost certainly cut.
    // Treated as overflow, which lands in BORING, which is an alarm -- not as a
    // model failure, which would be a lie about a skill that simply does not fit.
    const promptTokens = j?.prompt_eval_count ?? 0;
    if (promptTokens >= numCtx - 8) {
      throw new ProviderError(
        `prompt filled the ${numCtx}-token context window (${promptTokens} evaluated) for ` +
        `${modelId}. Ollama truncates rather than erroring, so this run would have measured ` +
        `a cut-off skill file. Recorded as context overflow.`,
        "context_overflow",
      );
    }

    const reply: CompletionReply = {
      text: j?.message?.content ?? "",
      served_model: j?.model ?? "",
      served_provider: "ollama-local",
      quantization: meta?.details?.quantization_level ?? "unknown",
      cached: false,
      latency_ms: Date.now() - t0,
      input_tokens: j?.prompt_eval_count ?? 0,
      output_tokens: j?.eval_count ?? 0,
      cost_usd: 0,
    };
    assertHonest(modelId, reply);
    return reply;
  },
};
