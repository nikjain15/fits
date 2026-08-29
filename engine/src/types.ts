/**
 * The measurement schema. One row per (condition, skill, model, case, trial).
 * Everything the site shows is derived from these rows and nothing else.
 *
 * Mirrors experiment/out/results.csv, plus the fields this build adds: the lane
 * a result came from, what actually served it, and the provenance needed to know
 * when a row has expired.
 */

export type Condition = "A" | "B";
export type CaseKind = "invoke" | "abstain" | "use_result";
export type Bucket = "SELECTION" | "EAGER" | "ARGS" | "IGNORED" | "REASONING" | "BORING";
export type Attribution = "FORMAT" | "SKILL_TEXT" | "MODEL";
export type Lane = "hosted" | "local";

/** Size classes. Several real models per class wherever they exist — a class is
 *  a range, never a point. `frontier` is a reference ceiling, not a product claim. */
export type SizeClass =
  | "0.5B" | "1B" | "1.5B" | "2.6B" | "3B" | "4B"
  | "7B" | "8B" | "9B" | "12B" | "frontier";

export const SIZE_CLASS_ORDER: SizeClass[] = [
  "0.5B", "1B", "1.5B", "2.6B", "3B", "4B", "7B", "8B", "9B", "12B", "frontier",
];

export interface ModelSpec {
  /** Stable key used in row keys and on the site. */
  key: string;
  /** What we ASK the provider for. Compared against served_model on every call. */
  id: string;
  cls: SizeClass;
  lane: Lane;
  provider: "openrouter" | "ollama" | "conduit";
  /** fp16 | q4_K_M | q4_0 | unknown. Never guessed — read from the provider or
   *  recorded as "unknown", which is itself a finding. */
  quantization: string;
  /** False for models whose API rejects sampling params. */
  sendTemperature: boolean;
  /** Send an explicit reasoning-off flag; true for anything with a thinking mode. */
  disableReasoning: boolean;
  /** Frontier rows are a ceiling reference. One repeat run, never a min-spec candidate. */
  isCeiling?: boolean;
  note: string;
}

/** One graded call. This is the atom; everything else is arithmetic over these. */
export interface ResultRow {
  // --- identity -----------------------------------------------------------
  condition: Condition;
  skill: string;
  skill_repo: string;
  skill_stars: number;
  skill_body_chars: number;
  model: string;
  model_id: string;
  size_class: SizeClass;
  case: string;
  case_kind: CaseKind;
  trial: number;
  /** Which repeat run of the whole cell this trial belongs to (1..N). The spread
   *  ACROSS repeat runs is a measurement, not noise. */
  repeat: number;

  // --- verdict ------------------------------------------------------------
  pass_substance: boolean;
  pass_strict: boolean;
  protocol_ok: boolean;
  knew_command: boolean;
  bucket: Bucket | "";
  detail: string;
  /** Derived, only where the ceiling passed the same case. */
  attribution: Attribution | "";
  ceiling_passed: boolean | null;
  excluded_reason: string;

  // --- provenance ---------------------------------------------------------
  lane: Lane;
  /** What ACTUALLY answered. If it differs from model_id the cell is discarded. */
  served_model: string;
  served_provider: string;
  quantization: string;
  /** Must be false on every row. A cached row is not a measurement. */
  cached: boolean;
  /** Digest of the weights (local) or of the endpoint canary (hosted). Rows expire
   *  when this changes — never by time alone. */
  model_digest: string;

  // --- cost and shape -----------------------------------------------------
  /** Populated ONLY on lane === "local". Hosted rows carry null. */
  latency_ms: number | null;
  latency_note: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  steps: number;
  skills_in_scope: number;

  // --- run identity -------------------------------------------------------
  run_id: string;
  harness_version: string;
  ts: string;
}

export const HARNESS_VERSION = "fits-engine/0.1.0";

/** CSV column order. Stable — the site and every downstream script read it. */
export const ROW_COLUMNS: (keyof ResultRow)[] = [
  "condition", "skill", "skill_repo", "skill_stars", "skill_body_chars",
  "model", "model_id", "size_class", "case", "case_kind", "trial", "repeat",
  "pass_substance", "pass_strict", "protocol_ok", "knew_command", "bucket", "detail",
  "attribution", "ceiling_passed", "excluded_reason",
  "lane", "served_model", "served_provider", "quantization", "cached", "model_digest",
  "latency_ms", "latency_note", "cost_usd", "input_tokens", "output_tokens",
  "steps", "skills_in_scope", "run_id", "harness_version", "ts",
];
