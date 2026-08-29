/**
 * The content-addressed node store.
 *
 * Every node's key is a hash of (node type, code version, resolved inputs). A
 * node with a cached result and an unchanged key is skipped. Change a model
 * digest, a skill's content hash, a case suite, or the classifier's version, and
 * exactly the affected subtree re-runs. That is the loop -- not a timer that
 * redoes everything.
 *
 * ATOMICITY IS THE POINT, not a nicety. A cell is (skill, model, condition) and
 * it lands whole or not at all: the rows are held in memory until the full trial
 * count is graded, then written in one file rename. Kill the engine mid-cell and
 * you lose that cell and nothing else. Waking up to half-written numbers is
 * worse than waking up to yesterday's.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./corpus.ts";
import type { ResultRow } from "./types.ts";

const NODES = join(REPO_ROOT, "data", "nodes");
const RUNS = join(REPO_ROOT, "data", "runs");
mkdirSync(NODES, { recursive: true });
mkdirSync(RUNS, { recursive: true });

export type NodeType = "discover" | "fetch" | "parse" | "cases" | "run" | "classify" | "aggregate" | "scope" | "repair" | "publish" | "canary";

export function nodeKey(type: NodeType, codeVersion: string, inputs: unknown): string {
  const s = JSON.stringify({ type, codeVersion, inputs });
  return `${type}-${createHash("sha256").update(s).digest("hex").slice(0, 20)}`;
}

export interface CellNode {
  key: string;
  type: NodeType;
  /** Everything that, if changed, must invalidate this node. */
  inputs: Record<string, unknown>;
  rows: ResultRow[];
  /** Non-empty when the cell was discarded rather than measured. */
  discarded: string;
  completed_at: string;
  wall_ms: number;
  spend_usd: number;
}

export function has(key: string): boolean {
  return existsSync(join(NODES, `${key}.json`));
}

export function read(key: string): CellNode | null {
  const p = join(NODES, `${key}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CellNode;
  } catch {
    return null; // a truncated node is no node; it will simply re-run
  }
}

/** Write-then-rename. A reader never sees a partial file. */
export function write(node: CellNode): void {
  const tmp = join(NODES, `.${node.key}.tmp`);
  writeFileSync(tmp, JSON.stringify(node));
  renameSync(tmp, join(NODES, `${node.key}.json`));
}

export function allNodes(): CellNode[] {
  return readdirSync(NODES)
    .filter((f) => f.endsWith(".json") && !f.startsWith("."))
    .map((f) => {
      try { return JSON.parse(readFileSync(join(NODES, f), "utf8")) as CellNode; } catch { return null; }
    })
    .filter((n): n is CellNode => n !== null);
}

export function allRows(): ResultRow[] {
  return allNodes().flatMap((n) => n.rows);
}

/** The run ledger: one line per session, for the digest and the spend record. */
export function logRun(entry: Record<string, unknown>): void {
  appendFileSync(join(RUNS, "ledger.jsonl"), JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\n");
}

export function readLedger(): Record<string, unknown>[] {
  const p = join(RUNS, "ledger.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return {}; }
  });
}

/** Verbatim traces, appended as cells complete. Big, and the reason re-judging
 *  never means re-running. */
export function appendTranscripts(lines: unknown[]): void {
  if (!lines.length) return;
  appendFileSync(join(RUNS, "transcripts.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
