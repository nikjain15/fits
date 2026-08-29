#!/usr/bin/env bash
# Run this in the morning. Aggregates whatever the night produced, writes the
# digest, and prints where things stand. Safe to run at any time — it is pure
# derivation over the node store and touches no model.
set -u
cd "$(dirname "$0")/.."
echo "── aggregate and publish ──"
npx tsx engine/src/publish.ts
echo
echo "── morning digest ──"
npx tsx engine/src/digest.ts
echo
echo "── the night, in one line ──"
grep -E "cells landed|stopped —|VOID|BORING" data/runs/overnight.log 2>/dev/null | tail -20
