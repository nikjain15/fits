/**
 * Does a size class disagree with itself?
 *
 * This is the question the whole product rests on. "Runs on 4B" is only a useful
 * label if the models inside a class behave alike; if two 8B models differ on the
 * same skill, then a class badge is a promise nobody can keep, and measuring per
 * model is not fussiness but the only honest option.
 *
 * It can also come out the other way, and that is a real result too: if models in
 * a class agree, the badge is safe, Fits can publish class-level labels with a
 * clear conscience, and a large part of its reason to exist goes away. Either
 * answer is publishable. The one thing not allowed is to assert the first while
 * measuring nothing.
 *
 * HOW A DISAGREEMENT IS COUNTED. Not by the gap between two point estimates —
 * two cells of 27 runs each will always differ by something. A pair counts as
 * disagreeing only when their 95% intervals DO NOT OVERLAP, which is the same
 * standard the digest uses for a verdict flip. Everything else is reported as
 * "consistent with no difference", however tempting the gap looks.
 *
 * The per-skill cells here are small, so most pairs will land in that second
 * bucket. That is the honest state of the evidence and the output says so rather
 * than ranking near-ties.
 */
import type { Cell } from "./aggregate.ts";
import { MODELS } from "./models.ts";
import type { SizeClass } from "./types.ts";

export interface Pair {
  skill: string;
  cls: SizeClass;
  a: { model: string; rate: number; lo: number; hi: number; n: number };
  b: { model: string; rate: number; lo: number; hi: number; n: number };
  gap: number;
  /** True only when the intervals are disjoint. */
  separated: boolean;
  /** True when one model clears the bar and the other does not — the case that
   *  makes a class badge actively wrong rather than merely imprecise. */
  verdictSplit: boolean;
}

export interface ClassVerdict {
  cls: SizeClass;
  models: string[];
  skillsCompared: number;
  separated: number;
  verdictSplits: number;
  meanGap: number;
  maxGap: number;
  worst: Pair | null;
  /** What a reader should take away, in one sentence, chosen by rule. */
  reading: string;
}

export function disagreements(C: Map<string, Cell>, bar: number): {
  classes: ClassVerdict[];
  pairs: Pair[];
} {
  // Group the models we actually measured by class, ignoring the ceiling: the
  // frontier is a reference, not a member of a size class anyone would ship.
  const byClass = new Map<SizeClass, string[]>();
  for (const c of C.values()) {
    if (c.condition !== "A") continue;
    const spec = MODELS.find((m) => m.key === c.model);
    if (!spec || spec.isCeiling) continue;
    const a = byClass.get(spec.cls) ?? [];
    if (!a.includes(c.model)) a.push(c.model);
    byClass.set(spec.cls, a);
  }

  const pairs: Pair[] = [];
  const classes: ClassVerdict[] = [];

  for (const [cls, models] of byClass) {
    if (models.length < 2) continue;               // one model is not a class

    const mine: Pair[] = [];
    const skills = [...new Set([...C.values()].filter((c) => c.condition === "A").map((c) => c.skill))];

    for (const skill of skills) {
      for (let i = 0; i < models.length; i++) {
        for (let j = i + 1; j < models.length; j++) {
          const ca = C.get(`${skill}|${models[i]}|A`);
          const cb = C.get(`${skill}|${models[j]}|A`);
          if (!ca || !cb) continue;
          const a = { model: models[i], rate: ca.substance.rate, lo: ca.substance.lo, hi: ca.substance.hi, n: ca.substance.n_calls };
          const b = { model: models[j], rate: cb.substance.rate, lo: cb.substance.lo, hi: cb.substance.hi, n: cb.substance.n_calls };
          const p: Pair = {
            skill, cls, a, b,
            gap: Math.abs(a.rate - b.rate),
            separated: a.hi < b.lo || b.hi < a.lo,
            verdictSplit: (a.rate >= bar) !== (b.rate >= bar),
          };
          mine.push(p);
          pairs.push(p);
        }
      }
    }

    if (!mine.length) continue;
    const gaps = mine.map((p) => p.gap);
    const separated = mine.filter((p) => p.separated).length;
    const splits = mine.filter((p) => p.verdictSplit).length;
    const worst = mine.slice().sort((x, y) => y.gap - x.gap)[0] ?? null;

    /**
     * The reading is chosen by a fixed rule, never written to taste. Order
     * matters: a separated interval is evidence; a verdict split without one is
     * a warning about the badge, not proof about the models; and everything else
     * is honestly "we cannot tell yet".
     */
    let reading: string;
    if (separated > 0) {
      reading = `${cls} disagrees with itself: ${separated} of ${mine.length} skill comparisons have non-overlapping intervals. A "${cls}+" badge cannot be read off one model.`;
    } else if (splits > 0) {
      reading = `${cls} shows ${splits} of ${mine.length} comparisons where one model clears the ${bar.toFixed(2)} bar and the other does not — but no interval separates, so this is a warning about the badge rather than proof the models differ. More trials would settle it.`;
    } else {
      reading = `${cls} has not been shown to disagree with itself: no interval separates across ${mine.length} comparisons. On this evidence a class-level label is defensible — which is a real result, and the opposite of what this product assumes.`;
    }

    classes.push({
      cls, models, skillsCompared: mine.length,
      separated, verdictSplits: splits,
      meanGap: gaps.reduce((x, y) => x + y, 0) / gaps.length,
      maxGap: Math.max(...gaps),
      worst, reading,
    });
  }

  classes.sort((a, b) => b.separated - a.separated || b.maxGap - a.maxGap);
  return { classes, pairs };
}
