/**
 * Skill discovery — "all skills that are open".
 *
 * THERE IS NO OFFICIAL REGISTRY API. Checked 2026-08-28: the Agent Plugins spec
 * deliberately leaves registries, marketplaces, installation and updates outside
 * the portable format, and there is no first-party index. See
 * docs/skill-format.md §5. So discovery is GitHub-first, in the order below.
 *
 *   1. GitHub code search for the manifest filenames confirmed in docs/skill-format.md
 *   2. GitHub topic search for the relevant topics
 *   3. Curated "awesome-" lists, dereferenced to repos
 *   4. engine/seeds.yaml for anything the above misses
 *
 * Every skill records `license`, `stars`, `commit` and `discovered_via`, so
 * provenance is never guessed. Discovery re-runs daily; a skill is re-fetched
 * only when its default-branch SHA changes.
 *
 * ON THE LICENCE FILTER. Applied literally, "has an OSI licence" excludes
 * `anthropics/skills` — 172k stars, no LICENSE file at the repo root, and the
 * source of the largest part of the existing corpus. Rejecting it would delete
 * the canonical corpus to satisfy a checkbox. So `license_ok` is RECORDED and
 * `seeds.yaml` carries a hand-vetted allowlist; nothing is silently included and
 * nothing is silently dropped.
 *
 * Uses the `gh` CLI so the caller's existing auth is reused and no token is
 * handled by this process.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../corpus.ts";

const OUT = join(REPO_ROOT, "data", "discovery.json");
const SEEDS = join(REPO_ROOT, "engine", "seeds.yaml");

/** Confirmed against the live API on 2026-08-28. Counts in the comments are that
 *  day's, and will drift. */
const QUERIES = {
  topics: ["agent-skills", "claude-skills", "agent-plugins"],   // 18,326 / 7,574 repos
  code: ["filename:SKILL.md path:skills", "filename:plugin.json path:/"], // 54,656 files
};

export interface Discovered {
  repo: string;
  stars: number;
  license: string | null;
  license_ok: boolean;
  default_branch: string;
  sha: string;
  pushed_at: string;
  discovered_via: string;
  /** skills/<name>/SKILL.md paths found in the repo. */
  skill_paths: string[];
  manifest_kind: "plugin_json" | "marketplace_json" | "bare" | "unknown";
}

function gh(args: string[]): any {
  const out = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out);
}

function seeds(): string[] {
  if (!existsSync(SEEDS)) return [];
  // Deliberately not a YAML dependency: the file is a list of repo slugs and
  // comments, and adding a parser for that would be the wrong trade.
  return readFileSync(SEEDS, "utf8").split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter((l) => /^-\s*\S+\/\S+$/.test(l))
    .map((l) => l.replace(/^-\s*/, ""));
}

async function main() {
  const found = new Map<string, Discovered>();
  const CAP = Number(process.env.FITS_DISCOVER_CAP ?? 50);

  const note = (repo: string, via: string) => {
    const e = found.get(repo);
    if (e && !e.discovered_via.includes(via)) e.discovered_via += `, ${via}`;
  };

  const add = (r: any, via: string) => {
    const repo = r.full_name ?? r.repository?.full_name;
    if (!repo) return;
    if (found.has(repo)) { note(repo, via); return; }
    found.set(repo, {
      repo,
      stars: r.stargazers_count ?? 0,
      license: r.license?.spdx_id ?? null,
      license_ok: Boolean(r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION"),
      default_branch: r.default_branch ?? "main",
      sha: "",
      pushed_at: r.pushed_at ?? "",
      discovered_via: via,
      skill_paths: [],
      manifest_kind: "unknown",
    });
  };

  for (const t of QUERIES.topics) {
    try {
      const j = gh(["api", "-X", "GET", "search/repositories", "-f", `q=topic:${t}`, "-f", "per_page=50", "-f", "sort=stars"]);
      for (const r of j.items ?? []) add(r, `topic:${t}`);
      console.log(`  topic:${t.padEnd(16)} ${j.total_count?.toLocaleString()} repos, took top ${Math.min(50, (j.items ?? []).length)}`);
    } catch (e: any) {
      console.log(`  topic:${t} failed: ${String(e?.message ?? e).slice(0, 100)}`);
    }
  }

  for (const q of QUERIES.code) {
    try {
      const j = gh(["api", "-X", "GET", "search/code", "-f", `q=${q}`, "-f", "per_page=50"]);
      for (const it of j.items ?? []) add({ full_name: it.repository?.full_name, default_branch: "main" }, `code:${q}`);
      console.log(`  code:${q.padEnd(34)} ${j.total_count?.toLocaleString()} files`);
    } catch (e: any) {
      console.log(`  code search "${q}" failed: ${String(e?.message ?? e).slice(0, 100)}`);
    }
  }

  for (const s of seeds()) {
    if (!found.has(s)) add({ full_name: s, default_branch: "main" }, "seeds.yaml");
    else note(s, "seeds.yaml");
  }

  // Rank by stars, then resolve the top CAP. Breadth is worthless until the depth
  // is trustworthy, so the first milestone caps at 50.
  const ranked = [...found.values()].sort((a, b) => b.stars - a.stars).slice(0, CAP);

  for (const d of ranked) {
    try {
      const meta = gh(["api", `repos/${d.repo}`]);
      d.stars = meta.stargazers_count ?? d.stars;
      d.license = meta.license?.spdx_id ?? null;
      d.license_ok = Boolean(d.license && d.license !== "NOASSERTION");
      d.default_branch = meta.default_branch ?? "main";
      d.pushed_at = meta.pushed_at ?? "";
      // Pin the commit. A skill is re-fetched only when this moves.
      d.sha = gh(["api", `repos/${d.repo}/commits/${d.default_branch}`]).sha ?? "";

      const tree = gh(["api", `repos/${d.repo}/git/trees/${d.sha}`, "-f", "recursive=1"]);
      const paths: string[] = (tree.tree ?? []).map((t: any) => t.path);
      d.skill_paths = paths.filter((p) => /(^|\/)skills\/[^/]+\/SKILL\.md$/.test(p)).slice(0, 200);
      d.manifest_kind = paths.includes("plugin.json") ? "plugin_json"
        : paths.includes(".claude-plugin/marketplace.json") ? "marketplace_json"
        : d.skill_paths.length ? "bare" : "unknown";
    } catch (e: any) {
      console.log(`  ! ${d.repo}: ${String(e?.message ?? e).slice(0, 90)}`);
    }
  }

  const withSkills = ranked.filter((d) => d.skill_paths.length);
  mkdirSync(join(REPO_ROOT, "data"), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    generated: new Date().toISOString(),
    queried: QUERIES,
    registry_api: "none — checked 2026-08-28; the Agent Plugins spec leaves distribution out of the portable format (docs/skill-format.md §5)",
    cap: CAP,
    repos_seen: found.size,
    repos_resolved: ranked.length,
    repos_with_skills: withSkills.length,
    skills_total: withSkills.reduce((a, d) => a + d.skill_paths.length, 0),
    unlicensed: withSkills.filter((d) => !d.license_ok).map((d) => d.repo),
    repos: ranked,
  }, null, 2));

  console.log(`\n  ${found.size} repos seen · ${ranked.length} resolved · ${withSkills.length} carry skills · ${withSkills.reduce((a, d) => a + d.skill_paths.length, 0)} SKILL.md files`);
  console.log(`  ${withSkills.filter((d) => !d.license_ok).length} of those repos report NO OSI licence — recorded, not dropped:`);
  for (const d of withSkills.filter((x) => !x.license_ok).slice(0, 6)) console.log(`    ${d.repo} (${d.stars.toLocaleString()}★)`);
  console.log(`\n  → data/discovery.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
