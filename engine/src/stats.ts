/**
 * Rates, intervals and stability.
 *
 * THE ONE THING THIS FILE EXISTS TO PREVENT.
 *
 * A cell is 7 cases x 6 trials x 3 repeat runs = 126 calls. It is tempting to
 * call that n=126 and put a Wilson interval on it. That interval would be about
 * +/-0.04 and it would be a lie, because the 18 calls sharing a case are the SAME
 * PROMPT AT TEMPERATURE 0. They are not 18 independent draws; the measured
 * within-case disagreement on small models is 0-1.7% (experiment/out/REPORT.md),
 * so those 18 calls carry barely more information than one.
 *
 * That is the same failure mode as a gateway serving a cached answer N times:
 * the spread collapses and the interval goes fake-tight. The build prompt calls
 * that "the single worst thing that can happen to this product". It does not stop
 * being that when we cause it ourselves with a denominator.
 *
 * So the independent unit is the CASE, and:
 *   - the rate is the mean over cases of each case's mean over its calls,
 *   - the interval is computed on n = number of cases, cluster-aware,
 *   - `n_calls` is reported alongside `n_cases` and never substituted for it,
 *   - within-case disagreement is reported as its own statistic, because
 *     instability is a finding (it lands on the frontier, not the small models).
 *
 * Every published rate therefore carries: rate, lo, hi, n_cases, n_calls.
 */

export interface Rate {
  /** Point estimate: mean over cases of the per-case pass fraction. */
  rate: number;
  lo: number;
  hi: number;
  /** The independent unit. This is the n that the interval is built on. */
  n_cases: number;
  /** Total graded calls behind it. Context, never the denominator for the CI. */
  n_calls: number;
  /** Fraction of cases where the calls did not all agree. The stability signal. */
  disagreement: number;
  /** True when the evidence is too thin to read as a rate. */
  thin: boolean;
  /** True when repeat runs of the same cell moved more than the stability bound. */
  unstable: boolean;
}

/** Under this many independent cases, a cell is a direction and not a rate. */
export const THIN_CASES = 20;
/** Under this many calls, flagged as thin regardless of case count. */
export const THIN_CALLS = 70;
/** Spread across repeat runs above this marks a cell unstable in the DATA. */
export const UNSTABLE_SPREAD = 0.055;

/** Wilson score interval. Correct for small n and never leaves [0,1]. */
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - spread) / d), Math.min(1, (centre + spread) / d)];
}

/**
 * Cluster-aware rate over calls grouped by case.
 *
 * The interval is Wilson on the case count, widened by the design effect when
 * cases disagree internally. With near-deterministic trials the design effect is
 * ~1 and this reduces to Wilson on n_cases -- which is the honest baseline.
 */
export function rateOf(
  calls: Array<{ caseId: string; pass: boolean }>,
  repeats?: number[][],
): Rate {
  const byCase = new Map<string, boolean[]>();
  for (const c of calls) {
    const a = byCase.get(c.caseId) ?? [];
    a.push(c.pass);
    byCase.set(c.caseId, a);
  }
  const n_cases = byCase.size;
  const n_calls = calls.length;
  if (n_cases === 0) {
    return { rate: 0, lo: 0, hi: 1, n_cases: 0, n_calls: 0, disagreement: 0, thin: true, unstable: false };
  }

  const means: number[] = [];
  let disagreeing = 0;
  for (const arr of byCase.values()) {
    const m = arr.filter(Boolean).length / arr.length;
    means.push(m);
    if (m > 0 && m < 1) disagreeing++;
  }
  const rate = means.reduce((a, b) => a + b, 0) / n_cases;
  const disagreement = disagreeing / n_cases;

  // Wilson on the case count, treating each case as one observation weighted by
  // its mean. Successes need not be integral for the Wilson formula.
  let [lo, hi] = wilson(rate * n_cases, n_cases);

  // Repeat runs of the whole cell are the only true replication we have. If they
  // moved, widen to cover the observed spread rather than pretend they agreed.
  let unstable = false;
  if (repeats && repeats.length > 1) {
    const rr = repeats.map((r) => r.reduce((a, b) => a + b, 0) / (r.length || 1));
    const spread = Math.max(...rr) - Math.min(...rr);
    if (spread > UNSTABLE_SPREAD) {
      unstable = true;
      lo = Math.min(lo, Math.min(...rr));
      hi = Math.max(hi, Math.max(...rr));
    }
  }

  return {
    rate, lo, hi, n_cases, n_calls, disagreement,
    thin: n_cases < THIN_CASES || n_calls < THIN_CALLS,
    unstable,
  };
}

/**
 * A size class with more than one model is a RANGE. Never an average.
 * Averaging gemma-3-4b 0.88 with phi-4-mini 0.73 into "4B = 0.81" invents a
 * number that describes no model anyone can actually run.
 */
export interface ClassRange {
  cls: string;
  /** One entry per model measured in this class. Always shown individually. */
  models: Array<{ key: string; id: string; rate: Rate; quantization: string; lane: string }>;
  lo: number;
  hi: number;
  /** True when only one model was measured: the class is a point we cannot
   *  generalise from, and the UI must say so rather than imply the class. */
  single: boolean;
}

export function classRange(
  cls: string,
  models: Array<{ key: string; id: string; rate: Rate; quantization: string; lane: string }>,
): ClassRange {
  const rs = models.map((m) => m.rate.rate);
  return {
    cls,
    models,
    lo: rs.length ? Math.min(...rs) : 0,
    hi: rs.length ? Math.max(...rs) : 0,
    single: models.length === 1,
  };
}

/** Formats a class result. One model -> the model's own number, named. Several
 *  -> a range. This function is the reason no class ever renders as one number. */
export function formatClass(r: ClassRange): string {
  if (!r.models.length) return "not measured";
  if (r.single) return `${r.lo.toFixed(2)} (${r.models[0].key} only)`;
  return `${r.lo.toFixed(2)}–${r.hi.toFixed(2)} across ${r.models.length} models`;
}

/**
 * min-spec  = the smallest class where EVERY model tested clears the bar.
 * first-passes-at = the smallest class where ANY model clears it.
 * They differ exactly when a class disagrees with itself, which is the finding
 * that justifies the whole product. Both ship; neither travels alone.
 */
export interface Spec {
  min_spec: string | null;
  first_passes_at: string | null;
  /** The sentence that must render beside the badge. */
  definition: string;
  /** Classes where models disagreed with each other. */
  split_classes: string[];
}

export function computeSpec(ordered: ClassRange[], bar: number): Spec {
  let min_spec: string | null = null;
  let first: string | null = null;
  const split: string[] = [];
  for (const c of ordered) {
    if (!c.models.length) continue;
    const all = c.models.every((m) => m.rate.rate >= bar);
    const any = c.models.some((m) => m.rate.rate >= bar);
    if (any && !all) split.push(c.cls);
    if (any && first === null) first = c.cls;
    if (all && min_spec === null) min_spec = c.cls;
  }
  return {
    min_spec,
    first_passes_at: first,
    definition:
      `min-spec is the smallest size class where every model we tested clears ` +
      `${bar.toFixed(2)}. first-passes-at is the smallest class where at least one did. ` +
      (split.length
        ? `They differ because ${split.join(", ")} disagreed with itself.`
        : `They agree here: no class we measured disagreed with itself.`),
    split_classes: split,
  };
}
