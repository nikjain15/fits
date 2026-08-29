/**
 * The browser entry point — the SAME engine, bundled for the page.
 *
 * WHY THIS EXISTS RATHER THAN A SECOND IMPLEMENTATION. The published site is
 * static, so running a test there means running it in the visitor's browser. The
 * obvious route is to write a compact JS runner for the page — and it is the
 * wrong one, because two graders means two truths. A browser that classified
 * `IGNORED` slightly differently from the engine would produce numbers that look
 * comparable to the published ones and are not, which is the same failure as
 * averaging two models into one size class, just harder to notice.
 *
 * So the protocol, the tool surface, the agent loop, the classifier and the case
 * generator are bundled from source and shipped to the page. One implementation,
 * one set of rules, whoever is running it.
 *
 * WHAT IS DIFFERENT IN THE BROWSER, and stated on the page rather than implied:
 *
 *   - The key is the VISITOR'S, held in their own browser and sent only to
 *     OpenRouter. It never reaches this project, and there is no server here to
 *     receive it.
 *   - A browser run is smaller than a published cell — a few trials, not 126
 *     calls — so it carries a wider interval and says so.
 *   - Its results are the visitor's own. They are NOT added to the published
 *     dataset, because nobody but the visitor can verify them, and an unverified
 *     row in a published rate is worth less than no row at all.
 */
export { buildSystemPrompt, parseTurn, PROTOCOL } from "./protocol.ts";
export { buildTools, TOOL_NAMES } from "./tools.ts";
export { runAgent } from "./agentloop.ts";
export { grade } from "./classify.ts";
export { extract } from "./extract.ts";
export { generate } from "./generate.ts";
export { parseSkill } from "./skills/parse.ts";
export { rateOf } from "./stats.ts";

import { assertHonest } from "./providers/index.ts";
export { assertHonest };

/**
 * A single OpenRouter call from the page, with the same honesty assertions the
 * server applies. Fallbacks off, caching refused, and the served model compared
 * to the requested one on every call — a substituted model is not a measurement
 * of the model you asked for, in a browser exactly as on a server.
 */
export async function browserComplete(
  key: string,
  modelId: string,
  req: { system: string; messages: Array<{ role: "user" | "assistant"; content: string }>; maxTokens: number; temperature?: number; disableReasoning?: boolean },
): Promise<{ text: string; served_model: string; cached: boolean; input_tokens: number; output_tokens: number; cost_usd: number; latency_ms: number }> {
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: req.maxTokens,
    messages: [{ role: "system", content: req.system }, ...req.messages],
    usage: { include: true },
    provider: { allow_fallbacks: false },
  };
  if (req.temperature !== undefined) { body.temperature = req.temperature; body.top_p = 1; body.seed = 7; }
  if (req.disableReasoning) body.reasoning = { enabled: false };

  const t0 = Date.now();
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      // Identifies the caller to OpenRouter; required for browser usage.
      "HTTP-Referer": (globalThis as any).location?.origin ?? "https://nikjain15.github.io",
      "X-Title": "Fits",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status}: ${t.slice(0, 160)}`);
  }
  const j: any = await r.json();
  const u = j?.usage ?? {};
  const reply = {
    text: j?.choices?.[0]?.message?.content ?? "",
    served_model: j?.model ?? "",
    served_provider: j?.provider ?? "unknown",
    quantization: "unknown",
    cached: Boolean(j?.cached ?? j?.cache_hit ?? u?.cache_hit ?? false),
    latency_ms: Date.now() - t0,
    context_window: 0,
    input_tokens: u.prompt_tokens ?? 0,
    output_tokens: u.completion_tokens ?? 0,
    cost_usd: typeof u.cost === "number" ? u.cost : 0,
  };
  assertHonest(modelId, reply);
  return reply;
}
