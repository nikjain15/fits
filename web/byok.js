/**
 * Bring-your-own-key testing, in the browser.
 *
 * The published site is static, so there is no server here to hold a key and no
 * inference to run. This module lets a visitor supply their OWN OpenRouter key
 * and run a real test from the page — the engine is the same bundle the server
 * uses (web/engine.js), so a verdict reached here is reached by exactly the same
 * rules as every published number.
 *
 * WHAT HAPPENS TO THE KEY. It is held in this browser's localStorage and sent to
 * exactly one place: api.openrouter.ai, by this page, over HTTPS. It is never
 * sent to this project — there is no server here that could receive it — it is
 * never written to any file we publish, and it is never put in a URL, a log line
 * or an error message. "Forget it" clears it from storage immediately.
 *
 * WHY THESE RESULTS ARE NEVER PUBLISHED. Nobody but the visitor can verify a run
 * that happened in the visitor's browser: we cannot see the transcript, cannot
 * confirm the model was not substituted beyond what the response claims, and
 * cannot reproduce it. An unverifiable row inside a published rate is worth less
 * than no row at all, so these results are labelled `yours`, kept in this browser
 * and never folded into the corpus figures.
 */
import {
  buildSystemPrompt, buildTools, runAgent, grade, generate, parseSkill,
  rateOf, browserComplete,
} from './engine.js';

const KEY_STORE = 'fits.openrouter.key';

export const byok = {
  get key() { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } },
  set key(v) { try { v ? localStorage.setItem(KEY_STORE, v) : localStorage.removeItem(KEY_STORE); } catch { /* private window */ } },
  has() { return this.key.length > 20; },
  forget() { this.key = ''; },
};

/** Shape check only — no network call, so a typo is caught before any spend. */
export function keyLooksValid(k) {
  return /^sk-or-v1-[A-Za-z0-9]{40,80}$/.test(k.trim());
}

/** Confirms the key works and reports the remaining credit, so a run is never
 *  started against a balance that cannot cover it. */
export async function checkKey(k) {
  const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${k}` } });
  if (!r.ok) return { ok: false, reason: r.status === 401 ? 'OpenRouter rejected this key.' : `OpenRouter returned ${r.status}.` };
  const d = (await r.json()).data ?? {};
  return {
    ok: true,
    usage: Number(d.usage ?? 0),
    limit: d.limit == null ? null : Number(d.limit),
    remaining: d.limit_remaining == null ? null : Number(d.limit_remaining),
  };
}

// ---------------------------------------------------------------------------

async function fetchSkill(url) {
  const u = url.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!u.startsWith('github.com/')) throw new Error('Only github.com URLs are supported.');
  const parts = u.slice('github.com/'.length).split('/').filter(Boolean);
  if (parts.length < 3) throw new Error('Point at a skill directory, not the repository root.');
  const repo = `${parts[0]}/${parts[1]}`;
  const ix = parts.findIndex(p => p === 'tree' || p === 'blob');
  let path = ix >= 0 ? parts.slice(ix + 2).join('/') : parts.slice(2).join('/');
  if (!/SKILL\.md$/i.test(path)) path += '/SKILL.md';

  for (const ref of ['HEAD', 'main', 'master']) {
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`);
    if (r.ok) return { raw: await r.text(), repo, path };
  }
  throw new Error(`No SKILL.md found at ${repo}/${path}.`);
}

/**
 * A deliberately SMALL run: 3 cases x `trials`, per model.
 *
 * A published cell is 126 calls; this is a handful. That is a real difference in
 * evidence, not a shortcut to be hidden — the interval comes back wide and the
 * UI shows it, so a browser result can never be mistaken for a corpus rate.
 */
export async function runInBrowser({ url, models, trials = 2, onProgress }) {
  const key = byok.key;
  if (!key) throw new Error('No key set.');

  const say = (s) => onProgress?.(s);

  say({ phase: 'fetching', message: `fetching ${url}` });
  const { raw, repo, path } = await fetchSkill(url);
  const dirName = path.replace(/\/SKILL\.md$/i, '').split('/').pop();
  const parsed = parseSkill(raw, dirName);

  say({ phase: 'generating', message: `parsed "${parsed.name}" — ${parsed.body_chars.toLocaleString()} chars` });
  const gen = generate(`${repo.split('/')[0]}__${parsed.name || dirName}`, parsed, [
    'Merge these two PDFs into one file',
    'Send an email to the team with this week numbers',
    'Deploy the current branch to production',
  ]);
  if (!gen.ok) throw new Error(gen.reason);
  say({ phase: 'generated', message: gen.reason, cases: gen.cases, provenance: gen.provenance });

  const results = [];
  for (const m of models) {
    const per = { model: m.key, id: m.id, cls: m.cls, rows: [], cost: 0, state: 'running' };
    results.push(per);
    say({ phase: 'running', message: `running ${m.key}`, results });

    for (const c of gen.cases) {
      for (let t = 1; t <= trials; t++) {
        const tools = buildTools(c.fixtures);
        const { system } = buildSystemPrompt(
          { id: gen.cases[0].skillId, name: parsed.name, selection: parsed.selection, body: parsed.body },
          tools.map(x => ({ name: x.name, description: x.description, jsonSchema: x.jsonSchema })),
          null,
        );
        let cost = 0;
        try {
          const trace = await runAgent({
            goal: c.prompt, system, tools, maxSteps: 4,
            call: async (messages) => {
              const r = await browserComplete(key, m.id, {
                system, messages, maxTokens: 512,
                ...(m.sendTemperature === false ? {} : { temperature: 0 }),
                disableReasoning: Boolean(m.disableReasoning),
              });
              cost += r.cost_usd;
              return r.text;
            },
          });
          const g = grade(c, { ...trace, error: undefined });
          per.rows.push({ case: c.id, kind: c.kind, pass: g.passSubstance, strict: g.passStrict, bucket: g.bucket, detail: g.detail });
        } catch (e) {
          // A failure here is OURS or the provider's, never the model's verdict —
          // the same rule the engine applies. It is recorded as BORING and shown
          // as an alarm rather than counted as a skill failing.
          per.rows.push({ case: c.id, kind: c.kind, pass: false, strict: false, bucket: 'BORING', detail: String(e.message || e).slice(0, 160) });
        }
        per.cost += cost;
        say({ phase: 'running', message: `${m.key} · ${per.rows.length}/${gen.cases.length * trials}`, results });
      }
    }

    per.state = 'done';
    per.rate = rateOf(per.rows.map(r => ({ caseId: r.case, pass: r.pass })));
    per.strictRate = rateOf(per.rows.map(r => ({ caseId: r.case, pass: r.strict })));
    per.boring = per.rows.filter(r => r.bucket === 'BORING').length;
    say({ phase: 'running', message: `${m.key} done`, results });
  }

  say({ phase: 'done', message: 'done', results, cases: gen.cases, provenance: gen.provenance });
  return { results, cases: gen.cases, provenance: gen.provenance, skill: { repo, path, name: parsed.name, chars: parsed.body_chars } };
}
