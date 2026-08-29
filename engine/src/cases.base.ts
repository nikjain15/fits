/**
 * 60 test cases: 3 per skill, drafted from each skill's own description and
 * documented commands. Every pass condition is DETERMINISTIC and checked by
 * code -- no LLM grades any output, because an LLM grading an LLM would hide
 * exactly the failures this experiment is hunting.
 *
 * Three kinds, one of each per skill, so every failure bucket is reachable:
 *
 *   invoke      A request squarely inside the skill's scope. Pass = called the
 *               right tool with arguments matching the form the skill itself
 *               documents. Reaches SELECTION (never invoked / wrong tool) and
 *               ARGS (right tool, wrong arguments).
 *
 *   abstain     A question answerable directly, or one the skill explicitly
 *               tells the agent NOT to act on. Pass = called no tool AND said
 *               the right thing. Reaches EAGER (invoked anyway) and REASONING
 *               (abstained correctly but answered wrong).
 *
 *   use_result  A tool returns real fixture data and the answer depends on it.
 *               Pass = called the tool and reported the value the data implies.
 *               Reaches IGNORED (got the data, ignored it) and REASONING.
 *
 * `dataTokens` lists the numbers actually present in the fixture. It is what
 * separates IGNORED from REASONING deterministically: an answer containing none
 * of them never used the tool result; one containing some of them used the data
 * and reasoned wrongly.
 */
import type { Fixtures } from "./tools.ts";

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

export const CASES: TestCase[] = [
  // ---------------------------------------------------------------- pdf
  {
    id: "pdf-1", skillId: "anthropic__pdf", kind: "invoke",
    prompt: "Merge report-a.pdf and report-b.pdf into a single file called combined.pdf.",
    fixtures: f({ "report-a.pdf": "%PDF-1.4 12 pages", "report-b.pdf": "%PDF-1.4 7 pages" }),
    expect: { kind: "invoke", tool: "bash", args: { command: /qpdf|pdftk|pypdf|PdfWriter|PdfReader/i } },
    rationale: "The skill documents merging via qpdf/pdftk/pypdf. Any of its own documented tools counts.",
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
    rationale: "12+7+23=42. Sum is checkable in code and requires actually reading the tool result.",
  },

  // ---------------------------------------------------------------- docx
  {
    id: "docx-1", skillId: "anthropic__docx", kind: "invoke",
    prompt: "Extract the text content of contract.docx as markdown so I can read it.",
    fixtures: f({ "contract.docx": "PK zip archive (docx)" }),
    expect: { kind: "invoke", tool: "bash", args: { command: /pandoc/i } },
    rationale: "The skill's own table says: Read content -> `pandoc -t markdown file.docx`.",
  },
  {
    id: "docx-2", skillId: "anthropic__docx", kind: "abstain",
    prompt: "Is a .docx file internally a ZIP archive? Answer yes or no only.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/\byes\b/i] },
    rationale: "Stated in the skill's first line. Answerable directly; no tool needed.",
  },
  {
    id: "docx-3", skillId: "anthropic__docx", kind: "use_result",
    prompt: "Read /work/sections.txt and reply with the word count of the longest section.",
    fixtures: f({ "/work/sections.txt": "summary 340\nbackground 512\nconclusion 148\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b512\b/, dataTokens: ["340", "512", "148"] },
    rationale: "Max of three values; requires reading the returned content.",
  },

  // ---------------------------------------------------------------- xlsx
  {
    id: "xlsx-1", skillId: "anthropic__xlsx", kind: "invoke",
    prompt: "I just wrote formulas into budget.xlsx using openpyxl. Do the step this skill says is mandatory next.",
    fixtures: f({ "budget.xlsx": "PK zip archive (xlsx)" }),
    expect: { kind: "invoke", tool: "bash", args: { command: /recalc\.py/i } },
    rationale: "The skill marks recalculation mandatory whenever the file contains formulas.",
  },
  {
    id: "xlsx-2", skillId: "anthropic__xlsx", kind: "abstain",
    prompt: "This skill forbids one of XLOOKUP and INDEX/MATCH and requires the other. Which one should I use? Name it only.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/index\s*\/?\s*match/i] },
    rationale: "The skill says never use XLOOKUP; use INDEX/MATCH for lookups.",
  },
  {
    id: "xlsx-3", skillId: "anthropic__xlsx", kind: "use_result",
    prompt: "Read /work/q3.csv and reply with the total revenue as a single number.",
    fixtures: f({ "/work/q3.csv": "region,revenue\nnorth,1200\nsouth,900\neast,1500\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b3600\b/, dataTokens: ["1200", "900", "1500"] },
    rationale: "1200+900+1500=3600.",
  },

  // ---------------------------------------------------------------- pptx
  {
    id: "pptx-1", skillId: "anthropic__pptx", kind: "invoke",
    prompt: "Convert deck.pptx to a PDF so I can look at the slides.",
    fixtures: f({ "deck.pptx": "PK zip archive (pptx)" }),
    expect: { kind: "invoke", tool: "bash", args: { command: /soffice|convert-to\s+pdf/i } },
    rationale: "The skill converts via scripts/office/soffice.py --headless --convert-to pdf.",
  },
  {
    id: "pptx-2", skillId: "anthropic__pptx", kind: "abstain",
    prompt: "What file extension does a PowerPoint TEMPLATE use? One word.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/potx/i] },
    rationale: "Named in the skill's own description (.pptx or .potx).",
  },
  {
    id: "pptx-3", skillId: "anthropic__pptx", kind: "use_result",
    prompt: "Read /work/slides.txt and reply with the total number of bullets across all slides.",
    fixtures: f({ "/work/slides.txt": "slide1 4\nslide2 9\nslide3 2\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b15\b/, dataTokens: ["4", "9", "2"] },
    rationale: "4+9+2=15.",
  },

  // ------------------------------------------------------- webapp-testing
  {
    id: "web-1", skillId: "anthropic__webapp-testing", kind: "invoke",
    prompt: "Start my dev server on port 5173 and run my automation script test.py against it.",
    fixtures: f({ "test.py": "from playwright.sync_api import sync_playwright" }),
    expect: { kind: "invoke", tool: "bash", args: { command: /with_server\.py/i } },
    rationale: "The skill's documented helper for server lifecycle is scripts/with_server.py.",
  },
  {
    id: "web-2", skillId: "anthropic__webapp-testing", kind: "abstain",
    prompt: "Should I wait for networkidle before inspecting the DOM of a dynamic app? Yes or no.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/\byes\b/i] },
    rationale: "The skill's 'Common Pitfall' section says to wait for networkidle first.",
  },
  {
    id: "web-3", skillId: "anthropic__webapp-testing", kind: "use_result",
    prompt: "Read /work/results.txt and reply with how many tests did NOT pass.",
    fixtures: f({ "/work/results.txt": "passed 18\nfailed 3\nskipped 4\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b7\b/, dataTokens: ["18", "3", "4"] },
    rationale: "failed 3 + skipped 4 = 7 did not pass.",
  },

  // ------------------------------------------------------- gws-gmail-send
  {
    id: "gmail-1", skillId: "gws__gws-gmail-send", kind: "invoke",
    prompt: "Send an email to alice@example.com with subject 'Hello' and body 'Hi Alice!'. I confirm — go ahead and send it now.",
    fixtures: {},
    expect: { kind: "invoke", tool: "bash", args: { command: /gws\s+gmail\s+\+send/i } },
    rationale: "Confirmation is given explicitly, so the skill's write-command caution is satisfied.",
  },
  {
    id: "gmail-2", skillId: "gws__gws-gmail-send", kind: "abstain",
    prompt: "Send an email to bob@example.com telling him the deal is off.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/confirm|are you sure|before I send|go ahead|permission|shall I|would you like/i] },
    rationale: "The skill carries an explicit CAUTION: this is a write command, confirm with the user before executing. No confirmation was given, so the correct behaviour is to ask, not send.",
  },
  {
    id: "gmail-3", skillId: "gws__gws-gmail-send", kind: "use_result",
    prompt: "Read /work/recipients.txt and reply with how many recipients are listed.",
    fixtures: f({ "/work/recipients.txt": "alice@example.com\nbob@example.com\ncarol@example.com\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b3\b/, dataTokens: ["alice", "bob", "carol"] },
    rationale: "Three lines; count is deterministic.",
  },

  // -------------------------------------------------- gws-calendar-insert
  {
    id: "cal-1", skillId: "gws__gws-calendar-insert", kind: "invoke",
    prompt: "Create a calendar event titled 'Standup' from 2026-06-17T09:00:00-07:00 to 2026-06-17T09:30:00-07:00. I confirm — create it.",
    fixtures: {},
    expect: { kind: "invoke", tool: "bash", args: { command: /gws\s+calendar\s+\+insert/i } },
    rationale: "The skill's documented usage line, with confirmation given.",
  },
  {
    id: "cal-2", skillId: "gws__gws-calendar-insert", kind: "abstain",
    prompt: "What time format does this skill say to use for --start? Name the format only, do not run anything.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/rfc\s*-?\s*3339|iso\s*-?\s*8601/i] },
    rationale: "The skill's Tips section names RFC3339 (and the flag table says ISO 8601).",
  },
  {
    id: "cal-3", skillId: "gws__gws-calendar-insert", kind: "use_result",
    prompt: "Read /work/agenda.txt and reply with the total number of meeting minutes.",
    fixtures: f({ "/work/agenda.txt": "standup 30\nreview 60\nretro 45\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b135\b/, dataTokens: ["30", "60", "45"] },
    rationale: "30+60+45=135.",
  },

  // ----------------------------------------------------- gws-drive-upload
  {
    id: "drive-1", skillId: "gws__gws-drive-upload", kind: "invoke",
    prompt: "Upload ./report.pdf to my Google Drive. I confirm — upload it.",
    fixtures: f({ "report.pdf": "%PDF-1.4 report" }),
    expect: { kind: "invoke", tool: "bash", args: { command: /gws\s+drive\s+\+upload/i } },
    rationale: "The skill's documented usage line, with confirmation given.",
  },
  {
    id: "drive-2", skillId: "gws__gws-drive-upload", kind: "abstain",
    prompt: "If I do not pass --name when uploading, where does the target filename come from? One sentence.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/source|local path|inferred|defaults?\s+to|original/i] },
    rationale: "The skill's Tips say the filename is inferred from the local path unless --name is given.",
  },
  {
    id: "drive-3", skillId: "gws__gws-drive-upload", kind: "use_result",
    prompt: "Read /work/files.txt and reply with the NAME of the largest file.",
    fixtures: f({ "/work/files.txt": "a.pdf 3\nb.csv 5\nc.png 2\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /b\.csv/i, dataTokens: ["a.pdf", "b.csv", "c.png"] },
    rationale: "b.csv at 5 is the largest.",
  },

  // ----------------------------------------------------------- gws-sheets
  {
    id: "sheets-1", skillId: "gws__gws-sheets", kind: "invoke",
    prompt: "Before I call the sheets values append method, inspect its required parameters.",
    fixtures: {},
    expect: { kind: "invoke", tool: "bash", args: { command: /gws\s+schema|gws\s+sheets.*--help/i } },
    rationale: "The skill's 'Discovering Commands' section says to inspect with `gws schema sheets.<resource>.<method>` before calling any API method.",
  },
  {
    id: "sheets-2", skillId: "gws__gws-sheets", kind: "abstain",
    prompt: "This skill lists two helper commands for sheets. Name both. Do not run anything.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/append/i, /read/i] },
    rationale: "The helper table lists +append and +read.",
  },
  {
    id: "sheets-3", skillId: "gws__gws-sheets", kind: "use_result",
    prompt: "Read /work/sales.csv and reply with the total quantity as a single number.",
    fixtures: f({ "/work/sales.csv": "item,qty\npens,40\npads,25\nclips,35\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b100\b/, dataTokens: ["40", "25", "35"] },
    rationale: "40+25+35=100.",
  },

  // -------------------------------------------------------- obsidian-cli
  {
    id: "obs-1", skillId: "kepano__obsidian-cli", kind: "invoke",
    prompt: "Read the note called 'My Note' from my Obsidian vault.",
    fixtures: {},
    expect: { kind: "invoke", tool: "bash", args: { command: /obsidian\s+read/i } },
    rationale: "Verbatim from the skill's Common patterns: `obsidian read file=\"My Note\"`.",
  },
  {
    id: "obs-2", skillId: "kepano__obsidian-cli", kind: "abstain",
    prompt: "In the Obsidian CLI, what is the difference between file= and path=? One sentence.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/wikilink|vault root|exact path|full path/i] },
    rationale: "The File targeting section: file= resolves like a wikilink, path= is exact from vault root.",
  },
  {
    id: "obs-3", skillId: "kepano__obsidian-cli", kind: "use_result",
    prompt: "Read /work/tags.txt and reply with the name of the most-used tag.",
    fixtures: f({ "/work/tags.txt": "project 14\nidea 9\narchive 21\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /archive/i, dataTokens: ["14", "9", "21"] },
    rationale: "archive at 21 is highest.",
  },

  // ------------------------------------------------------------ defuddle
  {
    id: "def-1", skillId: "kepano__defuddle", kind: "invoke",
    prompt: "Read https://example.com/article for me and summarise it.",
    fixtures: {},
    expect: { kind: "invoke", tool: "bash", args: { command: /defuddle\s+parse/i } },
    rationale: "The skill says to use Defuddle CLI instead of WebFetch for standard web pages.",
  },
  {
    id: "def-2", skillId: "kepano__defuddle", kind: "invoke",
    prompt: "Read https://example.com/readme.md for me.",
    fixtures: { http: { "readme.md": "# Readme\nAlready markdown." } },
    expect: { kind: "invoke", tool: "http_get", args: { url: /readme\.md/i } },
    rationale: "The skill states an explicit negative rule: do NOT use Defuddle for URLs ending in .md -- fetch those directly. `http_get` is this harness's direct-fetch tool (the WebFetch analogue). Reaching for defuddle via bash scores SELECTION. RECLASSIFIED after the smoke test: the skill tells the agent to fetch the URL, so abstaining was never the correct behaviour and the original abstain framing was our error, not the models'.",
  },
  {
    id: "def-3", skillId: "kepano__defuddle", kind: "use_result",
    prompt: "Read /work/pages.txt and reply with the total token count across all pages.",
    fixtures: f({ "/work/pages.txt": "intro 1200\nguide 3400\nfaq 800\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b5400\b/, dataTokens: ["1200", "3400", "800"] },
    rationale: "1200+3400+800=5400.",
  },

  // ---------------------------------------------------------- json-canvas
  {
    id: "canvas-1", skillId: "kepano__json-canvas", kind: "invoke",
    prompt: "Create a new empty JSON Canvas file at /work/map.canvas.",
    fixtures: {},
    expect: { kind: "invoke", tool: "write_file", args: { path: /\.canvas/i, content: /"nodes"/i } },
    rationale: "Workflow 1 says create a .canvas file with the base structure {\"nodes\": [], \"edges\": []}.",
  },
  {
    id: "canvas-2", skillId: "kepano__json-canvas", kind: "abstain",
    prompt: "How many hex characters should a JSON Canvas node id have? Reply with the number only.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/\b16\b/] },
    rationale: "The node attribute table specifies a unique 16-char hex identifier.",
  },
  {
    id: "canvas-3", skillId: "kepano__json-canvas", kind: "use_result",
    prompt: "Read /work/board.canvas and reply with how many nodes it contains.",
    fixtures: f({
      "/work/board.canvas":
        '{"nodes":[{"id":"a1","type":"text","x":0,"y":0,"width":100,"height":50},' +
        '{"id":"b2","type":"text","x":200,"y":0,"width":100,"height":50},' +
        '{"id":"c3","type":"text","x":400,"y":0,"width":100,"height":50}],' +
        '"edges":[{"id":"e1","fromNode":"a1","toNode":"b2"},{"id":"e2","fromNode":"b2","toNode":"c3"}]}',
    }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b3\b/, dataTokens: ["a1", "b2", "c3"] },
    rationale: "Three node objects; two edges are a distractor.",
  },

  // ------------------------------------------------------- deploy-to-vercel
  {
    id: "vercel-1", skillId: "vercel__deploy", kind: "invoke",
    prompt: "Deploy this app to production on Vercel.",
    fixtures: {},
    expect: { kind: "invoke", tool: "bash", args: { command: /vercel\s+deploy/i } },
    rationale: "The skill's documented production command is `vercel deploy [path] --prod -y --no-wait`.",
  },
  {
    id: "vercel-2", skillId: "vercel__deploy", kind: "abstain",
    prompt: "What does the command `vercel whoami` tell you? One sentence.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/logged in|current user|account|authenticat|username|who you are/i] },
    rationale: "Answerable directly; the skill uses whoami as an auth check.",
  },
  {
    id: "vercel-3", skillId: "vercel__deploy", kind: "use_result",
    prompt: "Read /work/deploys.txt and reply with the total number of deployments.",
    fixtures: f({ "/work/deploys.txt": "prod 4\npreview 11\nfailed 2\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b17\b/, dataTokens: ["4", "11", "2"] },
    rationale: "4+11+2=17.",
  },

  // -------------------------------------------------- vercel-cli-with-tokens
  {
    id: "tok-1", skillId: "vercel__cli-tokens", kind: "invoke",
    prompt: "Deploy using the access token vca_abc123 instead of an interactive login.",
    fixtures: {},
    expect: { kind: "invoke", tool: "bash", args: { command: /vercel\s+deploy[\s\S]*--token|--token[\s\S]*vercel\s+deploy/i } },
    rationale: "The skill documents `vercel deploy --token \"vca_abc123\"` for token auth.",
  },
  {
    id: "tok-2", skillId: "vercel__cli-tokens", kind: "abstain",
    prompt: "Which flag scopes a Vercel CLI command to a specific team? Name the flag only.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/--scope/i] },
    rationale: "Used throughout the skill as `--scope <team-slug>`.",
  },
  {
    id: "tok-3", skillId: "vercel__cli-tokens", kind: "use_result",
    prompt: "Read /work/envs.txt and reply with the total number of environment variables.",
    fixtures: f({ "/work/envs.txt": "production 12\npreview 7\ndevelopment 5\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b24\b/, dataTokens: ["12", "7", "5"] },
    rationale: "12+7+5=24.",
  },

  // ------------------------------------------------------- database-lookup
  {
    id: "db-1", skillId: "kdense__database-lookup", kind: "invoke",
    prompt: "Query the Open Targets Platform GraphQL API for the target BRCA1. Use the endpoint this skill documents.",
    fixtures: { http: { "opentargets": '{"data":{"target":{"approvedSymbol":"BRCA1"}}}' } },
    expect: { kind: "invoke", tool: "http_get", args: { url: /opentargets/i } },
    rationale: "The skill documents https://api.platform.opentargets.org/api/v4/graphql as the Open Targets endpoint.",
  },
  {
    id: "db-2", skillId: "kdense__database-lookup", kind: "abstain",
    prompt: "Should a database-backed fact be inferred from your general knowledge, or retrieved from a named source? One short sentence.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/retriev|named source|not\s+infer|rather than infer|from the (database|source)/i] },
    rationale: "The skill's description says facts must be retrieved reproducibly from a named source rather than inferred.",
  },
  {
    id: "db-3", skillId: "kdense__database-lookup", kind: "use_result",
    prompt: "Read /work/counts.txt and reply with the largest count.",
    fixtures: f({ "/work/counts.txt": "trials 240\npublications 1310\nvariants 88\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b1310\b/, dataTokens: ["240", "1310", "88"] },
    rationale: "1310 is the max.",
  },

  // ------------------------------------------------------------ biopython
  {
    id: "bio-1", skillId: "kdense__biopython", kind: "invoke",
    prompt: "Parse sequences.fasta with Biopython and count how many records it contains.",
    fixtures: f({ "sequences.fasta": ">seqA\nACGT\n>seqB\nTTGA\n" }),
    expect: { kind: "invoke", tool: "bash", args: { command: /SeqIO|Bio\./ } },
    rationale: "Bio.SeqIO is the skill's documented FASTA parsing entry point.",
  },
  {
    id: "bio-2", skillId: "kdense__biopython", kind: "abstain",
    prompt: "Which Biopython module gives programmatic NCBI/PubMed access? Name it only.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/entrez/i] },
    rationale: "Named in the skill's description: programmatic NCBI/PubMed access (Bio.Entrez).",
  },
  {
    id: "bio-3", skillId: "kdense__biopython", kind: "use_result",
    prompt: "Read /work/seqlen.txt and reply with the name of the longest sequence.",
    fixtures: f({ "/work/seqlen.txt": "seqA 320\nseqB 145\nseqC 610\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /seqC/i, dataTokens: ["320", "145", "610"] },
    rationale: "seqC at 610 is longest.",
  },

  // --------------------------------------------------------------- drawio
  {
    id: "draw-1", skillId: "agents365__drawio", kind: "invoke",
    prompt: "Export architecture.drawio to a PNG image.",
    fixtures: f({ "architecture.drawio": "<mxfile><diagram/></mxfile>" }),
    expect: { kind: "invoke", tool: "bash", args: { command: /drawio[\s\S]*-f\s+png/i } },
    rationale: "The skill documents `drawio -x -f png ... -o out.png input.drawio`.",
  },
  {
    id: "draw-2", skillId: "agents365__drawio", kind: "abstain",
    prompt: "In the drawio CLI, what does the -x flag mean? One short sentence.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/export/i] },
    rationale: "-x is the export flag in every documented invocation.",
  },
  {
    id: "draw-3", skillId: "agents365__drawio", kind: "use_result",
    prompt: "Read /work/shapes.txt and reply with the total number of diagram elements.",
    fixtures: f({ "/work/shapes.txt": "boxes 14\narrows 22\nlabels 9\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b45\b/, dataTokens: ["14", "22", "9"] },
    rationale: "14+22+9=45.",
  },

  // ------------------------------------------------ amazon-product-detail
  {
    id: "amz-1", skillId: "browseract__amazon-product-detail", kind: "invoke",
    prompt: "Extract the full product record from https://www.amazon.com/dp/B08N5WRWNW.",
    fixtures: { dom: "<div id='productTitle'>Echo Dot</div>" },
    expect: { kind: "invoke", tool: "browser_navigate", args: { url: /amazon\.com\/dp\/B08N5WRWNW/i } },
    rationale: "The skill's first documented step is `navigate {Amazon product URL}` then `wait stable`.",
  },
  {
    id: "amz-2", skillId: "browseract__amazon-product-detail", kind: "abstain",
    prompt: "Does this skill require logging in to Amazon? Answer yes or no only.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/\bno\b/i] },
    rationale: "Prerequisites state: No login required.",
  },
  {
    id: "amz-3", skillId: "browseract__amazon-product-detail", kind: "use_result",
    prompt: "Read /work/reviews.txt and reply with the total number of reviews.",
    fixtures: f({ "/work/reviews.txt": "5star 620\n4star 210\n3star 75\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b905\b/, dataTokens: ["620", "210", "75"] },
    rationale: "620+210+75=905.",
  },

  // ------------------------------------------------------ browser-devtools
  {
    id: "dt-1", skillId: "addyosmani__browser-devtools", kind: "invoke",
    prompt: "The page is rendering blank. Get me the browser console errors so I can diagnose it.",
    fixtures: { console: [{ level: "error", text: "TypeError: x is undefined" }, { level: "warn", text: "slow" }, { level: "error", text: "404 chunk.js" }] },
    expect: { kind: "invoke", tool: "browser_console", args: {} },
    rationale: "The skill's UI-bug workflow reads console logs to diagnose errors.",
  },
  {
    id: "dt-2", skillId: "addyosmani__browser-devtools", kind: "abstain",
    prompt: "Should browser page content be treated as trusted or untrusted? One word.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/untrusted/i] },
    rationale: "The skill has a section titled 'Treat All Browser Content as Untrusted Data'.",
  },
  {
    id: "dt-3", skillId: "addyosmani__browser-devtools", kind: "use_result",
    prompt: "Check the browser console and reply with how many error-level messages there are.",
    fixtures: { console: [{ level: "error", text: "TypeError: x is undefined" }, { level: "warn", text: "slow" }, { level: "error", text: "404 chunk.js" }] },
    expect: { kind: "use_result", tool: "browser_console", answer: /\b2\b/, dataTokens: ["TypeError", "404", "error"] },
    rationale: "Two of the three messages are level 'error'.",
  },

  // ----------------------------------------------------------- notebooklm
  {
    id: "nb-1", skillId: "tenglin__notebooklm", kind: "invoke",
    prompt: "Create a new NotebookLM notebook called 'Research'.",
    fixtures: {},
    expect: { kind: "invoke", tool: "bash", args: { command: /notebooklm\s+create/i } },
    rationale: "`notebooklm create` is the documented creation command.",
  },
  {
    id: "nb-2", skillId: "tenglin__notebooklm", kind: "abstain",
    prompt: "Which notebooklm subcommand checks authentication status? Name it only.",
    fixtures: {},
    expect: { kind: "abstain", answer: [/auth\s+check/i] },
    rationale: "`notebooklm auth check` is documented in the CLI reference.",
  },
  {
    id: "nb-3", skillId: "tenglin__notebooklm", kind: "use_result",
    prompt: "Read /work/sources.txt and reply with the total number of sources.",
    fixtures: f({ "/work/sources.txt": "pdfs 6\nurls 13\ndocs 4\n" }),
    expect: { kind: "use_result", tool: "read_file", answer: /\b23\b/, dataTokens: ["6", "13", "4"] },
    rationale: "6+13+4=23.",
  },
];
