# Where this stands — 29 Aug 2026

## M1 is done and the number is defensible

`anthropic__pdf` × `qwen2.5:7b-instruct-q4_K_M`, 7 cases × 6 trials × 3 repeat
runs = **126 calls**, local lane, $0, 9.8 minutes.

| | |
|---|---|
| pass (substance) | **0.86** |
| interval | **0.49–0.97** on 7 independent cases |
| pass (strict) | 0.43 |
| p50 latency | 5.4s (local lane — the only lane allowed to report it) |
| BORING | **0** |
| substituted models | 0 |
| cached responses | 0 |
| artifact | Q4_K_M, the file a laptop user actually pulls |

**The interval is wide on purpose.** A Wilson interval on n=126 would read
±0.06 — and it would be false. Every one of the 7 cases scored exactly 0.00 or
1.00 across its 18 calls: within-case disagreement was **0.0%**. Repeating an
identical prompt at temperature 0 is not independent evidence, so the interval is
built on the 7 cases. See `engine/src/stats.ts`.

The one real failure was `pdf-3`: the model read the file correctly and summed
12+7+23 to **32**. A REASONING failure, and the kind no rewrite fixes.

## Three harness bugs found before any number was trusted

The prior experiment needed twelve fixes to move one figure from 0.496 to 0.829
with nothing about the subject changing. Every surprising result here was treated
as our bug first. Three were.

1. **`use_result` demanded a specific reader.** A model that ran
   `cat /work/sizes.csv` through the `bash` tool got the data and answered
   **correctly** — and was scored `SELECTION`, a wrong-skill error. Our own mock
   `bash` serves `cat` from the fixtures deliberately, so this measured our
   preference, not the model. Data returned by *any* tool now counts.

2. **`IGNORED` vs `REASONING` was decided by looking for the input values in the
   answer.** For an aggregate case the correct answer is a sum and contains none
   of the inputs by construction, so every wrong aggregate landed in `IGNORED`
   and `REASONING` was unreachable. A model that answers 32 for 12+7+23 did not
   ignore the result. Fixed; attribution is unaffected because both map to MODEL.

3. **Ollama silently truncates an oversized prompt** rather than erroring. A
   41,000-character skill file would have been cut in half and we would have
   published a pass rate for a skill the model never read — the same class of
   fault as a substituted model. The context window is now pinned per model and
   overflow is detected and reported as overflow, never as a low score.

## What the night is doing

`engine/overnight.sh`, local lane, no key, no spend:

1. M1 deep cell on qwen2.5-7b ✓
2. M1 second model, gemma2:2b — **stopped early at 30%**, recorded as stopped,
   not as a rate
3. the grid — 20 skills × 2 local models, condition A
4. the scope axis — condition B, all skill descriptions in scope
5. publish

Every cell is atomic and every stage resumable. Run `engine/morning.sh` to
aggregate and write the digest.

## Two judgment calls made during the night

**The early stop is now off on the local lane.** `gemma2:2b` was hitting it on
almost every cell. The rule exists to protect a budget, and on a free lane there
is no budget to protect — while a discarded cell contributes no rows, and so
contributes nothing to the corpus-level rate either, which is where the
statistical power lives. A model that genuinely sits at 0.25 across twenty skills
is a *finding*; discarding every one of its cells turns that finding into twenty
blank spaces. It stays on for the hosted lane, where calls are paid for. Context
overflow is still stopped immediately — every remaining run would fail for the
same packaging reason. `engine/followup.sh` re-runs the cells the early stop
already threw away.

**One grading strictness left deliberately in place.** `docx-2` asks "Is a .docx
file internally a ZIP archive? Answer yes or no only." `gemma2:2b` replied
`{"answer": true}` — semantically right, and scored a failure because the case
demands the word. That is an instruction-following failure rather than a
comprehension one, and the harness has a concept for exactly that distinction
(`knew_command` → FORMAT) which it currently applies only to `invoke` cases.
Left unchanged because the reference harness grades this way and its Gemma-3-4B
skill-selection figure replicates an independent paper's (0.829 vs 0.78) —
changing the grading now would break the one external validation we have. Worth
revisiting with the hosted lane, where it can be measured rather than argued.

## What needs the OpenRouter key

These are blocked, not skipped. Nothing about them was estimated or faked.

- **16 of 18 models.** Every hosted class — 0.5B, 1B, 1.5B, 3B, 4B, 8B, 9B, 12B
  and the frontier ceiling — is recorded as `not-run` with the reason, and
  appears nowhere on the site as a number.
- **Attribution.** FORMAT / SKILL-TEXT / MODEL needs the frontier as its
  discriminator: without a ceiling there is no way to tell "the model is too
  small" from "the skill is broken". The ladder currently renders with
  `no attribution` against every rung rather than invented shares.
- **The acceptance item that `min-spec` and `first-passes-at` must differ for at
  least one real skill.** That requires two models in one class disagreeing. The
  local lane has one model per class, so tonight cannot produce it. Adding
  `mistral-7b` and hosted `qwen-2.5-7b` to the 7B class is the shortest path.
- **The quantization delta.** The local `qwen2.5-7b q4_K_M` side is measured; its
  hosted counterpart is not. `manifest.json` records it as
  `measured: false, reason: "hosted side not measured — no OPENROUTER_API_KEY"`
  rather than showing one side as if it were both.

To unblock, in one line:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...   # then --plan, read the estimate, then --yes
```

## Conflicts with the build prompt, flagged rather than resolved silently

1. **`n=126, CI ±0.04` is not sound.** Departed from, with the argument in
   `engine/src/stats.ts` and the measurement (0.0% within-case disagreement)
   backing it. This is the honesty rule applied to our own arithmetic.

2. **"Filters: has an OSI licence"** excludes `anthropics/skills` — 172k stars,
   no `LICENSE` file at the repo root per the GitHub API — and with it most of
   the corpus. Recorded as `license_ok: false` with a visible "no licence" pill
   and a `seeds.yaml` allowlist, rather than enforced blindly.

3. **The frontier figure of 90.0%** in the prompt and FITS.md, and **75.0%** in
   `experiment/out/REPORT.md`, are the same measurement over different
   denominators: 90.0% over the 150 runs that were actually attempted, 75.0% over
   all 180 including the 30 BORING rows from HTTP 402 credit exhaustion. Not a
   conflict, but it must be stated whenever either is quoted.

4. **`.claude-plugin/marketplace.json`** is a third container format the prompt
   does not mention, and it is load-bearing: without it the most-starred skills
   repo in the corpus is invisible. Handled, documented in
   `docs/skill-format.md` §6.

## Not pushed

The repo is committed locally and has no remote. Creating `nikjain15/fits` and
pushing is a public, outward-facing action and is left for you to approve.
