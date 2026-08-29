/**
 * Endpoint drift detection.
 *
 * Local weights have a digest: when it changes, the artifact changed and every
 * row measured against the old one is stale. A HOSTED endpoint behind a stable
 * model id has no such signal. It can change underneath you with no version bump
 * and no notice -- which is WORSE than local staleness, because nothing tells
 * you. "The model you rented changed and nobody told you" is exactly this
 * product's subject, so drift events are part of the published record.
 *
 * The canary is a small fixed set of cases, one per model, re-run on every
 * scheduled pass. When a canary result moves beyond its interval, every result
 * for that model is marked `endpoint-drifted` and the cells are re-queued.
 *
 * Nothing here expires by TIME. A result is stale when the thing it measured
 * changed, and not before.
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./corpus.ts";
import { available } from "./models.ts";
import { ollama } from "./providers/ollama.ts";
import { openrouter } from "./providers/openrouter.ts";
import { conduit } from "./providers/conduit.ts";
import type { Provider } from "./providers/index.ts";
import { wilson } from "./stats.ts";

const PROVIDERS: Record<string, Provider> = { ollama, openrouter, conduit };
const STATE = join(REPO_ROOT, "data", "runs", "canary.json");

/**
 * The canary cases. Deliberately tiny, deliberately fixed, and deliberately
 * boring: they test the protocol surface rather than any skill, so a move here
 * means the endpoint moved and not that a skill file changed.
 */
const CANARY = [
  { id: "c1", prompt: `Reply with exactly this JSON and nothing else: {"answer":"alpha"}`, want: /alpha/ },
  { id: "c2", prompt: `Call the bash tool to list files. Reply with one JSON object only.`, want: /"tool"\s*:\s*"bash"/ },
  { id: "c3", prompt: `What is 17 plus 25? Reply with {"answer":"<number>"} and nothing else.`, want: /\b42\b/ },
  { id: "c4", prompt: `Reply with {"answer":"no"} and nothing else.`, want: /\bno\b/i },
  { id: "c5", prompt: `Reply with exactly this JSON and nothing else: {"answer":"omega"}`, want: /omega/ },
];

const SYSTEM = `You are an AI agent. You have one tool: bash(command). Reply with exactly ONE JSON object and nothing else: {"tool":"bash","args":{"command":"..."}} to act, or {"answer":"..."} to answer.`;

interface CanaryRecord { model: string; rate: number; lo: number; hi: number; digest: string; served: string; ts: string }

async function main() {
  mkdirSync(join(REPO_ROOT, "data", "runs"), { recursive: true });
  const prev: Record<string, CanaryRecord> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
  const now: Record<string, CanaryRecord> = {};
  const drifted: string[] = [];

  const { runnable } = available();
  for (const m of runnable) {
    const p = PROVIDERS[m.provider];
    let hits = 0, served = "", digest = "";
    try {
      digest = await p.digest(m.id);
      for (const c of CANARY) {
        const r = await p.complete(m.id, {
          system: SYSTEM,
          messages: [{ role: "user", content: c.prompt }],
          maxTokens: 96,
          ...(m.sendTemperature ? { temperature: 0, seed: 7 } : {}),
          disableReasoning: m.disableReasoning,
        });
        served = r.served_model;
        if (c.want.test(r.text)) hits++;
      }
    } catch (e: any) {
      console.log(`  ${m.key.padEnd(20)} canary could not run: ${String(e?.message ?? e).slice(0, 120)}`);
      continue;
    }

    const [lo, hi] = wilson(hits, CANARY.length);
    const rec: CanaryRecord = { model: m.key, rate: hits / CANARY.length, lo, hi, digest, served, ts: new Date().toISOString() };
    now[m.key] = rec;

    const before = prev[m.key];
    if (before) {
      // Two independent drift signals, either of which is enough.
      const outsideInterval = rec.rate < before.lo || rec.rate > before.hi;
      const digestMoved = before.digest !== rec.digest;
      if (outsideInterval || digestMoved) {
        drifted.push(m.key);
        console.log(`  ${m.key.padEnd(20)} DRIFTED — ${before.rate.toFixed(2)} → ${rec.rate.toFixed(2)}` +
          (digestMoved ? `, digest ${before.digest} → ${rec.digest}` : "") +
          `. Every result for this model is marked endpoint-drifted and re-queued.`);
      } else {
        console.log(`  ${m.key.padEnd(20)} steady at ${rec.rate.toFixed(2)} (digest ${rec.digest})`);
      }
    } else {
      console.log(`  ${m.key.padEnd(20)} baseline ${rec.rate.toFixed(2)} (digest ${rec.digest})`);
    }
  }

  writeFileSync(STATE, JSON.stringify(now, null, 2));
  if (drifted.length) {
    console.log(`\n${drifted.length} model(s) drifted: ${drifted.join(", ")}`);
    process.exit(2); // the workflow turns this into a warning and re-queues
  }
  console.log(`\nNo drift. ${Object.keys(now).length} models checked.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
