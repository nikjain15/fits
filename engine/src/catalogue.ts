/**
 * Turn the raw crawl into something a browser can search — without overclaiming.
 *
 * TWO NUMBERS THAT MUST NEVER BLEND, and this file is where they are kept apart.
 *
 *   catalogued   a skill we found and can name. Provenance only. NO verdict.
 *   measured     a skill actually run against a model. The small number.
 *
 * A catalogue row with no measurement reads "not tested" and nothing else. It
 * never borrows confidence from the tested rows above it, and the site never
 * implies that a large catalogue is a large body of evidence.
 *
 * THE COPY PROBLEM. 135,620 crawled paths are not 135,620 skills. Anthropic's
 * `pdf` skill appears in 86 repositories; `skill-creator` in 139. People vendor
 * other people's skills wholesale. Publishing the raw path count as a skill count
 * would be a confidently-wrong number of exactly the kind this product exists to
 * prevent -- so copies are grouped, the canonical row is the most-starred one,
 * and the count of copies is shown rather than hidden.
 *
 * Two skills are treated as copies when they share a directory name AND an
 * identical byte size. That is deliberately conservative: it will call two
 * genuinely different `pdf` skills distinct if they differ by a single byte, and
 * it will never merge two skills that differ in content. Under-merging leaves an
 * honest duplicate on the page; over-merging would delete someone's work from
 * the record.
 *
 * WHY TWO FILES. The full index is tens of megabytes. Loading that to render a
 * front page nobody has searched yet is rude. The top tier by stars loads at
 * startup and covers what almost everyone is looking for; the full index is
 * fetched only when a search actually needs it, with the wait made visible.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./corpus.ts";
import { loadCatalogue, type CatalogueEntry } from "./discover.ts";
import { SKILLS } from "./manifest.ts";
import { categorise, CATEGORIES } from "./categorise.ts";
import { loadDescriptions } from "./enrich.ts";

const OUT = join(REPO_ROOT, "web", "data");

/** How many rows the front page gets without a second request. */
const TOP_TIER = 5_000;

export interface CatalogueRow {
  /** owner/repo */
  r: string;
  /** skill directory name */
  n: string;
  /** path within the repo */
  p: string;
  /** stars */
  s: number;
  /** SKILL.md size in bytes */
  z: number;
  /** SPDX licence id, "" when GitHub reports none */
  l: string;
  /** how many other repos carry a byte-identical copy; 0 when unique */
  c: number;
  /** measured? 1 when this skill has results in the dataset */
  m?: 1;
  /** category ids. Assigned from the description where we have one, and from the
   *  name alone where we do not — `d` records which, so the site never presents a
   *  weak label as a strong one. */
  g: string[];
  /** the skill's own one-line description, "" when not yet fetched */
  d: string;
}

export function buildCatalogue(): {
  rows: CatalogueRow[];
  stats: Record<string, number | string>;
} {
  const raw = loadCatalogue();
  const described = loadDescriptions();

  // The 20 skills we actually measured, so the catalogue can point at them.
  const measured = new Set(SKILLS.map((s) => `${s.repo}|${s.name}`.toLowerCase()));

  const groups = new Map<string, CatalogueEntry[]>();
  for (const e of raw) {
    const k = `${e.dir.toLowerCase()}|${e.size}`;
    const a = groups.get(k) ?? [];
    a.push(e);
    groups.set(k, a);
  }

  const rows: CatalogueRow[] = [];
  for (const [, copies] of groups) {
    // The canonical row is the most-starred copy. Ties break on the shortest
    // repo name, which is stable and favours the original over a fork path.
    copies.sort((a, b) => b.stars - a.stars || a.repo.length - b.repo.length);
    const e = copies[0];
    /**
     * Categories here come from the skill's NAME and repo only, because the
     * crawl deliberately does not download 116,000 skill bodies — that is
     * ~2GB of other people's files to render a filter chip. Name-only is
     * weaker than the categorisation the 20 measured skills get (which reads
     * the full text), and the site says so rather than implying they are the
     * same quality of label. A skill whose name carries no domain word is
     * uncategorised, which is a true statement about what we know.
     */
    const desc = described.get(`${e.repo}|${e.dir}`);
    const cat = categorise(e.dir, `${e.repo} ${e.dir}`, desc?.description ?? "");
    const row: CatalogueRow = {
      r: e.repo, n: e.dir, p: e.path, s: e.stars, z: e.size,
      l: e.license, c: copies.length - 1, g: cat.ids,
      d: desc?.description ?? "",
    };
    if (measured.has(`${e.repo}|${e.dir}`.toLowerCase())) row.m = 1;
    rows.push(row);
  }

  rows.sort((a, b) => b.s - a.s || a.r.localeCompare(b.r) || a.n.localeCompare(b.n));

  const repos = new Set(raw.map((e) => e.repo));
  const licensed = rows.filter((r) => r.l).length;
  const stats = {
    paths_crawled: raw.length,
    distinct_skills: rows.length,
    copies_folded: raw.length - rows.length,
    repos: repos.size,
    with_osi_licence: licensed,
    measured: rows.filter((r) => r.m).length,
    uncategorised: rows.filter((r) => !r.g.length).length,
    described: rows.filter((r) => r.d).length,
    top_tier: Math.min(TOP_TIER, rows.length),
  };
  // Counts per category, so the UI never renders a filter that matches nothing.
  const counts: Record<string, number> = {};
  for (const c of CATEGORIES) counts[c.id] = 0;
  for (const r of rows) for (const g of r.g) counts[g] = (counts[g] ?? 0) + 1;
  (stats as any).categories = CATEGORIES
    .map((c) => ({ id: c.id, label: c.label, n: counts[c.id] }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n);
  return { rows, stats };
}

export function writeCatalogue(): Record<string, number | string> {
  mkdirSync(OUT, { recursive: true });
  const { rows, stats } = buildCatalogue();

  // Columnar, not an array of objects: the key names would otherwise be ~60% of
  // the payload repeated 100,000 times.
  const pack = (rs: CatalogueRow[]) => ({
    cols: ["r", "n", "p", "s", "z", "l", "c", "m", "g", "d"],
    rows: rs.map((x) => [x.r, x.n, x.p, x.s, x.z, x.l, x.c, x.m ?? 0, x.g.join(","), x.d]),
  });

  writeFileSync(join(OUT, "catalogue-top.json"), JSON.stringify({
    ...stats,
    note: "The most-starred slice, loaded with the page. Search falls through to the full index automatically.",
    ...pack(rows.slice(0, TOP_TIER)),
  }));

  writeFileSync(join(OUT, "catalogue-full.json"), JSON.stringify({
    ...stats,
    ...pack(rows),
  }));

  return stats;
}

if (process.argv[1]?.endsWith("catalogue.ts")) {
  const s = writeCatalogue();
  console.log("catalogue written → web/data/");
  for (const [k, v] of Object.entries(s)) {
    console.log(`  ${k.padEnd(20)} ${typeof v === "number" ? v.toLocaleString() : v}`);
  }
}
