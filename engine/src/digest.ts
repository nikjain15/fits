/**
 * The morning digest.
 *
 * The deliverable of a night's run, not a side effect. It leads with what
 * CHANGED, because a dashboard nobody opens is not information.
 *
 * Order is fixed and it is not negotiable:
 *   1. What broke      — any non-zero BORING, any served-model substitution, any
 *                        cached response, any endpoint drift. These lead when
 *                        present, because a broken harness invalidates
 *                        everything below it.
 *   2. What moved      — verdict flips, with old and new, and whether the
 *                        intervals actually separate. A flip inside the noise is
 *                        reported as "no change, wider interval", never as news.
 *   3. What is new     — skills added, cells filled, classes that became
 *                        measurable.
 *   4. What it cost.
 *   5. One finding     — chosen by a fixed rule (largest verdict flip on the
 *                        most-starred skill), never by a model writing copy.
 *
 * A night that produced nothing says so in one line. It does not manufacture a
 * finding.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./corpus.ts";
import * as store from "./store.ts";
import { cells, markCeiling, type Cell as CellLike } from "./aggregate.ts";
import { MODELS } from "./models.ts";
import type { ResultRow } from "./types.ts";

const OUT = join(REPO_ROOT, "web", "digest");
const SNAP = join(REPO_ROOT, "data", "runs", "last-digest-snapshot.json");
const BAR = Number(process.env.FITS_BAR ?? 0.80);

interface Snapshot { [cellKey: string]: { rate: number; lo: number; hi: number; verdict: boolean } }

function main() {
  mkdirSync(OUT, { recursive: true });
  const nodes = store.allNodes();
  const rows: ResultRow[] = nodes.flatMap((n) => n.rows);
  if (!rows.length) {
    console.log("No rows. No digest written — an empty night is not a finding.");
    return;
  }
  markCeiling(rows);
  const C = cells(rows);

  const prev: Snapshot = existsSync(SNAP) ? JSON.parse(readFileSync(SNAP, "utf8")) : {};
  const now: Snapshot = {};
  for (const [k, c] of C) {
    now[k] = { rate: c.substance.rate, lo: c.substance.lo, hi: c.substance.hi, verdict: c.substance.rate >= BAR };
  }

  // ---- 1. what broke -------------------------------------------------------
  const boring = rows.filter((r) => r.bucket === "BORING");
  const substituted = rows.filter((r) => r.served_model && r.served_model !== r.model_id);
  const cached = rows.filter((r) => r.cached);
  const voided = store.liveDiscards(nodes);
  const broke: string[] = [];
  if (boring.length) {
    const byKind = new Map<string, number>();
    for (const r of boring) { const k = r.detail.split(":")[0]; byKind.set(k, (byKind.get(k) ?? 0) + 1); }
    broke.push(`**${boring.length} BORING failures** (${(100 * boring.length / rows.length).toFixed(1)}% of runs). ` +
      [...byKind].map(([k, v]) => `${v}× ${k}`).join(", ") +
      `. BORING is a smoke alarm for the harness, not a model verdict — treat every one as our bug until proven otherwise.`);
  }
  if (substituted.length) broke.push(`**${substituted.length} rows served by a different model than the one requested.** Those cells are void.`);
  if (cached.length) broke.push(`**${cached.length} cached responses.** A cache collapses the repeat-run spread and fabricates a tight interval. Everything downstream of these rows is unsafe.`);
  if (voided.length) {
    for (const v of voided.slice(0, 8)) broke.push(`cell void — \`${v.inputs?.skill} × ${v.inputs?.model}\`: ${v.discarded}`);
  }

  // ---- 2. what moved -------------------------------------------------------
  interface Flip { key: string; from: number; to: number; separates: boolean; stars: number }
  const flips: Flip[] = [];
  for (const [k, v] of Object.entries(now)) {
    const p = prev[k];
    if (!p) continue;
    if (p.verdict === v.verdict && Math.abs(p.rate - v.rate) < 0.02) continue;
    // Do the intervals actually separate? If not, this is not a change.
    const separates = v.lo > p.hi || p.lo > v.hi;
    const skill = k.split("|")[0];
    flips.push({ key: k, from: p.rate, to: v.rate, separates, stars: rows.find((r) => r.skill === skill)?.skill_stars ?? 0 });
  }

  // ---- 3. what is new ------------------------------------------------------
  const fresh = Object.keys(now).filter((k) => !prev[k]);
  const classes = [...new Set(rows.map((r) => r.size_class))];

  // ---- 4. cost -------------------------------------------------------------
  const spend = rows.reduce((a, r) => a + r.cost_usd, 0);

  // ---- 4b. the cold/warm latency gap --------------------------------------
  // Mechanical, not editorial: the largest first-run-versus-median gap in the
  // dataset. It earns a fixed section because latency is the only thing the
  // local lane is allowed to report, and the median alone is not what a user
  // feels the first time they run a skill.
  let latLine = "";
  {
    const gaps = [...C.values()]
      .filter((c) => c.cold_ms !== null && c.p50_ms !== null && c.p50_ms > 0)
      .map((c) => ({ c, ratio: c.cold_ms! / c.p50_ms! }))
      .sort((a, b) => b.ratio - a.ratio);
    if (gaps.length) {
      const g = gaps[0];
      latLine = `- Largest cold/warm gap: \`${g.c.skill} × ${g.c.model}\` — **${(g.c.cold_ms! / 1000).toFixed(1)}s on the first run** against ${(g.c.p50_ms! / 1000).toFixed(1)}s median, **${g.ratio.toFixed(0)}×**. The first run pays full prompt evaluation; every run after it reuses the runtime's KV prefix cache because the system prompt is identical. Both numbers are published and never merged — you feel the cold one the first time you run a skill.`;
    }
  }

  // ---- 5. one finding, by rule --------------------------------------------
  const separating = flips.filter((f) => f.separates).sort((a, b) => b.stars - a.stars || Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  let finding: string;
  if (separating.length) {
    const f = separating[0];
    finding = `\`${f.key}\` moved from ${f.from.toFixed(2)} to ${f.to.toFixed(2)}, and the intervals separate.`;
  } else if (fresh.length) {
    // No flips, but new ground. State the widest disagreement inside a class,
    // which is the finding that justifies the product existing.
    const split = splitClasses(C);
    finding = split
      ? `${split.cls} disagreed with itself: ${split.detail}. That gap is the reason a size-class badge cannot be read off one model.`
      : `${fresh.length} cells measured for the first time. **No size class disagreed with itself yet** — every class in this dataset has only one model in it, so there is nothing a class-level badge could be wrong about. That changes the moment a second model joins a class.`;
  } else {
    finding = "Nothing moved and nothing new landed.";
  }

  const date = new Date().toISOString().slice(0, 10);
  const md = [
    `# Fits — ${date}`,
    ``,
    `${rows.length.toLocaleString()} runs · ${C.size} cells · ${new Set(rows.map((r) => r.skill)).size} skills · ${new Set(rows.map((r) => r.model)).size} models · lane ${[...new Set(rows.map((r) => r.lane))].join(" + ")}`,
    ``,
    `## What broke`,
    broke.length ? broke.map((b) => `- ${b}`).join("\n")
      : `- Nothing. Zero BORING, no substituted models, no cached responses. The measurement is trustworthy at this level.`,
    ``,
    `## What moved`,
    flips.length
      ? flips.map((f) => f.separates
          ? `- \`${f.key}\` **${f.from.toFixed(2)} → ${f.to.toFixed(2)}** — the intervals separate, so this is a real change.`
          : `- \`${f.key}\` ${f.from.toFixed(2)} → ${f.to.toFixed(2)} — **no change, wider interval**. The intervals overlap; this is noise being reported honestly rather than as news.`).join("\n")
      : `- Nothing moved. ${Object.keys(prev).length ? "Every cell that existed yesterday still reads the same." : "First pass — there is no yesterday to compare against."}`,
    ``,
    `## What is new`,
    fresh.length ? `- ${fresh.length} cells measured for the first time.\n${freshLines(fresh)}` : `- No new cells.`,
    `- Classes present in the data: ${classes.join(", ")}.`,
    ``,
    `## What it cost`,
    `- $${spend.toFixed(4)} this dataset. ${spend === 0 ? "The local lane costs nothing but electricity and wall-clock." : ""}`,
    ``,
    `## Latency, cold against warm`,
    latLine || `- No local-lane latency in this dataset.`,
    ``,
    `## One finding`,
    finding,
    ``,
    `---`,
    `Chosen by a fixed rule — the largest verdict flip whose intervals separate, on the most-starred skill — and never by a model writing copy. A night that produced nothing says so.`,
    ``,
  ].join("\n");

  writeFileSync(join(OUT, `${date}.md`), md);
  writeFileSync(join(OUT, "latest.md"), md);
  writeFileSync(SNAP, JSON.stringify(now));
  console.log(md);
  console.log(`\nwritten → web/digest/${date}.md`);
}

function freshLines(fresh: string[]): string {
  const bySkill = new Map<string, number>();
  for (const k of fresh) { const s = k.split("|")[0]; bySkill.set(s, (bySkill.get(s) ?? 0) + 1); }
  return [...bySkill].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([s, n]) => `  - \`${s}\` — ${n} cell${n > 1 ? "s" : ""}`).join("\n");
}

/**
 * The widest WITHIN-CLASS disagreement.
 *
 * This must compare models that share a size class, and only those. An earlier
 * version grouped by skill alone and duly reported "qwen2.5-7b 1.00 vs
 * gemma2-2b 0.67" as a class disagreeing with itself — but those are 7B and
 * 2.6B, and a bigger model scoring higher than a smaller one is the expected
 * ordering, not a finding. Reporting it as one would have been precisely the
 * confidently-wrong number this product exists to prevent, in the product's own
 * morning digest.
 *
 * A class disagreeing with itself is the finding that justifies the whole thing:
 * if every model in a class agreed, "4B+" would be a safe label and Fits would
 * have nothing to say.
 */
function splitClasses(C: Map<string, CellLike>): { cls: string; detail: string; spread: number } | null {
  const byClassSkill = new Map<string, Array<{ model: string; rate: number }>>();
  for (const c of C.values()) {
    if (c.condition !== "A") continue;
    const spec = MODELS.find((m) => m.key === c.model);
    if (!spec) continue;
    const g = `${c.skill}|${spec.cls}`;
    const a = byClassSkill.get(g) ?? [];
    a.push({ model: c.model, rate: c.substance.rate });
    byClassSkill.set(g, a);
  }
  let best: { cls: string; detail: string; spread: number } | null = null;
  for (const [g, ms] of byClassSkill) {
    if (ms.length < 2) continue;          // one model is not a class
    const rs = ms.map((m) => m.rate);
    const spread = Math.max(...rs) - Math.min(...rs);
    if (spread === 0) continue;
    if (!best || spread > best.spread) {
      const [skill, cls] = g.split("|");
      best = {
        cls: `${cls} on \`${skill}\``,
        spread,
        detail: ms.sort((a, b) => b.rate - a.rate).map((m) => `${m.model} ${m.rate.toFixed(2)}`).join(" vs "),
      };
    }
  }
  return best;
}

main();
