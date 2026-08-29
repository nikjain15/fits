/**
 * Where API keys come from, and where they must never come from.
 *
 * Three sources, in order, first hit wins:
 *
 *   1. the process environment          — what CI uses (Actions secrets)
 *   2. ~/.fits.env                      — a local file, mode 600, never in the repo
 *   3. the macOS keychain               — if the operator prefers it there
 *
 * The repo is public. Nothing here writes a key anywhere, echoes one, or puts one
 * in a log line, and `redact()` below is used on every error path that might
 * carry a request body. A key in a stack trace is a leaked key.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const FILE = join(homedir(), ".fits.env");
let loaded = false;

/** Parse ~/.fits.env once and fold it into process.env without overwriting
 *  anything already set — an explicit export always beats the file. */
function loadFile(): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(FILE)) return;

  // A world-readable secrets file is a finding, not a detail. Say so loudly and
  // still load it, because refusing would only push the operator somewhere worse.
  try {
    const mode = statSync(FILE).mode & 0o077;
    if (mode) {
      console.error(`  ! ${FILE} is readable by other users. Fix with: chmod 600 ${FILE}`);
    }
  } catch { /* stat failure is not worth failing a run over */ }

  for (const line of readFileSync(FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

function fromKeychain(name: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    return execFileSync("security", ["find-generic-password", "-s", name, "-w"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Returns the secret, or undefined. Never throws, never logs the value. */
export function secret(name: string): string | undefined {
  loadFile();
  return process.env[name] || fromKeychain(name) || undefined;
}

export function has(name: string): boolean {
  return Boolean(secret(name));
}

/**
 * Strip anything key-shaped out of a string before it reaches a log, an error
 * message or a committed file. Applied to provider errors, which routinely echo
 * the request that caused them.
 */
export function redact(s: string): string {
  return s
    .replace(/sk-or-v1-[A-Za-z0-9_-]{8,}/g, "sk-or-v1-***")
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-***")
    .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, "gh*_***")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, (m) => (/^[a-f0-9]+$/i.test(m) ? m : "***"));
}

/** One line describing what is available, for a run header. Names only. */
export function availability(): string {
  const rows = [
    ["OPENROUTER_API_KEY", "hosted lane + frontier ceiling"],
    ["GITHUB_TOKEN", "corpus discovery at full rate"],
  ] as const;
  return rows.map(([k, what]) => `${has(k) ? "✓" : "✗"} ${k.padEnd(20)} ${what}`).join("\n  ");
}
