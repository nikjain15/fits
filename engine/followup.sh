#!/usr/bin/env bash
# Runs after overnight.sh finishes.
#
# Its job is to recover what the early stop threw away. Cells discarded as
# "stopped early" carry no rows, so they contribute nothing to the corpus-level
# rate — which is exactly where the statistical power lives. On a free lane that
# trade is a pure loss, so those cells are re-run to completion with the early
# stop off. Cells discarded for CONTEXT OVERFLOW are not retried: every remaining
# run would fail for the same packaging reason.
set -u
cd "$(dirname "$0")/.."
LOG=data/runs/overnight.log

# Wait for the main pass to finish. Poll, do not assume.
while pgrep -f "engine/overnight.sh" > /dev/null; do sleep 30; done

echo -e "\n══ follow-up — re-running stopped cells to completion (early stop off) ══ $(date '+%H:%M:%S')" | tee -a "$LOG"
FITS_EARLY_STOP=off FITS_TRIALS=3 FITS_REPEATS=3 npx tsx engine/src/run.ts \
  --lane local --yes --budget-min 150 2>&1 | tee -a "$LOG"

echo -e "\n══ publish and digest ══ $(date '+%H:%M:%S')" | tee -a "$LOG"
npx tsx engine/src/publish.ts 2>&1 | tee -a "$LOG"
npx tsx engine/src/digest.ts  2>&1 | tee -a "$LOG"
echo -e "\n══ all done ══ $(date '+%H:%M:%S')" | tee -a "$LOG"
