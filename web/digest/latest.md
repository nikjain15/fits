# Fits — 2026-08-29

729 runs · 21 cells · 19 skills · 2 models · lane local

## What broke
- cell void — `anthropic__pdf × gemma2-2b-q4_0`: stopped early after 20 runs at 30% — more than 30 points below the 0.8 bar. Not published as a rate.
- cell void — `tenglin__notebooklm × gemma2-2b-q4_0`: stopped early after 20 runs at 30% — more than 30 points below the 0.8 bar. Not published as a rate.
- cell void — `agents365__drawio × gemma2-2b-q4_0`: stopped early after 20 runs at 30% — more than 30 points below the 0.8 bar. Not published as a rate.
- cell void — `kepano__json-canvas × gemma2-2b-q4_0`: stopped early after 20 runs at 30% — more than 30 points below the 0.8 bar. Not published as a rate.
- cell void — `gws__gws-gmail-send × qwen2.5-7b-q4km`: stopped early after 20 runs at 30% — more than 30 points below the 0.8 bar. Not published as a rate.
- cell void — `kdense__biopython × gemma2-2b-q4_0`: stopped early after 20 runs at 30% — more than 30 points below the 0.8 bar. Not published as a rate.
- cell void — `anthropic__xlsx × gemma2-2b-q4_0`: stopped early after 20 runs at 0% — more than 30 points below the 0.8 bar. Not published as a rate.
- cell void — `addyosmani__browser-devtools × gemma2-2b-q4_0`: stopped early after 20 runs at 30% — more than 30 points below the 0.8 bar. Not published as a rate.

## What moved
- Nothing moved. Every cell that existed yesterday still reads the same.

## What is new
- No new cells.
- Classes present in the data: 7B, 2.6B.

## What it cost
- $0.0000 this dataset. The local lane costs nothing but electricity and wall-clock.

## Latency, cold against warm
- Largest cold/warm gap: `tenglin__notebooklm × qwen2.5-7b-q4km` — **164.1s on the first run** against 4.5s median, **36×**. The first run pays full prompt evaluation; every run after it reuses the runtime's KV prefix cache because the system prompt is identical. Both numbers are published and never merged — you feel the cold one the first time you run a skill.

## One finding
Nothing moved and nothing new landed.

---
Chosen by a fixed rule — the largest verdict flip whose intervals separate, on the most-starred skill — and never by a model writing copy. A night that produced nothing says so.
