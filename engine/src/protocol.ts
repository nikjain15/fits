/**
 * The tool-call protocol, the system prompt, and the turn parser.
 *
 * WHY A TEXT PROTOCOL RATHER THAN NATIVE TOOL-CALLING.
 * Several models in the matrix have no native tool API on their provider (on
 * OpenRouter: google/gemma-3-4b-it, meta-llama/llama-3.2-1b-instruct). Using the
 * native API would make those fail 100% of cases for a HARNESS reason, producing
 * an all-BORING result that measures our plumbing. One uniform text protocol
 * across every model keeps the comparison clean: every difference is model
 * capability, not API surface.
 *
 * The cost of that choice, stated wherever the numbers are: a text protocol is
 * HARDER than a native tool API for models that have one. Absolute rates read
 * LOW. The ranking between models and the failure mix are unaffected, and the
 * headline number must always be reported as protocol-dependent.
 */
import type { ToolSpec } from "./tools.ts";

export const PROTOCOL = `You act by replying with exactly ONE JSON object and nothing else.

To use a tool:
{"tool": "<tool name>", "args": { ... }}

To give your final answer:
{"answer": "<your answer>"}

Rules:
- Output the JSON object only. No prose before or after it. No markdown fences.
- "tool" MUST be one of the tool names listed above. A Skill is NOT a tool and
  cannot be called by name: a Skill tells you WHICH tool to use and WITH WHAT
  arguments. To follow a Skill that documents a command line, call the "bash"
  tool and put that command line in args.command.
- Call a tool only when the task actually requires it. If the task is a question
  you can answer directly, reply with {"answer": ...} and do not call a tool.
- After a tool returns, either call another tool or give {"answer": ...}.`;

export interface ScopedSkill {
  id: string;
  name: string;
  /** The selection surface: description (+ when_to_use), truncated as the client
   *  would truncate it. See docs/skill-format.md §4. */
  selection: string;
  /** The execution surface: the SKILL.md body. Only in scope once activated. */
  body: string;
}

/** Claude Code truncates description + when_to_use at 1,536 chars in the listing.
 *  Documented, verified, and applied here so the selection surface we measure is
 *  the one a real client would show. */
export const SELECTION_CAP = 1536;

export function selectionSurface(description: string, whenToUse?: string): string {
  const s = [description, whenToUse].filter(Boolean).join(" ").trim();
  return s.length > SELECTION_CAP ? s.slice(0, SELECTION_CAP) : s;
}

/**
 * Build the system prompt.
 *
 * Condition A: only the skill under test is in scope — its selection surface and
 * its full body.
 *
 * Condition B / scope axis: every in-scope skill's NAME + SELECTION SURFACE is
 * listed, and the body of the skill under test is still supplied. That mirrors
 * progressive disclosure exactly as the Agent Skills spec defines it (metadata
 * for all skills at startup, body only on activation), so the axis measures
 * discrimination and not context length.
 */
export function buildSystemPrompt(
  underTest: ScopedSkill,
  tools: ToolSpec[],
  library: ScopedSkill[] | null,
): { system: string; skillsInScope: number } {
  const toolBlock = tools
    .map((t) => `- ${t.name}: ${t.description}\n  args schema: ${JSON.stringify(t.jsonSchema)}`)
    .join("\n");

  const parts: string[] = [
    "You are an AI agent with access to tools and to installed Skills.",
    `\n## Available tools\n${toolBlock}`,
    `\n## Protocol\n${PROTOCOL}`,
  ];

  if (library && library.length > 1) {
    const list = library.map((s) => `- ${s.name}: ${s.selection}`).join("\n");
    parts.push(`\n## Installed skills (${library.length})\nChoose the one that applies to the request.\n${list}`);
  }

  parts.push(`\n## Skill: ${underTest.name}\n${underTest.selection}\n\n${underTest.body}`);
  return { system: parts.join("\n"), skillsInScope: library ? library.length : 1 };
}

export type ParseKind = "tool" | "answer" | "unparseable_tool_attempt" | "unparseable_prose" | "empty";

export interface ParsedTurn {
  kind: ParseKind;
  tool?: { name: string; args: unknown };
  answer?: string;
  raw: string;
}

const TOOL_WORDS = /"tool"|"name"\s*:|"args"|bash|read_file|write_file|list_files|browser_|http_get/i;

/** First balanced {...} block, ignoring braces inside strings. */
function firstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

export function parseTurn(rawIn: string): ParsedTurn {
  const raw = (rawIn ?? "").trim();
  if (!raw) return { kind: "empty", raw };

  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const block = firstJsonObject(unfenced);

  if (block) {
    try {
      const o = JSON.parse(block) as Record<string, unknown>;
      if (typeof o.tool === "string") {
        // Accept BOTH shapes. Models frequently flatten arguments to the top
        // level -- {"tool":"bash","command":"..."}. Reading only `args` silently
        // discarded a semantically perfect call and scored it as an ARGS failure.
        const nested = (o as any).args;
        const flat = Object.fromEntries(Object.entries(o).filter(([k]) => k !== "tool" && k !== "args"));
        const args = nested && typeof nested === "object" && Object.keys(nested).length ? nested
          : Object.keys(flat).length ? flat
          : (nested ?? {});
        return { kind: "tool", tool: { name: o.tool, args }, raw };
      }
      if (typeof o.name === "string" && ("arguments" in o || "args" in o)) {
        return { kind: "tool", tool: { name: o.name, args: (o as any).args ?? (o as any).arguments ?? {} }, raw };
      }
      if (typeof o.answer === "string") return { kind: "answer", answer: o.answer, raw };
      if (typeof o.answer === "number" || typeof o.answer === "boolean") {
        return { kind: "answer", answer: String(o.answer), raw };
      }
    } catch { /* fall through */ }
  }

  // No usable JSON. Distinguish "tried to call a tool and botched it" from
  // "just wrote prose" — an argument-formation failure is not a non-invocation.
  return { kind: TOOL_WORDS.test(raw) ? "unparseable_tool_attempt" : "unparseable_prose", raw };
}
