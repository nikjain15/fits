#!/usr/bin/env bash
# The overnight pass, local lane.
#
# Each stage is resumable and each cell lands atomically, so killing this at any
# point loses at most the cell in flight. Stages are ordered by what the dataset
# is missing, not by convenience: the deep single-skill cell first (it is the one
# with enough cases to carry a rate), then breadth, then the scope axis.
#
# No key is needed. Nothing here spends money.
set -u
cd "$(dirname "$0")/.."
export FITS_BAR=0.80
LOG=data/runs/overnight.log
mkdir -p data/runs
say(){ echo -e "\n══ $* ══ $(date '+%H:%M:%S')" | tee -a "$LOG"; }

say "stage 1 — M1 deep cell: anthropic__pdf x qwen2.5-7b-q4km (7 cases x 6 trials x 3 repeats)"
FITS_TRIALS=6 FITS_REPEATS=3 npx tsx engine/src/run.ts \
  --skill anthropic__pdf --model qwen2.5-7b-q4km --yes --budget-min 45 2>&1 | tee -a "$LOG"

say "stage 2 — M1 second model: anthropic__pdf x gemma2-2b-q4_0"
FITS_TRIALS=6 FITS_REPEATS=3 npx tsx engine/src/run.ts \
  --skill anthropic__pdf --model gemma2-2b-q4_0 --yes --budget-min 45 2>&1 | tee -a "$LOG"

say "stage 3 — the grid, condition A: 20 skills x 2 local models"
FITS_TRIALS=3 FITS_REPEATS=3 npx tsx engine/src/run.ts \
  --lane local --yes --budget-min 300 2>&1 | tee -a "$LOG"

say "stage 4 — the scope axis, condition B"
FITS_TRIALS=3 FITS_REPEATS=3 npx tsx engine/src/run.ts \
  --lane local --scope --yes --budget-min 150 2>&1 | tee -a "$LOG"

say "stage 5 — aggregate and publish"
npx tsx engine/src/publish.ts 2>&1 | tee -a "$LOG" || echo "publish not ready yet — data is intact, re-run it" | tee -a "$LOG"

say "done"
