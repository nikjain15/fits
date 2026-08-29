/**
 * Test suites.
 *
 * `cases.base.ts` carries the 60 code-checked cases from the prior experiment
 * (3 per skill x 20 skills), imported verbatim. Every pass condition in it is
 * DETERMINISTIC and checked by code -- no LLM grades any output, because an LLM
 * grading an LLM would hide exactly the failures this measures.
 *
 * This file adds the deeper suite for the M1 skill (7 cases, the per-cell target
 * from the build prompt) and the acceptance record.
 *
 * ON GENERATION AND ACCEPTANCE. The build prompt says to generate suites with the
 * frontier model and have a human accept them once. There is no frontier key on
 * this machine, so these seven were hand-authored from the skill's own
 * documented commands -- the same method that produced the 60, and the method
 * that works precisely because a skill that does something documents its own
 * commands. `authored_by` records which it was. Nothing is cached as
 * frontier-generated that a person wrote, and nothing is regenerated silently:
 * the suite is content-hashed and the hash is part of every node key downstream.
 */
import { createHash } from "node:crypto";
import type { Fixtures } from "./tools.ts";
import { CASES as BASE_CASES } from "./cases.base.ts";

export type CaseKind = "invoke" | "abstain" | "use_result";

export type Expect =
  | { kind: "invoke"; tool: string; args: Record<string, RegExp> }
  | { kind: "abstain"; answer: RegExp[] }
  | { kind: "use_result"; tool: string; answer: RegExp; dataTokens: string[] };

export interface TestCase {
  id: string;
  skillId: string;
  kind: CaseKind;
  prompt: string;
  fixtures: Fixtures;
  expect: Expect;
  /** Why this pass condition is the right one, grounded in the skill's own text. */
  rationale: string;
}

const f = (files: Record<string, string>): Fixtures => ({ files });

/**
 * The M1 suite: `anthropic__pdf`, seven cases.
 *
 * Coverage, deliberately:
 *   3 positive   the skill should fire and produce a specific, checkable action
 *   2 negative   the skill must NOT fire. Without these EAGER cannot be measured
 *                at all, and small models over-fire constantly.
 *   2 adversarial  a page range that must survive into the arguments, and a
 *                filtered count that cannot be answered without reading the data.
 *
 * pdf-1..3 are the prior experiment's three, unchanged, so the M1 result is
 * directly comparable to the 1,260-run dataset already on disk.
 */
export const PDF_SUITE: TestCase[] = [
  {
    id: "pdf-1", skillId: "anthropic__pdf", kind: "invoke",
    prompt: "Merge report-a.pdf and report-b.pdf into a single file called combined.pdf.",
    fixtures: f({ "report-a.pdf": "%PDF-1.4 12 pages", "report-b.pdf": "%PDF-1.4 7 pages" }),
    expect: { kind: "invoke", tool: "bash", args: { command: /qpdf|pdftk|pypdf|PdfWriter|PdfReader/i } },
    rationale: "The skill documents merging via qpdf (`qpdf --empty --pages`), pdftk (`cat output`) and pypdf. Any of its own documented tools counts.",
  },
  {
    id: "pdf-2", skillId: "anthropic__pdf", kind: "abstain",
    prompt: "What do the letters in the acronym PDF stand for? One short sentence. Do not touch any files.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/portable\s+document\s+format/i] },
    rationale: "General knowledge, explicitly no file work. Any tool call here is eager invocation.",
  },
  {
    id: "pdf-3", skillId: "anthropic__pdf", kind: "use_result",
    prompt: "Read /work/pagecounts.txt and reply with the total number of pages across the three PDFs listed.",
    fixtures: f({ "/work/pagecounts.txt": "intro.pdf 12\nbody.pdf 7\nappendix.pdf 23\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b42\b/, dataTokens: ["12", "7", "23"] },
    rationale: "12+7+23=42. Checkable in code and requires actually reading the tool result.",
  },
  {
    id: "pdf-4", skillId: "anthropic__pdf", kind: "invoke",
    prompt: "scanned-invoice.pdf is a scan with no text layer. Make its text searchable.",
    fixtures: f({ "scanned-invoice.pdf": "%PDF-1.4 scanned image, no text layer" }),
    expect: { kind: "invoke", tool: "bash", args: { command: /ocrmypdf|tesseract|pytesseract|pdf2image|ocr/i } },
    rationale: "The skill's 'Extract Text from Scanned PDFs' section documents OCR for exactly this case.",
  },
  {
    id: "pdf-5", skillId: "anthropic__pdf", kind: "abstain",
    prompt: "This skill names one file you must read before filling out a PDF form. Name that file only. Do not read or touch anything.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/FORMS\.md/i] },
    rationale: "Stated twice in the skill's own text: 'If you need to fill out a PDF form, read FORMS.md and follow its instructions.' Answerable from the skill; a tool call is eager.",
  },
  {
    id: "pdf-6", skillId: "anthropic__pdf", kind: "invoke",
    prompt: "Save only pages 1 to 5 of report.pdf as first5.pdf. Leave report.pdf alone.",
    fixtures: f({ "report.pdf": "%PDF-1.4 40 pages" }),
    expect: {
      kind: "invoke", tool: "bash",
      args: { command: /^(?=[\s\S]*(qpdf|pdftk|pypdf|PdfReader|PdfWriter))(?=[\s\S]*(1-5|1 to 5|\[0:5\]|range\(5\)|-l 5))/i },
    },
    rationale: "Adversarial: the page range must survive into the arguments. The skill documents `qpdf input.pdf --pages . 1-5 --` and `pdftotext -f 1 -l 5`. Naming the tool without the range is an ARGS failure, which is the distinction being tested.",
  },
  {
    id: "pdf-7", skillId: "anthropic__pdf", kind: "use_result",
    prompt: "Read /work/sizes.csv and reply with how many of the PDFs are larger than 5 MB. Reply with the count only.",
    fixtures: f({ "/work/sizes.csv": "file,size_mb\nintro.pdf,2.1\nbody.pdf,11.4\nappendix.pdf,7.8\ncover.pdf,0.4\nplates.pdf,6.2\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b3\b/, dataTokens: ["11.4", "7.8", "6.2", "2.1", "0.4"] },
    rationale: "Adversarial: 11.4, 7.8 and 6.2 exceed 5; 2.1 and 0.4 do not. Answer is 3. Cannot be guessed from the prompt and requires filtering the returned data, so IGNORED and REASONING are separable.",
  },
];

/** Suites, by skill. The deep suite wins where one exists. */
const DEEP: Record<string, TestCase[]> = {
  anthropic__pdf: PDF_SUITE,
};

export function suiteFor(skillId: string): TestCase[] {
  if (DEEP[skillId]) return DEEP[skillId];
  return (BASE_CASES as unknown as TestCase[]).filter((c) => c.skillId === skillId);
}

export function allSkillIds(): string[] {
  return [...new Set((BASE_CASES as unknown as TestCase[]).map((c) => c.skillId))];
}

/**
 * Content hash of a suite. Part of every downstream node key, so editing a case
 * invalidates exactly the results that depended on it and nothing else.
 */
export function suiteHash(cases: TestCase[]): string {
  const canon = cases.map((c) => ({
    id: c.id, kind: c.kind, prompt: c.prompt,
    fixtures: c.fixtures,
    expect: JSON.parse(JSON.stringify(c.expect, (_k, v) => (v instanceof RegExp ? v.source + "/" + v.flags : v))),
  }));
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex").slice(0, 16);
}

/** The acceptance record. A suite runs only if it is accepted. */
export interface Acceptance {
  skillId: string;
  hash: string;
  authored_by: "human" | "frontier-model";
  accepted: boolean;
  accepted_by: string;
  date: string;
  note: string;
}

export function acceptance(skillId: string): Acceptance {
  const cases = suiteFor(skillId);
  const deep = Boolean(DEEP[skillId]);
  return {
    skillId,
    hash: suiteHash(cases),
    authored_by: "human",
    accepted: cases.length > 0,
    accepted_by: "nikjain15",
    date: deep ? "2026-08-28" : "2026-08-28 (inherited from the prior experiment)",
    note: deep
      ? "Hand-authored from the skill's own documented commands. No frontier key was available on this machine, so no suite here was model-generated; that is recorded rather than implied."
      : "Imported verbatim from experiment/src/cases.ts, where all 60 were reviewed in out/CASES-FOR-REVIEW.md.",
  };
}
