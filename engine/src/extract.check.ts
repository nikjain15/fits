/**
 * Does reading the answer key out of the file actually work?
 *
 * The 124 hand-written cases are the gold set. For every `invoke` case among
 * them, a human decided what a correct command looks like. This asks whether
 * pure extraction -- no model, no human -- would have arrived at the same place.
 *
 * The measure is deliberately hard on us: an extracted invocation counts as
 * recovering a hand-written case only if the HAND-WRITTEN regex matches the
 * extracted command. That is the right direction of the test. It asks "would
 * the machine have produced something the human would have accepted", not the
 * flattering reverse.
 *
 * Whatever this prints is the number. If extraction only recovers half, the
 * honest conclusion is that it covers half and a human or a model is needed for
 * the rest -- not that the benchmark should be softened.
 */
import { loadCorpus } from "./corpus.ts";
import { suiteFor, allSkillIds, type TestCase } from "./cases.ts";
import { extract, assertionFor } from "./extract.ts";

const corpus = loadCorpus();
const CASES: TestCase[] = allSkillIds().flatMap((id) => suiteFor(id));
const invokeCases = CASES.filter((c) => c.expect.kind === "invoke");

let recovered = 0, missed = 0, unmeasurable = 0;
const misses: string[] = [];
const perSkill: string[] = [];

for (const skill of corpus) {
  const ex = extract(skill.id, skill.parsed);
  const mine = invokeCases.filter((c) => c.skillId === skill.id);
  if (!mine.length) continue;

  if (!ex.measurable) {
    unmeasurable += mine.length;
    perSkill.push(`  ${skill.id.padEnd(36)} — no invocations extracted (${mine.length} cases)`);
    continue;
  }

  let hit = 0;
  for (const c of mine) {
    // Some invoke cases assert on `command`, others on a path or url. Take every
    // asserted argument; the case is recovered if an extracted invocation
    // satisfies ALL of them, which is what the grader itself requires.
    const args = (c.expect as { args: Record<string, RegExp> }).args ?? {};
    const wants = Object.values(args);
    if (!wants.length) continue;
    const want = wants[0];
    const found = ex.invocations.find((inv) => wants.every((w) => w.test(inv.command)));
    if (found) { hit++; recovered++; }
    else {
      missed++;
      misses.push(`  ${c.id.padEnd(14)} wanted ${String(want).slice(0, 46).padEnd(48)} top extracted: ${ex.invocations.slice(0, 3).map((i) => i.head).join(", ")}`);
    }
  }
  perSkill.push(
    `  ${skill.id.padEnd(36)} ${hit}/${mine.length}  ` +
    `${String(ex.invocations.length).padStart(3)} invocations · ${ex.claims.length} claims · ${ex.prohibitions.length} prohibitions`,
  );
}

const total = recovered + missed + unmeasurable;
console.log(`\nExtraction against ${total} hand-written invoke cases\n`);
console.log(perSkill.join("\n"));
console.log(`\n  recovered      ${recovered}/${total}  (${(100 * recovered / total).toFixed(0)}%)`);
console.log(`  missed         ${missed}/${total}`);
console.log(`  unextractable  ${unmeasurable}/${total}   (prose-only skills — catalogued, never scored)`);

if (misses.length) {
  console.log(`\nWhere it missed — each one is either a gap in the extractor or a case a human\nwrote from knowledge the file does not contain:\n`);
  console.log(misses.join("\n"));
}

// The abstain material, which is what makes EAGER measurable at all.
const withClaims = corpus.filter((s) => extract(s.id, s.parsed).claims.length > 0).length;
const withProhib = corpus.filter((s) => extract(s.id, s.parsed).prohibitions.length > 0).length;
console.log(`\n  skills yielding an abstain claim   ${withClaims}/${corpus.length}`);
console.log(`  skills stating a prohibition       ${withProhib}/${corpus.length}`);
