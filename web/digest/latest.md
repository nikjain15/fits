# Fits — 2026-08-29

2,430 runs · 80 cells · 20 skills · 2 models · lane local

## What broke
- Nothing. Zero BORING, no substituted models, no cached responses. The measurement is trustworthy at this level.

## What moved
- Nothing moved. First pass — there is no yesterday to compare against.

## What is new
- 80 cells measured for the first time.
  - `gws__gws-calendar-insert` — 4 cells
  - `kdense__biopython` — 4 cells
  - `anthropic__pdf` — 4 cells
  - `vercel__cli-tokens` — 4 cells
  - `gws__gws-sheets` — 4 cells
  - `agents365__drawio` — 4 cells
  - `tenglin__notebooklm` — 4 cells
  - `vercel__deploy` — 4 cells
  - `kepano__defuddle` — 4 cells
  - `kdense__database-lookup` — 4 cells
  - `anthropic__webapp-testing` — 4 cells
  - `kepano__json-canvas` — 4 cells
- Classes present in the data: 2.6B, 7B.

## What it cost
- $0.0000 this dataset. The local lane costs nothing but electricity and wall-clock.

## Latency, cold against warm
- Largest cold/warm gap: `vercel__cli-tokens × gemma2-2b-q4_0` — **29.0s on the first run** against 0.7s median, **42×**. The first run pays full prompt evaluation; every run after it reuses the runtime's KV prefix cache because the system prompt is identical. Both numbers are published and never merged — you feel the cold one the first time you run a skill.

## One finding
80 cells measured for the first time. **No size class disagreed with itself yet** — every class in this dataset has only one model in it, so there is nothing a class-level badge could be wrong about. That changes the moment a second model joins a class.

---
Chosen by a fixed rule — the largest verdict flip whose intervals separate, on the most-starred skill — and never by a model writing copy. A night that produced nothing says so.
