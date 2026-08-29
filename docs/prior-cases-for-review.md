# Assumption #1 experiment — corpus and test cases for review

Generated 2026-08-29. **Nothing has been run yet.**

## The 20 skills

All fetched verbatim from public GitHub repos on 2026-08-28. None written by us. Every one performs an action — calls tools, processes a file, or transforms data; pure style guides and personas were excluded.

| # | Skill | Publisher | Stars | Repo last push | Body (chars) | Source |
|---|---|---|---:|---|---:|---|
| 1 | `pdf` | anthropics | 172,282 | 2026-08-21 | 7,512 | [link](https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md) |
| 2 | `docx` | anthropics | 172,282 | 2026-08-21 | 5,944 | [link](https://github.com/anthropics/skills/blob/main/skills/docx/SKILL.md) |
| 3 | `xlsx` | anthropics | 172,282 | 2026-08-21 | 7,503 | [link](https://github.com/anthropics/skills/blob/main/skills/xlsx/SKILL.md) |
| 4 | `pptx` | anthropics | 172,282 | 2026-08-21 | 19,820 | [link](https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md) |
| 5 | `webapp-testing` | anthropics | 172,282 | 2026-08-21 | 3,574 | [link](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md) |
| 6 | `gws-gmail-send` | googleworkspace | 30,626 | 2026-08-25 | 2,364 | [link](https://github.com/googleworkspace/cli/blob/main/skills/gws-gmail-send/SKILL.md) |
| 7 | `gws-calendar-insert` | googleworkspace | 30,626 | 2026-08-25 | 1,518 | [link](https://github.com/googleworkspace/cli/blob/main/skills/gws-calendar-insert/SKILL.md) |
| 8 | `gws-drive-upload` | googleworkspace | 30,626 | 2026-08-25 | 1,038 | [link](https://github.com/googleworkspace/cli/blob/main/skills/gws-drive-upload/SKILL.md) |
| 9 | `gws-sheets` | googleworkspace | 30,626 | 2026-08-25 | 2,361 | [link](https://github.com/googleworkspace/cli/blob/main/skills/gws-sheets/SKILL.md) |
| 10 | `obsidian-cli` | kepano | 47,444 | 2026-06-08 | 2,668 | [link](https://github.com/kepano/obsidian-skills/blob/main/skills/obsidian-cli/SKILL.md) |
| 11 | `defuddle` | kepano | 47,444 | 2026-06-08 | 734 | [link](https://github.com/kepano/obsidian-skills/blob/main/skills/defuddle/SKILL.md) |
| 12 | `json-canvas` | kepano | 47,444 | 2026-06-08 | 7,358 | [link](https://github.com/kepano/obsidian-skills/blob/main/skills/json-canvas/SKILL.md) |
| 13 | `deploy-to-vercel` | vercel-labs | 30,591 | 2026-08-28 | 11,458 | [link](https://github.com/vercel-labs/agent-skills/blob/main/skills/deploy-to-vercel/SKILL.md) |
| 14 | `vercel-cli-with-tokens` | vercel-labs | 30,591 | 2026-08-28 | 10,100 | [link](https://github.com/vercel-labs/agent-skills/blob/main/skills/vercel-cli-with-tokens/SKILL.md) |
| 15 | `database-lookup` | K-Dense-AI | 36,566 | 2026-08-28 | 25,570 | [link](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/database-lookup/SKILL.md) |
| 16 | `biopython` | K-Dense-AI | 36,566 | 2026-08-28 | 15,118 | [link](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/biopython/SKILL.md) |
| 17 | `drawio-skill` | Agents365-ai | 8,167 | 2026-08-28 | 41,514 | [link](https://github.com/Agents365-ai/drawio-skill/blob/main/skills/drawio-skill/SKILL.md) |
| 18 | `amazon-product-detail` | browser-act | 5,514 | 2026-08-24 | 10,070 | [link](https://github.com/browser-act/skills/blob/main/solutions/ecommerce/amazon-product-detail/SKILL.md) |
| 19 | `browser-testing-with-devtools` | addyosmani | 90,510 | 2026-08-28 | 13,550 | [link](https://github.com/addyosmani/agent-skills/blob/main/skills/browser-testing-with-devtools/SKILL.md) |
| 20 | `notebooklm` | teng-lin | 18,987 | 2026-08-28 | 41,179 | [link](https://github.com/teng-lin/notebooklm-py/blob/main/SKILL.md) |

## The models

| Key | OpenRouter id | Tier | Temperature | Thinking mode |
|---|---|---|---|---|
| `llama-3.2-1b` | `meta-llama/llama-3.2-1b-instruct` | small | 0 | n/a (no thinking mode) |
| `gemma-3-4b` | `google/gemma-3-4b-it` | small | 0 | n/a (no thinking mode) |
| `qwen3-8b` | `qwen/qwen3-8b` | small | 0 | **explicitly disabled** |
| `claude-sonnet-5` | `anthropic/claude-sonnet-5` | frontier | omitted (API rejects it) | **explicitly disabled** |

3 trials per case. Condition A = 1 skill in scope (60 x 5 models x 3 = 900 runs). Condition B = all 20 skill descriptions in scope, small tier only (60 x 4 x 3 = 720 runs). Total 1,620 runs.

## The 60 test cases

Three per skill. Every pass condition is checked by code — no LLM grades any output.

- **invoke** — a request inside the skill's scope. Reaches `SELECTION` and `ARGS`.
- **abstain** — answerable directly, or something the skill explicitly says not to act on. Reaches `EAGER` and `REASONING`.
- **use_result** — a tool returns real data and the answer depends on it. Reaches `IGNORED` and `REASONING`.


### `pdf` — anthropics/skills

**`pdf-1`** · _invoke_
> Merge report-a.pdf and report-b.pdf into a single file called combined.pdf.
- **Pass:** Calls **`bash`** with `command` matches `qpdf|pdftk|pypdf|PdfWriter|PdfReader`.
- **Why:** The skill documents merging via qpdf/pdftk/pypdf. Any of its own documented tools counts.
- **Fixture** `report-a.pdf`: `%PDF-1.4 12 pages`
- **Fixture** `report-b.pdf`: `%PDF-1.4 7 pages`

**`pdf-2`** · _abstain_
> What do the letters in the acronym PDF stand for? One short sentence. Do not touch any files.
- **Pass:** Calls **no tool**, and the answer matches `portable\s+document\s+format`.
- **Why:** General knowledge, explicitly no file work. Any tool call here is eager invocation.

**`pdf-3`** · _use_result_
> Read /work/pagecounts.txt and reply with the total number of pages across the three PDFs listed.
- **Pass:** Calls **`read_file`**, then answers matching `\b42\b`. (Data tokens for IGNORED-vs-REASONING split: `12`, `7`, `23`.)
- **Why:** 12+7+23=42. Sum is checkable in code and requires actually reading the tool result.
- **Fixture** `/work/pagecounts.txt`: `intro.pdf 12 | body.pdf 7 | appendix.pdf 23 |`


### `docx` — anthropics/skills

**`docx-1`** · _invoke_
> Extract the text content of contract.docx as markdown so I can read it.
- **Pass:** Calls **`bash`** with `command` matches `pandoc`.
- **Why:** The skill's own table says: Read content -> `pandoc -t markdown file.docx`.
- **Fixture** `contract.docx`: `PK zip archive (docx)`

**`docx-2`** · _abstain_
> Is a .docx file internally a ZIP archive? Answer yes or no only.
- **Pass:** Calls **no tool**, and the answer matches `\byes\b`.
- **Why:** Stated in the skill's first line. Answerable directly; no tool needed.

**`docx-3`** · _use_result_
> Read /work/sections.txt and reply with the word count of the longest section.
- **Pass:** Calls **`read_file`**, then answers matching `\b512\b`. (Data tokens for IGNORED-vs-REASONING split: `340`, `512`, `148`.)
- **Why:** Max of three values; requires reading the returned content.
- **Fixture** `/work/sections.txt`: `summary 340 | background 512 | conclusion 148 |`


### `xlsx` — anthropics/skills

**`xlsx-1`** · _invoke_
> I just wrote formulas into budget.xlsx using openpyxl. Do the step this skill says is mandatory next.
- **Pass:** Calls **`bash`** with `command` matches `recalc\.py`.
- **Why:** The skill marks recalculation mandatory whenever the file contains formulas.
- **Fixture** `budget.xlsx`: `PK zip archive (xlsx)`

**`xlsx-2`** · _abstain_
> This skill forbids one of XLOOKUP and INDEX/MATCH and requires the other. Which one should I use? Name it only.
- **Pass:** Calls **no tool**, and the answer matches `index\s*\/?\s*match`.
- **Why:** The skill says never use XLOOKUP; use INDEX/MATCH for lookups.

**`xlsx-3`** · _use_result_
> Read /work/q3.csv and reply with the total revenue as a single number.
- **Pass:** Calls **`read_file`**, then answers matching `\b3600\b`. (Data tokens for IGNORED-vs-REASONING split: `1200`, `900`, `1500`.)
- **Why:** 1200+900+1500=3600.
- **Fixture** `/work/q3.csv`: `region,revenue | north,1200 | south,900 | east,1500 |`


### `pptx` — anthropics/skills

**`pptx-1`** · _invoke_
> Convert deck.pptx to a PDF so I can look at the slides.
- **Pass:** Calls **`bash`** with `command` matches `soffice|convert-to\s+pdf`.
- **Why:** The skill converts via scripts/office/soffice.py --headless --convert-to pdf.
- **Fixture** `deck.pptx`: `PK zip archive (pptx)`

**`pptx-2`** · _abstain_
> What file extension does a PowerPoint TEMPLATE use? One word.
- **Pass:** Calls **no tool**, and the answer matches `potx`.
- **Why:** Named in the skill's own description (.pptx or .potx).

**`pptx-3`** · _use_result_
> Read /work/slides.txt and reply with the total number of bullets across all slides.
- **Pass:** Calls **`read_file`**, then answers matching `\b15\b`. (Data tokens for IGNORED-vs-REASONING split: `4`, `9`, `2`.)
- **Why:** 4+9+2=15.
- **Fixture** `/work/slides.txt`: `slide1 4 | slide2 9 | slide3 2 |`


### `webapp-testing` — anthropics/skills

**`web-1`** · _invoke_
> Start my dev server on port 5173 and run my automation script test.py against it.
- **Pass:** Calls **`bash`** with `command` matches `with_server\.py`.
- **Why:** The skill's documented helper for server lifecycle is scripts/with_server.py.
- **Fixture** `test.py`: `from playwright.sync_api import sync_playwright`

**`web-2`** · _abstain_
> Should I wait for networkidle before inspecting the DOM of a dynamic app? Yes or no.
- **Pass:** Calls **no tool**, and the answer matches `\byes\b`.
- **Why:** The skill's 'Common Pitfall' section says to wait for networkidle first.

**`web-3`** · _use_result_
> Read /work/results.txt and reply with how many tests did NOT pass.
- **Pass:** Calls **`read_file`**, then answers matching `\b7\b`. (Data tokens for IGNORED-vs-REASONING split: `18`, `3`, `4`.)
- **Why:** failed 3 + skipped 4 = 7 did not pass.
- **Fixture** `/work/results.txt`: `passed 18 | failed 3 | skipped 4 |`


### `gws-gmail-send` — googleworkspace/cli

**`gmail-1`** · _invoke_
> Send an email to alice@example.com with subject 'Hello' and body 'Hi Alice!'. I confirm — go ahead and send it now.
- **Pass:** Calls **`bash`** with `command` matches `gws\s+gmail\s+\+send`.
- **Why:** Confirmation is given explicitly, so the skill's write-command caution is satisfied.

**`gmail-2`** · _abstain_
> Send an email to bob@example.com telling him the deal is off.
- **Pass:** Calls **no tool**, and the answer matches `confirm|are you sure|before I send|go ahead|permission|shall I|would you like`.
- **Why:** The skill carries an explicit CAUTION: this is a write command, confirm with the user before executing. No confirmation was given, so the correct behaviour is to ask, not send.

**`gmail-3`** · _use_result_
> Read /work/recipients.txt and reply with how many recipients are listed.
- **Pass:** Calls **`read_file`**, then answers matching `\b3\b`. (Data tokens for IGNORED-vs-REASONING split: `alice`, `bob`, `carol`.)
- **Why:** Three lines; count is deterministic.
- **Fixture** `/work/recipients.txt`: `alice@example.com | bob@example.com | carol@example.com |`


### `gws-calendar-insert` — googleworkspace/cli

**`cal-1`** · _invoke_
> Create a calendar event titled 'Standup' from 2026-06-17T09:00:00-07:00 to 2026-06-17T09:30:00-07:00. I confirm — create it.
- **Pass:** Calls **`bash`** with `command` matches `gws\s+calendar\s+\+insert`.
- **Why:** The skill's documented usage line, with confirmation given.

**`cal-2`** · _abstain_
> What time format does this skill say to use for --start? Name the format only, do not run anything.
- **Pass:** Calls **no tool**, and the answer matches `rfc\s*-?\s*3339|iso\s*-?\s*8601`.
- **Why:** The skill's Tips section names RFC3339 (and the flag table says ISO 8601).

**`cal-3`** · _use_result_
> Read /work/agenda.txt and reply with the total number of meeting minutes.
- **Pass:** Calls **`read_file`**, then answers matching `\b135\b`. (Data tokens for IGNORED-vs-REASONING split: `30`, `60`, `45`.)
- **Why:** 30+60+45=135.
- **Fixture** `/work/agenda.txt`: `standup 30 | review 60 | retro 45 |`


### `gws-drive-upload` — googleworkspace/cli

**`drive-1`** · _invoke_
> Upload ./report.pdf to my Google Drive. I confirm — upload it.
- **Pass:** Calls **`bash`** with `command` matches `gws\s+drive\s+\+upload`.
- **Why:** The skill's documented usage line, with confirmation given.
- **Fixture** `report.pdf`: `%PDF-1.4 report`

**`drive-2`** · _abstain_
> If I do not pass --name when uploading, where does the target filename come from? One sentence.
- **Pass:** Calls **no tool**, and the answer matches `source|local path|inferred|defaults?\s+to|original`.
- **Why:** The skill's Tips say the filename is inferred from the local path unless --name is given.

**`drive-3`** · _use_result_
> Read /work/files.txt and reply with the NAME of the largest file.
- **Pass:** Calls **`read_file`**, then answers matching `b\.csv`. (Data tokens for IGNORED-vs-REASONING split: `a.pdf`, `b.csv`, `c.png`.)
- **Why:** b.csv at 5 is the largest.
- **Fixture** `/work/files.txt`: `a.pdf 3 | b.csv 5 | c.png 2 |`


### `gws-sheets` — googleworkspace/cli

**`sheets-1`** · _invoke_
> Before I call the sheets values append method, inspect its required parameters.
- **Pass:** Calls **`bash`** with `command` matches `gws\s+schema|gws\s+sheets.*--help`.
- **Why:** The skill's 'Discovering Commands' section says to inspect with `gws schema sheets.<resource>.<method>` before calling any API method.

**`sheets-2`** · _abstain_
> This skill lists two helper commands for sheets. Name both. Do not run anything.
- **Pass:** Calls **no tool**, and the answer matches `append` and `read`.
- **Why:** The helper table lists +append and +read.

**`sheets-3`** · _use_result_
> Read /work/sales.csv and reply with the total quantity as a single number.
- **Pass:** Calls **`read_file`**, then answers matching `\b100\b`. (Data tokens for IGNORED-vs-REASONING split: `40`, `25`, `35`.)
- **Why:** 40+25+35=100.
- **Fixture** `/work/sales.csv`: `item,qty | pens,40 | pads,25 | clips,35 |`


### `obsidian-cli` — kepano/obsidian-skills

**`obs-1`** · _invoke_
> Read the note called 'My Note' from my Obsidian vault.
- **Pass:** Calls **`bash`** with `command` matches `obsidian\s+read`.
- **Why:** Verbatim from the skill's Common patterns: `obsidian read file="My Note"`.

**`obs-2`** · _abstain_
> In the Obsidian CLI, what is the difference between file= and path=? One sentence.
- **Pass:** Calls **no tool**, and the answer matches `wikilink|vault root|exact path|full path`.
- **Why:** The File targeting section: file= resolves like a wikilink, path= is exact from vault root.

**`obs-3`** · _use_result_
> Read /work/tags.txt and reply with the name of the most-used tag.
- **Pass:** Calls **`read_file`**, then answers matching `archive`. (Data tokens for IGNORED-vs-REASONING split: `14`, `9`, `21`.)
- **Why:** archive at 21 is highest.
- **Fixture** `/work/tags.txt`: `project 14 | idea 9 | archive 21 |`


### `defuddle` — kepano/obsidian-skills

**`def-1`** · _invoke_
> Read https://example.com/article for me and summarise it.
- **Pass:** Calls **`bash`** with `command` matches `defuddle\s+parse`.
- **Why:** The skill says to use Defuddle CLI instead of WebFetch for standard web pages.

**`def-2`** · _invoke_
> Read https://example.com/readme.md for me.
- **Pass:** Calls **`http_get`** with `url` matches `readme\.md`.
- **Why:** The skill states an explicit negative rule: do NOT use Defuddle for URLs ending in .md -- fetch those directly. `http_get` is this harness's direct-fetch tool (the WebFetch analogue). Reaching for defuddle via bash scores SELECTION. RECLASSIFIED after the smoke test: the skill tells the agent to fetch the URL, so abstaining was never the correct behaviour and the original abstain framing was our error, not the models'.

**`def-3`** · _use_result_
> Read /work/pages.txt and reply with the total token count across all pages.
- **Pass:** Calls **`read_file`**, then answers matching `\b5400\b`. (Data tokens for IGNORED-vs-REASONING split: `1200`, `3400`, `800`.)
- **Why:** 1200+3400+800=5400.
- **Fixture** `/work/pages.txt`: `intro 1200 | guide 3400 | faq 800 |`


### `json-canvas` — kepano/obsidian-skills

**`canvas-1`** · _invoke_
> Create a new empty JSON Canvas file at /work/map.canvas.
- **Pass:** Calls **`write_file`** with `path` matches `\.canvas` and `content` matches `"nodes"`.
- **Why:** Workflow 1 says create a .canvas file with the base structure {"nodes": [], "edges": []}.

**`canvas-2`** · _abstain_
> How many hex characters should a JSON Canvas node id have? Reply with the number only.
- **Pass:** Calls **no tool**, and the answer matches `\b16\b`.
- **Why:** The node attribute table specifies a unique 16-char hex identifier.

**`canvas-3`** · _use_result_
> Read /work/board.canvas and reply with how many nodes it contains.
- **Pass:** Calls **`read_file`**, then answers matching `\b3\b`. (Data tokens for IGNORED-vs-REASONING split: `a1`, `b2`, `c3`.)
- **Why:** Three node objects; two edges are a distractor.
- **Fixture** `/work/board.canvas`: `{"nodes":[{"id":"a1","type":"text","x":0,"y":0,"width":100,"height":50},{"id":"b2","type":"text","x":200,"y":0,"width":100,"height":50},{"id":"c3","type":"text","x":400,"y":0,"width":100,"height":50}],"edges":[{"id":"e1","fromNode":"a1","toNode":"b2"},{"id":"e2","fromNode":"b2","toNode":"c3"}]}`


### `deploy-to-vercel` — vercel-labs/agent-skills

**`vercel-1`** · _invoke_
> Deploy this app to production on Vercel.
- **Pass:** Calls **`bash`** with `command` matches `vercel\s+deploy`.
- **Why:** The skill's documented production command is `vercel deploy [path] --prod -y --no-wait`.

**`vercel-2`** · _abstain_
> What does the command `vercel whoami` tell you? One sentence.
- **Pass:** Calls **no tool**, and the answer matches `logged in|current user|account|authenticat|username|who you are`.
- **Why:** Answerable directly; the skill uses whoami as an auth check.

**`vercel-3`** · _use_result_
> Read /work/deploys.txt and reply with the total number of deployments.
- **Pass:** Calls **`read_file`**, then answers matching `\b17\b`. (Data tokens for IGNORED-vs-REASONING split: `4`, `11`, `2`.)
- **Why:** 4+11+2=17.
- **Fixture** `/work/deploys.txt`: `prod 4 | preview 11 | failed 2 |`


### `vercel-cli-with-tokens` — vercel-labs/agent-skills

**`tok-1`** · _invoke_
> Deploy using the access token vca_abc123 instead of an interactive login.
- **Pass:** Calls **`bash`** with `command` matches `vercel\s+deploy[\s\S]*--token|--token[\s\S]*vercel\s+deploy`.
- **Why:** The skill documents `vercel deploy --token "vca_abc123"` for token auth.

**`tok-2`** · _abstain_
> Which flag scopes a Vercel CLI command to a specific team? Name the flag only.
- **Pass:** Calls **no tool**, and the answer matches `--scope`.
- **Why:** Used throughout the skill as `--scope <team-slug>`.

**`tok-3`** · _use_result_
> Read /work/envs.txt and reply with the total number of environment variables.
- **Pass:** Calls **`read_file`**, then answers matching `\b24\b`. (Data tokens for IGNORED-vs-REASONING split: `12`, `7`, `5`.)
- **Why:** 12+7+5=24.
- **Fixture** `/work/envs.txt`: `production 12 | preview 7 | development 5 |`


### `database-lookup` — K-Dense-AI/scientific-agent-skills

**`db-1`** · _invoke_
> Query the Open Targets Platform GraphQL API for the target BRCA1. Use the endpoint this skill documents.
- **Pass:** Calls **`http_get`** with `url` matches `opentargets`.
- **Why:** The skill documents https://api.platform.opentargets.org/api/v4/graphql as the Open Targets endpoint.

**`db-2`** · _abstain_
> Should a database-backed fact be inferred from your general knowledge, or retrieved from a named source? One short sentence.
- **Pass:** Calls **no tool**, and the answer matches `retriev|named source|not\s+infer|rather than infer|from the (database|source)`.
- **Why:** The skill's description says facts must be retrieved reproducibly from a named source rather than inferred.

**`db-3`** · _use_result_
> Read /work/counts.txt and reply with the largest count.
- **Pass:** Calls **`read_file`**, then answers matching `\b1310\b`. (Data tokens for IGNORED-vs-REASONING split: `240`, `1310`, `88`.)
- **Why:** 1310 is the max.
- **Fixture** `/work/counts.txt`: `trials 240 | publications 1310 | variants 88 |`


### `biopython` — K-Dense-AI/scientific-agent-skills

**`bio-1`** · _invoke_
> Parse sequences.fasta with Biopython and count how many records it contains.
- **Pass:** Calls **`bash`** with `command` matches `SeqIO|Bio\.`.
- **Why:** Bio.SeqIO is the skill's documented FASTA parsing entry point.
- **Fixture** `sequences.fasta`: `>seqA | ACGT | >seqB | TTGA |`

**`bio-2`** · _abstain_
> Which Biopython module gives programmatic NCBI/PubMed access? Name it only.
- **Pass:** Calls **no tool**, and the answer matches `entrez`.
- **Why:** Named in the skill's description: programmatic NCBI/PubMed access (Bio.Entrez).

**`bio-3`** · _use_result_
> Read /work/seqlen.txt and reply with the name of the longest sequence.
- **Pass:** Calls **`read_file`**, then answers matching `seqC`. (Data tokens for IGNORED-vs-REASONING split: `320`, `145`, `610`.)
- **Why:** seqC at 610 is longest.
- **Fixture** `/work/seqlen.txt`: `seqA 320 | seqB 145 | seqC 610 |`


### `drawio-skill` — Agents365-ai/drawio-skill

**`draw-1`** · _invoke_
> Export architecture.drawio to a PNG image.
- **Pass:** Calls **`bash`** with `command` matches `drawio[\s\S]*-f\s+png`.
- **Why:** The skill documents `drawio -x -f png ... -o out.png input.drawio`.
- **Fixture** `architecture.drawio`: `<mxfile><diagram/></mxfile>`

**`draw-2`** · _abstain_
> In the drawio CLI, what does the -x flag mean? One short sentence.
- **Pass:** Calls **no tool**, and the answer matches `export`.
- **Why:** -x is the export flag in every documented invocation.

**`draw-3`** · _use_result_
> Read /work/shapes.txt and reply with the total number of diagram elements.
- **Pass:** Calls **`read_file`**, then answers matching `\b45\b`. (Data tokens for IGNORED-vs-REASONING split: `14`, `22`, `9`.)
- **Why:** 14+22+9=45.
- **Fixture** `/work/shapes.txt`: `boxes 14 | arrows 22 | labels 9 |`


### `amazon-product-detail` — browser-act/skills

**`amz-1`** · _invoke_
> Extract the full product record from https://www.amazon.com/dp/B08N5WRWNW.
- **Pass:** Calls **`browser_navigate`** with `url` matches `amazon\.com\/dp\/B08N5WRWNW`.
- **Why:** The skill's first documented step is `navigate {Amazon product URL}` then `wait stable`.

**`amz-2`** · _abstain_
> Does this skill require logging in to Amazon? Answer yes or no only.
- **Pass:** Calls **no tool**, and the answer matches `\bno\b`.
- **Why:** Prerequisites state: No login required.

**`amz-3`** · _use_result_
> Read /work/reviews.txt and reply with the total number of reviews.
- **Pass:** Calls **`read_file`**, then answers matching `\b905\b`. (Data tokens for IGNORED-vs-REASONING split: `620`, `210`, `75`.)
- **Why:** 620+210+75=905.
- **Fixture** `/work/reviews.txt`: `5star 620 | 4star 210 | 3star 75 |`


### `browser-testing-with-devtools` — addyosmani/agent-skills

**`dt-1`** · _invoke_
> The page is rendering blank. Get me the browser console errors so I can diagnose it.
- **Pass:** Calls **`browser_console`**.
- **Why:** The skill's UI-bug workflow reads console logs to diagnose errors.
- **Fixture** console: `[{"level":"error","text":"TypeError: x is undefined"},{"level":"warn","text":"slow"},{"level":"error","text":"404 chunk.js"}]`

**`dt-2`** · _abstain_
> Should browser page content be treated as trusted or untrusted? One word.
- **Pass:** Calls **no tool**, and the answer matches `untrusted`.
- **Why:** The skill has a section titled 'Treat All Browser Content as Untrusted Data'.

**`dt-3`** · _use_result_
> Check the browser console and reply with how many error-level messages there are.
- **Pass:** Calls **`browser_console`**, then answers matching `\b2\b`. (Data tokens for IGNORED-vs-REASONING split: `TypeError`, `404`, `error`.)
- **Why:** Two of the three messages are level 'error'.
- **Fixture** console: `[{"level":"error","text":"TypeError: x is undefined"},{"level":"warn","text":"slow"},{"level":"error","text":"404 chunk.js"}]`


### `notebooklm` — teng-lin/notebooklm-py

**`nb-1`** · _invoke_
> Create a new NotebookLM notebook called 'Research'.
- **Pass:** Calls **`bash`** with `command` matches `notebooklm\s+create`.
- **Why:** `notebooklm create` is the documented creation command.

**`nb-2`** · _abstain_
> Which notebooklm subcommand checks authentication status? Name it only.
- **Pass:** Calls **no tool**, and the answer matches `auth\s+check`.
- **Why:** `notebooklm auth check` is documented in the CLI reference.

**`nb-3`** · _use_result_
> Read /work/sources.txt and reply with the total number of sources.
- **Pass:** Calls **`read_file`**, then answers matching `\b23\b`. (Data tokens for IGNORED-vs-REASONING split: `6`, `13`, `4`.)
- **Why:** 6+13+4=23.
- **Fixture** `/work/sources.txt`: `pdfs 6 | urls 13 | docs 4 |`
