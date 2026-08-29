/**
 * Reading the answer key out of the skill file.
 *
 * THE IDEA, and why the whole generation plan rests on it. A skill that DOES
 * something documents its own invocations -- `pandoc -t markdown`, `qpdf
 * --empty --pages`, `python scripts/recalc.py`, `defuddle parse --md`. So the
 * skill file contains its own gold data, and a checker can be derived from it
 * with no model involved and no human writing one.
 *
 * That matters because of a trap. If a small model writes the test AND a small
 * model sits the test, a badly written test marks a model that did the RIGHT
 * thing as failing -- a false negative wearing a skill's name, which is exactly
 * the confidently-wrong number this product exists to prevent.
 *
 * The split that avoids it:
 *
 *   what counts as passing   extracted here, deterministically. No model.
 *   how a user phrases it    a model may propose wording. It can make a case
 *                            INVALID, which is visible and discardable. It can
 *                            never make a good model look bad, because it never
 *                            touches the assertion.
 *
 * WHAT THIS DOES NOT DO. A skill that is prose advice with no invocations in it
 * yields nothing here, and that is the correct output -- `measurable: false`.
 * Those skills are catalogued and never scored, and the site says which. FITS.md
 * §4 is explicit that this generalises exactly as far as skills that specify
 * concrete invocations, and no further.
 */
import type { ParsedSkill } from "./skills/parse.ts";

export interface Invocation {
  /** The command line as the skill writes it, trimmed. */
  command: string;
  /** The executable or entry point: `pandoc`, `qpdf`, `python scripts/recalc.py`. */
  head: string;
  /** Flags and subcommands that distinguish this invocation from its neighbours. */
  distinguishers: string[];
  /** The nearest human description of what this command is FOR: a table cell, a
   *  list-item lead-in, or the enclosing heading. This is the seed for a user
   *  request, and where it came from is recorded because a table cell is far
   *  better evidence than a distant heading. */
  purpose: string;
  purpose_source: "table-row" | "list-item" | "heading" | "preceding-line" | "none";
  /** Where in the body it was found, for auditing. */
  line: number;
  source: "fenced-block" | "inline-code" | "table-cell" | "code-api";
  /** True when the skill marks this as required/mandatory/always. Those make the
   *  strongest cases, because the skill itself says there is no alternative. */
  mandatory: boolean;
}

export interface Extraction {
  skill: string;
  invocations: Invocation[];
  /** Facts the skill asserts in prose, usable for abstain cases: a short claim
   *  that can be checked against the model's answer without any tool call. */
  claims: Claim[];
  /** Things the skill says NOT to do. The strongest abstain material there is,
   *  because the skill itself declares the boundary. */
  prohibitions: string[];
  measurable: boolean;
  reason: string;
}

export interface Claim {
  /** The sentence as written. */
  text: string;
  /** The token a correct answer must contain — a named tool, format or value. */
  answer: string;
  kind: "never-use" | "always-use" | "definition" | "default";
}

// ---------------------------------------------------------------------------
// Shell-command recognition
//
// Deliberately a WHITELIST of shapes rather than "anything in backticks". Skill
// files put prose, field names, file paths and JSON keys in backticks constantly;
// treating those as commands produced assertions that matched nothing and quietly
// generated unpassable tests.

/** Executables that appear as the head of a real invocation. */
const CMD_HEAD = /^(?:[a-z][\w.-]*\/)?([a-z][\w.-]{1,30})(?=\s|$)/i;

/** Heads that are almost always prose, not commands. */
const NOT_COMMANDS = new Set([
  "the", "a", "an", "this", "that", "it", "you", "we", "if", "when", "note",
  "true", "false", "null", "yes", "no", "name", "description", "type", "id",
  "string", "number", "boolean", "object", "array", "key", "value", "path",
  "e.g", "i.e", "etc", "example", "default", "optional", "required",
]);

/** A line only counts as a command if it looks like one: a plausible head plus
 *  at least one argument, flag, subcommand or path. A bare word is not a command. */
function looksLikeCommand(line: string): boolean {
  const s = line.trim();
  if (!s || s.length > 400) return false;
  if (/^[#>|]/.test(s)) return false;                      // comment, quote, table rule
  if (/^\s*[{}\[\]]/.test(s)) return false;                // JSON/YAML fragment
  if (/^(?:https?|ftp):\/\//.test(s)) return false;        // a URL
  const m = CMD_HEAD.exec(s);
  if (!m) return false;
  if (NOT_COMMANDS.has(m[1].toLowerCase())) return false;
  // Needs a second token that is a flag, a path, a subcommand or an argument.
  const rest = s.slice(m[0].length).trim();
  if (!rest) return false;
  return /^[-\w./"'$]/.test(rest);
}

/** Strip a shell prompt, a leading `$`, and any trailing comment. */
function cleanCommand(line: string): string {
  return line
    .replace(/^\s*[$>#]\s+/, "")
    .replace(/\s+#\s.*$/, "")
    .trim();
}

function headOf(cmd: string): string {
  const parts = cmd.split(/\s+/);
  // `python scripts/recalc.py` and `npx tsx foo.ts` — the script IS the identity.
  if (/^(python3?|node|npx|uv|bun|deno|sh|bash|ruby|perl)$/i.test(parts[0]) && parts[1]) {
    const second = parts[1].startsWith("-") ? parts[2] ?? parts[1] : parts[1];
    return `${parts[0]} ${second}`;
  }
  return parts[0];
}

function distinguishersOf(cmd: string): string[] {
  const out: string[] = [];
  for (const tok of cmd.split(/\s+/).slice(1)) {
    if (/^--?[a-z][\w-]*$/i.test(tok)) out.push(tok);                 // flags
    else if (/^[a-z][\w-]{1,20}$/i.test(tok) && out.length < 2) out.push(tok); // subcommands
    if (out.length >= 4) break;
  }
  return out;
}

// ---------------------------------------------------------------------------

const MANDATORY = /\b(must|mandatory|always|required|never skip|do not skip)\b/i;

export function extract(skill: string, p: ParsedSkill): Extraction {
  const lines = p.body.split("\n");
  const invocations: Invocation[] = [];
  const seen = new Set<string>();

  let heading = "";
  let inFence = false;
  let fenceLang = "";
  let fenceIntro = "";           // the line just before the fence opened

  const push = (
    command: string, purpose: string, purpose_source: Invocation["purpose_source"],
    line: number, source: Invocation["source"], context: string,
  ) => {
    const cmd = cleanCommand(command);
    if (!looksLikeCommand(cmd)) return;
    const head = headOf(cmd);
    // One invocation per (head + first distinguisher). A skill that shows the
    // same command six times with different filenames is one testable fact, not
    // six, and counting it six times would weight verbose skills more heavily.
    const dist = distinguishersOf(cmd);
    const key = `${head}|${dist[0] ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    invocations.push({
      command: cmd, head, distinguishers: dist,
      purpose: purpose.trim().slice(0, 200),
      purpose_source, line, source,
      mandatory: MANDATORY.test(context),
    });
  };

  /** A library or API call documented in a code sample. Identity is the dotted
   *  name; no arguments, because the sample's arguments are its own. */
  const pushApi = (name: string, purpose: string, line: number, context: string) => {
    const clean = name.replace(/^\(+|\)+$/g, "");
    if (clean.length < 3 || NOT_COMMANDS.has(clean.toLowerCase())) return;
    if (/^(self|this|console|logger|log|print|str|int|list|dict|os\.path)\b/i.test(clean)) return;
    const key = `api|${clean.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    invocations.push({
      command: clean, head: clean, distinguishers: [],
      purpose: purpose.trim().slice(0, 200),
      purpose_source: purpose ? "preceding-line" : "heading",
      line, source: "code-api", mandatory: MANDATORY.test(context),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    const fence = /^(?:```|~~~)(\w*)/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceLang = fence[1].toLowerCase();
        // Walk back for the sentence that introduces the block.
        fenceIntro = "";
        for (let j = i - 1; j >= 0 && j > i - 4; j--) {
          const t = lines[j].trim().replace(/[:`*]/g, "");
          if (t) { fenceIntro = t; break; }
        }
      } else {
        inFence = false; fenceLang = ""; fenceIntro = "";
      }
      continue;
    }

    if (inFence) {
      if (!fenceLang || /^(bash|sh|shell|console|zsh|terminal|cmd)$/.test(fenceLang)) {
        push(line, fenceIntro || heading, fenceIntro ? "preceding-line" : "heading",
             i + 1, "fenced-block", `${fenceIntro}\n${heading}\n${line}`);
        continue;
      }
      /**
       * A ```python block is not prose — for a large class of skills it IS the
       * documented invocation. Anthropic's own pdf, docx, xlsx and pptx skills
       * tell the agent what to do by showing Python, not a shell line: the pdf
       * skill documents OCR only as `import pytesseract` /
       * `pytesseract.image_to_string(...)`, and skipping these blocks lost that
       * case entirely.
       *
       * What is extracted is the LIBRARY and the CALL, never the whole snippet.
       * `pytesseract.image_to_string` is a documented capability; the surrounding
       * loop and variable names are not, and asserting on them would produce a
       * test that only the skill's exact sample code could pass.
       */
      if (/^(python|py|python3|javascript|js|typescript|ts|ruby|node)$/.test(fenceLang)) {
        for (const m of line.matchAll(/^\s*(?:import|from)\s+([a-zA-Z_][\w.]{1,40})/g)) {
          pushApi(m[1], fenceIntro || heading, i + 1, `${fenceIntro}\n${heading}\n${line}`);
        }
        for (const m of line.matchAll(/\b([a-zA-Z_][\w]{2,30})\.([a-zA-Z_][\w]{2,40})\s*\(/g)) {
          pushApi(`${m[1]}.${m[2]}`, fenceIntro || heading, i + 1, `${fenceIntro}\n${heading}\n${line}`);
        }
      }
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { heading = h[2].replace(/[`*]/g, "").trim(); continue; }

    // Table rows are the best evidence in the file: they pair a task with its
    // command explicitly. `| Read content | `pandoc -t markdown file.docx` |`
    if (/^\|/.test(line) && line.includes("`")) {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      const codeCells = cells.filter((c) => /`[^`]+`/.test(c));
      const proseCells = cells.filter((c) => !/`[^`]+`/.test(c) && c.length > 2);
      for (const cell of codeCells) {
        for (const m of cell.matchAll(/`([^`]+)`/g)) {
          push(m[1], proseCells[0] ?? heading, proseCells[0] ? "table-row" : "heading",
               i + 1, "table-cell", line);
        }
      }
      continue;
    }

    // Inline code in a list item or sentence.
    if (line.includes("`")) {
      const listLead = /^[-*+]\s+(.*)$/.exec(line);
      const prose = (listLead?.[1] ?? line).replace(/`[^`]*`/g, "").replace(/[*_]/g, "").trim();
      for (const m of line.matchAll(/`([^`]+)`/g)) {
        push(m[1], prose || heading, listLead ? "list-item" : prose ? "preceding-line" : "heading",
             i + 1, "inline-code", line);
      }
    }
  }

  const claims = extractClaims(p.body);
  const prohibitions = extractProhibitions(p.body);

  // A skill is measurable when it tells us at least one concrete thing to do.
  // Everything else is catalogued and left unscored, on purpose.
  const measurable = invocations.length > 0;
  return {
    skill,
    invocations: invocations.sort(rank),
    claims,
    prohibitions,
    measurable,
    reason: measurable
      ? `${invocations.length} documented invocations`
      : "no documented invocations — prose-only skill, catalogued but not scored",
  };
}

/** Best evidence first: a mandatory command named in a table beats a bare
 *  command under a distant heading. */
function rank(a: Invocation, b: Invocation): number {
  const score = (x: Invocation) =>
    (x.mandatory ? 4 : 0) +
    ({ "table-row": 3, "list-item": 2, "preceding-line": 2, heading: 1, none: 0 }[x.purpose_source]) +
    // A shell line the skill tells you to run is stronger evidence than a symbol
    // lifted out of a code sample, so shell ranks above API on a tie.
    (x.source === "code-api" ? 0 : 1) +
    (x.distinguishers.length ? 1 : 0);
  return score(b) - score(a);
}

// ---------------------------------------------------------------------------
// Claims and prohibitions — the material for abstain cases.

const CLAIM_PATTERNS: Array<{ re: RegExp; kind: Claim["kind"] }> = [
  { re: /\bnever use\s+`?([\w.\-/ ]{2,40})`?/i, kind: "never-use" },
  { re: /\bdo not use\s+`?([\w.\-/ ]{2,40})`?/i, kind: "never-use" },
  { re: /\balways use\s+`?([\w.\-/ ]{2,40})`?/i, kind: "always-use" },
  { re: /\buse\s+`([\w.\-/ ]{2,40})`\s+(?:instead|rather than|not)\b/i, kind: "always-use" },
  { re: /\bdefaults? to\s+`?([\w.\-/ ]{2,40})`?/i, kind: "default" },
  { re: /\bis (?:internally )?an?\s+([\w \-]{3,40})\b/i, kind: "definition" },
];

function extractClaims(body: string): Claim[] {
  const out: Claim[] = [];
  const seen = new Set<string>();
  for (const sentence of body.split(/(?<=[.!?])\s+|\n/)) {
    const s = sentence.trim();
    if (!s || s.length > 300) continue;
    for (const { re, kind } of CLAIM_PATTERNS) {
      const m = re.exec(s);
      if (!m) continue;
      const answer = m[1].trim().replace(/[.,;:]$/, "");
      if (answer.length < 2 || seen.has(answer.toLowerCase())) continue;
      seen.add(answer.toLowerCase());
      out.push({ text: s.replace(/[`*]/g, "").slice(0, 200), answer, kind });
      break;
    }
    if (out.length >= 12) break;
  }
  return out;
}

function extractProhibitions(body: string): string[] {
  const out: string[] = [];
  for (const sentence of body.split(/(?<=[.!?])\s+|\n/)) {
    const s = sentence.trim().replace(/[`*]/g, "");
    if (!s || s.length > 240) continue;
    if (/\b(never|do not|don't|must not|avoid)\b/i.test(s) && /\b(use|call|run|edit|write|modify|create)\b/i.test(s)) {
      out.push(s.slice(0, 200));
    }
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * The assertion for an invoke case: a regex over the proposed command.
 *
 * Built from the skill's own vocabulary and NOTHING else. Alternatives are
 * OR-ed because a skill that documents three ways to merge a PDF has three
 * right answers, and marking two of them wrong would be our error showing up as
 * the model's.
 */
export function assertionFor(inv: Invocation, siblings: Invocation[]): RegExp {
  const alts = new Set<string>([inv.head]);
  // Same purpose, different tool -> a documented alternative, not a wrong answer.
  for (const s of siblings) {
    if (s !== inv && s.purpose && s.purpose === inv.purpose) alts.add(s.head);
  }
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp([...alts].map(esc).join("|"), "i");
}
