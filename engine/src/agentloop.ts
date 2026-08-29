/**
 * A minimal agent loop. Deliberately small and dependency-free: the prior
 * harness borrowed one from an external checkout, which is fine for an
 * experiment on one machine and impossible for a repo that has to run in GitHub
 * Actions.
 *
 * It does three things and nothing else: call the model, run the tool it asked
 * for, feed the result back. Argument validation is recorded rather than
 * enforced -- a malformed call is a MEASUREMENT (bucket ARGS), so rejecting it
 * before it reaches the classifier would delete the finding.
 */
import { parseTurn, type ParsedTurn } from "./protocol.ts";
import { payloadBytes, type Tool } from "./tools.ts";

export interface StepRecord {
  kind: "tool_call" | "tool_error" | "answer";
  tool: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  /** Bytes of tool-call arguments. Feeds the rung-5 leak accounting. */
  arg_bytes: number;
}

export interface LoopResult {
  steps: StepRecord[];
  turns: ParsedTurn[];
  answer?: string;
  stoppedAtCap: boolean;
}

export interface LoopOptions {
  goal: string;
  system: string;
  tools: Tool[];
  maxSteps: number;
  call: (messages: Array<{ role: "user" | "assistant"; content: string }>) => Promise<string>;
}

export async function runAgent(o: LoopOptions): Promise<LoopResult> {
  const byName = new Map(o.tools.map((t) => [t.name, t]));
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: o.goal },
  ];
  const steps: StepRecord[] = [];
  const turns: ParsedTurn[] = [];

  for (let step = 0; step < o.maxSteps; step++) {
    const raw = await o.call(messages);
    const parsed = parseTurn(raw);
    turns.push(parsed);

    if (parsed.kind === "answer") {
      steps.push({ kind: "answer", tool: "", arg_bytes: 0 });
      return { steps, turns, answer: parsed.answer, stoppedAtCap: false };
    }

    if (parsed.kind !== "tool") {
      // Unparseable. End the run rather than burn calls on retries; the
      // classifier decides whether that was a botched call or plain prose.
      return { steps, turns, answer: parsed.raw, stoppedAtCap: false };
    }

    const { name, args } = parsed.tool!;
    const bytes = payloadBytes(args);
    const tool = byName.get(name);
    if (!tool) {
      // A call naming a tool that does not exist is recorded, not thrown. It is
      // the difference between "chose the wrong tool" and "could not express the
      // right one", which the classifier depends on.
      steps.push({ kind: "tool_error", tool: name, args, error: `no such tool: ${name}`, arg_bytes: bytes });
      // Feed the model back its own turn in the protocol's own shape. Echoing a
      // different shape teaches it to imitate the echo instead of the protocol.
      messages.push({ role: "assistant", content: JSON.stringify({ tool: name, args }) });
      messages.push({ role: "user", content: JSON.stringify({ error: `no such tool: ${name}` }) });
      continue;
    }

    let result: unknown;
    try {
      result = await tool.handler(args);
      steps.push({ kind: "tool_call", tool: name, args, result, arg_bytes: bytes });
    } catch (e: any) {
      steps.push({ kind: "tool_error", tool: name, args, error: String(e?.message ?? e), arg_bytes: bytes });
      result = { error: String(e?.message ?? e) };
    }
    messages.push({ role: "assistant", content: JSON.stringify({ tool: name, args }) });
    messages.push({ role: "user", content: JSON.stringify(result) });
  }

  return { steps, turns, stoppedAtCap: true };
}
