# Fits

**Minimum system requirements for AI skills.**

Software has said "requires 8GB RAM, macOS 12+" since the 1990s. Agent skills ship
with nothing. Fits tests a published skill against small models, reports what
breaks, and repairs what it can without retraining anything.

It answers one question: *will this AI agent skill actually work on the small model
I can afford to run?*

---

## Where things are

```
docs/skill-format.md     what the format ACTUALLY is, from sources fetched 2026-08-28
engine/src/              the measurement graph
  providers/             one interface, three adapters (ollama, openrouter, conduit)
  skills/parse.ts        the SKILL.md parser, written against docs/skill-format.md
  stats.ts               rates, intervals, and the reason a class is never a point
  classify.ts            deterministic grading; five of six buckets need no model
  aggregate.ts           pure derivation — re-judging never means re-running
  run.ts                 the runner: dry-run estimate, spend cap, atomic cells
  publish.ts             emits web/data/*.json
  digest.ts              the morning digest
  canary.ts              endpoint-drift detection
corpus/skills/           20 real published skills, verbatim, fetched 2026-08-28
data/nodes/              the content-addressed node store (gitignored while local)
web/                     the site — static, vanilla, read-only over JSON
```

## Run it

Nothing here needs a key to produce a real number. The local lane is free.

```bash
npm install

# always print the estimate first — it is what the spend cap is checked against
npx tsx engine/src/run.ts --skill anthropic__pdf --model qwen2.5-7b-q4km --plan

# then measure
npx tsx engine/src/run.ts --skill anthropic__pdf --model qwen2.5-7b-q4km --yes

npx tsx engine/src/publish.ts      # → web/data/
npx tsx engine/src/digest.ts       # → web/digest/
cd web && python3 -m http.server 8080
```

`engine/overnight.sh` runs the whole local pass unattended. Every cell is atomic
and every stage is resumable: kill it at any point and you lose at most the cell
in flight.

### Adding the hosted lane

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
npx tsx engine/src/run.ts --lane hosted --plan     # read the estimate
npx tsx engine/src/run.ts --lane hosted --yes
```

That is the only change. The adapter is written, pinned (fallbacks off,
quantization constrained) and asserted; it has simply never had a key.

---

## The rules this repo enforces in code, not in prose

These are the reason the product exists. Where a feature and one of these
conflicted, the rule won.

**A cached response is not a measurement.** Fits runs the same prompt many times
on purpose — the spread across repeats *is* the measurement. A gateway serving one
stored answer N times collapses that spread and produces a fabricated rate with a
fake-tight interval. `providers/index.ts` asserts `cached === false` on every
single response and voids the cell if one comes back cached. Configuration is not
trusted; the response is checked.

**A substituted model is not the model you asked for.** If a spend cap trips and a
gateway swaps in a backup, a measurement of X silently becomes a measurement of Y.
`served_model` is compared to the requested id on every call. On mismatch the cell
is discarded with both names recorded. The two are never blended.

**n is the number of cases, not the number of calls.** A cell is 7 cases × 6 trials
× 3 repeat runs = 126 calls, and it is tempting to put a Wilson interval on 126.
That interval would be ±0.04 and it would be a lie: the 18 calls sharing a case are
the same prompt at temperature 0, and measured within-case disagreement on small
models is 0–1.7%. So the independent unit is the **case**, the interval is built on
the case count, `n_calls` is reported beside `n_cases` and never substituted for
it, and repeat-run spread widens the interval rather than being averaged away.
This is a deliberate departure from the build prompt's `n=126, ±0.04` — see
`engine/src/stats.ts` for the argument.

**A size class is a range, never a point.** Two 4B models are not interchangeable.
`gemma-3-4b 0.88` and `phi-4-mini 0.73` are reported as `0.73–0.88 across 2 models`,
never as `4B = 0.81`. `formatClass()` is the only sanctioned renderer.

**min-spec ≠ first-passes-at.** min-spec is the smallest class where *every* model
tested clears the bar; first-passes-at is the smallest where *any* did. They differ
exactly when a class disagrees with itself, and the sentence defining them ships
beside the badge so the label never travels alone.

**BORING is a smoke alarm, not a bucket.** Across 1,080 small-model runs in the
reference dataset there were zero. An earlier run showed 16.5% and every one was
the harness's own rate-limiting and connection handling. A non-zero BORING rate
means the harness is broken until proven otherwise, so it is surfaced as an alert,
never as a slice competing for rank, and a cell over 20% BORING is marked
not-a-valid-measurement.

**Latency exists only on the local lane.** A hosted p50 is network plus queue plus
datacenter batching and says nothing about a laptop. Hosted rows carry
`latency_ms: null` and a `not_comparable` reason.

**Results expire when the thing they measured changes, never by time alone.** Every
row carries the model digest it was produced against. Local weights have a digest;
a hosted endpoint behind a stable id does not, which is *worse*, so `canary.ts`
re-runs a fixed probe suite and marks a model's results `endpoint-drifted` when it
moves.

**A partial cell is never published.** A cell lands whole, in one file rename, or
it stays in the node cache and is invisible to the site.

**Unmeasured is absent, not estimated.** A model that could not run appears in
`not_measured` with its reason and nowhere else. A class with no data is named in
the footer and shown nowhere.

---

## What has actually been measured

See `web/data/manifest.json` for the authoritative record — it carries the
lane, the served provider, the quantization, the digests, the run window, the spend
and the integrity counts.

The prior experiment this builds on (`data/prior-results.csv`, 1,260 runs, 29 Aug
2026) is the reference dataset: 20 real published skills, 60 code-checked cases,
llama-3.2-1b 25.0% · gemma-3-4b 52.2% · qwen3-8b 83.3% · claude-sonnet-5 90.0%
(provisional, over 150 measured runs). Its harness needed **twelve fixes** to move
Gemma-3-4B skill selection from 0.496 to 0.829 with nothing about the subject
changing. Treat every surprising result as a suspected harness bug first and a
finding second — this repo has already found two more (see `classify.ts` v0.2.0).

## What is deliberately not built

**A model that predicts min-spec from the skill file without running it.** It is
the obvious demo and it contradicts the measurement: `drawio` at 41,514 characters
scored 66.7% while `defuddle` at 734 characters scored 44.4%. Nothing on the file's
face tells you. Building a predictor would be Fits publishing exactly the kind of
confidently-wrong number it exists to prevent.

**Rung 5's leak percentage.** The mockup showed `4.1%`, labelled illustrative. It
is not shown at all now. Byte-level accounting is instrumented — every tool call's
arguments are weighed in `tools.ts` — but it has not been run over enough real
traces, and a leak figure is precisely the kind of number that must never be
estimated.
