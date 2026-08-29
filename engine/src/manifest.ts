/**
 * The corpus: 20 real, published Agent Skills, fetched verbatim from public
 * GitHub repositories on 2026-08-28. Nothing here was written by us.
 *
 * Selection rule (from the experiment brief): the skill must DO something --
 * call tools, process a file, transform data. Pure style guides and "you are a
 * helpful X" personas were excluded because they have nothing to fail at.
 *
 * Provenance was read from the GitHub REST API on 2026-08-28; `stars` and
 * `pushed` are that day's values and will drift.
 */

export interface SkillMeta {
  /** Local id, also the filename stem under skills/. */
  id: string;
  /** The `name:` field from the skill's own YAML frontmatter. */
  name: string;
  repo: string;
  path: string;
  url: string;
  stars: number;
  /** Repo last-pushed date (YYYY-MM-DD) as reported by the GitHub API. */
  pushed: string;
}

const R = {
  anthropic: { repo: "anthropics/skills", stars: 172282, pushed: "2026-08-21" },
  gws: { repo: "googleworkspace/cli", stars: 30626, pushed: "2026-08-25" },
  kepano: { repo: "kepano/obsidian-skills", stars: 47444, pushed: "2026-06-08" },
  vercel: { repo: "vercel-labs/agent-skills", stars: 30591, pushed: "2026-08-28" },
  kdense: { repo: "K-Dense-AI/scientific-agent-skills", stars: 36566, pushed: "2026-08-28" },
  agents365: { repo: "Agents365-ai/drawio-skill", stars: 8167, pushed: "2026-08-28" },
  browseract: { repo: "browser-act/skills", stars: 5514, pushed: "2026-08-24" },
  addyosmani: { repo: "addyosmani/agent-skills", stars: 90510, pushed: "2026-08-28" },
  tenglin: { repo: "teng-lin/notebooklm-py", stars: 18987, pushed: "2026-08-28" },
} as const;

function mk(id: string, name: string, src: { repo: string; stars: number; pushed: string }, path: string): SkillMeta {
  return { id, name, repo: src.repo, path, url: `https://github.com/${src.repo}/blob/main/${path}`, stars: src.stars, pushed: src.pushed };
}

export const SKILLS: SkillMeta[] = [
  mk("anthropic__pdf", "pdf", R.anthropic, "skills/pdf/SKILL.md"),
  mk("anthropic__docx", "docx", R.anthropic, "skills/docx/SKILL.md"),
  mk("anthropic__xlsx", "xlsx", R.anthropic, "skills/xlsx/SKILL.md"),
  mk("anthropic__pptx", "pptx", R.anthropic, "skills/pptx/SKILL.md"),
  mk("anthropic__webapp-testing", "webapp-testing", R.anthropic, "skills/webapp-testing/SKILL.md"),
  mk("gws__gws-gmail-send", "gws-gmail-send", R.gws, "skills/gws-gmail-send/SKILL.md"),
  mk("gws__gws-calendar-insert", "gws-calendar-insert", R.gws, "skills/gws-calendar-insert/SKILL.md"),
  mk("gws__gws-drive-upload", "gws-drive-upload", R.gws, "skills/gws-drive-upload/SKILL.md"),
  mk("gws__gws-sheets", "gws-sheets", R.gws, "skills/gws-sheets/SKILL.md"),
  mk("kepano__obsidian-cli", "obsidian-cli", R.kepano, "skills/obsidian-cli/SKILL.md"),
  mk("kepano__defuddle", "defuddle", R.kepano, "skills/defuddle/SKILL.md"),
  mk("kepano__json-canvas", "json-canvas", R.kepano, "skills/json-canvas/SKILL.md"),
  mk("vercel__deploy", "deploy-to-vercel", R.vercel, "skills/deploy-to-vercel/SKILL.md"),
  mk("vercel__cli-tokens", "vercel-cli-with-tokens", R.vercel, "skills/vercel-cli-with-tokens/SKILL.md"),
  mk("kdense__database-lookup", "database-lookup", R.kdense, "skills/database-lookup/SKILL.md"),
  mk("kdense__biopython", "biopython", R.kdense, "skills/biopython/SKILL.md"),
  mk("agents365__drawio", "drawio-skill", R.agents365, "skills/drawio-skill/SKILL.md"),
  mk("browseract__amazon-product-detail", "amazon-product-detail", R.browseract, "solutions/ecommerce/amazon-product-detail/SKILL.md"),
  mk("addyosmani__browser-devtools", "browser-testing-with-devtools", R.addyosmani, "skills/browser-testing-with-devtools/SKILL.md"),
  mk("tenglin__notebooklm", "notebooklm", R.tenglin, "SKILL.md"),
];
