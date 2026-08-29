/**
 * Loads the corpus off disk and joins it to its provenance.
 *
 * `corpus/skills/*.md` are the 20 real published skills, fetched verbatim from
 * public GitHub repositories on 2026-08-28. Nothing in them was written by us.
 * Provenance (repo, stars, commit, licence) is recorded per skill so it is never
 * guessed, and `license_ok` is recorded rather than enforced -- see
 * docs/skill-format.md §6.4 for why a strict OSI filter would delete the
 * canonical corpus.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkill, isMeasurable, type ParsedSkill } from "./skills/parse.ts";
import { SKILLS, type SkillMeta } from "./manifest.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..");
const SKILL_DIR = join(REPO_ROOT, "corpus", "skills");

export interface CorpusSkill extends SkillMeta {
  parsed: ParsedSkill;
  /** Whether GitHub reported an OSI licence for the source repo. */
  license_ok: boolean;
  license_note: string;
  measurable: boolean;
  unmeasurable_reason: string;
  discovered_via: string;
}

/** Repos whose licence metadata GitHub reports as absent. Recorded, not hidden.
 *  `anthropics/skills` (172k stars) ships no LICENSE file at the repo root, so a
 *  literal "must have an OSI licence" discovery filter excludes the single most
 *  important repo in the corpus. These are hand-vetted as public reference
 *  material and carried with license_ok:false so nothing is silently included. */
const LICENCE_EXCEPTIONS: Record<string, string> = {
  "anthropics/skills": "GitHub reports license:null — no LICENSE file at repo root. Individual skills carry their own `license:` frontmatter (pdf: 'Proprietary. LICENSE.txt has complete terms'). Hand-vetted, public, and flagged rather than dropped.",
};

let cache: CorpusSkill[] | null = null;

export function loadCorpus(): CorpusSkill[] {
  if (cache) return cache;
  cache = SKILLS.map((meta) => {
    const path = join(SKILL_DIR, `${meta.id}.md`);
    if (!existsSync(path)) throw new Error(`corpus file missing: ${path}`);
    const raw = readFileSync(path, "utf8");
    const parsed = parseSkill(raw, meta.name);
    const m = isMeasurable(parsed);
    const exception = LICENCE_EXCEPTIONS[meta.repo];
    return {
      ...meta,
      parsed,
      license_ok: !exception,
      license_note: exception ?? (parsed.license ? `skill frontmatter: ${parsed.license}` : "repo licence assumed from GitHub metadata"),
      measurable: m.ok,
      unmeasurable_reason: m.reason,
      discovered_via: "seeded (prior experiment corpus, GitHub REST 2026-08-28)",
    };
  });
  return cache;
}

export function skillById(id: string): CorpusSkill {
  const s = loadCorpus().find((x) => x.id === id);
  if (!s) throw new Error(`unknown skill: ${id}`);
  return s;
}

/** Files actually present, for cross-checking the manifest against the disk. */
export function filesOnDisk(): string[] {
  return readdirSync(SKILL_DIR).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
}
