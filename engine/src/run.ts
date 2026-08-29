/**
 * The runner.
 *
 * A cell is (skill, model, condition). It is measured whole or not at all.
 * Cells are ordered by what the dataset is currently missing, not by a fixed
 * sweep, because a class with one model tested is where the product is currently
 * overclaiming and is therefore the highest-value next run.
 *
 *   priority 1  cells with no results at all
 *   priority 2  cells whose model digest or skill content hash has moved (stale)
 *   priority 3  thin cells — under the trial target
 *   priority 4  everything else
 *
 * Two hard stops, both configurable and neither advisory:
 *   - a spend cap, checked before every call, that ABORTS rather than warns
 *   - a wall-clock budget, checked between cells
 *
 * And one early stop: after EARLY_STOP_TRIALS calls, a cell missing the bar by
 * more than EARLY_STOP_MARGIN is abandoned and recorded as stopped-early. That
 * is said in the data, not silently.
 *
 * Usage:
 *   tsx engine/src/run.ts --plan                       dry-run estimate only
 *   tsx engine/src/run.ts --skill anthropic__pdf --model qwen2.5-7b-q4km --yes
 *   tsx engine/src/run.ts --lane local --all --yes --budget-min 420
 */
import { randomUUID } from "node:crypto";
import { MODELS, available, byKey } from "./models.ts";
import { loadCorpus, skillById, type CorpusSkill } from "./corpus.ts";
import { suiteFor, suiteHash, acceptance, allSkillIds, type TestCase } from "./cases.ts";
import { buildTools } from "./tools.ts";
import { buildSystemPrompt, type ScopedSkill } from "./protocol.ts";
import { runAgent } from "./agentloop.ts";
import { grade, attributionOf, type RunTrace } from "./classify.ts";
import { ollama } from "./providers/ollama.ts";
import { openrouter } from "./providers/openrouter.ts";
import { conduit } from "./providers/conduit.ts";
import { ProviderError, type Provider } from "./providers/index.ts";
import { HARNESS_VERSION, type Condition, type ModelSpec, type ResultRow } from "./types.ts";
import * as store from "./store.ts";

// ---------------------------------------------------------------- configuration
const CFG = {
  /** Calls per cell = cases x TRIALS x REPEATS. */
  TRIALS: Number(process.env.FITS_TRIALS ?? 6),
  REPEATS: Number(process.env.FITS_REPEATS ?? 3),
  /** The ceiling is a reference, not a min-spec candidate. It gets one repeat
   *  run, not three: it needs no tight interval and it costs 20-100x. */
  CEILING_REPEATS: 1,
  MAX_STEPS: 4,
  MAX_TOKENS: 512,
  /** Hard stop. Not a warning. */
  SPEND_CAP_USD: Number(process.env.FITS_SPEND_CAP ?? 5),
  BUDGET_MIN: Number(process.env.FITS_BUDGET_MIN ?? 480),
  /** A per-cell wall cap. The wall BUDGET is checked between cells, so without
   *  this one pathological cell — a 41,000-character skill at a 16k context, four
   *  steps deep, twenty-seven runs — can eat an entire night on its own and
   *  starve every cell behind it. A cell that hits this cap is recorded as
   *  exceeded, with no rate, exactly like any other unfinished cell. */
  CELL_CAP_MIN: Number(process.env.FITS_CELL_CAP_MIN ?? 25),
  EARLY_STOP_TRIALS: 20,
  EARLY_STOP_MARGIN: 0.30,
  /** The early stop exists to protect a BUDGET. On the local lane there is no
   *  budget to protect — the marginal cost of finishing a cell is wall-clock on
   *  an idle machine — and stopping costs us real information: a cell that is
   *  discarded contributes no rows, so it contributes nothing to the corpus-level
   *  rate either, which is where the statistical power lives. A model that
   *  genuinely sits at 0.25 across twenty skills is a finding; discarding every
   *  one of its cells turns that finding into twenty blank spaces.
   *
   *  So: on by default (the hosted lane pays per call), off where the calls are
   *  free. Set FITS_EARLY_STOP=on to force it back on. */
  EARLY_STOP: (process.env.FITS_EARLY_STOP ?? "auto") as "on" | "off" | "auto",
  BAR: Number(process.env.FITS_BAR ?? 0.80),
  /** Average tokens per model call, from the prior 1,260-run dataset. Used only
   *  for the dry-run estimate, never for a published number. */
  EST_TOKENS_PER_CALL: 1450,
  /** A graded RUN is not one model call. The agent loop calls the model once per
   *  step, and the prior 1,260-run dataset averages 1.64 steps per run. An
   *  estimate that ignored this would understate the bill by ~64% — and the
   *  estimate is what the spend cap is checked against, so understating it is a
   *  correctness bug, not a cosmetic one. Measured, not assumed. */
  STEPS_PER_RUN: 1.64,
};

const PROVIDERS: Record<string, Provider> = { ollama, openrouter, conduit };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (n: string) => process.argv.includes(`--${n}`);

// ---------------------------------------------------------------- cell planning
interface Cell {
  skill: CorpusSkill;
  model: ModelSpec;
  condition: Condition;
  cases: TestCase[];
  repeats: number;
  calls: number;
  priority: number;
  reason: string;
  key: string;
  digest: string;
}

// Bumping this invalidates exactly the run nodes that depended on the old
// grading and nothing else — which is the content-addressing working.
// 0.2.0: use_result is tool-agnostic about how the data was read, and the
//        IGNORED/REASONING split no longer misfires on aggregate answers.
const CLASSIFIER_VERSION = "classify/0.2.0";

function cellKey(skill: CorpusSkill, model: ModelSpec, condition: Condition, digest: string, cases: TestCase[], repeats: number): string {
  return store.nodeKey("run", `${HARNESS_VERSION}+${CLASSIFIER_VERSION}`, {
    skill: skill.id,
    skill_content: skill.parsed.content_hash,
    model: model.key,
    model_id: model.id,
    digest,
    condition,
    suite: suiteHash(cases),
    trials: CFG.TRIALS,
    repeats,
    max_steps: CFG.MAX_STEPS,
    max_tokens: CFG.MAX_TOKENS,
  });
}

async function plan(skills: CorpusSkill[], models: ModelSpec[], conditions: Condition[]): Promise<Cell[]> {
  const cells: Cell[] = [];
  const digests = new Map<string, string>();

  for (const m of models) {
    if (!digests.has(m.key)) {
      try {
        digests.set(m.key, await PROVIDERS[m.provider].digest(m.id));
      } catch (e: any) {
        console.error(`  ! cannot resolve digest for ${m.key}: ${String(e?.message ?? e)} — skipping this model, recorded as not-run`);
        digests.set(m.key, "");
      }
    }
  }

  for (const s of skills) {
    if (!s.measurable) continue;
    const cases = suiteFor(s.id);
    if (!cases.length) continue;
    if (!acceptance(s.id).accepted) continue;
    for (const m of models) {
      const digest = digests.get(m.key) ?? "";
      if (!digest) continue;
      const repeats = m.isCeiling ? CFG.CEILING_REPEATS : CFG.REPEATS;
      for (const condition of conditions) {
        const key = cellKey(s, m, condition, digest, cases, repeats);
        const existing = store.read(key);
        if (existing && !existing.discarded) continue; // done, and its key still matches

        // Is there an older node for this cell under a different key? Then this
        // is stale rather than empty, and stale outranks thin.
        const stale = store.allNodes().some((n) =>
          n.inputs?.skill === s.id && n.inputs?.model === m.key && n.inputs?.condition === condition,
        );
        cells.push({
          skill: s, model: m, condition, cases, repeats,
          calls: cases.length * CFG.TRIALS * repeats,
          priority: existing?.discarded ? 2 : stale ? 2 : 1,
          reason: existing?.discarded ? `retry: ${existing.discarded}` : stale ? "stale — model digest, skill content or harness version moved" : "never measured",
          key, digest,
        });
      }
    }
  }
  cells.sort((a, b) => a.priority - b.priority || a.calls - b.calls);
  return cells;
}

// ---------------------------------------------------------------- the estimate
function estimate(cells: Cell[]): { calls: number; tokens: number; usd: number; byModel: Map<string, { calls: number; usd: number }> } {
  let calls = 0, usd = 0;
  const byModel = new Map<string, { calls: number; usd: number }>();
  for (const c of cells) {
    const p = PROVIDERS[c.model.provider].price(c.model.id);
    // 80/20 input/output split, from the prior dataset's token accounting.
    const modelCalls = c.calls * CFG.STEPS_PER_RUN;
    const cost = modelCalls * (CFG.EST_TOKENS_PER_CALL / 1e6) * (0.8 * p.inputPerMTok + 0.2 * p.outputPerMTok);
    calls += modelCalls; usd += cost;
    const e = byModel.get(c.model.key) ?? { calls: 0, usd: 0 };
    e.calls += modelCalls; e.usd += cost;
    byModel.set(c.model.key, e);
  }
  return { calls, tokens: calls * CFG.EST_TOKENS_PER_CALL, usd, byModel };
}

// ---------------------------------------------------------------- running a cell
function scoped(s: CorpusSkill): ScopedSkill {
  return { id: s.id, name: s.parsed.name, selection: s.parsed.selection, body: s.parsed.body };
}

async function runCell(cell: Cell, runId: string, spend: { usd: number }): Promise<{ rows: ResultRow[]; discarded: string; transcripts: unknown[]; wall: number }> {
  const provider = PROVIDERS[cell.model.provider];
  const rows: ResultRow[] = [];
  const transcripts: unknown[] = [];
  const t0 = Date.now();
  let passes = 0, graded = 0;

  const library = cell.condition === "B"
    ? loadCorpus().filter((x) => x.measurable).map(scoped)
    : null;

  for (let repeat = 1; repeat <= cell.repeats; repeat++) {
    for (const tc of cell.cases) {
      for (let trial = 1; trial <= CFG.TRIALS; trial++) {
        // Hard spend stop, checked BEFORE the call. A cap that is checked after
        // is not a cap.
        if (spend.usd >= CFG.SPEND_CAP_USD) {
          return { rows: [], discarded: `spend cap of $${CFG.SPEND_CAP_USD} reached — cell abandoned, nothing partial published`, transcripts, wall: Date.now() - t0 };
        }
        if (Date.now() - t0 > CFG.CELL_CAP_MIN * 60_000) {
          return {
            rows: [],
            discarded: `exceeded its ${CFG.CELL_CAP_MIN}-minute cell cap after ${graded} of ${cell.calls} runs ` +
              `(${cell.skill.parsed.body_chars.toLocaleString()}-char skill on ${cell.model.id}). No rate is published from a ` +
              `partial cell. Re-run it alone with a larger FITS_CELL_CAP_MIN.`,
            transcripts, wall: Date.now() - t0,
          };
        }

        const tools = buildTools(tc.fixtures);
        const { system, skillsInScope } = buildSystemPrompt(scoped(cell.skill), tools, library);

        let latency = 0, cost = 0, inTok = 0, outTok = 0, maxPrompt = 0, ctxWindow = 0;
        let served_model = cell.model.id, served_provider = "", quantization = cell.model.quantization, cached = false;
        let error: RunTrace["error"];

        const result = await runAgent({
          goal: tc.prompt,
          system,
          tools,
          maxSteps: CFG.MAX_STEPS,
          call: async (messages) => {
            const r = await provider.complete(cell.model.id, {
              system,
              messages,
              maxTokens: CFG.MAX_TOKENS,
              ...(cell.model.sendTemperature ? { temperature: 0, seed: 7 } : {}),
              disableReasoning: cell.model.disableReasoning,
            });
            latency += r.latency_ms;
            cost += r.cost_usd;
            spend.usd += r.cost_usd;
            inTok += r.input_tokens;
            maxPrompt = Math.max(maxPrompt, r.input_tokens);
            ctxWindow = r.context_window;
            outTok += r.output_tokens;
            served_model = r.served_model;
            served_provider = r.served_provider;
            quantization = r.quantization;
            cached = cached || r.cached;
            return r.text;
          },
        }).catch((e: any) => {
          // A cached response or a substituted model is NOT a failed run — it is
          // an invalid measurement, and it takes the whole cell with it.
          if (e instanceof ProviderError && (e.kind === "cached_response" || e.kind === "provider_substitution")) {
            throw e;
          }
          error = { kind: e instanceof ProviderError ? e.kind : "harness", message: String(e?.message ?? e) };
          return null;
        });

        const trace: RunTrace = {
          steps: result?.steps ?? [],
          turns: result?.turns ?? [],
          finalAnswer: result?.answer,
          stoppedAtCap: result?.stoppedAtCap ?? false,
          error,
        };
        const g = grade(tc, trace);
        graded++; if (g.passSubstance) passes++;

        rows.push({
          condition: cell.condition,
          skill: cell.skill.id,
          skill_repo: cell.skill.repo,
          skill_stars: cell.skill.stars,
          skill_body_chars: cell.skill.parsed.body_chars,
          model: cell.model.key,
          model_id: cell.model.id,
          size_class: cell.model.cls,
          case: tc.id,
          case_kind: tc.kind,
          trial,
          repeat,
          pass_substance: g.passSubstance,
          pass_strict: g.passStrict,
          protocol_ok: g.protocolOk,
          knew_command: g.knewCommand,
          bucket: g.bucket,
          detail: g.detail,
          attribution: attributionOf(g.bucket, g.knewCommand),
          ceiling_passed: null,      // filled by aggregate.ts, which knows the ceiling
          excluded_reason: "",
          lane: cell.model.lane,
          served_model,
          served_provider,
          quantization,
          cached,
          model_digest: cell.digest,
          // Latency is populated ONLY on the local lane. A hosted p50 is network
          // plus queue plus datacenter batching and says nothing about a laptop;
          // filling it in would report a number that means something else.
          latency_ms: cell.model.lane === "local" ? latency : null,
          latency_note: cell.model.lane === "local" ? "" : "not_comparable: hosted latency is network + queue + batching, not what a user would experience",
          cost_usd: cost,
          input_tokens: inTok,
          max_prompt_tokens: maxPrompt,
          context_window: ctxWindow,
          output_tokens: outTok,
          steps: trace.steps.length,
          skills_in_scope: skillsInScope,
          run_id: runId,
          harness_version: HARNESS_VERSION,
          ts: new Date().toISOString(),
        });

        transcripts.push({
          run_id: runId, cell: cell.key, condition: cell.condition, skill: cell.skill.id,
          model: cell.model.key, case: tc.id, trial, repeat,
          prompt: tc.prompt, raw: trace.turns.map((t) => t.raw), steps: trace.steps,
          answer: trace.finalAnswer, pass: g.passSubstance, bucket: g.bucket, detail: g.detail,
        });

        // Early stop. Recorded as a STATE with its reason, never as a low score.
        const earlyStopOn = CFG.EARLY_STOP === "on" ||
          (CFG.EARLY_STOP === "auto" && cell.model.lane === "hosted");
        // Context overflow is the exception: it is never worth finishing, because
        // every remaining run would fail for the same packaging reason and none of
        // them would be a measurement of the model.
        const overflowNow = rows.length >= 6 &&
          rows.filter((r) => r.bucket === "BORING" && /context/i.test(r.detail)).length === rows.length;
        if ((earlyStopOn && graded >= CFG.EARLY_STOP_TRIALS && (passes / graded) < CFG.BAR - CFG.EARLY_STOP_MARGIN) || overflowNow) {
          // Why it is failing matters more than that it is failing. A cell that
          // is almost entirely context overflow is not a model that performs
          // badly — it is a skill file that does not FIT this model's window,
          // which is a min-spec finding in its own right and the literal subject
          // of the product. Recording it as "0.00 pass" would be a lie about a
          // skill the model never got to read.
          const boringSoFar = rows.filter((r) => r.bucket === "BORING").length;
          const overflow = rows.filter((r) => r.bucket === "BORING" && /context/i.test(r.detail)).length;
          const misses = rows.filter((r) => !r.pass_substance).length || 1;
          let why: string;
          if (overflow / misses > 0.8) {
            why = `does not fit — ${overflow} of ${misses} misses are context overflow. The skill file (${cell.skill.parsed.body_chars.toLocaleString()} chars) exceeds what ${cell.model.id} can hold, so it was never read. This is a packaging limit, not a pass rate.`;
          } else if (boringSoFar / misses > 0.2) {
            why = `NOT A VALID MEASUREMENT — ${boringSoFar} of ${misses} misses are BORING. BORING is a smoke alarm for our own harness; no model verdict may be read from this cell until it is chased down.`;
          } else {
            why = `stopped early after ${graded} runs at ${(100 * passes / graded).toFixed(0)}% — more than ${CFG.EARLY_STOP_MARGIN * 100} points below the ${CFG.BAR} bar. Not published as a rate.`;
          }
          return { rows: [], discarded: why, transcripts, wall: Date.now() - t0 };
        }
      }
    }
  }
  return { rows, discarded: "", transcripts, wall: Date.now() - t0 };
}

// ---------------------------------------------------------------- main
async function main() {
  const runId = randomUUID().slice(0, 8);
  const { runnable, blocked } = available();

  const laneArg = arg("lane");
  const modelArg = arg("model");
  const skillArg = arg("skill");
  const conditions: Condition[] = flag("scope") ? ["A", "B"] : ["A"];
  if (arg("budget-min")) CFG.BUDGET_MIN = Number(arg("budget-min"));

  let models = runnable;
  if (laneArg) models = models.filter((m) => m.lane === laneArg);
  if (modelArg) models = models.filter((m) => modelArg.split(",").includes(m.key));

  let skills = loadCorpus();
  if (skillArg) skills = skills.filter((s) => skillArg.split(",").includes(s.id));

  console.log(`\nfits ${HARNESS_VERSION} · run ${runId}`);
  console.log(`bar ${CFG.BAR} · ${CFG.TRIALS} trials x ${CFG.REPEATS} repeat runs · step cap ${CFG.MAX_STEPS}`);
  console.log(`\nRunnable models (${models.length}):`);
  for (const m of models) console.log(`  ${m.key.padEnd(20)} ${m.cls.padEnd(9)} ${m.lane.padEnd(7)} ${m.quantization.padEnd(8)} ${m.id}`);
  if (blocked.length) {
    console.log(`\nNot runnable — recorded as not-run, never estimated (${blocked.length}):`);
    const byReason = new Map<string, string[]>();
    for (const b of blocked) {
      const a = byReason.get(b.reason) ?? []; a.push(b.model.key); byReason.set(b.reason, a);
    }
    for (const [r, ks] of byReason) console.log(`  ${ks.length} models — ${r}\n    ${ks.join(", ")}`);
  }

  if (!models.length) {
    console.error("\nNo runnable models. Nothing was run and nothing was fabricated.");
    process.exit(1);
  }

  const cells = await plan(skills, models, conditions);
  if (!cells.length) {
    console.log("\nNothing to do — every cell is present and its key still matches.");
    return;
  }

  const est = estimate(cells);
  console.log(`\n── dry run ──────────────────────────────────────────────`);
  const runs = cells.reduce((a, c) => a + c.calls, 0);
  console.log(`  ${cells.length} cells · ${runs.toLocaleString()} graded runs · ~${Math.round(est.calls).toLocaleString()} model calls (${CFG.STEPS_PER_RUN} steps/run, measured) · ~${(est.tokens / 1e6).toFixed(1)}M tokens`);
  for (const [k, v] of [...est.byModel].sort((a, b) => b[1].usd - a[1].usd)) {
    console.log(`    ${k.padEnd(20)} ${String(Math.round(v.calls)).padStart(6)} model calls   $${v.usd.toFixed(3)}`);
  }
  console.log(`  estimated spend  $${est.usd.toFixed(2)}   (hard cap $${CFG.SPEND_CAP_USD})`);
  console.log(`  wall budget      ${CFG.BUDGET_MIN} min`);
  console.log(`─────────────────────────────────────────────────────────`);

  if (est.usd > CFG.SPEND_CAP_USD) {
    console.error(`\nEstimate exceeds the cap. Nothing was run. Raise FITS_SPEND_CAP or narrow the run.`);
    process.exit(1);
  }
  if (flag("plan")) { console.log("\n--plan: estimate only, nothing run.\n"); return; }
  if (!flag("yes")) {
    console.error(`\nRefusing to spend without confirmation. Re-run with --yes to proceed.`);
    process.exit(1);
  }

  store.logRun({ event: "run_start", run_id: runId, cells: cells.length, est_calls: est.calls, est_usd: est.usd, models: models.map((m) => m.key) });

  const spend = { usd: 0 };
  const deadline = Date.now() + CFG.BUDGET_MIN * 60_000;
  let done = 0, discarded = 0;

  for (const cell of cells) {
    if (Date.now() > deadline) {
      console.log(`\nWall budget reached. ${cells.length - done - discarded} cells left for the next pass — the graph resumes exactly here.`);
      break;
    }
    const label = `${cell.skill.id} x ${cell.model.key} [${cell.condition}]`;
    process.stdout.write(`  ${label.padEnd(52)} ${String(cell.calls).padStart(4)} calls … `);

    let out;
    try {
      out = await runCell(cell, runId, spend);
    } catch (e: any) {
      // Cached response or provider substitution. The cell is void, loudly.
      const why = String(e?.message ?? e);
      store.write({
        key: cell.key, type: "run",
        inputs: { skill: cell.skill.id, model: cell.model.key, condition: cell.condition, digest: cell.digest },
        rows: [], discarded: why, completed_at: new Date().toISOString(), wall_ms: 0, spend_usd: 0,
      });
      console.log(`VOID\n      ${why}`);
      store.logRun({ event: "cell_void", run_id: runId, cell: cell.key, reason: why });
      discarded++;
      continue;
    }

    if (out.discarded) {
      store.write({
        key: cell.key, type: "run",
        inputs: { skill: cell.skill.id, model: cell.model.key, condition: cell.condition, digest: cell.digest },
        rows: [], discarded: out.discarded, completed_at: new Date().toISOString(), wall_ms: out.wall, spend_usd: 0,
      });
      store.appendTranscripts(out.transcripts);
      console.log(`stopped — ${out.discarded.slice(0, 70)}`);
      discarded++;
      continue;
    }

    const pass = out.rows.filter((r) => r.pass_substance).length / (out.rows.length || 1);
    const boring = out.rows.filter((r) => r.bucket === "BORING").length;
    // The whole cell, in one rename. Never partial.
    store.write({
      key: cell.key, type: "run",
      inputs: { skill: cell.skill.id, model: cell.model.key, condition: cell.condition, digest: cell.digest, suite: suiteHash(cell.cases) },
      rows: out.rows, discarded: "", completed_at: new Date().toISOString(), wall_ms: out.wall,
      spend_usd: out.rows.reduce((a, r) => a + r.cost_usd, 0),
    });
    store.appendTranscripts(out.transcripts);
    done++;

    const med = out.rows.map((r) => r.latency_ms).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const p50 = med.length ? `${(med[Math.floor(med.length / 2)] / 1000).toFixed(1)}s` : "—";
    console.log(
      `pass ${pass.toFixed(2)}  p50 ${p50}  $${spend.usd.toFixed(3)}` +
      (boring ? `  ⚠ ${boring} BORING — harness suspect, not a model verdict` : ""),
    );
  }

  store.logRun({ event: "run_end", run_id: runId, cells_done: done, cells_discarded: discarded, spend_usd: spend.usd });
  console.log(`\n${done} cells landed · ${discarded} discarded · $${spend.usd.toFixed(3)} spent\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
