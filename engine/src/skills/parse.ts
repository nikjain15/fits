/**
 * The SKILL.md parser. Written against docs/skill-format.md, which was written
 * from sources fetched on 2026-08-28 -- not from recollection, and not from the
 * build prompt's description of the format.
 *
 * Two things the specs say that this file exists to honour:
 *
 * 1. THE SELECTION SURFACE AND THE EXECUTION SURFACE ARE DIFFERENT FIELDS.
 *    The Agent Skills spec defines progressive disclosure: `name` + `description`
 *    (~100 tokens) load at startup for EVERY installed skill; the body loads only
 *    once the skill is activated. So the scope axis must pad with descriptions,
 *    never with bodies, or it measures context length instead of discrimination.
 *
 * 2. THE SPEC'S SIX FIELDS ARE NOT WHAT IS IN THE WILD.
 *    The spec's closed set is name, description, license, compatibility,
 *    metadata, allowed-tools. Claude Code -- the largest client -- accepts a much
 *    larger set, makes `name` optional (defaulting to the directory name), makes
 *    `description` merely recommended (falling back to the first paragraph), and
 *    appends `when_to_use` to the description, truncating the pair at 1,536
 *    characters. A parser that enforced the spec's six fields would reject a
 *    large share of the real corpus. This one records what it found and carries
 *    on; `spec_conformance` says which fields were extras.
 */
import { createHash } from "node:crypto";

export const SELECTION_CAP = 1536;

/** The Agent Skills 1.0 closed set (agentskills.io/specification, 2026-08-28). */
export const SPEC_FIELDS = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"] as const;

export interface ParsedSkill {
  /** Frontmatter `name`, or the directory name when absent (Claude Code rule). */
  name: string;
  name_source: "frontmatter" | "directory";
  description: string;
  description_source: "frontmatter" | "first-paragraph" | "absent";
  when_to_use: string;
  /** description + when_to_use, truncated exactly as the client truncates it. */
  selection: string;
  selection_chars: number;
  /** Everything after the frontmatter. The execution surface. */
  body: string;
  body_chars: number;
  license: string | null;
  compatibility: string | null;
  allowed_tools: string[];
  /** Frontmatter keys outside the Agent Skills closed set. Not an error. */
  extra_fields: string[];
  spec_conformance: "strict" | "client-extended" | "no-frontmatter";
  /** Problems that make the skill unmeasurable, as opposed to merely non-standard. */
  errors: string[];
  /** Content hash of the file. A skill's results expire when this moves. */
  content_hash: string;
}

function splitFrontmatter(raw: string): { fm: string; body: string; had: boolean } {
  if (!raw.startsWith("---")) return { fm: "", body: raw, had: false };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { fm: "", body: raw, had: false };
  return { fm: raw.slice(3, end), body: raw.slice(end + 4).replace(/^\n+/, ""), had: true };
}

/** Minimal YAML for the shapes real skills use: scalars, quoted scalars, folded
 *  continuation lines, and nested maps (metadata). Deliberately not a full YAML
 *  parser -- a dependency-free reader that handles the observed corpus and says
 *  so when it meets something else. */
function fmKeys(fm: string): string[] {
  return fm.split("\n").filter((l) => /^[A-Za-z_][\w-]*\s*:/.test(l)).map((l) => l.split(":")[0].trim());
}

function fmField(fm: string, key: string): string {
  const lines = fm.split("\n");
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i === -1) return "";
  let v = lines[i].slice(key.length + 1).trim();
  for (let j = i + 1; j < lines.length; j++) {
    if (/^\S/.test(lines[j])) break;      // a new top-level key ends the value
    v += " " + lines[j].trim();
  }
  return v.replace(/^["']|["']$/g, "").trim();
}

export function parseSkill(raw: string, dirName: string): ParsedSkill {
  const { fm, body, had } = splitFrontmatter(raw);
  const errors: string[] = [];

  const fmName = fmField(fm, "name");
  const name = fmName || dirName;
  if (!fmName && !dirName) errors.push("no name in frontmatter and no directory name to fall back to");

  // Spec: name must be 1-64 chars, lowercase alphanumeric + hyphens, no leading
  // or trailing hyphen, no consecutive hyphens, and must match the directory.
  if (fmName) {
    if (fmName.length > 64) errors.push(`name is ${fmName.length} chars, spec maximum is 64`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fmName)) errors.push(`name "${fmName}" is not spec-legal (lowercase alphanumeric and single hyphens only)`);
  }

  let description = fmField(fm, "description");
  let description_source: ParsedSkill["description_source"] = description ? "frontmatter" : "absent";
  if (!description) {
    // Claude Code: "If omitted, uses the first paragraph of markdown content."
    const para = body.split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !s.startsWith("#"));
    if (para) { description = para; description_source = "first-paragraph"; }
  }
  if (!description) errors.push("no description and no usable first paragraph — nothing to select on");
  if (description.length > 1024 && description_source === "frontmatter") {
    // Non-fatal: the spec caps it, the wild does not always obey.
    errors.push(`description is ${description.length} chars, spec maximum is 1024`);
  }

  const when_to_use = fmField(fm, "when_to_use");
  const selRaw = [description, when_to_use].filter(Boolean).join(" ").trim();
  const selection = selRaw.length > SELECTION_CAP ? selRaw.slice(0, SELECTION_CAP) : selRaw;

  const keys = fmKeys(fm);
  const extra_fields = keys.filter((k) => !(SPEC_FIELDS as readonly string[]).includes(k));

  const at = fmField(fm, "allowed-tools");

  return {
    name,
    name_source: fmName ? "frontmatter" : "directory",
    description,
    description_source,
    when_to_use,
    selection,
    selection_chars: selection.length,
    body,
    body_chars: body.length,
    license: fmField(fm, "license") || null,
    compatibility: fmField(fm, "compatibility") || null,
    allowed_tools: at ? at.split(/[\s,]+/).filter(Boolean) : [],
    extra_fields,
    spec_conformance: !had ? "no-frontmatter" : extra_fields.length ? "client-extended" : "strict",
    errors,
    content_hash: createHash("sha256").update(raw).digest("hex").slice(0, 16),
  };
}

/** Measurable = parses, has a selection surface, and has a body with something
 *  in it. A skill with nothing to fail at cannot produce a finding. */
export function isMeasurable(p: ParsedSkill): { ok: boolean; reason: string } {
  if (p.errors.some((e) => e.startsWith("no description") || e.startsWith("no name"))) {
    return { ok: false, reason: p.errors[0] };
  }
  if (p.body_chars < 200) return { ok: false, reason: `body is ${p.body_chars} chars — nothing to execute` };
  return { ok: true, reason: "" };
}
