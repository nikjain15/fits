// engine/src/protocol.ts
var PROTOCOL = `You act by replying with exactly ONE JSON object and nothing else.

To use a tool:
{"tool": "<tool name>", "args": { ... }}

To give your final answer:
{"answer": "<your answer>"}

Rules:
- Output the JSON object only. No prose before or after it. No markdown fences.
- "tool" MUST be one of the tool names listed above. A Skill is NOT a tool and
  cannot be called by name: a Skill tells you WHICH tool to use and WITH WHAT
  arguments. To follow a Skill that documents a command line, call the "bash"
  tool and put that command line in args.command.
- Call a tool only when the task actually requires it. If the task is a question
  you can answer directly, reply with {"answer": ...} and do not call a tool.
- After a tool returns, either call another tool or give {"answer": ...}.`;
function buildSystemPrompt(underTest, tools, library) {
  const toolBlock = tools.map((t) => `- ${t.name}: ${t.description}
  args schema: ${JSON.stringify(t.jsonSchema)}`).join("\n");
  const parts = [
    "You are an AI agent with access to tools and to installed Skills.",
    `
## Available tools
${toolBlock}`,
    `
## Protocol
${PROTOCOL}`
  ];
  if (library && library.length > 1) {
    const list = library.map((s) => `- ${s.name}: ${s.selection}`).join("\n");
    parts.push(`
## Installed skills (${library.length})
Choose the one that applies to the request.
${list}`);
  }
  parts.push(`
## Skill: ${underTest.name}
${underTest.selection}

${underTest.body}`);
  return { system: parts.join("\n"), skillsInScope: library ? library.length : 1 };
}
var TOOL_WORDS = /"tool"|"name"\s*:|"args"|bash|read_file|write_file|list_files|browser_|http_get/i;
function firstJsonObject(s) {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc2 = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc2) {
      esc2 = false;
      continue;
    }
    if (c === "\\") {
      esc2 = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
function parseTurn(rawIn) {
  const raw = (rawIn ?? "").trim();
  if (!raw) return { kind: "empty", raw };
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const block = firstJsonObject(unfenced);
  if (block) {
    try {
      const o = JSON.parse(block);
      if (typeof o.tool === "string") {
        const nested = o.args;
        const flat = Object.fromEntries(Object.entries(o).filter(([k]) => k !== "tool" && k !== "args"));
        const args = nested && typeof nested === "object" && Object.keys(nested).length ? nested : Object.keys(flat).length ? flat : nested ?? {};
        return { kind: "tool", tool: { name: o.tool, args }, raw };
      }
      if (typeof o.name === "string" && ("arguments" in o || "args" in o)) {
        return { kind: "tool", tool: { name: o.name, args: o.args ?? o.arguments ?? {} }, raw };
      }
      if (typeof o.answer === "string") return { kind: "answer", answer: o.answer, raw };
      if (typeof o.answer === "number" || typeof o.answer === "boolean") {
        return { kind: "answer", answer: String(o.answer), raw };
      }
    } catch {
    }
  }
  return { kind: TOOL_WORDS.test(raw) ? "unparseable_tool_attempt" : "unparseable_prose", raw };
}

// engine/src/tools.ts
function buildTools(fx) {
  const files = fx.files ?? {};
  return [
    {
      name: "bash",
      description: "Run a shell command and return its stdout. Use for any CLI tool.",
      jsonSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      handler: async (a) => {
        const cmd = String(a?.command ?? "");
        if (/^\s*(ls|find|pwd|file|stat|dir)\b/i.test(cmd) || /\bls\s+-/.test(cmd)) {
          const names = Object.keys(files);
          return { exit_code: 0, stdout: names.length ? names.join("\n") : "(no files)" };
        }
        if (/^\s*cat\b/i.test(cmd)) {
          const hit = Object.entries(files).find(([k]) => cmd.includes(k.replace(/^\//, "")) || cmd.includes(k));
          if (hit) return { exit_code: 0, stdout: hit[1] };
        }
        return { exit_code: 0, stdout: `(ran) ${cmd.slice(0, 200)}` };
      }
    },
    {
      name: "read_file",
      description: "Read a UTF-8 text file and return its contents.",
      jsonSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: async (a) => {
        const p = String(a?.path ?? "");
        const hit = files[p] ?? files[p.replace(/^\.\//, "/")] ?? Object.entries(files).find(([k]) => k.endsWith(p.replace(/^\.?\/?/, "/")))?.[1];
        if (hit === void 0) return { error: `no such file: ${p}`, available: Object.keys(files) };
        return { path: p, content: hit };
      }
    },
    {
      name: "write_file",
      description: "Write UTF-8 text to a file, creating or overwriting it.",
      jsonSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      handler: async (a) => ({ ok: true, path: String(a?.path ?? ""), bytes: String(a?.content ?? "").length })
    },
    {
      name: "list_files",
      description: "List the files in a directory.",
      jsonSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: async () => ({ entries: Object.keys(files) })
    },
    {
      name: "browser_navigate",
      description: "Navigate the browser to a URL and wait for the page to settle.",
      jsonSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      handler: async (a) => ({ ok: true, url: String(a?.url ?? ""), title: "page loaded" })
    },
    {
      name: "browser_dom",
      description: "Read the rendered DOM of the current page.",
      jsonSchema: { type: "object", properties: {} },
      handler: async () => ({ dom: fx.dom ?? "<html><body>(empty)</body></html>" })
    },
    {
      name: "browser_console",
      description: "Retrieve console output (log, warn, error) from the current page.",
      jsonSchema: { type: "object", properties: {} },
      handler: async () => ({ messages: fx.console ?? [] })
    },
    {
      name: "browser_network",
      description: "Retrieve network requests and response statuses from the current page.",
      jsonSchema: { type: "object", properties: {} },
      handler: async () => ({ requests: fx.network ?? [] })
    },
    {
      name: "http_get",
      description: "Perform an HTTP GET against a URL and return the response body.",
      jsonSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      handler: async (a) => {
        const u = String(a?.url ?? "");
        const hit = Object.entries(fx.http ?? {}).find(([k]) => u.includes(k))?.[1];
        return hit === void 0 ? { status: 200, body: "{}" } : { status: 200, body: hit };
      }
    }
  ];
}
var TOOL_NAMES = [
  "bash",
  "read_file",
  "write_file",
  "list_files",
  "browser_navigate",
  "browser_dom",
  "browser_console",
  "browser_network",
  "http_get"
];
function payloadBytes(args) {
  return Buffer.byteLength(JSON.stringify(args ?? {}), "utf8");
}

// engine/src/agentloop.ts
async function runAgent(o) {
  const byName = new Map(o.tools.map((t) => [t.name, t]));
  const messages = [
    { role: "user", content: o.goal }
  ];
  const steps = [];
  const turns = [];
  for (let step = 0; step < o.maxSteps; step++) {
    const raw = await o.call(messages);
    const parsed = parseTurn(raw);
    turns.push(parsed);
    if (parsed.kind === "answer") {
      steps.push({ kind: "answer", tool: "", arg_bytes: 0 });
      return { steps, turns, answer: parsed.answer, stoppedAtCap: false };
    }
    if (parsed.kind !== "tool") {
      return { steps, turns, answer: parsed.raw, stoppedAtCap: false };
    }
    const { name, args } = parsed.tool;
    const bytes = payloadBytes(args);
    const tool = byName.get(name);
    if (!tool) {
      steps.push({ kind: "tool_error", tool: name, args, error: `no such tool: ${name}`, arg_bytes: bytes });
      messages.push({ role: "assistant", content: JSON.stringify({ tool: name, args }) });
      messages.push({ role: "user", content: JSON.stringify({ error: `no such tool: ${name}` }) });
      continue;
    }
    let result;
    try {
      result = await tool.handler(args);
      steps.push({ kind: "tool_call", tool: name, args, result, arg_bytes: bytes });
    } catch (e) {
      steps.push({ kind: "tool_error", tool: name, args, error: String(e?.message ?? e), arg_bytes: bytes });
      result = { error: String(e?.message ?? e) };
    }
    messages.push({ role: "assistant", content: JSON.stringify({ tool: name, args }) });
    messages.push({ role: "user", content: JSON.stringify(result) });
  }
  return { steps, turns, stoppedAtCap: true };
}

// engine/src/classify.ts
var REAL_TOOLS = new Set(TOOL_NAMES);
var isRealTool = (t) => REAL_TOOLS.has(t);
function callsOf(steps) {
  return steps.filter((s) => s.kind === "tool_call" || s.kind === "tool_error").map((s) => ({ tool: s.tool, args: s.args }));
}
function argsMatchStrict(args, want) {
  for (const [k, re] of Object.entries(want)) {
    const v = args && typeof args === "object" ? args[k] : void 0;
    if (typeof v !== "string" || !re.test(v)) return false;
  }
  return true;
}
function argsMatchLoose(args, want) {
  const blob = JSON.stringify(args ?? {});
  return Object.values(want).every((re) => re.test(blob));
}
function grade(c, t) {
  const decidedBy = "code";
  if (t.error) {
    return {
      passSubstance: false,
      passStrict: false,
      protocolOk: false,
      knewCommand: false,
      bucket: "BORING",
      detail: `${t.error.kind}: ${t.error.message.slice(0, 160)}`,
      decidedBy
    };
  }
  if (t.turns.length === 0 || t.turns.every((x) => x.kind === "empty")) {
    return {
      passSubstance: false,
      passStrict: false,
      protocolOk: false,
      knewCommand: false,
      bucket: "BORING",
      detail: "model returned no content",
      decidedBy
    };
  }
  const calls = callsOf(t.steps);
  const attempted = t.turns.some((x) => x.kind === "unparseable_tool_attempt");
  const allRaw = t.turns.map((x) => x.raw).join("\n");
  const protocolOk = t.turns.every((x) => x.kind === "tool" || x.kind === "answer");
  const lastRaw = t.turns.length ? t.turns[t.turns.length - 1].raw : "";
  const answerText = t.finalAnswer ?? lastRaw;
  const done = (passSubstance, bucket, detail, knewCommand = false) => ({
    passSubstance,
    passStrict: passSubstance && protocolOk,
    protocolOk,
    knewCommand,
    bucket: passSubstance ? "" : bucket,
    detail,
    decidedBy
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
  const quotedData = e.dataTokens.some((tok) => allRaw.includes(tok));
  const wantsNumber = /\\b|\d/.test(e.answer.source) && /\d/.test(e.answer.source);
  const gaveNumber = /\d/.test(answerText);
  if (quotedData || wantsNumber && gaveNumber) {
    return done(false, "REASONING", `had the data and concluded wrongly: ${answerText.slice(0, 160)}`);
  }
  return done(false, "IGNORED", `answer shows no engagement with the returned data: ${answerText.slice(0, 160)}`);
}

// engine/src/extract.ts
var CMD_HEAD = /^(?:[a-z][\w.-]*\/)?([a-z][\w.-]{1,30})(?=\s|$)/i;
var NOT_COMMANDS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "it",
  "you",
  "we",
  "if",
  "when",
  "note",
  "true",
  "false",
  "null",
  "yes",
  "no",
  "name",
  "description",
  "type",
  "id",
  "string",
  "number",
  "boolean",
  "object",
  "array",
  "key",
  "value",
  "path",
  "e.g",
  "i.e",
  "etc",
  "example",
  "default",
  "optional",
  "required"
]);
function looksLikeCommand(line) {
  const s = line.trim();
  if (!s || s.length > 400) return false;
  if (/^[#>|]/.test(s)) return false;
  if (/^\s*[{}\[\]]/.test(s)) return false;
  if (/^(?:https?|ftp):\/\//.test(s)) return false;
  const m = CMD_HEAD.exec(s);
  if (!m) return false;
  if (NOT_COMMANDS.has(m[1].toLowerCase())) return false;
  const rest = s.slice(m[0].length).trim();
  if (!rest) return false;
  return /^[-\w./"'$]/.test(rest);
}
function cleanCommand(line) {
  return line.replace(/^\s*[$>#]\s+/, "").replace(/\s+#\s.*$/, "").trim();
}
function headOf(cmd) {
  const parts = cmd.split(/\s+/);
  if (/^(python3?|node|npx|uv|bun|deno|sh|bash|ruby|perl)$/i.test(parts[0]) && parts[1]) {
    const second = parts[1].startsWith("-") ? parts[2] ?? parts[1] : parts[1];
    return `${parts[0]} ${second}`;
  }
  return parts[0];
}
function distinguishersOf(cmd) {
  const out = [];
  for (const tok of cmd.split(/\s+/).slice(1)) {
    if (/^--?[a-z][\w-]*$/i.test(tok)) out.push(tok);
    else if (/^[a-z][\w-]{1,20}$/i.test(tok) && out.length < 2) out.push(tok);
    if (out.length >= 4) break;
  }
  return out;
}
var MANDATORY = /\b(must|mandatory|always|required|never skip|do not skip)\b/i;
function extract(skill, p) {
  const lines = p.body.split("\n");
  const invocations = [];
  const seen = /* @__PURE__ */ new Set();
  let heading = "";
  let inFence = false;
  let fenceLang = "";
  let fenceIntro = "";
  const push = (command, purpose, purpose_source, line, source, context) => {
    const cmd = cleanCommand(command);
    if (!looksLikeCommand(cmd)) return;
    const head = headOf(cmd);
    const dist = distinguishersOf(cmd);
    const key = `${head}|${dist[0] ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    invocations.push({
      command: cmd,
      head,
      distinguishers: dist,
      purpose: purpose.trim().slice(0, 200),
      purpose_source,
      line,
      source,
      mandatory: MANDATORY.test(context)
    });
  };
  const pushApi = (name, purpose, line, context) => {
    const clean = name.replace(/^\(+|\)+$/g, "");
    if (clean.length < 3 || NOT_COMMANDS.has(clean.toLowerCase())) return;
    if (/^(self|this|console|logger|log|print|str|int|list|dict|os\.path)\b/i.test(clean)) return;
    const key = `api|${clean.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    invocations.push({
      command: clean,
      head: clean,
      distinguishers: [],
      purpose: purpose.trim().slice(0, 200),
      purpose_source: purpose ? "preceding-line" : "heading",
      line,
      source: "code-api",
      mandatory: MANDATORY.test(context)
    });
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const fence = /^(?:```|~~~)(\w*)/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceLang = fence[1].toLowerCase();
        fenceIntro = "";
        for (let j = i - 1; j >= 0 && j > i - 4; j--) {
          const t = lines[j].trim().replace(/[:`*]/g, "");
          if (t) {
            fenceIntro = t;
            break;
          }
        }
      } else {
        inFence = false;
        fenceLang = "";
        fenceIntro = "";
      }
      continue;
    }
    if (inFence) {
      if (!fenceLang || /^(bash|sh|shell|console|zsh|terminal|cmd)$/.test(fenceLang)) {
        push(
          line,
          fenceIntro || heading,
          fenceIntro ? "preceding-line" : "heading",
          i + 1,
          "fenced-block",
          `${fenceIntro}
${heading}
${line}`
        );
        continue;
      }
      if (/^(python|py|python3|javascript|js|typescript|ts|ruby|node)$/.test(fenceLang)) {
        for (const m of line.matchAll(/^\s*(?:import|from)\s+([a-zA-Z_][\w.]{1,40})/g)) {
          pushApi(m[1], fenceIntro || heading, i + 1, `${fenceIntro}
${heading}
${line}`);
        }
        for (const m of line.matchAll(/\b([a-zA-Z_][\w]{2,30})\.([a-zA-Z_][\w]{2,40})\s*\(/g)) {
          pushApi(`${m[1]}.${m[2]}`, fenceIntro || heading, i + 1, `${fenceIntro}
${heading}
${line}`);
        }
      }
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      heading = h[2].replace(/[`*]/g, "").trim();
      continue;
    }
    if (/^\|/.test(line) && line.includes("`")) {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      const codeCells = cells.filter((c) => /`[^`]+`/.test(c));
      const proseCells = cells.filter((c) => !/`[^`]+`/.test(c) && c.length > 2);
      for (const cell of codeCells) {
        for (const m of cell.matchAll(/`([^`]+)`/g)) {
          push(
            m[1],
            proseCells[0] ?? heading,
            proseCells[0] ? "table-row" : "heading",
            i + 1,
            "table-cell",
            line
          );
        }
      }
      continue;
    }
    if (line.includes("`")) {
      const listLead = /^[-*+]\s+(.*)$/.exec(line);
      const prose = (listLead?.[1] ?? line).replace(/`[^`]*`/g, "").replace(/[*_]/g, "").trim();
      for (const m of line.matchAll(/`([^`]+)`/g)) {
        push(
          m[1],
          prose || heading,
          listLead ? "list-item" : prose ? "preceding-line" : "heading",
          i + 1,
          "inline-code",
          line
        );
      }
    }
  }
  const claims = extractClaims(p.body);
  const prohibitions = extractProhibitions(p.body);
  const measurable = invocations.length > 0;
  return {
    skill,
    invocations: invocations.sort(rank),
    claims,
    prohibitions,
    measurable,
    reason: measurable ? `${invocations.length} documented invocations` : "no documented invocations \u2014 prose-only skill, catalogued but not scored"
  };
}
function rank(a, b) {
  const score = (x) => (x.mandatory ? 4 : 0) + { "table-row": 3, "list-item": 2, "preceding-line": 2, heading: 1, none: 0 }[x.purpose_source] + // A shell line the skill tells you to run is stronger evidence than a symbol
  // lifted out of a code sample, so shell ranks above API on a tie.
  (x.source === "code-api" ? 0 : 1) + (x.distinguishers.length ? 1 : 0);
  return score(b) - score(a);
}
var CLAIM_PATTERNS = [
  { re: /\bnever use\s+`?([\w.\-/ ]{2,40})`?/i, kind: "never-use" },
  { re: /\bdo not use\s+`?([\w.\-/ ]{2,40})`?/i, kind: "never-use" },
  { re: /\balways use\s+`?([\w.\-/ ]{2,40})`?/i, kind: "always-use" },
  { re: /\buse\s+`([\w.\-/ ]{2,40})`\s+(?:instead|rather than|not)\b/i, kind: "always-use" },
  { re: /\bdefaults? to\s+`?([\w.\-/ ]{2,40})`?/i, kind: "default" },
  { re: /\bis (?:internally )?an?\s+([\w \-]{3,40})\b/i, kind: "definition" }
];
function extractClaims(body) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const sentence of body.split(/(?<=[.!?])\s+|\n/)) {
    const s = sentence.trim();
    if (!s || s.length > 300) continue;
    for (const { re, kind } of CLAIM_PATTERNS) {
      const m = re.exec(s);
      if (!m) continue;
      const answer = m[1].trim().replace(/[.,;:]$/, "");
      if (answer.length < 2 || seen.has(answer.toLowerCase())) continue;
      seen.add(answer.toLowerCase());
      out.push({ text: s.replace(/[`*]/g, "").slice(0, 200), answer, kind });
      break;
    }
    if (out.length >= 12) break;
  }
  return out;
}
function extractProhibitions(body) {
  const out = [];
  for (const sentence of body.split(/(?<=[.!?])\s+|\n/)) {
    const s = sentence.trim().replace(/[`*]/g, "");
    if (!s || s.length > 240) continue;
    if (/\b(never|do not|don't|must not|avoid)\b/i.test(s) && /\b(use|call|run|edit|write|modify|create)\b/i.test(s)) {
      out.push(s.slice(0, 200));
    }
    if (out.length >= 8) break;
  }
  return out;
}

// engine/src/generate.ts
var esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function phrase(purpose, skillName, forbidden) {
  let p = purpose.replace(/`[^`]*`/g, " ").replace(/^[-*\d.\s]+/, "").replace(/^(to|for|use|used|when|if)\s+/i, "").replace(/[.:;]+$/, "").trim();
  for (const f of forbidden) {
    if (f.length < 2) continue;
    p = p.replace(new RegExp(`\\S*${esc(f)}\\S*`, "gi"), " ");
  }
  p = p.replace(/\s-{1,2}[A-Za-z][\w-]*/g, " ").replace(/\S*\/\S*/g, " ").replace(/\b\S+\.(?:[a-z0-9]{1,5})\b/gi, " ").replace(/\b(?:sudo|npx|npm|pip|python3?|node|bash|sh)\b/gi, " ");
  p = p.replace(/\s{2,}/g, " ").replace(/^[\s,;-]+|[\s,;-]+$/g, "").trim();
  const words = p.split(/\s+/).filter(Boolean);
  if (words.length < 3) {
    const nice = skillName.replace(/[-_]+/g, " ");
    return `I have a file called report.txt and I need the ${nice} job done on it. Go ahead.`;
  }
  const lower = p[0].toLowerCase() + p.slice(1);
  return `I need to ${lower}, using report.txt. Go ahead and do it.`;
}
function generate(skillId, parsed, decoys = []) {
  const ex = extract(skillId, parsed);
  const provenance = [];
  if (!ex.measurable) {
    return {
      cases: [],
      extraction: ex,
      provenance,
      ok: false,
      reason: "no documented invocations \u2014 this is a prose skill. It can be catalogued but there is nothing concrete to test, and inventing a command to test would be testing our own guess."
    };
  }
  const cases = [];
  const top = ex.invocations[0];
  const alts = /* @__PURE__ */ new Set([top.head]);
  for (const s of ex.invocations) if (s.purpose && s.purpose === top.purpose) alts.add(s.head);
  const pattern = new RegExp([...alts].map(esc).map((x) => x.replace(/\\ /g, "\\s+")).join("|"), "i");
  const forbidden = [...alts].flatMap((a) => a.split(/[\s/]+/)).concat(top.distinguishers).filter(Boolean);
  cases.push({
    id: `${skillId}--auto-invoke`,
    skillId,
    kind: "invoke",
    prompt: phrase(top.purpose || parsed.name, parsed.name, forbidden),
    fixtures: { files: { "report.txt": "line one\nline two\nline three\n" } },
    expect: { kind: "invoke", tool: "bash", args: { command: pattern } },
    rationale: `The skill documents \`${top.command.slice(0, 90)}\` for "${top.purpose.slice(0, 60)}" (${top.source}, line ${top.line}).`
  });
  provenance.push(`invoke \u2014 from the skill's own documented command: ${top.command.slice(0, 100)}`);
  const claim = ex.claims.find((c) => c.kind === "never-use" || c.kind === "always-use") ?? ex.claims[0];
  if (claim) {
    cases.push({
      id: `${skillId}--auto-abstain`,
      skillId,
      kind: "abstain",
      prompt: `Answer in one short sentence, from the skill's instructions only. Do not run anything. ${claim.kind === "never-use" ? `Which tool or approach does this skill tell you NOT to use?` : claim.kind === "always-use" ? `Which tool or approach does this skill tell you to always use?` : `According to this skill, what is ${claim.answer}?`}`,
      fixtures: {},
      expect: { kind: "abstain", answer: [new RegExp(esc(claim.answer.split(/\s+/)[0]), "i")] },
      rationale: `The skill states: "${claim.text.slice(0, 110)}". Answerable from the text; any tool call here is eager invocation.`
    });
    provenance.push(`abstain \u2014 from a claim the skill makes about itself: "${claim.text.slice(0, 90)}"`);
  } else if (decoys.length) {
    cases.push({
      id: `${skillId}--auto-abstain`,
      skillId,
      kind: "abstain",
      prompt: `${decoys[0]} \u2014 if that is outside what this skill does, say "not my job" and do not call any tool.`,
      fixtures: {},
      expect: { kind: "abstain", answer: [/not my job|outside|cannot|can't|unrelated|different skill/i] },
      rationale: `Borrowed from another catalogued skill's scope. This skill should decline rather than fire \u2014 which is how EAGER is measured.`
    });
    provenance.push(`abstain \u2014 borrowed from a neighbouring skill's scope, so firing here is eager invocation`);
  }
  cases.push({
    id: `${skillId}--auto-use-result`,
    skillId,
    kind: "use_result",
    prompt: "Read /work/counts.txt and reply with the total of the three numbers listed.",
    fixtures: { files: { "/work/counts.txt": "alpha 14\nbeta 27\ngamma 9\n" } },
    expect: { kind: "use_result", tool: "read_file", answer: /\b50\b/, dataTokens: ["14", "27", "9"] },
    rationale: "14+27+9=50. Requires actually reading what the tool returned; the fixture's own numbers separate IGNORED from REASONING."
  });
  provenance.push("use_result \u2014 generic arithmetic over fixture data, identical for every skill so the tool-result step is comparable across them");
  return {
    cases,
    extraction: ex,
    provenance,
    ok: true,
    reason: `${cases.length} cases derived from ${ex.invocations.length} documented invocations, ${ex.claims.length} claims and ${ex.prohibitions.length} prohibitions`
  };
}

// engine/src/hash.browser.ts
function hashText(s) {
  let h1 = 2166136261, h2 = 16777619;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c + i, 2246822507) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// engine/src/skills/parse.ts
var SELECTION_CAP = 1536;
var SPEC_FIELDS = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"];
function splitFrontmatter(raw) {
  if (!raw.startsWith("---")) return { fm: "", body: raw, had: false };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { fm: "", body: raw, had: false };
  return { fm: raw.slice(3, end), body: raw.slice(end + 4).replace(/^\n+/, ""), had: true };
}
function fmKeys(fm) {
  return fm.split("\n").filter((l) => /^[A-Za-z_][\w-]*\s*:/.test(l)).map((l) => l.split(":")[0].trim());
}
function fmField(fm, key) {
  const lines = fm.split("\n");
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i === -1) return "";
  let v = lines[i].slice(key.length + 1).trim();
  for (let j = i + 1; j < lines.length; j++) {
    if (/^\S/.test(lines[j])) break;
    v += " " + lines[j].trim();
  }
  return v.replace(/^["']|["']$/g, "").trim();
}
function parseSkill(raw, dirName) {
  const { fm, body, had } = splitFrontmatter(raw);
  const errors = [];
  const fmName = fmField(fm, "name");
  const name = fmName || dirName;
  if (!fmName && !dirName) errors.push("no name in frontmatter and no directory name to fall back to");
  if (fmName) {
    if (fmName.length > 64) errors.push(`name is ${fmName.length} chars, spec maximum is 64`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fmName)) errors.push(`name "${fmName}" is not spec-legal (lowercase alphanumeric and single hyphens only)`);
  }
  let description = fmField(fm, "description");
  let description_source = description ? "frontmatter" : "absent";
  if (!description) {
    const para = body.split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !s.startsWith("#"));
    if (para) {
      description = para;
      description_source = "first-paragraph";
    }
  }
  if (!description) errors.push("no description and no usable first paragraph \u2014 nothing to select on");
  if (description.length > 1024 && description_source === "frontmatter") {
    errors.push(`description is ${description.length} chars, spec maximum is 1024`);
  }
  const when_to_use = fmField(fm, "when_to_use");
  const selRaw = [description, when_to_use].filter(Boolean).join(" ").trim();
  const selection = selRaw.length > SELECTION_CAP ? selRaw.slice(0, SELECTION_CAP) : selRaw;
  const keys = fmKeys(fm);
  const extra_fields = keys.filter((k) => !SPEC_FIELDS.includes(k));
  const at = fmField(fm, "allowed-tools");
  return {
    name,
    name_source: fmName ? "frontmatter" : "directory",
    description,
    description_source,
    when_to_use,
    selection,
    selection_chars: selection.length,
    body,
    body_chars: body.length,
    license: fmField(fm, "license") || null,
    compatibility: fmField(fm, "compatibility") || null,
    allowed_tools: at ? at.split(/[\s,]+/).filter(Boolean) : [],
    extra_fields,
    spec_conformance: !had ? "no-frontmatter" : extra_fields.length ? "client-extended" : "strict",
    errors,
    content_hash: hashText(raw)
  };
}

// engine/src/stats.ts
var THIN_CASES = 20;
var THIN_CALLS = 70;
var UNSTABLE_SPREAD = 0.055;
function wilson(successes, n, z = 1.96) {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const d = 1 + z * z / n;
  const centre = p + z * z / (2 * n);
  const spread = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (centre - spread) / d), Math.min(1, (centre + spread) / d)];
}
function rateOf(calls, repeats) {
  const byCase = /* @__PURE__ */ new Map();
  for (const c of calls) {
    const a = byCase.get(c.caseId) ?? [];
    a.push(c.pass);
    byCase.set(c.caseId, a);
  }
  const n_cases = byCase.size;
  const n_calls = calls.length;
  if (n_cases === 0) {
    return { rate: 0, lo: 0, hi: 1, n_cases: 0, n_calls: 0, disagreement: 0, thin: true, unstable: false };
  }
  const means = [];
  let disagreeing = 0;
  for (const arr of byCase.values()) {
    const m = arr.filter(Boolean).length / arr.length;
    means.push(m);
    if (m > 0 && m < 1) disagreeing++;
  }
  const rate = means.reduce((a, b) => a + b, 0) / n_cases;
  const disagreement = disagreeing / n_cases;
  let [lo, hi] = wilson(rate * n_cases, n_cases);
  let unstable = false;
  if (repeats && repeats.length > 1) {
    const rr = repeats.map((r) => r.reduce((a, b) => a + b, 0) / (r.length || 1));
    const spread = Math.max(...rr) - Math.min(...rr);
    if (spread > UNSTABLE_SPREAD) {
      unstable = true;
      lo = Math.min(lo, Math.min(...rr));
      hi = Math.max(hi, Math.max(...rr));
    }
  }
  return {
    rate,
    lo,
    hi,
    n_cases,
    n_calls,
    disagreement,
    thin: n_cases < THIN_CASES || n_calls < THIN_CALLS,
    unstable
  };
}

// engine/src/providers/index.ts
var ProviderError = class extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
    this.name = "ProviderError";
  }
  kind;
};
function assertHonest(requestedId, r) {
  if (r.cached) {
    throw new ProviderError(
      `provider returned a CACHED response for ${requestedId}. A cached answer is not a measurement: it collapses the repeat-run spread this product is built on. Turn response caching off at the gateway and re-run this cell.`,
      "cached_response"
    );
  }
  if (!servedMatches(requestedId, r.served_model)) {
    throw new ProviderError(
      `provider substitution: asked for "${requestedId}", served by "${r.served_model}". This cell measures the served model, not the requested one, and the two are never blended. Cell discarded.`,
      "provider_substitution"
    );
  }
}
function servedMatches(requested, served) {
  if (!served) return false;
  const norm = (s) => s.trim().toLowerCase().replace(/:(free|nitro|floor|extended)$/i, "");
  return norm(requested) === norm(served);
}

// engine/src/browser.ts
async function browserComplete(key, modelId, req) {
  const body = {
    model: modelId,
    max_tokens: req.maxTokens,
    messages: [{ role: "system", content: req.system }, ...req.messages],
    usage: { include: true },
    provider: { allow_fallbacks: false }
  };
  if (req.temperature !== void 0) {
    body.temperature = req.temperature;
    body.top_p = 1;
    body.seed = 7;
  }
  if (req.disableReasoning) body.reasoning = { enabled: false };
  const t0 = Date.now();
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      // Identifies the caller to OpenRouter; required for browser usage.
      "HTTP-Referer": globalThis.location?.origin ?? "https://nikjain15.github.io",
      "X-Title": "Fits"
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status}: ${t.slice(0, 160)}`);
  }
  const j = await r.json();
  const u = j?.usage ?? {};
  const reply = {
    text: j?.choices?.[0]?.message?.content ?? "",
    served_model: j?.model ?? "",
    served_provider: j?.provider ?? "unknown",
    quantization: "unknown",
    cached: Boolean(j?.cached ?? j?.cache_hit ?? u?.cache_hit ?? false),
    latency_ms: Date.now() - t0,
    context_window: 0,
    input_tokens: u.prompt_tokens ?? 0,
    output_tokens: u.completion_tokens ?? 0,
    cost_usd: typeof u.cost === "number" ? u.cost : 0
  };
  assertHonest(modelId, reply);
  return reply;
}
export {
  PROTOCOL,
  TOOL_NAMES,
  assertHonest,
  browserComplete,
  buildSystemPrompt,
  buildTools,
  extract,
  generate,
  grade,
  parseSkill,
  parseTurn,
  rateOf,
  runAgent
};
