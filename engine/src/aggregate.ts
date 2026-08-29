/**
 * Everything the site shows, derived from the rows and nothing else.
 *
 * This file is pure. It never touches a model, so re-judging never means
 * re-running -- which is the whole reason `run` is the only expensive node.
 *
 * Four rules it enforces mechanically, because they are the ones a UI is most
 * likely to quietly break:
 *
 *   1. No rate without n and an interval. Every `Rate` here carries n_cases,
 *      n_calls, lo and hi. There is no path that emits a bare number.
 *   2. No size class averaged into a point. A class is a list of models and a
 *      range; `formatClass` is the only sanctioned way to render one.
 *   3. BORING is an alarm, not a slice. It is counted separately, it never
 *      competes for rank with the other five buckets, and a cell over 20% BORING
 *      is marked not-a-valid-measurement.
 *   4. Latency exists only on the local lane. Hosted cells carry null and a
 *      reason.
 */
import { rateOf, classRange, computeSpec, type Rate, type ClassRange } from "./stats.ts";
import { SIZE_CLASS_ORDER, type Bucket, type Condition, type ResultRow, type SizeClass } from "./types.ts";
import { MODELS } from "./models.ts";

export interface Cell {
  skill: string;
  model: string;
  condition: Condition;
  substance: Rate;
  strict: Rate;
  /** Local lane only. Hosted cells carry null and `latency_note`.
   *  WARM: the median of every run after the first. */
  p50_ms: number | null;
  /** The FIRST run of this cell — the only one that paid full prompt evaluation.
   *  See the note in cells() for why this is the number a user actually feels. */
  cold_ms: number | null;
  latency_note: string;
  buckets: Partial<Record<Bucket, number>>;
  boring: number;
  boring_share: number;
  /** True when BORING is over a fifth of the misses: the harness is suspect and
   *  no verdict may be read from this cell. */
  invalid: boolean;
  attribution: Partial<Record<"FORMAT" | "SKILL_TEXT" | "MODEL", number>>;
  by_kind: Record<string, { substance: Rate; strict: Rate }>;
  /** Median USD to run this skill once on this model. Real, from the provider's
   *  own usage accounting — not a price-list multiplication. 0 on the local lane,
   *  where the cost is electricity and is not ours to quote. */
  cost_per_run: number;
  lane: string;
  quantization: string;
  served_provider: string;
  model_digest: string;
  misses: number;
}

const key = (s: string, m: string, c: Condition) => `${s}|${m}|${c}`;

export function cells(rows: ResultRow[]): Map<string, Cell> {
  const groups = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const k = key(r.skill, r.model, r.condition);
    const a = groups.get(k) ?? [];
    a.push(r);
    groups.set(k, a);
  }

  const out = new Map<string, Cell>();
  for (const [k, rs] of groups) {
    const r0 = rs[0];

    // Repeat runs are the only true replication: same prompt, same settings, a
    // separate pass. Their spread is a measurement, so it is fed to the interval
    // rather than averaged away.
    const repeats = [...new Set(rs.map((r) => r.repeat))].sort()
      .map((rep) => rs.filter((r) => r.repeat === rep).map((r) => (r.pass_substance ? 1 : 0)));

    const substance = rateOf(rs.map((r) => ({ caseId: r.case, pass: r.pass_substance })), repeats);
    const strict = rateOf(rs.map((r) => ({ caseId: r.case, pass: r.pass_strict })));

    /**
     * LATENCY IS TWO NUMBERS, AND PUBLISHING ONE OF THEM IS A LIE.
     *
     * Measured on agents365__drawio (41,514 chars) x qwen2.5-7b-q4_K_M, 27 runs:
     * the first run took 163.7s and the median took 4.8s. A 34x gap.
     *
     * The cause is not noise. The harness sends a byte-identical system prompt
     * 27 times, so llama.cpp reuses its KV prefix cache and every run after the
     * first skips prompt evaluation of ~12,000 tokens. That is correct runtime
     * behaviour and we are not going to defeat it -- but a user invoking this
     * skill for the first time waits 164 seconds, and publishing "p50 4.8s" as
     * the local latency would be exactly the confidently-wrong number this
     * product exists to prevent. Latency is the ONLY thing the local lane is
     * allowed to report, which makes getting it right non-optional.
     *
     * So both ship, labelled and never merged:
     *   cold_ms  the first run — full prompt evaluation, what you feel once
     *   p50_ms   the median of the rest — warm prefix, what you feel after
     */
    const ordered = [...rs].sort((a, b) => a.ts.localeCompare(b.ts));
    const coldRow = ordered.find((r) => r.latency_ms !== null);
    const warm = ordered.slice(ordered.indexOf(coldRow ?? ordered[0]) + 1)
      .map((r) => r.latency_ms).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const lat = warm;
    const buckets: Partial<Record<Bucket, number>> = {};
    for (const r of rs) if (r.bucket) buckets[r.bucket] = (buckets[r.bucket] ?? 0) + 1;
    const boring = buckets.BORING ?? 0;
    const misses = rs.filter((r) => !r.pass_substance).length;

    const attribution: Cell["attribution"] = {};
    for (const r of rs) {
      if (r.attribution && r.ceiling_passed !== false) {
        attribution[r.attribution] = (attribution[r.attribution] ?? 0) + 1;
      }
    }

    const by_kind: Cell["by_kind"] = {};
    for (const kind of ["invoke", "abstain", "use_result"]) {
      const sub = rs.filter((r) => r.case_kind === kind);
      if (!sub.length) continue;
      by_kind[kind] = {
        substance: rateOf(sub.map((r) => ({ caseId: r.case, pass: r.pass_substance }))),
        strict: rateOf(sub.map((r) => ({ caseId: r.case, pass: r.pass_strict }))),
      };
    }

    const costs = rs.map((r) => r.cost_usd).filter((x) => x > 0).sort((a, b) => a - b);
    out.set(k, {
      cost_per_run: costs.length ? costs[Math.floor(costs.length / 2)] : 0,
      skill: r0.skill, model: r0.model, condition: r0.condition,
      substance, strict,
      p50_ms: r0.lane === "local" && lat.length ? lat[Math.floor(lat.length / 2)] : null,
      cold_ms: r0.lane === "local" ? (coldRow?.latency_ms ?? null) : null,
      latency_note: r0.lane === "local"
        ? "cold = first run, full prompt evaluation. warm = median of the rest, llama.cpp KV prefix cache reused because the system prompt is identical across runs."
        : r0.latency_note,
      buckets, boring,
      boring_share: misses ? boring / misses : 0,
      invalid: misses > 0 && boring / misses > 0.20,
      attribution, by_kind,
      lane: r0.lane, quantization: r0.quantization,
      served_provider: r0.served_provider, model_digest: r0.model_digest,
      misses,
    });
  }
  return out;
}

/**
 * Attribution needs the ceiling as its discriminator: a case the frontier also
 * failed is not a small-model story, and charging it to a small model would
 * inflate the thing we are trying to measure. This stamps `ceiling_passed` and
 * `excluded_reason` onto rows in place, so the exclusions are visible in the
 * data rather than applied invisibly at render time.
 */
export function markCeiling(rows: ResultRow[]): { ceilingFailed: string[]; noCeiling: string[] } {
  const ceiling = MODELS.filter((m) => m.isCeiling).map((m) => m.key);
  const verdict = new Map<string, boolean>();

  for (const c of new Set(rows.map((r) => r.case))) {
    // BORING rows carry no verdict about anything -- they are harness or billing
    // faults. Counting one as a ceiling failure would mislabel a case the
    // ceiling never actually attempted as "the skill is unclear".
    const t = rows.filter((r) => ceiling.includes(r.model) && r.case === c && r.bucket !== "BORING");
    if (t.length) verdict.set(c, t.filter((r) => r.pass_substance).length * 2 > t.length);
  }

  const ceilingFailed: string[] = [];
  const noCeiling: string[] = [];
  for (const c of new Set(rows.map((r) => r.case))) {
    const v = verdict.get(c);
    if (v === undefined) noCeiling.push(c);
    else if (!v) ceilingFailed.push(c);
  }

  for (const r of rows) {
    const v = verdict.get(r.case);
    r.ceiling_passed = v ?? null;
    if (v === undefined) {
      r.excluded_reason = "no ceiling verdict for this case — attribution not computed";
      r.attribution = "";
    } else if (!v) {
      r.excluded_reason = "the ceiling failed this case too — the skill is unclear or the case is wrong; not charged to a small model";
      r.attribution = "";
    }
  }
  return { ceilingFailed, noCeiling };
}

/** Per-model corpus-level rate. This is where the statistical power is; a
 *  per-skill cell of 3-7 cases is a direction, not a rate. */
export function modelSummary(rows: ResultRow[], model: string, condition: Condition) {
  const rs = rows.filter((r) => r.model === model && r.condition === condition);
  if (!rs.length) return null;
  const repeats = [...new Set(rs.map((r) => r.repeat))].sort()
    .map((rep) => rs.filter((r) => r.repeat === rep).map((r) => (r.pass_substance ? 1 : 0)));
  // Model-wide latency: the cold figure is the median of each cell's FIRST run,
  // because "cold" is a per-skill property (a new skill means a new prefix).
  const firstOfCell = new Map<string, ResultRow>();
  for (const r of [...rs].sort((a, b) => a.ts.localeCompare(b.ts))) {
    const k = `${r.skill}|${r.condition}`;
    if (!firstOfCell.has(k)) firstOfCell.set(k, r);
  }
  const coldIds = new Set([...firstOfCell.values()].map((r) => `${r.skill}|${r.case}|${r.trial}|${r.repeat}|${r.condition}`));
  const colds = [...firstOfCell.values()].map((r) => r.latency_ms).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const lat = rs.filter((r) => !coldIds.has(`${r.skill}|${r.case}|${r.trial}|${r.repeat}|${r.condition}`))
    .map((r) => r.latency_ms).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const buckets: Partial<Record<Bucket, number>> = {};
  for (const r of rs) if (r.bucket) buckets[r.bucket] = (buckets[r.bucket] ?? 0) + 1;
  const attribution: Partial<Record<string, number>> = {};
  for (const r of rs) if (r.attribution) attribution[r.attribution] = (attribution[r.attribution] ?? 0) + 1;

  const by_kind: Record<string, { substance: Rate; strict: Rate }> = {};
  for (const kind of ["invoke", "abstain", "use_result"]) {
    const sub = rs.filter((r) => r.case_kind === kind);
    if (sub.length) {
      by_kind[kind] = {
        substance: rateOf(sub.map((r) => ({ caseId: r.case, pass: r.pass_substance }))),
        strict: rateOf(sub.map((r) => ({ caseId: r.case, pass: r.pass_strict }))),
      };
    }
  }

  // Repeat-run disagreement, per (case) -- the instability statistic. Measured,
  // and in the prior dataset it landed on the frontier, not the small models.
  let disagree = 0, cellsSeen = 0;
  for (const c of new Set(rs.map((r) => r.case))) {
    const t = rs.filter((r) => r.case === c);
    if (t.length < 2) continue;
    cellsSeen++;
    if (new Set(t.map((r) => r.pass_substance)).size > 1) disagree++;
  }

  // Tool-invocation validity: of the runs that should have produced a call, how
  // many produced a well-formed one.
  const shouldCall = rs.filter((r) => r.case_kind !== "abstain");
  const validCall = shouldCall.filter((r) => r.pass_strict || (r.protocol_ok && r.bucket !== "ARGS"));

  return {
    substance: rateOf(rs.map((r) => ({ caseId: r.case, pass: r.pass_substance })), repeats),
    strict: rateOf(rs.map((r) => ({ caseId: r.case, pass: r.pass_strict }))),
    p50_ms: lat.length ? lat[Math.floor(lat.length / 2)] : null,
    cold_p50_ms: colds.length ? colds[Math.floor(colds.length / 2)] : null,
    buckets,
    boring: buckets.BORING ?? 0,
    attribution,
    by_kind,
    nd: cellsSeen ? disagree / cellsSeen : 0,
    call_validity: shouldCall.length ? validCall.length / shouldCall.length : 0,
    n_calls: rs.length,
    n_cases: new Set(rs.map((r) => r.case)).size,
    n_skills: new Set(rs.map((r) => r.skill)).size,
  };
}

/** Class ranges for one skill. Never averaged. */
export function classesFor(rows: ResultRow[], skill: string, condition: Condition = "A"): ClassRange[] {
  const out: ClassRange[] = [];
  for (const cls of SIZE_CLASS_ORDER) {
    const models = MODELS.filter((m) => m.cls === cls);
    const measured: ClassRange["models"] = [];
    for (const m of models) {
      const rs = rows.filter((r) => r.skill === skill && r.model === m.key && r.condition === condition);
      if (!rs.length) continue;
      measured.push({
        key: m.key, id: m.id, quantization: m.quantization, lane: m.lane,
        rate: rateOf(rs.map((r) => ({ caseId: r.case, pass: r.pass_substance }))),
      });
    }
    // An unmeasured class is ABSENT, not estimated. The footer names it.
    if (measured.length) out.push(classRange(cls, measured));
  }
  return out;
}

export function specFor(rows: ResultRow[], skill: string, bar: number) {
  return computeSpec(classesFor(rows, skill), bar);
}

/**
 * The quantization delta: the same model family, hosted versus the artifact you
 * would actually download. Nobody publishes this, and it falls straight out of
 * the honesty rules. Returns null until both sides exist -- never one side
 * presented as if it were both.
 */
export function quantizationDeltas(rows: ResultRow[]) {
  const pairs = [{ hosted: "qwen2.5-7b", local: "qwen2.5-7b-q4km", family: "qwen2.5-7b-instruct" }];
  const out: Array<Record<string, unknown>> = [];
  for (const p of pairs) {
    const h = rows.filter((r) => r.model === p.hosted && r.condition === "A");
    const l = rows.filter((r) => r.model === p.local && r.condition === "A");
    if (!h.length || !l.length) {
      out.push({
        family: p.family, measured: false,
        reason: !h.length && !l.length ? "neither side measured"
          : !h.length ? "hosted side not measured — no OPENROUTER_API_KEY on this machine"
          : "local side not measured",
      });
      continue;
    }
    // Compare only on the cases both sides actually ran.
    const shared = new Set([...new Set(h.map((r) => r.case))].filter((c) => l.some((r) => r.case === c)));
    const hr = rateOf(h.filter((r) => shared.has(r.case)).map((r) => ({ caseId: r.case, pass: r.pass_substance })));
    const lr = rateOf(l.filter((r) => shared.has(r.case)).map((r) => ({ caseId: r.case, pass: r.pass_substance })));
    out.push({
      family: p.family, measured: true, shared_cases: shared.size,
      hosted: { model: p.hosted, quantization: h[0].quantization, rate: hr },
      local: { model: p.local, quantization: l[0].quantization, rate: lr },
      delta: hr.rate - lr.rate,
    });
  }
  return out;
}
