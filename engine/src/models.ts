/**
 * The model matrix. Eleven size classes, several real models per class wherever
 * they exist -- because two 4B models are not interchangeable and a class with
 * one model in it is a point we cannot generalise from.
 *
 * Nothing here is a promise that a model ran. `available()` resolves this list
 * against what the configured providers ACTUALLY offer, and anything missing is
 * recorded as not-run rather than quietly dropped, so an absent class is visible
 * in the data instead of being invisible on the site.
 */
import type { ModelSpec, SizeClass } from "./types.ts";
import { has } from "./secrets.ts";

export const MODELS: ModelSpec[] = [
  // ---- hosted, OpenRouter --------------------------------------------------
  //
  // RESOLVED AGAINST THE LIVE CATALOG on 2026-08-29, not written from memory.
  // Six ids in the first draft of this file had been WITHDRAWN since it was
  // written: qwen-2.5-0.5b, gemma-3-1b, qwen-2.5-1.5b, qwen-2.5-3b, qwen3-4b,
  // phi-4-mini-instruct, mistral-7b-instruct, gemma-2-9b. That is the reason the
  // brief says never to hardcode a model list, and the withdrawals are recorded
  // in WITHDRAWN below rather than quietly deleted — a class that lost its second
  // model stopped being a range, and that has to be visible.
  //
  // SELECTION RULE, applied uniformly so this is not cherry-picking:
  //   in    general-purpose instruction-tuned models with a stated parameter count
  //   out   :free  (rate-limited, and several mandate reasoning that cannot be
  //                 disabled — that measures decode settings, not model size)
  //   out   :batch duplicates of a model already listed
  //   out   task specialists — translation (hy-mt2), GUI agents (ui-tars),
  //         safety classifiers (llama-guard), vision-only and roleplay tunes
  //         (lunaris, mythomax, remm-slerp, aion-rp). They are real 8B models,
  //         but they are not what anyone installs a skill onto.

  { key: "llama-3.2-1b", id: "meta-llama/llama-3.2-1b-instruct", cls: "1B", lane: "hosted", provider: "openrouter", quantization: "unknown", sendTemperature: true, disableReasoning: false, note: "Below the 4B floor of arXiv 2602.16653. Prior run: strict pass 0.0% over 360 runs — it never emitted one valid tool call. Only 1B left in the catalog, so 1B is a point, not a range." },

  { key: "llama-3.2-3b", id: "meta-llama/llama-3.2-3b-instruct", cls: "3B", lane: "hosted", provider: "openrouter", quantization: "unknown", sendTemperature: true, disableReasoning: false, note: "" },
  { key: "ministral-3b", id: "mistralai/ministral-3b-2512", cls: "3B", lane: "hosted", provider: "openrouter", quantization: "unknown", sendTemperature: true, disableReasoning: false, note: "Second model in the 3B class, so 3B is a range." },

  { key: "gemma-3-4b", id: "google/gemma-3-4b-it", cls: "4B", lane: "hosted", provider: "openrouter", quantization: "unknown", sendTemperature: true, disableReasoning: false, note: "Replication anchor: same family/size as the paper's 0.78 skill-selection figure; we measured 0.829. The only 4B left in the catalog — the class people actually run is a POINT, and the site must say so." },

  { key: "qwen2.5-7b", id: "qwen/qwen-2.5-7b-instruct", cls: "7B", lane: "hosted", provider: "openrouter", quantization: "unknown", sendTemperature: true, disableReasoning: false, note: "Hosted counterpart of the local q4_K_M artifact. This pair is the whole quantization delta: same weights, different precision, and the gap between them is what a laptop user actually gets." },

  // The 8B class is the one that can answer the question the product exists for:
  // four real models, same badge. If they disagree, '8B+' is not a label.
  { key: "qwen3-8b", id: "qwen/qwen3-8b", cls: "8B", lane: "hosted", provider: "openrouter", quantization: "unknown", sendTemperature: true, disableReasoning: true, note: "Hybrid thinking model — reasoning explicitly disabled, or we would measure decode settings." },
  { key: "llama-3.1-8b", id: "meta-llama/llama-3.1-8b-instruct", cls: "8B", lane: "hosted", provider: "openrouter", quantization: "unknown", sendTemperature: true, disableReasoning: false, note: "" },
  { key: "granite-4.1-8b", id: "ibm-granite/granite-4.1-8b", cls: "8B", lane: "hosted", provider: "openrouter", quantization: "unknown", sendTemperature: true, disableReasoning: false, note: "Third 8B, different vendor lineage entirely." },
  { key: "ministral-8b", id: "mistralai/ministral-8b-2512", cls: "8B", lane: "hosted", provider: "openrouter", quantization: "unknown", sendTemperature: true, disableReasoning: false, note: "Fourth 8B." },

  { key: "qwen3.5-9b", id: "qwen/qwen3.5-9b", cls: "9B", lane: "hosted", provider: "openrouter", quantization: "unknown", sendTemperature: true, disableReasoning: true, note: "" },

  { key: "gemma-3-12b", id: "google/gemma-3-12b-it", cls: "12B", lane: "hosted", provider: "openrouter", quantization: "unknown", sendTemperature: true, disableReasoning: false, note: "" },
  { key: "mistral-nemo-12b", id: "mistralai/mistral-nemo", cls: "12B", lane: "hosted", provider: "openrouter", quantization: "unknown", sendTemperature: true, disableReasoning: false, note: "Top of the range that fits a 16GB laptop at q4." },

  {
    key: "claude-sonnet-5", id: "anthropic/claude-sonnet-5", cls: "frontier", lane: "hosted",
    provider: "openrouter", quantization: "fp-hosted", sendTemperature: false, disableReasoning: true,
    isCeiling: true,
    note: "A REFERENCE CEILING, not a product claim. It exists so a low small-model score reads as 'the model is too small' rather than 'the skill is broken'. One repeat run, not three: it needs no tight interval and it dominates the bill 20-100x.",
  },

  // ---- local, Ollama -------------------------------------------------------
  // The only lane that may report latency, and the only place the artifact under
  // test is the one a user would actually pull.
  {
    key: "gemma2-2b-q4_0", id: "gemma2:2b", cls: "2.6B", lane: "local",
    provider: "ollama", quantization: "Q4_0", sendTemperature: true, disableReasoning: false,
    note: "Local ground truth, 2.6B at Q4_0. The 2.6B class had no measurement at all before this: liquid/lfm-2.5-2.6b could not be run hosted because its endpoint mandates reasoning and returns empty content.",
  },
  {
    key: "qwen2.5-7b-q4km", id: "qwen2.5:7b-instruct-q4_K_M", cls: "7B", lane: "local",
    provider: "ollama", quantization: "Q4_K_M", sendTemperature: true, disableReasoning: false,
    note: "Local ground truth, 7B at Q4_K_M — the exact artifact a laptop user pulls. Paired with hosted qwen-2.5-7b-instruct, this is the quantization delta.",
  },
];

export const byKey = (k: string) => MODELS.find((m) => m.key === k);

/** Models in a class, in the order they are declared. A class is a range. */
/**
 * Ids that were in this roster and are no longer in the live catalog. Kept so a
 * class that LOST a model is visible as a loss rather than looking like a class
 * we never bothered to fill. A hosted model can vanish with no notice — which is
 * the same problem as one changing silently underneath a stable id, and the
 * reason the canary suite exists.
 */
export const WITHDRAWN: Array<{ id: string; cls: SizeClass; noticed: string }> = [
  { id: "qwen/qwen-2.5-0.5b-instruct", cls: "0.5B", noticed: "2026-08-29" },
  { id: "google/gemma-3-1b-it", cls: "1B", noticed: "2026-08-29" },
  { id: "qwen/qwen-2.5-1.5b-instruct", cls: "1.5B", noticed: "2026-08-29" },
  { id: "qwen/qwen-2.5-3b-instruct", cls: "3B", noticed: "2026-08-29" },
  { id: "qwen/qwen3-4b", cls: "4B", noticed: "2026-08-29" },
  { id: "microsoft/phi-4-mini-instruct", cls: "4B", noticed: "2026-08-29" },
  { id: "mistralai/mistral-7b-instruct", cls: "7B", noticed: "2026-08-29" },
  { id: "google/gemma-2-9b-it", cls: "9B", noticed: "2026-08-29" },
];

export function inClass(cls: SizeClass): ModelSpec[] {
  return MODELS.filter((m) => m.cls === cls);
}

/** Which models can actually run right now, given the environment. Everything
 *  else is not-run — a recorded state, never an estimate. */
export function available(): { runnable: ModelSpec[]; blocked: Array<{ model: ModelSpec; reason: string }> } {
  const runnable: ModelSpec[] = [];
  const blocked: Array<{ model: ModelSpec; reason: string }> = [];
  const hasKey = has("OPENROUTER_API_KEY");
  const localPulled = (process.env.FITS_LOCAL_MODELS ?? "gemma2:2b,qwen2.5:7b-instruct-q4_K_M")
    .split(",").map((s) => s.trim());

  for (const m of MODELS) {
    if (m.provider === "openrouter" && !hasKey) {
      blocked.push({ model: m, reason: "OPENROUTER_API_KEY not set — hosted lane unavailable" });
    } else if (m.provider === "ollama" && !localPulled.includes(m.id)) {
      blocked.push({ model: m, reason: `not pulled locally (ollama pull ${m.id})` });
    } else if (m.provider === "conduit") {
      blocked.push({ model: m, reason: "conduit gateway not serving real traffic yet" });
    } else {
      runnable.push(m);
    }
  }
  return { runnable, blocked };
}
