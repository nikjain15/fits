#!/usr/bin/env bash
# Final pass. Waits for the follow-up, then re-measures the eight quarantined
# cells with per-call prompt accounting, a working overflow guard, and each
# model's real context window. Then publishes and writes the digest.
set -u
cd "$(dirname "$0")/.."
LOG=data/runs/overnight.log
while pgrep -f "engine/followup.sh" > /dev/null; do sleep 30; done
echo -e "\n══ final — re-measuring quarantined cells with per-call accounting ══ $(date '+%H:%M:%S')" | tee -a "$LOG"
FITS_EARLY_STOP=off FITS_TRIALS=3 FITS_REPEATS=3 npx tsx engine/src/run.ts \
  --lane local --scope --yes --budget-min 180 2>&1 | tee -a "$LOG"
echo -e "\n══ publish and digest ══ $(date '+%H:%M:%S')" | tee -a "$LOG"
npx tsx engine/src/publish.ts 2>&1 | tee -a "$LOG"
npx tsx engine/src/digest.ts  2>&1 | tee -a "$LOG"
echo -e "\n══ FINISHED ══ $(date '+%H:%M:%S')" | tee -a "$LOG"
