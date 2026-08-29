/**
 * Discovery — catalogue the open corpus of Agent Skills.
 *
 * There is NO official registry. Verified 2026-08-29: the Agent Plugins spec
 * deliberately leaves distribution, registries and marketplaces out of the
 * portable format (docs/skill-format.md §1), so there is no API to ask. The
 * corpus has to be crawled, and where it is crawled from is recorded on every
 * row rather than assumed.
 *
 * THE HONEST SHAPE OF THIS. Cataloguing is cheap; measuring is not. A measured
 * cell is 126 model calls, so 20,000 skills x one model is 2.5M calls and will
 * not happen. The product is therefore two numbers that must never be conflated:
 *
 *   catalogued   every skill we can find and parse. Provenance only. No verdict.
 *   measured     skills actually run against a model. This is the small number.
 *
 * The site shows both, always, side by side. A catalogue entry with no
 * measurement says "not measured" and nothing else — it never borrows
 * confidence from the skills next to it.
 *
 * WHY REPO-FIRST RATHER THAN CODE-SEARCH-FIRST. GitHub's code search reports
 * ~54,000 SKILL.md hits but returns at most 1,000 results for any one query, and
 * its slicing options are poor. Repository search has the same 1,000 cap but
 * slices cleanly by star count, so a ladder of star ranges walks the whole
 * population. One tree call per repo then yields every SKILL.md it contains, on
 * the 5,000/hour core limit rather than the 30/minute search limit.
 *
 * RESUMABLE. Every repo examined is recorded, so a restart never re-walks one.
 * The crawl is expected to be interrupted; that is the normal case, not an error.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./corpus.ts";
import { secret } from "./secrets.ts";

const DIR = join(REPO_ROOT, "data", "corpus");
const INDEX = join(DIR, "skills.jsonl");
const SEEN = join(DIR, "repos-seen.json");
const STATE = join(DIR, "crawl-state.json");

export interface CatalogueEntry {
  /** owner/repo/path/to/skill — unique, and the thing a user can click. */
  id: string;
  repo: string;
  path: string;
  /** Directory name, which the spec requires to match frontmatter `name`. */
  dir: string;
  name: string;
  description: string;
  stars: number;
  license: string;
  /** Default-branch SHA at the time of discovery. A skill is re-fetched only
   *  when this moves — that is the whole staleness rule. */
  commit: string;
  size: number;
  discovered_via: string;
  found_at: string;
}

// ---------------------------------------------------------------------------

const TOKEN = secret("GITHUB_TOKEN") ?? "";

async function gh(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const url = new URL(`https://api.github.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "fits-discovery",
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      },
    });
    if (r.ok) return r.json();

    // Secondary rate limits answer 403 with a Retry-After; primary limits answer
    // 403/429 with x-ratelimit-remaining: 0 and a reset epoch. Both are waited
    // out rather than retried blindly, because hammering a limit extends it.
    const remaining = r.headers.get("x-ratelimit-remaining");
    const reset = Number(r.headers.get("x-ratelimit-reset") ?? 0);
    if ((r.status === 403 || r.status === 429) && remaining === "0" && reset) {
      const waitMs = Math.max(1000, reset * 1000 - Date.now() + 1000);
      console.log(`  rate limit reached; sleeping ${Math.round(waitMs / 1000)}s`);
      await sleep(Math.min(waitMs, 15 * 60_000));
      continue;
    }
    const retryAfter = Number(r.headers.get("retry-after") ?? 0);
    if (r.status === 403 || r.status === 429) {
      await sleep(Math.max(retryAfter * 1000, 2000 * 2 ** attempt));
      continue;
    }
    if (r.status === 404 || r.status === 409) return null;   // empty repo, gone
    if (r.status >= 500) { await sleep(2000 * 2 ** attempt); continue; }
    throw new Error(`GitHub ${r.status} ${path}: ${(await r.text()).slice(0, 160)}`);
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------

/**
 * The star ladder. Repository search caps at 1,000 results per query, so the
 * population is walked in slices narrow enough that no slice overflows. Wide at
 * the top where repos are few, tight at the bottom where they are many.
 */
function starRanges(): string[] {
  const edges = [
    100000, 50000, 25000, 12000, 6000, 3000, 1500, 800, 400, 200,
    100, 60, 40, 25, 15, 10, 7, 5, 4, 3, 2, 1,
  ];
  const out: string[] = [`stars:>=${edges[0]}`];
  for (let i = 0; i < edges.length - 1; i++) out.push(`stars:${edges[i + 1]}..${edges[i] - 1}`);
  out.push("stars:0");
  return out;
}

/**
 * Repos that must be crawled regardless of what the topic search returns.
 *
 * Topic search only finds repos whose owners tagged them. Seven of the twenty
 * skills we have actually MEASURED live in repos carrying no relevant topic at
 * all — kepano/obsidian-skills, vercel-labs/agent-skills, browser-act/skills and
 * others — so the catalogue was missing the very skills the site has data for.
 * A discovery method that cannot find the things you already know about is not
 * finished; docs/skill-format.md §6 lists the hand-maintained seed list as the
 * fourth strategy for exactly this reason.
 */
const SEED_REPOS = [
  "anthropics/skills",
  "kepano/obsidian-skills",
  "vercel-labs/agent-skills",
  "browser-act/skills",
  "teng-lin/notebooklm-py",
  "K-Dense-AI/scientific-agent-skills",
  "addyosmani/agent-skills",
  "Agents365-ai/drawio-skill",
  "googleworkspace/agent-skills",
  "openclaw/openclaw",
];

/** Search surfaces, in the order docs/skill-format.md §6 records. */
const TOPICS = [
  "agent-skills", "claude-skills", "agent-plugins", "ai-skills",
  "claude-code", "skills", "agent-skill", "anthropic-skills",
];

interface CrawlState {
  queriesDone: string[];
  reposQueued: string[];
  reposDone: string[];
  startedAt: string;
}

function loadState(): CrawlState {
  if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, "utf8"));
  return { queriesDone: [], reposQueued: [], reposDone: [], startedAt: new Date().toISOString() };
}
const saveState = (s: CrawlState) => writeFileSync(STATE, JSON.stringify(s, null, 2));

// ---------------------------------------------------------------------------

/** Phase 1 — find repositories that plausibly contain skills. */
async function findRepos(state: CrawlState, budgetMs: number): Promise<void> {
  const t0 = Date.now();
  const queued = new Set(state.reposQueued);
  const done = new Set(state.reposDone);

  // Seeds first, so the repos we have measurements for are never missing from
  // the catalogue because a search happened not to surface them.
  for (const r of SEED_REPOS) {
    if (!queued.has(r) && !done.has(r)) { queued.add(r); state.reposQueued.unshift(r); }
  }
  saveState(state);

  for (const topic of TOPICS) {
    for (const range of starRanges()) {
      const q = `topic:${topic} ${range}`;
      if (state.queriesDone.includes(q)) continue;
      if (Date.now() - t0 > budgetMs) return;

      let page = 1;
      for (;;) {
        const j = await gh("/search/repositories", { q, per_page: 100, page, sort: "stars" });
        const items = j?.items ?? [];
        for (const it of items) {
          if (!queued.has(it.full_name) && !done.has(it.full_name)) {
            queued.add(it.full_name);
            state.reposQueued.push(it.full_name);
          }
        }
        if (items.length < 100 || page >= 10) break;   // 1,000-result ceiling
        page++;
        await sleep(2200);                             // 30 search req/min
      }
      state.queriesDone.push(q);
      saveState(state);
      console.log(`  ${q} → ${state.reposQueued.length} repos queued`);
      await sleep(2200);
    }
  }
}

/**
 * Phase 2 — walk each repo's tree once and record every SKILL.md in it.
 *
 * A skill is a DIRECTORY containing SKILL.md (Agent Skills spec §Directory
 * structure), so the directory name is the identity and the spec requires
 * frontmatter `name` to match it. Both are recorded; a mismatch is a real
 * finding about the corpus, not something to normalise away.
 */
async function walkRepos(state: CrawlState, budgetMs: number): Promise<number> {
  const t0 = Date.now();
  const done = new Set(state.reposDone);
  let found = 0;

  const queue = state.reposQueued.filter((r) => !done.has(r));
  for (const full of queue) {
    if (Date.now() - t0 > budgetMs) break;

    const meta = await gh(`/repos/${full}`);
    if (!meta) { done.add(full); state.reposDone.push(full); continue; }
    const branch = meta.default_branch ?? "main";
    const head = await gh(`/repos/${full}/commits/${branch}`, { per_page: 1 });
    const sha = head?.sha ?? "";
    const tree = await gh(`/repos/${full}/git/trees/${sha || branch}`, { recursive: 1 });

    const rows: CatalogueEntry[] = [];
    for (const node of tree?.tree ?? []) {
      if (node.type !== "blob") continue;
      if (!/(^|\/)SKILL\.md$/i.test(node.path)) continue;
      // A skill at the repo root has path "SKILL.md" and no directory segment.
      // The earlier expression left dir === "SKILL.md" for those, which turned
      // 544 distinct root-level skills into one meaningless bucket.
      const dir = /\//.test(node.path) ? node.path.replace(/\/SKILL\.md$/i, "") : "";
      rows.push({
        id: `${full}/${dir}`,
        repo: full,
        path: node.path,
        dir: dir ? (dir.split("/").pop() ?? dir) : (full.split("/").pop() ?? full),
        // name/description are filled in lazily when a skill is fetched for
        // measurement. Guessing them from the path would be inventing metadata.
        name: "",
        description: "",
        stars: meta.stargazers_count ?? 0,
        license: meta.license?.spdx_id ?? "",
        commit: sha,
        size: node.size ?? 0,
        discovered_via: "github repo search by topic + star slice, tree walk",
        found_at: new Date().toISOString(),
      });
    }
    if (rows.length) {
      appendFileSync(INDEX, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
      found += rows.length;
    }
    done.add(full);
    state.reposDone.push(full);
    if (state.reposDone.length % 25 === 0) {
      saveState(state);
      console.log(`  ${state.reposDone.length}/${state.reposQueued.length} repos · ${count()} skills catalogued`);
    }
  }
  saveState(state);
  return found;
}

export function count(): number {
  if (!existsSync(INDEX)) return 0;
  return readFileSync(INDEX, "utf8").split("\n").filter(Boolean).length;
}

export function loadCatalogue(): CatalogueEntry[] {
  if (!existsSync(INDEX)) return [];
  const seen = new Set<string>();
  const out: CatalogueEntry[] = [];
  for (const line of readFileSync(INDEX, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as CatalogueEntry;
      if (seen.has(e.id)) continue;    // a repo re-walked after a commit moved
      seen.add(e.id);
      out.push(e);
    } catch { /* a half-written line from a killed process; skip it */ }
  }
  return out;
}

// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(DIR, { recursive: true });
  if (!TOKEN) {
    console.log("No GITHUB_TOKEN — using the unauthenticated limit (60 req/hour).");
    console.log("Export a token, or run: GITHUB_TOKEN=$(gh auth token) npx tsx engine/src/discover.ts");
  }
  const minutes = Number(process.env.FITS_DISCOVER_MIN ?? 60);
  const state = loadState();
  console.log(`discovery — budget ${minutes} min · ${count()} skills already catalogued\n`);

  console.log("phase 1 — finding repositories");
  await findRepos(state, minutes * 60_000 * 0.35);
  console.log(`\nphase 2 — walking ${state.reposQueued.length - state.reposDone.length} repo trees`);
  await walkRepos(state, minutes * 60_000 * 0.65);

  const all = loadCatalogue();
  const repos = new Set(all.map((e) => e.repo));
  console.log(`\ncatalogued ${all.length} skills across ${repos.size} repos`);
  console.log(`  ${state.reposDone.length} repos examined, ${state.reposQueued.length - state.reposDone.length} still queued`);
  console.log(`  → ${INDEX}`);
}

/**
 * Entry guard. The first version of this used `import.meta.url === file://argv[1]`,
 * which tsx does not satisfy, so main() never ran and the process exited silently
 * with an empty log. Replacing it with a bare `main()` fixed that and introduced a
 * far worse bug: importing this module for its `loadCatalogue` helper STARTED A
 * CRAWL. Match on the filename instead, which holds under tsx and under node.
 */
if (/discover\.ts$/.test(process.argv[1] ?? "")) main();
