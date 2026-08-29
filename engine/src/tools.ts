/**
 * The mock tool surface every run is given. Ported unchanged in behaviour from
 * the prior harness, where every line of it was earned by a bug.
 *
 * SAFETY: nothing here executes anything. `bash` does not run a shell -- it
 * records the proposed command and returns a canned success. This measures what
 * a model PROPOSES; executing model-authored shell would add real risk and buy
 * no measurement.
 *
 * The surface is deliberately UNIFORM across all skills:
 *   1. Real Agent Skills are instructions layered over a general tool surface (a
 *      shell, a filesystem, a browser). They rarely ship bespoke tool APIs.
 *   2. It keeps the scope axis honest. What grows from 1 to 32 is the number of
 *      SKILL DESCRIPTIONS in scope -- the variable the 10-20-skill discrimination
 *      limit is about. Tool count is held constant so it cannot confound it.
 */

export interface ToolSpec {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
}
export interface Tool extends ToolSpec {
  handler: (args: any) => Promise<unknown>;
}

export interface Fixtures {
  files?: Record<string, string>;
  console?: Array<{ level: string; text: string }>;
  network?: Array<{ url: string; status: number }>;
  dom?: string;
  http?: Record<string, string>;
}

export function buildTools(fx: Fixtures): Tool[] {
  const files = fx.files ?? {};
  return [
    {
      name: "bash",
      description: "Run a shell command and return its stdout. Use for any CLI tool.",
      jsonSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      handler: async (a: any) => {
        const cmd = String(a?.command ?? "");
        // Reconnaissance must be INFORMATIVE. A stub for ls/find punished exactly
        // the models careful enough to check their inputs first, and understated
        // the ceiling by 7.3% of its runs. read_file and list_files already knew
        // the fixtures; bash has to as well, or the harness measures caution.
        if (/^\s*(ls|find|pwd|file|stat|dir)\b/i.test(cmd) || /\bls\s+-/.test(cmd)) {
          const names = Object.keys(files);
          return { exit_code: 0, stdout: names.length ? names.join("\n") : "(no files)" };
        }
        if (/^\s*cat\b/i.test(cmd)) {
          const hit = Object.entries(files).find(([k]) => cmd.includes(k.replace(/^\//, "")) || cmd.includes(k));
          if (hit) return { exit_code: 0, stdout: hit[1] };
        }
        return { exit_code: 0, stdout: `(ran) ${cmd.slice(0, 200)}` };
      },
    },
    {
      name: "read_file",
      description: "Read a UTF-8 text file and return its contents.",
      jsonSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: async (a: any) => {
        const p = String(a?.path ?? "");
        // Tolerate a leading ./ or a bare basename so a near-miss path is an
        // argument nit, not a fabricated file-not-found reasoning trap.
        const hit = files[p] ?? files[p.replace(/^\.\//, "/")] ??
          Object.entries(files).find(([k]) => k.endsWith(p.replace(/^\.?\/?/, "/")))?.[1];
        if (hit === undefined) return { error: `no such file: ${p}`, available: Object.keys(files) };
        return { path: p, content: hit };
      },
    },
    {
      name: "write_file",
      description: "Write UTF-8 text to a file, creating or overwriting it.",
      jsonSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      handler: async (a: any) => ({ ok: true, path: String(a?.path ?? ""), bytes: String(a?.content ?? "").length }),
    },
    {
      name: "list_files",
      description: "List the files in a directory.",
      jsonSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: async () => ({ entries: Object.keys(files) }),
    },
    {
      name: "browser_navigate",
      description: "Navigate the browser to a URL and wait for the page to settle.",
      jsonSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      handler: async (a: any) => ({ ok: true, url: String(a?.url ?? ""), title: "page loaded" }),
    },
    {
      name: "browser_dom",
      description: "Read the rendered DOM of the current page.",
      jsonSchema: { type: "object", properties: {} },
      handler: async () => ({ dom: fx.dom ?? "<html><body>(empty)</body></html>" }),
    },
    {
      name: "browser_console",
      description: "Retrieve console output (log, warn, error) from the current page.",
      jsonSchema: { type: "object", properties: {} },
      handler: async () => ({ messages: fx.console ?? [] }),
    },
    {
      name: "browser_network",
      description: "Retrieve network requests and response statuses from the current page.",
      jsonSchema: { type: "object", properties: {} },
      handler: async () => ({ requests: fx.network ?? [] }),
    },
    {
      name: "http_get",
      description: "Perform an HTTP GET against a URL and return the response body.",
      jsonSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      handler: async (a: any) => {
        const u = String(a?.url ?? "");
        const hit = Object.entries(fx.http ?? {}).find(([k]) => u.includes(k))?.[1];
        return hit === undefined ? { status: 200, body: "{}" } : { status: 200, body: hit };
      },
    },
  ];
}

export const TOOL_NAMES = [
  "bash", "read_file", "write_file", "list_files",
  "browser_navigate", "browser_dom", "browser_console", "browser_network", "http_get",
] as const;

/** Byte accounting for ladder rung 5. Every tool call's arguments are weighed so
 *  the leak figure can be computed from real payloads instead of estimated.
 *  Nothing is published from this until it has run over real traces. */
export function payloadBytes(args: unknown): number {
  return Buffer.byteLength(JSON.stringify(args ?? {}), "utf8");
}
