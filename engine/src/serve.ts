/**
 * The local control server — what makes "Test it" real.
 *
 * The published site is static JSON on GitHub Pages. It has no GPU, no API key
 * and no way to run a model, and the mockup's Test button was a simulation. This
 * server is the honest version: run it on your own machine and the same button
 * fetches a skill, derives a suite from the skill's own text, runs it against
 * real models, and writes the result into the same node store as every other
 * measurement.
 *
 *   npm run serve      →  http://localhost:8099
 *
 * WHAT THE PUBLIC SITE DOES INSTEAD. `GET /api/health` fails there, so the UI
 * says plainly that testing needs a local engine and offers the command. It does
 * not fake a run, and it does not pretend a queue exists that nobody is draining.
 *
 * EVERYTHING A RUN PRODUCES HERE IS MARKED `auto-derived`. Nobody has accepted
 * these cases, so they are weaker evidence than the hand-written suites and the
 * site labels them as such rather than blending them into the corpus rates.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { REPO_ROOT } from "./corpus.ts";
import { parseSkill } from "./skills/parse.ts";
import { generate } from "./generate.ts";
import { MODELS, available } from "./models.ts";
import { configureHttp } from "./net.ts";

const WEB = join(REPO_ROOT, "web");
const PORT = Number(process.env.PORT ?? 8099);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml",
};

interface Job {
  id: string;
  url: string;
  skillId: string;
  state: "parsing" | "generating" | "running" | "done" | "error";
  message: string;
  /** Per-model progress, so the UI can show queued / running / done. */
  models: Array<{ key: string; cls: string; state: "queued" | "running" | "done" | "failed"; pass?: number; n?: number }>;
  cases: Array<{ kind: string; prompt: string; rationale: string }>;
  provenance: string[];
  startedAt: number;
  log: string[];
}

const jobs = new Map<string, Job>();

/** Requests drawn from other catalogued skills — a fixed, seeded set so two runs
 *  of the same skill are comparable. */
function decoyRequests(exclude: string): string[] {
  const pool = [
    "Merge these two PDFs into one file",
    "Send an email to the team with this week's numbers",
    "Deploy the current branch to production",
    "Convert this spreadsheet to CSV and total the revenue column",
    "Draw an architecture diagram of these three services",
    "Transcribe this audio file",
  ];
  return pool.filter((p) => !p.toLowerCase().includes(exclude.toLowerCase().split("-")[0]));
}

// ---------------------------------------------------------------------------

/**
 * Accept the shapes people actually paste, and refuse anything else by name.
 * A silent guess at a URL shape produces a 404 that looks like "this skill does
 * not exist" rather than "we did not understand your link".
 */
function resolveSkillUrl(raw: string): { repo: string; path: string } | { error: string } {
  const u = raw.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!u.startsWith("github.com/")) {
    return { error: "Only github.com URLs are supported. Paste a link to a skill directory or its SKILL.md." };
  }
  const rest = u.slice("github.com/".length);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length < 2) return { error: "That looks like a repository root. Point at a skill directory, e.g. .../tree/main/skills/pdf" };
  const repo = `${parts[0]}/${parts[1]}`;

  // owner/repo/tree/<ref>/<path...>  or  owner/repo/blob/<ref>/<path...>
  let path = "";
  const ix = parts.findIndex((p) => p === "tree" || p === "blob");
  if (ix >= 0) path = parts.slice(ix + 2).join("/");
  else if (parts.length > 2) path = parts.slice(2).join("/");

  if (!path) return { error: "No skill path in that URL. Point at the skill's directory, not the repository root." };
  if (!/SKILL\.md$/i.test(path)) path = `${path}/SKILL.md`;
  return { repo, path };
}

async function fetchSkill(repo: string, path: string): Promise<string | null> {
  for (const ref of ["HEAD", "main", "master"]) {
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`).catch(() => null);
    if (r?.ok) return r.text();
  }
  return null;
}

// ---------------------------------------------------------------------------

async function startJob(job: Job, url: string, modelKeys: string[]) {
  const push = (m: string) => { job.message = m; job.log.push(m); };

  const resolved = resolveSkillUrl(url);
  if ("error" in resolved) { job.state = "error"; push(resolved.error); return; }

  push(`fetching ${resolved.repo}/${resolved.path}`);
  const raw = await fetchSkill(resolved.repo, resolved.path);
  if (!raw) {
    job.state = "error";
    push(`No SKILL.md at ${resolved.repo}/${resolved.path}. Nothing was run and nothing was invented.`);
    return;
  }

  const dirName = resolved.path.replace(/\/SKILL\.md$/i, "").split("/").pop() ?? "skill";
  const parsed = parseSkill(raw, dirName);
  job.skillId = `${resolved.repo.split("/")[0]}__${parsed.name || dirName}`.toLowerCase().replace(/[^a-z0-9_]+/g, "-");

  job.state = "generating";
  push(`parsed "${parsed.name}" — ${parsed.body_chars.toLocaleString()} characters, ${parsed.spec_conformance}`);

  /**
   * Decoys for the abstain case: real requests belonging to OTHER skills.
   *
   * Without a negative case, EAGER — firing when it should have stayed out — is
   * unmeasurable, and it is the failure small models commit most. Not every
   * skill states a claim we can quiz it on (webapp-testing states none), so the
   * fallback borrows a neighbour's job from the catalogue. Nothing is invented:
   * the request is a real published skill's purpose, which this skill should
   * decline.
   */
  const gen = generate(job.skillId, parsed, decoyRequests(parsed.name));
  job.provenance = gen.provenance;
  job.cases = gen.cases.map((c) => ({ kind: c.kind, prompt: c.prompt, rationale: c.rationale }));
  if (!gen.ok) {
    job.state = "error";
    push(gen.reason);
    return;
  }
  push(gen.reason);

  // The runner reads skills off disk and cases from a registry, so a pasted
  // skill is written into the corpus as an auto-derived entry. It is tagged so
  // it can never be mistaken for one of the human-accepted suites.
  const dir = join(REPO_ROOT, "corpus", "auto");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${job.skillId}.md`), raw);
  writeFileSync(join(dir, `${job.skillId}.cases.json`), JSON.stringify({
    skillId: job.skillId, repo: resolved.repo, path: resolved.path,
    authored_by: "auto-derived", accepted: false,
    generated_at: new Date().toISOString(),
    provenance: gen.provenance,
    cases: gen.cases.map((c) => ({
      ...c,
      expect: { ...c.expect, ...( "args" in c.expect ? { args: Object.fromEntries(Object.entries(c.expect.args).map(([k, v]) => [k, String(v)])) } : {}) },
    })),
  }, null, 2));

  job.state = "running";
  job.models = modelKeys.map((k) => {
    const m = MODELS.find((x) => x.key === k)!;
    return { key: k, cls: m.cls, state: "queued" as const };
  });

  // Spawned rather than run in-process: a crash in a run must not take the
  // server down, and the child is the same code path the CLI uses, so a result
  // produced here is produced exactly as a scheduled run would produce it.
  for (const m of job.models) {
    m.state = "running";
    push(`running on ${m.key}`);
    await new Promise<void>((resolve) => {
      const child = spawn("npx", [
        "tsx", join(REPO_ROOT, "engine", "src", "run.ts"),
        "--auto-skill", job.skillId, "--model", m.key, "--yes", "--budget-min", "10",
      ], { cwd: REPO_ROOT, env: { ...process.env, FITS_TRIALS: "3", FITS_REPEATS: "1" } });
      let out = "";
      child.stdout.on("data", (d) => { out += String(d); });
      child.stderr.on("data", (d) => { out += String(d); });
      child.on("close", (code) => {
        const hit = /pass (\d\.\d\d)/.exec(out);
        m.pass = hit ? Number(hit[1]) : undefined;
        m.state = code === 0 && hit ? "done" : "failed";
        if (!hit) push(`${m.key}: no result — ${out.trim().split("\n").pop()?.slice(0, 120) ?? "run produced nothing"}`);
        resolve();
      });
    });
  }

  job.state = "done";
  push(`done in ${Math.round((Date.now() - job.startedAt) / 1000)}s`);
}

// ---------------------------------------------------------------------------

function send(res: ServerResponse, code: number, body: unknown, type = "application/json") {
  const s = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(s);
}

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  // Contain the path: a served file must be inside web/.
  const full = join(WEB, normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!full.startsWith(WEB) || !existsSync(full)) { send(res, 404, "not found", "text/plain"); return; }
  res.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream" });
  res.end(readFileSync(full));
}

async function main() {
  configureHttp();
  const { runnable } = available();

  createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");

    if (url.pathname === "/api/health") {
      return send(res, 200, {
        ok: true,
        models: runnable.map((m) => ({ key: m.key, cls: m.cls, lane: m.lane, id: m.id })),
        note: "Local engine. Runs are real and land in data/nodes/ like any other measurement.",
      });
    }

    if (url.pathname === "/api/test" && req.method === "POST") {
      const body = await new Promise<string>((r) => { let b = ""; req.on("data", (d) => b += d); req.on("end", () => r(b)); });
      let parsed: { url?: string; models?: string[] };
      try { parsed = JSON.parse(body || "{}"); } catch { return send(res, 400, { error: "bad JSON" }); }
      if (!parsed.url) return send(res, 400, { error: "no url" });

      const wanted = parsed.models?.length
        ? runnable.filter((m) => parsed.models!.includes(m.key))
        // Default to the local lane: free, needs no key, and it is the only lane
        // that can report what a laptop would actually feel.
        : runnable.filter((m) => m.lane === "local");
      if (!wanted.length) return send(res, 400, { error: "no runnable models — pull an Ollama model or set OPENROUTER_API_KEY" });

      const job: Job = {
        id: randomUUID().slice(0, 8), url: parsed.url, skillId: "",
        state: "parsing", message: "starting", models: [], cases: [], provenance: [],
        startedAt: Date.now(), log: [],
      };
      jobs.set(job.id, job);
      startJob(job, parsed.url, wanted.map((m) => m.key)).catch((e) => {
        job.state = "error";
        job.message = String(e?.message ?? e).slice(0, 200);
      });
      return send(res, 200, { id: job.id });
    }

    const m = /^\/api\/job\/([\w-]+)$/.exec(url.pathname);
    if (m) {
      const job = jobs.get(m[1]);
      return job ? send(res, 200, job) : send(res, 404, { error: "no such job" });
    }

    serveStatic(req, res);
  }).listen(PORT, () => {
    console.log(`\n  fits — local engine on http://localhost:${PORT}`);
    console.log(`  ${runnable.length} runnable models: ${runnable.map((m) => m.key).join(", ") || "none"}`);
    console.log(`  Paste a skill URL and press Test it. Runs are real.\n`);
  });
}

if (/serve\.ts$/.test(process.argv[1] ?? "")) main();
