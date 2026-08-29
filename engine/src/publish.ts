/**
 * Emits web/data/*.json. Pure: reads the node store, writes JSON.
 *
 * The shape is a superset of the mockup's embedded `D` blob, so the site is a
 * port rather than a rewrite -- with the fields the mockup could not carry
 * because it had no engine behind it: intervals, case counts, lanes,
 * quantization, served provider, model digests, and the not-measured list.
 *
 * WHAT THIS FILE REFUSES TO EMIT
 *   - a rate without n_cases, n_calls, lo and hi
 *   - a size class averaged to a point
 *   - a latency for a hosted cell
 *   - a cell that was discarded, stopped early, or is over 20% BORING, as if it
 *     were a measurement
 *   - anything at all for a model that did not run: it appears in `not_measured`
 *     with the reason, and nowhere else
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, loadCorpus } from "./corpus.ts";
import { MODELS, available } from "./models.ts";
import * as store from "./store.ts";
import { writeCatalogue, buildCatalogue } from "./catalogue.ts";
import { categorise, CATEGORY_LABEL } from "./categorise.ts";
import { cells, markCeiling, modelSummary, classesFor, specFor, quantizationDeltas } from "./aggregate.ts";
import { SIZE_CLASS_ORDER, HARNESS_VERSION, type Condition, type ResultRow } from "./types.ts";
import { acceptance, suiteFor } from "./cases.ts";
import { THIN_CALLS, THIN_CASES } from "./stats.ts";

const OUT = join(REPO_ROOT, "web", "data");

/** Windows for rows produced before `context_window` was recorded on the row.
 *  Mirrors engine/src/providers/ollama.ts. */
const LEGACY_WINDOW: Record<string, number> = {
  "gemma2:2b": 8192,
  "qwen2.5:7b-instruct-q4_K_M": 16384,
};
const BAR = Number(process.env.FITS_BAR ?? 0.80);

/**
 * How many OTHER repositories carry a byte-identical copy of this skill.
 *
 * This is the honest skill-level adoption signal. Repo stars are not: a repo
 * with 172,282 stars and 19 skills has not given any one of them 172,282 votes.
 * Someone vendoring a specific file into their own project is a considered act
 * about that file.
 */
let _catRows: any[] | null = null;
function copiesOf(repo: string, name: string): number {
  if (_catRows === null) {
    try { _catRows = buildCatalogue().rows; } catch { _catRows = []; }
  }
  const hit = _catRows.find((r) => r.r === repo && r.n === name);
  return hit ? hit.c : 0;
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const nodes = store.allNodes();
  let rows: ResultRow[] = nodes.flatMap((n) => n.rows);

  if (!rows.length) {
    console.error("No rows in the node store. Nothing published — an empty dataset is not a zero.");
    process.exit(1);
  }

  /**
   * THE TRUNCATION ASSERTION.
   *
   * A row whose largest single call exceeded its context window measured a skill
   * file the model never fully read. Ollama truncates instead of erroring, so
   * such a row LOOKS like a clean result -- it has a pass rate, a latency and no
   * BORING. It is not a measurement, and the first version of this engine
   * published a whole night of them.
   *
   * This check lives at publish time rather than only in the provider, so the
   * invariant holds no matter what any node on disk happens to contain, and no
   * matter which version of the provider produced it. Offending rows are dropped
   * and counted; they never reach a rate.
   */
  // `max_prompt_tokens` and `context_window` were added after the first night's
  // run, so older rows carry neither. For those, the largest single call is
  // bounded below by (accumulated prompt tokens / number of model calls), and
  // the call count is bounded above by steps + 1. If even that LOWER BOUND
  // exceeds the window, the prompt was provably truncated. Rows that cannot be
  // decided either way are counted as unverifiable and said so — never quietly
  // trusted, and never quietly dropped.
  const windowOf = (r: ResultRow) =>
    r.context_window ?? LEGACY_WINDOW[r.model_id] ?? 0;
  const maxPromptOf = (r: ResultRow) =>
    r.max_prompt_tokens ?? Math.round(r.input_tokens / Math.max(1, (r.steps ?? 0) + 1));

  const truncated = rows.filter((r) => windowOf(r) > 0 && maxPromptOf(r) > windowOf(r));
  const suspect = rows.filter((r) =>
    r.max_prompt_tokens === undefined && windowOf(r) > 0 && !truncated.includes(r) &&
    // Only a row whose accumulated total already exceeds the window is in doubt;
    // one that fits even as a single call is decided.
    r.input_tokens > windowOf(r));
  if (truncated.length || suspect.length) {
    const cellsHit = [...new Set(truncated.map((r) => `${r.skill}|${r.model}|${r.condition}`))];
    console.error(
      `\n  ! ${truncated.length} rows exceeded their context window and were DROPPED — ` +
      `${cellsHit.length} cells affected. Those prompts were silently truncated, so the ` +
      `model never saw the whole skill file. This is a packaging limit, not a pass rate.`,
    );
    for (const c of cellsHit.slice(0, 10)) console.error(`      ${c}`);
    if (suspect.length) {
      console.error(
        `  ! ${suspect.length} rows accumulated more than their window across steps and predate ` +
        `per-call accounting, so whether any single call was truncated cannot be decided. ` +
        `Dropped rather than trusted.`,
      );
    }
  }
  const dropped = new Set([...truncated, ...suspect]);
  rows = rows.filter((r) => !dropped.has(r));
  if (!rows.length) {
    console.error("Every row was dropped by the truncation check. Nothing published.");
    process.exit(1);
  }

  const { ceilingFailed, noCeiling } = markCeiling(rows);
  const C = cells(rows);
  const corpus = loadCorpus();
  const { blocked } = available();

  // ---- models actually present in the data ---------------------------------
  const presentKeys = [...new Set(rows.map((r) => r.model))];
  const M = MODELS.filter((m) => presentKeys.includes(m.key)).map((m) => {
    const A = modelSummary(rows, m.key, "A");
    const B = modelSummary(rows, m.key, "B");
    const digest = rows.find((r) => r.model === m.key)?.model_digest ?? "";
    const served = rows.find((r) => r.model === m.key)?.served_provider ?? "unknown";
    return {
      m: m.key, id: m.id, cls: m.cls, P: SIZE_CLASS_ORDER.indexOf(m.cls),
      lane: m.lane, quantization: m.quantization, served_provider: served,
      digest, is_ceiling: Boolean(m.isCeiling), note: m.note,
      A, B,
      bk: A?.buckets ?? {}, at: A?.attribution ?? {}, kd: A?.by_kind ?? {},
      f1: A?.call_validity ?? 0, nd: A?.nd ?? 0,
      // Whether the provider offers a native tool API is a deployment constraint
      // that exists before any skill is written, and belongs on a min-spec label
      // independently of skill quality.
      native: m.lane === "local" ? false : !["gemma-3-4b", "llama-3.2-1b", "gemma-3-1b"].includes(m.key),
      p50: A?.p50_ms ?? null,
      cold_p50: A?.cold_p50_ms ?? null,
      latency_note: m.lane === "local" ? "" : "not_comparable: hosted latency is network + queue + batching",
    };
  }).sort((a, b) => a.P - b.P);

  /**
   * AUTO-DERIVED SKILLS NEVER REACH THE PUBLISHED DATASET.
   *
   * A skill pasted into the local Test button is fetched, given a suite derived
   * from its own text, and run through the same engine — so its rows land in the
   * node store beside everything else. They must not land on the SITE: nobody has
   * accepted those cases, and folding an unreviewed suite into a corpus rate is
   * the same overclaim as averaging two models into one size class.
   *
   * They are dropped here, at the publish boundary, rather than by never storing
   * them — the run is real evidence for the person who asked for it, and it stays
   * in data/nodes/ where they can read it.
   */
  const inCorpus = new Set(corpus.map((c) => c.id));
  const autoRows = rows.filter((r) => !inCorpus.has(r.skill));
  if (autoRows.length) {
    const names = [...new Set(autoRows.map((r) => r.skill))];
    console.log(`  ${autoRows.length} rows from ${names.length} auto-derived skill(s) held back — no human has accepted those suites: ${names.join(", ")}`);
    rows = rows.filter((r) => inCorpus.has(r.skill));
  }

  // ---- skills --------------------------------------------------------------
  const skillIds = [...new Set(rows.map((r) => r.skill))];
  const S: Record<string, unknown> = {};
  for (const id of skillIds) {
    const s = corpus.find((x) => x.id === id)!;
    const acc = acceptance(id);
    S[id] = {
      repo: s.repo, url: s.url, stars: s.stars, chars: s.parsed.body_chars,
      /**
       * CREDIBILITY, and the one signal everybody gets wrong.
       *
       * `stars` is the REPOSITORY's star count, not the skill's. anthropics/skills
       * has 172,282 stars across 19 skills; not one of those stars is a vote for
       * the `pdf` skill specifically. Published because it is what exists and
       * people look for it, labelled on the site as repo-level so it cannot be
       * read as skill popularity.
       *
       * `copies` is the honest skill-level adoption signal: how many OTHER
       * repositories carry a byte-identical copy of this exact file. Someone
       * vendoring a skill into their own project is a considered act about that
       * skill. It is the closest thing to an install count the corpus offers.
       */
      copies: copiesOf(s.repo, s.parsed.name),
      name: s.parsed.name, selection_chars: s.parsed.selection_chars,
      license: s.parsed.license, license_ok: s.license_ok, license_note: s.license_note,
      spec_conformance: s.parsed.spec_conformance, extra_fields: s.parsed.extra_fields,
      content_hash: s.parsed.content_hash, discovered_via: s.discovered_via,
      cases: suiteFor(id).length, suite_hash: acc.hash, suite_authored_by: acc.authored_by,
      // These 20 are categorised from the FULL text, unlike catalogue rows which
      // only have a name to go on. Both use the same deterministic rules; the
      // difference is how much evidence each had, and the site says which.
      ...(() => {
        const c = categorise(s.parsed.name, s.parsed.body.slice(0, 12000), s.parsed.description);
        return { categories: c.ids, category_evidence: c.evidence };
      })(),
      classes: classesFor(rows, id),
      spec: specFor(rows, id, BAR),
    };
  }

  // ---- cells ---------------------------------------------------------------
  const Cout: Record<string, unknown> = {};
  for (const [k, c] of C) {
    Cout[k] = {
      // The mockup's short keys, kept so the port is minimal...
      n: c.substance.n_calls, sub: round(c.substance.rate), strict: round(c.strict.rate),
      p50: c.p50_ms === null ? null : c.p50_ms / 1000,
      cost: c.cost_per_run,
      cold: c.cold_ms === null ? null : c.cold_ms / 1000,
      bk: c.buckets, at: c.attribution,
      kd: Object.fromEntries(Object.entries(c.by_kind).map(([k2, v]) => [k2, {
        n: v.substance.n_calls, sub: round(v.substance.rate), strict: round(v.strict.rate),
      }])),
      // ...and the fields a bare number must never travel without.
      n_cases: c.substance.n_cases,
      lo: round(c.substance.lo), hi: round(c.substance.hi),
      strict_lo: round(c.strict.lo), strict_hi: round(c.strict.hi),
      thin: c.substance.thin, unstable: c.substance.unstable,
      disagreement: round(c.substance.disagreement),
      boring: c.boring, boring_share: round(c.boring_share), invalid: c.invalid,
      lane: c.lane, quantization: c.quantization, digest: c.model_digest,
      latency_note: c.latency_note,
    };
  }

  // ---- what did NOT get measured, and why ----------------------------------
  const measuredClasses = new Set(M.map((m) => m.cls));
  const not_measured = {
    classes: SIZE_CLASS_ORDER.filter((c) => !measuredClasses.has(c)),
    models: blocked.map((b) => ({ key: b.model.key, id: b.model.id, cls: b.model.cls, reason: b.reason })),
    note: "Absent, not estimated. A class with no measurement is shown nowhere on the site except here.",
  };

  const discarded = store.liveDiscards(nodes).map((n) => ({
    skill: n.inputs?.skill, model: n.inputs?.model, condition: n.inputs?.condition, reason: n.discarded,
  }));

  // ---- the manifest --------------------------------------------------------
  const totalSpend = rows.reduce((a, r) => a + r.cost_usd, 0);
  const boringTotal = rows.filter((r) => r.bucket === "BORING").length;
  const substitutions = rows.filter((r) => r.served_model && r.served_model !== r.model_id).length;
  const cachedRows = rows.filter((r) => r.cached).length;

  const manifest = {
    harness_version: HARNESS_VERSION,
    generated: new Date().toISOString(),
    bar: BAR,
    runs: rows.length,
    cells: C.size,
    skills: skillIds.length,
    cases: new Set(rows.map((r) => r.case)).size,
    models: M.length,
    lanes: [...new Set(rows.map((r) => r.lane))],
    providers: [...new Set(rows.map((r) => r.served_provider))],
    quantizations: [...new Set(rows.map((r) => r.quantization))],
    // The dataset can legitimately mix windows: the first pass pinned qwen2.5 to
    // 16k before it was corrected to the model's real 32k maximum. num_ctx does
    // not change what a model outputs for a prompt that FITS — at temperature 0
    // with a fixed seed the generation is identical — it only determines whether
    // truncation happens. So it is recorded per row and surfaced here rather than
    // used to invalidate a night of otherwise-sound cells.
    context_windows: [...new Set(rows.map((r) => r.context_window).filter(Boolean))].sort((a, b) => a - b),
    digests: Object.fromEntries(M.map((m) => [m.m, m.digest])),
    run_window: {
      first: rows.map((r) => r.ts).sort()[0],
      last: rows.map((r) => r.ts).sort().slice(-1)[0],
    },
    spend_usd: round(totalSpend, 4),
    // The three things that invalidate everything below them if non-zero.
    integrity: {
      rows_dropped_truncated: truncated.length,
      rows_dropped_unverifiable: suspect.length,
      boring: boringTotal,
      boring_share: round(boringTotal / rows.length, 4),
      provider_substitutions: substitutions,
      cached_responses: cachedRows,
      verdict: boringTotal === 0 && substitutions === 0 && cachedRows === 0 && truncated.length === 0 && suspect.length === 0
        ? "clean — zero BORING, no substitutions, no cached responses"
        : "SUSPECT — see the counts above; a non-zero value here invalidates the numbers below it until chased down",
    },
    ceiling: {
      present: M.some((m) => m.is_ceiling),
      failed_cases: ceilingFailed,
      no_verdict_cases: noCeiling,
      note: M.some((m) => m.is_ceiling)
        ? "Attribution computed only over cases the ceiling handled."
        : "No frontier ceiling in this dataset, so attribution is NOT computed. FORMAT/SKILL-TEXT/MODEL shares are absent rather than guessed.",
    },
    quantization_delta: quantizationDeltas(rows),
    discarded_cells: discarded,
    not_measured,
    thresholds: { thin_cases: THIN_CASES, thin_calls: THIN_CALLS },
    latency_note:
      "Local latency is published as TWO numbers and they are never merged. cold = the first run of a skill, which pays full prompt evaluation. warm = the median of the runs after it, where llama.cpp reuses its KV prefix cache because the harness sends a byte-identical system prompt each time. Measured gap on agents365__drawio (41,514 chars) x qwen2.5-7b-q4_K_M: 163.7s cold against 4.8s warm, 34x. A user invoking a skill for the first time feels the cold number, so publishing only the median would be a confidently-wrong number about the one thing the local lane exists to report.",
    protocol_note:
      "A uniform text tool-call protocol is used across every model, because several models have no native tool API on their provider and a native harness would fail them 100% for a harness reason. A text protocol is HARDER than a native tool API, so absolute rates read low. The ranking and the failure mix are unaffected.",
  };

  const payload = { meta: manifest, M, S, C: Cout };

  writeFileSync(join(OUT, "fits.json"), JSON.stringify(payload));
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(OUT, "rows.json"), JSON.stringify(rows));

  // The catalogue is provenance, not evidence, and is written alongside the
  // measurements so the site can show both numbers without ever blending them.
  try {
    const cs = writeCatalogue();
    console.log(`  catalogue: ${Number(cs.distinct_skills).toLocaleString()} distinct skills · ${Number(cs.repos).toLocaleString()} repos · ${Number(cs.copies_folded).toLocaleString()} copies folded · ${Number(cs.uncategorised).toLocaleString()} uncategorised — provenance only, no verdict`);
  } catch (e: any) {
    console.log(`  catalogue: NOT written (${String(e?.message ?? e).slice(0, 90)})`);
  }
  console.log(`published → web/data/`);
  console.log(`  ${rows.length} rows · ${C.size} cells · ${skillIds.length} skills · ${M.length} models`);
  console.log(`  lanes: ${manifest.lanes.join(", ")} · spend $${manifest.spend_usd}`);
  console.log(`  integrity: ${manifest.integrity.verdict}`);
  if (not_measured.classes.length) console.log(`  not measured: ${not_measured.classes.join(", ")}`);
  if (discarded.length) console.log(`  ${discarded.length} discarded cells (not published as measurements)`);
}

function round(x: number, n = 4): number {
  return Number.isFinite(x) ? Number(x.toFixed(n)) : 0;
}

main();
