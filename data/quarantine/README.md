# Quarantined cells — 2026-08-29

These eight cells were produced before the engine recorded the largest SINGLE
model call's prompt size. Their accumulated prompt tokens exceed the model's
context window, and Ollama truncates an oversized prompt instead of erroring, so
it cannot be decided from what was recorded whether any individual call was cut.

A truncated call measures a skill file the model never fully read. That looks
exactly like a clean result — it has a pass rate, a latency and no BORING — which
is why it is the most dangerous failure mode in this harness.

They are moved here rather than deleted so the record of the fault survives, and
re-measured with per-call accounting and a working overflow guard. Nothing from
them was published; `publish.ts` drops undecidable rows and says so.

Every one is a large skill:
  agents365__drawio          41,514 chars   A and B
  tenglin__notebooklm        41,179 chars   A and B
  anthropic__pptx            19,820 chars   A and B
  kdense__database-lookup    25,570 chars   B
  vercel__deploy             11,458 chars   B  (gemma2:2b, 8k window)
