/**
 * Fetch each catalogued skill's own `name` and `description`, so the directory
 * can be browsed rather than only grep-ed.
 *
 * WHY THIS IS NEEDED, measured rather than assumed. Categorising from the
 * directory name alone left 72% of the corpus uncategorised — and inspecting
 * those names shows that is not a weak implementation, it is the truth:
 * `blucli`, `crabbox`, `deslop`, `gog`, `clawsweeper`. No rule recovers a domain
 * from those, and a model guessing at them would invent 90,000 plausible labels
 * nobody would ever check.
 *
 * The `description` field is the fix, and it is the right one on the spec's own
 * terms: Agent Skills requires it to say "what the skill does and when to use
 * it", and it is the ONLY thing a client loads at startup to decide whether a
 * skill applies (docs/skill-format.md §2, progressive disclosure). If a
 * description cannot tell you what a skill is for, the skill has a real problem
 * that is worth surfacing rather than papering over.
 *
 * COST. Fetched from raw.githubusercontent.com, which serves the file directly
 * and does not spend the REST API's 5,000/hour budget — so the crawl and this
 * can run at the same time without starving each other. Only the first 4KB of
 * each file is read: frontmatter is at the top, and pulling whole bodies would
 * mean downloading gigabytes of other people's files to render a filter chip.
 *
 * Resumable, and ordered by stars, so an interrupted pass has always enriched
 * the rows people are most likely to look at.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./corpus.ts";
import { buildCatalogue } from "./catalogue.ts";
import { parseSkill } from "./skills/parse.ts";

const DIR = join(REPO_ROOT, "data", "corpus");
const OUT = join(DIR, "descriptions.jsonl");

export interface Described {
  /** repo|dir, matching the catalogue row's identity. */
  k: string;
  /** frontmatter name, "" when absent — which is itself a finding. */
  name: string;
  description: string;
  /** How the description was obtained, never guessed. */
  src: "frontmatter" | "first-paragraph" | "absent" | "fetch-failed";
}

export function loadDescriptions(): Map<string, Described> {
  const out = new Map<string, Described>();
  if (!existsSync(OUT)) return out;
  for (const line of readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const d = JSON.parse(line) as Described; out.set(d.k, d); } catch { /* half-written line */ }
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchHead(repo: string, commit: string, path: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${repo}/${commit || "HEAD"}/${path}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { range: "bytes=0-4095", "user-agent": "fits-enrich" } });
      if (r.status === 200 || r.status === 206) return await r.text();
      if (r.status === 404) return null;
      if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }
      return null;
    } catch {
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  const limit = Number(process.env.FITS_ENRICH_LIMIT ?? 8000);
  const concurrency = Number(process.env.FITS_ENRICH_CONCURRENCY ?? 8);

  const { rows } = buildCatalogue();
  const have = loadDescriptions();
  const todo = rows.slice(0, limit).filter((r) => !have.has(`${r.r}|${r.n}`));

  console.log(`enrich — ${have.size} already described · ${todo.length} to fetch (top ${limit} by stars)\n`);

  let done = 0, ok = 0, missing = 0;
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const row = todo[cursor++];
      if (!row) return;
      const raw = await fetchHead(row.r, "", row.p);
      let d: Described;
      if (raw === null) {
        d = { k: `${row.r}|${row.n}`, name: "", description: "", src: "fetch-failed" };
        missing++;
      } else {
        // parseSkill already implements the spec's frontmatter rules and Claude
        // Code's "fall back to the first paragraph" behaviour, so the same reader
        // that measures a skill also describes it. One parser, one set of rules.
        const p = parseSkill(raw, row.n);
        d = {
          k: `${row.r}|${row.n}`,
          name: p.name,
          description: p.description.slice(0, 400),
          src: p.description_source,
        };
        if (p.description) ok++;
      }
      appendFileSync(OUT, JSON.stringify(d) + "\n");
      done++;
      if (done % 250 === 0) {
        console.log(`  ${done}/${todo.length} · ${ok} described · ${missing} unreachable`);
      }
      await sleep(60);   // polite: ~8 workers x 60ms is well under any abuse threshold
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  console.log(`\ndone · ${ok} described · ${missing} unreachable · → ${OUT}`);
}

if (/enrich\.ts$/.test(process.argv[1] ?? "")) main();
