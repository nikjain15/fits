# The skill format, as observed

**Written from sources fetched on 2026-08-28.** Nothing here is from training data or
from the build prompt. Where a source and the build prompt disagree, the source wins
and the disagreement is recorded at the bottom.

Fits' parser (`engine/src/skills/parse.ts`) is written against this file, not against
recollection. If the format moves, update this file first and the parser second.

---

## 1. Two specifications, not one

There are two separate specs and they are layered. Conflating them is the first way to
get the parser wrong.

| | what it defines | authority |
|---|---|---|
| **Agent Skills** | `SKILL.md` — the frontmatter fields and the body | https://agentskills.io/specification |
| **Agent Plugins 1.0** | `plugin.json` — packaging and discovery *around* skills | https://agent-plugins.org/specification |

Agent Plugins explicitly does **not** define the `SKILL.md` format. It says only that
skills are discovered from `skills/` subdirectories and that each "MUST conform to the
Agent Skills specification". So a plugin is a container; the skill is the unit Fits
measures.

---

## 2. Agent Skills — `SKILL.md`

Fetched from https://agentskills.io/specification on 2026-08-28.

### Directory layout

```
skill-name/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation
├── assets/           # Optional: templates, resources
└── ...               # Any additional files or directories
```

### Frontmatter — the complete field list

YAML frontmatter, then Markdown body.

| Field | Required | Constraints (verbatim from the spec) |
|---|---|---|
| `name` | **Yes** | Max 64 characters. Lowercase letters, numbers, and hyphens only. Must not start or end with a hyphen. |
| `description` | **Yes** | Max 1024 characters. Non-empty. Describes what the skill does and when to use it. |
| `license` | No | License name or reference to a bundled license file. |
| `compatibility` | No | Max 500 characters. Environment requirements (intended product, system packages, network access, etc.). |
| `metadata` | No | Arbitrary key-value mapping (string keys → string values). |
| `allowed-tools` | No | Space-separated string of pre-approved tools. **Experimental.** |

Additional `name` rules the spec states separately: 1–64 characters, unicode lowercase
alphanumeric plus hyphens, no leading/trailing hyphen, **no consecutive hyphens**, and
it **must match the parent directory name**.

That is the whole closed set. Six fields, two required.

### Body

No format restrictions. The spec recommends step-by-step instructions, input/output
examples, and edge cases, and says to keep `SKILL.md` **under 500 lines**, moving detail
into `references/`.

### Progressive disclosure — the part that matters for measurement

The spec names three load stages:

1. **Metadata** (~100 tokens): `name` + `description`, loaded at startup **for every
   installed skill**.
2. **Instructions** (<5000 tokens recommended): the full `SKILL.md` body, loaded only
   once the skill is activated.
3. **Resources**: `scripts/`, `references/`, `assets/`, loaded only when required.

**This is the mechanism the scope axis measures.** Stage 1 is the selection surface and
it scales with the number of installed skills; stage 2 is the execution surface and it
does not. A scope-axis run that pads the context with full skill bodies would be
measuring something the runtime never does. Padding must be **descriptions only**.

The prior experiment (`experiment/src/protocol.ts`) already does exactly this, and this
spec is why it is correct.

### Validation

The spec points at a reference validator, `skills-ref validate ./my-skill`
(https://github.com/agentskills/agentskills/tree/main/skills-ref).

---

## 3. Agent Plugins 1.0 — `plugin.json`

Fetched from https://agent-plugins.org/specification on 2026-08-28. Spec version
**1.0.0**, status Published.

### Layout

```text
my-plugin/
├── plugin.json
├── skills/
│   └── summarize/
│       ├── SKILL.md
│       ├── scripts/
│       └── references/
├── mcp.json
└── com.example.client/
    └── hooks/
```

### `plugin.json`

Closed schema. The only permitted top-level fields are:

`$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`,
`license`, `keywords`, `extensions`.

Required: `$schema` (must be `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`)
and `name` (1–64 chars, lowercase alphanumeric with hyphens/periods, no consecutive
hyphens or periods).

`license` is recommended to be an SPDX identifier. `extensions` carries client-specific
data under reverse-domain namespaces.

### `mcp.json`

Optional, at plugin root. Requires `$schema` and `mcpServers`. Transports: `stdio`
(`command`, optional `args`/`env`/`cwd`), `streamable-http` (`url`, optional `headers`),
and the deprecated `sse`. Clients MUST support at least one of `stdio` or
`streamable-http`. `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` expand in `args`, `env`, `cwd`
only.

### Out of scope for v1 — quoted

> "Other proposed component types — such as commands, hooks, agents, rules, and LSP
> servers — remain too client-specific for a stable portable contract and are outside
> the v1 format."

The spec also leaves **distribution** out: registries, marketplaces, installation and
updates are not part of the portable format. That is confirmed by the absence of any
official registry API (§5).

---

## 4. Claude Code — the largest client, and its superset

Fetched from https://code.claude.com/docs/en/skills on 2026-08-28. This matters because
a large share of the public corpus is written *for Claude Code*, not for the portable
spec, and the parser meets those files in the wild.

**Where skills live:**

| scope | path |
|---|---|
| Personal | `~/.claude/skills/<skill-name>/SKILL.md` |
| Project | `.claude/skills/<skill-name>/SKILL.md` |
| Plugin | `<plugin>/skills/<name>/SKILL.md` → invoked as `/<plugin>:<name>` |

Also: nested `.claude/skills/` below the working directory, and `~/.claude/skills/synced/`
(reserved name, used for claude.ai sync).

**Claude Code accepts a much larger frontmatter set than the spec's six fields**,
including `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`,
`user-invocable`, `disallowed-tools`, `model`, `effort`, `context`, `agent`,
`background`, `hooks`, `paths`, `shell`. It accepts `license` and `compatibility` but
does not act on them.

Two consequences the docs state directly, and that the parser must handle:

- `name` is **optional** in Claude Code and defaults to the directory name.
- `description` is only *recommended*; if omitted, the first paragraph of the body is
  used.
- `when_to_use` is **appended to `description`** in the skill listing, and the combined
  text is **truncated at 1,536 characters**.

The docs also record that stricter consumers reject the extras outright, quoting the
error: `Unexpected key(s) in SKILL.md frontmatter: argument-hint. Allowed properties
are: allowed-tools, compatibility, description, license, metadata, name`.

**So "the selection surface" is client-dependent.** Fits measures
`description` + `when_to_use`, truncated at 1,536 characters, and records
`selection_surface_chars` on every skill so the choice is visible rather than buried.

---

## 5. Is there an official registry API? No.

Checked 2026-08-28. The Agent Plugins spec deliberately leaves registries and
marketplaces out of the portable format, and there is no first-party index API. What
exists is third-party (e.g. a directory claiming 999 plugins across 613 repos,
2026-08-18) and GitHub itself.

**Consequence for `engine/src/skills/discover.ts`:** discovery is GitHub-first, exactly
as the build prompt's fallback ordering assumed. Verified working against the live API
on 2026-08-28:

| query | result |
|---|---|
| `topic:agent-skills` | 18,326 repos |
| `topic:claude-skills` | 7,574 repos |
| `filename:SKILL.md path:skills` (code search) | 54,656 files |

---

## 6. What the real corpus actually looks like

Five repos inspected via the GitHub API on 2026-08-28. **The wild does not match the
spec cleanly, and the parser is written for the wild.**

| repo | root manifest | skills dir | note |
|---|---|---|---|
| `anthropics/skills` (172k★) | `.claude-plugin/marketplace.json` | `skills/` | **No `plugin.json` at all.** Claude Code marketplace format. |
| `addyosmani/agent-skills` (90k★) | `plugin.json` **and** `.claude-plugin/` | `skills/` | `plugin.json` is `{name, version, description}` — **no `$schema`**, which the 1.0.0 spec requires. |
| `K-Dense-AI/scientific-agent-skills` (36k★) | `plugin.json` | `skills/` | closest to spec |
| `openclaw/openclaw` (30k★) | none | `skills/` | bare skills directory, no plugin wrapper |

**Four findings that shape the parser:**

1. **`skills/<name>/SKILL.md` is the reliable invariant.** It held in every repo
   inspected. `plugin.json` did not.
2. **A missing or schema-less `plugin.json` is normal, not an error.** Rejecting on it
   would discard the two largest repos in the corpus. The parser records
   `manifest_kind: plugin_json | marketplace_json | bare` and carries on.
3. **`.claude-plugin/marketplace.json` is a third container format** that neither spec
   defines. It is a Claude Code convention. It must be parsed or `anthropics/skills` —
   the single most-starred skills repo — is invisible.
4. **Licence metadata is unreliable at the repo level.** GitHub's API reports
   `license: null` for `anthropics/skills`: there is no `LICENSE` file in the repo root.
   A strict "has an OSI licence" discovery filter therefore **excludes the canonical
   corpus**. Fits records `license` and `license_ok` per skill and lets the filter be
   configured; `engine/seeds.yaml` carries a hand-vetted allowlist for repos that fail
   the automatic check but are unambiguously public reference material. Nothing is
   silently included.

---

## 7. Where this disagrees with the build prompt

- **"Check first whether an official registry with an API exists."** Checked. It does
  not. GitHub-based discovery is the path, as the prompt's fallback assumed.
- **"Filters: has an OSI licence."** Applied literally, this drops `anthropics/skills`
  (172k★, no `LICENSE` file) and therefore most of the existing 20-skill corpus.
  Recorded as `license_ok: false` and overridable via `seeds.yaml` rather than enforced
  blindly. Flagged here because it changes what the corpus is.
- **The prompt does not mention `.claude-plugin/marketplace.json`.** It is real and it
  is load-bearing. Handled.
- **The prompt does not mention `when_to_use`.** It is part of the selection surface in
  the largest client and is measured as such.

---

## Sources

- https://agentskills.io/specification — fetched 2026-08-28
- https://agent-plugins.org/specification — fetched 2026-08-28
- https://agent-plugins.org/ — fetched 2026-08-28
- https://code.claude.com/docs/en/skills — fetched 2026-08-28
- GitHub REST API (`search/repositories`, `search/code`, `repos/*/contents`) — queried
  2026-08-28 as `nikjain15`
