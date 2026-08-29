/**
 * Deterministic grading and failure bucketing. No model grades anything here.
 * Five of the six buckets fall out of the trace structurally; only REASONING
 * involves judgment, and even that is decided by a code-checkable assertion
 * wherever the case supplies one.
 *
 * TWO PASS DEFINITIONS, reported separately:
 *
 *   passSubstance  Did it do the right thing — right tool, right arguments,
 *                  right conclusion, correct abstention — regardless of whether
 *                  it wrapped the reply in the required JSON envelope? This is
 *                  the headline, and the buckets are computed from it.
 *   passStrict     passSubstance AND every turn was protocol-conformant JSON.
 *                  What an agent runtime could actually execute.
 *
 * The gap between them IS the protocol tax and is reported as its own statistic.
 * Folding format noise into the taxonomy would inflate the very number we are
 * trying to measure honestly.
 *
 * BORING IS A SMOKE ALARM, NOT A BUCKET. Across 1,080 small-model runs in the
 * prior dataset there were zero. An earlier run showed 16.5% and every one was
 * the harness's own rate-limiting and connection handling. A non-zero BORING
 * rate means the harness is broken until proven otherwise; see aggregate.ts,
 * where a cell over 20% BORING is marked not-a-valid-measurement.
 */
import type { Bucket } from "./types.ts";
import type { StepRecord } from "./agentloop.ts";
import type { ParsedTurn } from "./protocol.ts";
import { TOOL_NAMES } from "./tools.ts";
import type { TestCase } from "./cases.ts";

export interface RunTrace {
  steps: StepRecord[];
  turns: ParsedTurn[];
  finalAnswer?: string;
  stoppedAtCap: boolean;
  error?: { kind: string; message: string };
}

export interface Grade {
  passSubstance: boolean;
  passStrict: boolean;
  protocolOk: boolean;
  /** The right command appeared in the raw text but no callable form was emitted.
   *  A distinct, reportable state — it is what ladder rung 2 repairs — but it is
   *  NOT a pass: no action occurred. */
  knewCommand: boolean;
  bucket: Bucket | "";
  detail: string;
  /** Which mechanism decided this case. Recorded so an LLM judge can never be
   *  mistaken for a code check. */
  decidedBy: "code";
}

const REAL_TOOLS = new Set<string>(TOOL_NAMES as readonly string[]);
const isRealTool = (t: string) => REAL_TOOLS.has(t);

interface CallRec { tool: string; args: any }
function callsOf(steps: StepRecord[]): CallRec[] {
  return steps
    .filter((s) => s.kind === "tool_call" || s.kind === "tool_error")
    .map((s) => ({ tool: s.tool, args: s.args }));
}

function argsMatchStrict(args: any, want: Record<string, RegExp>): boolean {
  for (const [k, re] of Object.entries(want)) {
    const v = args && typeof args === "object" ? (args as any)[k] : undefined;
    if (typeof v !== "string" || !re.test(v)) return false;
  }
  return true;
}
function argsMatchLoose(args: any, want: Record<string, RegExp>): boolean {
  const blob = JSON.stringify(args ?? {});
  return Object.values(want).every((re) => re.test(blob));
}

export function grade(c: TestCase, t: RunTrace): Grade {
  const decidedBy = "code" as const;

  // 1. BORING first: anything that never got a fair hearing. This is an alarm
  //    about our own infrastructure, not a verdict about the model.
  if (t.error) {
    return {
      passSubstance: false, passStrict: false, protocolOk: false, knewCommand: false,
      bucket: "BORING", detail: `${t.error.kind}: ${t.error.message.slice(0, 160)}`, decidedBy,
    };
  }
  if (t.turns.length === 0 || t.turns.every((x) => x.kind === "empty")) {
    return {
      passSubstance: false, passStrict: false, protocolOk: false, knewCommand: false,
      bucket: "BORING", detail: "model returned no content", decidedBy,
    };
  }

  const calls = callsOf(t.steps);
  const attempted = t.turns.some((x) => x.kind === "unparseable_tool_attempt");
  const allRaw = t.turns.map((x) => x.raw).join("\n");
  const protocolOk = t.turns.every((x) => x.kind === "tool" || x.kind === "answer");
  const lastRaw = t.turns.length ? t.turns[t.turns.length - 1].raw : "";
  const answerText = t.finalAnswer ?? lastRaw;

  const done = (passSubstance: boolean, bucket: Bucket | "", detail: string, knewCommand = false): Grade => ({
    passSubstance,
    passStrict: passSubstance && protocolOk,
    protocolOk,
    knewCommand,
    bucket: passSubstance ? "" : bucket,
    detail,
    decidedBy,
  });

  const e = c.expect;

  if (e.kind === "invoke") {
    const exact = calls.find((x) => x.tool === e.tool && argsMatchStrict(x.args, e.args));
    if (exact) return done(true, "", `called ${e.tool} with matching args`);

    const rightTool = calls.filter((x) => x.tool === e.tool);
    if (rightTool.length) {
      const loose = rightTool.find((x) => argsMatchLoose(x.args, e.args));
      if (loose) return done(true, "", `called ${e.tool}; intent present under a non-standard arg key`);
      return done(false, "ARGS", `called ${e.tool} but args did not match: ${JSON.stringify(rightTool[0].args).slice(0, 160)}`);
    }
    if (calls.length) {
      // Naming the SKILL as the tool means the right skill was chosen and the
      // call was malformed — an ARGS failure, not a selection failure. Keeping
      // these apart is what stops SELECTION absorbing every malformed call and
      // inflating itself; conflating them is the single bug that moved the prior
      // Gemma-3-4B selection figure from 0.496 to 0.829.
      if (calls.every((x) => !isRealTool(x.tool))) {
        return done(false, "ARGS", `invented a tool name ("${calls[0].tool}") instead of calling ${e.tool}`, true);
      }
      return done(false, "SELECTION", `called ${calls.map((x) => x.tool).join(",")} instead of ${e.tool}`);
    }
    const knew = Object.values(e.args).every((re) => re.test(allRaw));
    if (knew) return done(false, "ARGS", "named the right command in prose but emitted no callable form", true);
    if (attempted) return done(false, "ARGS", "attempted a tool call that did not parse");
    return done(false, "SELECTION", "never invoked a tool");
  }

  if (e.kind === "abstain") {
    if (calls.length) return done(false, "EAGER", `called ${calls.map((x) => x.tool).join(",")} when no tool was needed`);
    if (attempted) return done(false, "EAGER", "attempted a tool call when no tool was needed");
    if (e.answer.every((re) => re.test(answerText))) return done(true, "", "abstained and answered correctly");
    if (e.answer.every((re) => re.test(allRaw))) return done(true, "", "abstained; correct content outside the answer envelope");
    return done(false, "REASONING", `abstained but answered wrongly: ${answerText.slice(0, 160)}`);
  }

  // ------------------------------------------------------------- use_result
  //
  // WHAT THIS CASE KIND ACTUALLY TESTS: did the model get the data in front of
  // it, and did it then use it correctly? It does NOT test which reader it
  // reached for.
  //
  // Two harness artifacts were found here on the first M1 smoke run and are
  // fixed below. Both inflated the failure count with our own choices:
  //
  //   (a) Requiring the exact `e.tool` scored `cat /work/sizes.csv` through the
  //       bash tool as a SELECTION error — a wrong-skill verdict — even though
  //       the model got the data and answered correctly. Our own mock bash
  //       serves `cat` from the fixtures deliberately, so penalising a model for
  //       using it measured our preference, not its capability. Data returned by
  //       ANY tool now counts as data seen.
  //
  //   (b) `sawData` was tested against the final answer. For an aggregate case
  //       the correct answer is a sum or a count and contains NONE of the input
  //       tokens by construction, so every wrong aggregate landed in IGNORED and
  //       REASONING was unreachable. IGNORED means "called the tool, then
  //       ignored what came back"; a model that returns 32 for 12+7+23 did not
  //       ignore the result, it used it wrongly. Data seen is now tested against
  //       the whole trace, and an answer of the expected SHAPE counts as
  //       engagement.
  //
  // Attribution is unaffected — IGNORED and REASONING both map to MODEL — so the
  // prior dataset's FORMAT/SKILL-TEXT/MODEL split still stands. Only the raw
  // bucket display changes.
  const returnedBlob = JSON.stringify(t.steps.map((s) => s.result ?? null));
  const dataReturned = e.dataTokens.some((tok) => returnedBlob.includes(tok));

  if (!dataReturned) {
    if (calls.length && calls.every((x) => !isRealTool(x.tool))) {
      return done(false, "ARGS", `invented a tool name ("${calls[0].tool}") instead of calling ${e.tool}`, true);
    }
    if (calls.length) {
      return done(false, "SELECTION", `called ${calls.map((x) => x.tool).join(",")}, which never returned the data`);
    }
    if (attempted) return done(false, "ARGS", "attempted a tool call that did not parse");
    return done(false, "SELECTION", "never invoked a tool, so never saw the data");
  }

  if (e.answer.test(answerText)) return done(true, "", "used the tool result correctly");

  if (!t.finalAnswer && t.stoppedAtCap) {
    return done(false, "IGNORED", "got the tool result but never produced an answer (hit step cap)");
  }
  // Engagement: it quoted the data, or it produced an answer of the shape the
  // case asks for (a numeric expectation answered with a number).
  const quotedData = e.dataTokens.some((tok) => allRaw.includes(tok));
  const wantsNumber = /\\b|\d/.test(e.answer.source) && /\d/.test(e.answer.source);
  const gaveNumber = /\d/.test(answerText);
  if (quotedData || (wantsNumber && gaveNumber)) {
    return done(false, "REASONING", `had the data and concluded wrongly: ${answerText.slice(0, 160)}`);
  }
  return done(false, "IGNORED", `answer shows no engagement with the returned data: ${answerText.slice(0, 160)}`);
}

/**
 * Attribution is DERIVED, not judged, and only for rows the ceiling passed.
 *
 *   FORMAT      named the right command but could not emit it callably
 *   SKILL_TEXT  wrong skill or tool chosen, or the call was malformed
 *   MODEL       right calls / wrong judgment, ignored result, or fired eagerly
 *
 * The frontier is the discriminator: if it passed, the task is fair and the
 * skill is legible, so the limitation is in the small model. If it failed too,
 * this is not a small-model story at all and the case is excluded rather than
 * charged to a model.
 */
export function attributionOf(bucket: Bucket | "", knewCommand: boolean): "FORMAT" | "SKILL_TEXT" | "MODEL" | "" {
  if (!bucket || bucket === "BORING") return "";
  if (bucket === "ARGS" && knewCommand) return "FORMAT";
  if (bucket === "ARGS" || bucket === "SELECTION") return "SKILL_TEXT";
  return "MODEL";
}
