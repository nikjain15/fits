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
import { httpFetch } from "../net.ts";

const BASE = process.env.OLLAMA_HOST ?? "http://localhost:11434";

interface TagEntry {
  name: string;
  digest: string;
  details?: { quantization_level?: string; parameter_size?: string; family?: string };
}

let tagCache: Map<string, TagEntry> | null = null;

/**
 * Context window per local model. THE MODEL'S OWN MAXIMUM, not a number we
 * picked.
 *
 * This distinction is the whole point and the first version got it wrong. Qwen2.5
 * supports 32k; the first run pinned it to 16k, and the two largest skills in the
 * corpus (drawio at 41,514 chars, notebooklm at 41,179) overflowed it. Reporting
 * those as "this skill does not fit this model" would have blamed the model for a
 * setting of ours — a min-spec label that was really a config label, which is
 * precisely the kind of confidently-wrong number this product exists to prevent.
 *
 * So the window is the model's advertised maximum. A skill that overflows THAT
 * genuinely does not fit, and saying so is a real finding.
 *
 * The KV cache is the constraint on the other side: 32k on a 7B at q4 costs
 * roughly 1.9GB alongside 4.7GB of weights, which fits this machine's 16GB. A
 * window large enough to evict the weights would measure swap instead of the
 * model — also a measurement fault, in the opposite direction.
 */
const CONTEXT: Record<string, number> = {
  "gemma2:2b": 8192,                     // gemma-2's actual maximum
  "qwen2.5:7b-instruct-q4_K_M": 32768,   // qwen2.5's actual maximum; ~1.9GB of KV
};
export function contextWindow(modelId: string): number {
  return CONTEXT[modelId] ?? Number(process.env.FITS_NUM_CTX ?? 8192);
}

async function tags(): Promise<Map<string, TagEntry>> {
  if (tagCache) return tagCache;
  const r = await httpFetch(`${BASE}/api/tags`).catch((e) => {
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
      res = await httpFetch(`${BASE}/api/chat`, {
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

    /**
     * THE TRUNCATION CHECK. Rewritten after the first version failed to fire on
     * real data, which is the only reason we know it was wrong.
     *
     * Ollama truncates an oversized prompt instead of erroring, and it reports
     * the count in two DIFFERENT ways depending on the case. Both were observed
     * directly on this machine on 2026-08-29:
     *
     *   - `agents365__drawio` at num_ctx 16384 reported prompt_eval_count
     *     26,594 -- ABOVE the window. The full, untruncated count.
     *   - A 20,000-token probe at num_ctx 4096 reported prompt_eval_count 2,050
     *     -- far BELOW the window -- and a needle placed at the very start of
     *     the prompt was gone: the model answered garbage.
     *
     * The original check looked for a count near the window and caught neither.
     * A cell measured through a truncated prompt is a pass rate for a skill file
     * the model never read: the same class of fault as a substituted model, and
     * the exact confidently-wrong number this product exists to prevent.
     *
     * So both shapes are now checked, against the size we actually sent.
     */
    const promptTokens = j?.prompt_eval_count ?? 0;
    const sentChars = req.system.length + req.messages.reduce((a, m) => a + m.content.length, 0);
    // Deliberately conservative: 3.5 chars/token under-estimates for English
    // prose and code alike, so the floor below is a floor and not a guess.
    const estTokens = Math.round(sentChars / 3.5);

    if (promptTokens > numCtx) {
      throw new ProviderError(
        `prompt is ${promptTokens} tokens against a ${numCtx}-token window for ${modelId}. ` +
        `Ollama truncates rather than erroring, so this run measured a cut-off skill file. ` +
        `Recorded as context overflow — the skill does not fit this model, which is a ` +
        `packaging limit and not a pass rate.`,
        "context_overflow",
      );
    }
    if (promptTokens > 0 && promptTokens < estTokens * 0.7) {
      throw new ProviderError(
        `sent ~${estTokens} tokens (${sentChars} chars) but only ${promptTokens} were evaluated ` +
        `for ${modelId} at num_ctx ${numCtx}. The prompt was silently truncated and the model ` +
        `did not see the whole skill. Recorded as context overflow.`,
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
      context_window: numCtx,
      input_tokens: j?.prompt_eval_count ?? 0,
      output_tokens: j?.eval_count ?? 0,
      cost_usd: 0,
    };
    assertHonest(modelId, reply);
    return reply;
  },
};
