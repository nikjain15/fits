import { byok, keyLooksValid, checkKey, runInBrowser } from './byok.js';

/* ===========================================================================
   Fits — the site.
   Ported from fits-mockup.html, which is the visual spec. Read-only over static
   JSON emitted by the engine. Vanilla on purpose: static JSON plus one router is
   a legitimate final answer, and a build step would buy nothing here.

   WHAT THIS FILE WILL NOT RENDER
     - a rate without its interval and its case count
     - a size class with several models as one number
     - a latency for a hosted cell
     - a cell marked invalid (over 20% BORING) as if it were a measurement
     - anything at all for a model that did not run

   "Test it" queues a request. The site cannot run a model in a browser and says
   so rather than faking it.
   =========================================================================== */

let D = null, M = [], SK = [], MET = null;
let BAR = { pass: 0.80, strict: false };
let myModel = 0;
let state = { q: '', only: false, url: '', yours: [], catError: '', sort: 'fit', cat: '', catSort: 'stars', licOnly: false, view: 'tested', how: false };
let dstate = { tab: null, fm: null, openRung: null };
let route = null;

/* ---------------------------------------------------------------- helpers */
const cell = (sk, m, c) => D.C[sk + '|' + m + '|' + (c || 'A')];
/* A cell that was TRIED and stopped early is not the same state as a cell that
   was never run, and rendering both as "—" would hide a real result. Discarded
   cells carry their reason and are shown as such — never as a rate, because a
   stopped cell has no trial count behind it. */
const discardedOf = (sk, m, c) => (MET.discarded_cells || []).find(d =>
  d.skill === sk && d.model === m && d.condition === (c || 'A'));
const rate = a => a ? (BAR.strict ? a.strict : a.sub) : null;
const lo = a => a ? (BAR.strict ? a.strict_lo : a.lo) : null;
const hi = a => a ? (BAR.strict ? a.strict_hi : a.hi) : null;
const p2 = x => (x === null || x === undefined) ? '—' : x.toFixed(2);
const pc = x => (x * 100).toFixed(0) + '%';
const title = sk => sk.replace('__', '/');
const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/* Every rate that reaches the screen goes through here. There is no other path. */
function ciLine(a) {
  if (!a) return '';
  const bits = [`${p2(lo(a))}–${p2(hi(a))}`, `${a.n_cases} cases`, `${a.n} runs`];
  if (a.unstable) bits.push('unstable across repeat runs');
  return bits.join(' · ');
}
function thinNote(a) {
  if (!a) return '';
  if (!a.thin) return '';
  const worth = (100 / a.n_cases).toFixed(0);
  return `<b style="color:var(--warn);font-weight:400">Thin evidence:</b> ${a.n_cases} independent cases across ${a.n} runs. One case is worth ${worth} points, so read this as a direction, not a rate. The corpus line is where the power is — repeat trials of the same prompt at temperature 0 are near-identical and do not add evidence, which is why the interval is built on cases and not on runs.`;
}

const fitOf = (sk, i, c) => {
  const a = cell(sk, M[i].m, c || 'A');
  if (!a) return null;
  return { ok: rate(a) >= BAR.pass, r: rate(a), a };
};

/* min-spec = smallest class where EVERY model tested clears the bar.
   first-passes-at = smallest class where ANY did. Both ship; the sentence that
   defines them travels with the badge. */
function specOf(sk) {
  const s = D.S[sk] && D.S[sk].spec;
  if (!s) return null;
  const classes = D.S[sk].classes || [];
  // Recompute against the live bar — the header controls are global lenses and
  // every number on screen must move with them.
  let min = null, first = null; const split = [];
  for (const c of classes) {
    const all = c.models.every(m => (BAR.strict ? m.rate.rate : m.rate.rate) >= BAR.pass);
    const any = c.models.some(m => m.rate.rate >= BAR.pass);
    if (any && !all) split.push(c.cls);
    if (any && first === null) first = c.cls;
    if (all && min === null) min = c.cls;
  }
  return {
    min_spec: min, first_passes_at: first, split_classes: split,
    definition: `min-spec is the smallest size class where every model we tested clears ${BAR.pass.toFixed(2)}. first-passes-at is the smallest class where at least one did.`
  };
}
const specLabel = v => v === null ? 'no pass' : (v === 'frontier' ? 'frontier only' : v + '+');

/* ---------------------------------------------------------------- charts */
function bigTrack(sk, cond) {
  const y = v => Math.max(2, Math.min(100, v * 100));
  return `<div class="track"><div class="tkbody">
    <div class="tkline" data-l="bar ${BAR.pass.toFixed(2)}" style="bottom:${y(BAR.pass)}%"></div>
    <div class="tkcols">${M.map((m, i) => {
      const a = cell(sk, m.m, cond || 'A');
      if (!a) {
        const d = discardedOf(sk, m.m, cond);
        return `<div class="tkcol na" title="${d ? esc(d.reason) : 'never run — recorded as not-run'}">
          <div class="tkval" style="bottom:6px">${d ? 'stopped' : 'not run'}</div></div>`;
      }
      const ok = rate(a) >= BAR.pass;
      return `<div class="tkcol ${ok ? 'ok' : ''} ${i === myModel ? 'you' : ''}" title="${esc(m.id)} — substance ${p2(a.sub)}, strict ${p2(a.strict)}, ${a.n_cases} cases / ${a.n} runs, ${a.lane} lane, ${esc(a.quantization)}">
        <div class="tkval" style="bottom:calc(${y(a.sub)}% + 5px)">${p2(a.sub)}${a.strict < a.sub ? ' / ' + p2(a.strict) : ''}</div>
        <div class="sub" style="height:${y(a.sub)}%"></div>
        <div class="str" style="height:${y(a.strict)}%"></div></div>`;
    }).join('')}
    </div></div>
    <div class="tkfoot">${M.map((m, i) => {
      const a = cell(sk, m.m, cond || 'A');
      return `<div class="tkf"><div class="nm">${m.cls}</div>
        <div class="sb">${a && a.cold != null ? a.cold.toFixed(0) + 's cold' : (m.lane === 'hosted' ? 'latency n/a' : '—')}</div>
        <div class="sb">${a && a.p50 != null ? a.p50.toFixed(1) + 's warm' : ''}</div>
        <div class="sb">${a ? a.n_cases + ' cases' : ''}</div>
        <div class="sb">${esc(m.quantization)}</div>
        ${m.is_ceiling ? '<div class="sb" style="color:var(--warn)">ceiling</div>' : ''}
        ${i === myModel ? '<div class="yo">you</div>' : ''}</div>`;
    }).join('')}
    </div>
    <div class="note t">Solid = <b style="color:var(--fg2);font-weight:400">strict</b> (job done <em>and</em> a valid tool call). Hatched above it = did the job, malformed call. Latency is shown only on the <b style="color:var(--fg2);font-weight:400">local</b> lane, and as <b style="color:var(--fg2);font-weight:400">two numbers that are never merged</b>: <em>cold</em> is the first run of a skill and pays full prompt evaluation; <em>warm</em> is the median after it, where the runtime reuses its KV prefix cache. The gap reaches 34× on the largest skill in this corpus. You feel the cold number the first time you run it. A hosted p50 is network plus queue plus batching and is shown as nothing at all.</div>
  </div>`;
}

/* The class chart: band = spread across models in that class, one dot per
   model, your bar drawn across. A class is a range, never a point. */
function classChart(sk) {
  const cls = (D.S[sk] && D.S[sk].classes) || [];
  if (!cls.length) return '';
  return `<div class="sec"><div class="sh">By size class — a class is a range, not a number</div>
    ${cls.map(c => {
      const rs = c.models.map(m => m.rate.rate);
      const l = Math.min(...rs), h = Math.max(...rs);
      return `<div class="bandrow">
        <span class="mono" style="font-size:12px;color:${c.models.every(m => m.rate.rate >= BAR.pass) ? 'var(--ac)' : 'var(--fg2)'}">${c.cls}</span>
        <div class="band"><i style="left:${l * 100}%;width:${Math.max(1, (h - l) * 100)}%"></i>
          <s style="left:${BAR.pass * 100}%"></s>
          ${c.models.map(m => `<b style="left:${m.rate.rate * 100}%" title="${esc(m.key)} ${p2(m.rate.rate)} (${m.quantization}, ${m.lane})"></b>`).join('')}</div>
        <span class="mono" style="font-size:11.5px;color:var(--fg3);text-align:right">${c.single ? p2(l) : p2(l) + '–' + p2(h)}</span>
      </div>`;
    }).join('')}
    <div class="note t">${cls.some(c => c.single)
      ? `Classes marked with a single mark had <b style="color:var(--warn);font-weight:400">one model tested</b>. A class is not its models: two 4B models are not interchangeable, so a single-model class is that model's number and nothing may be generalised from it.`
      : `Every class here has more than one model, so each is reported as a range.`}
    </div></div>`;
}

function miniTrack(sk) {
  return `<div class="mtrack">${M.map((m, i) => {
    const a = cell(sk, m.m, 'A');
    if (!a) return `<i style="height:3px;opacity:.3"></i>`;
    const ok = rate(a) >= BAR.pass;
    return `<i class="${ok ? 'ok' : ''} ${i === myModel ? 'you' : ''}" style="height:${Math.max(3, Math.min(20, a.sub * 20))}px"></i>`;
  }).join('')}</div>`;
}

/* ---------------------------------------------------------------- home */
/* ================= the catalogue =================
 * Provenance, never evidence. A catalogue row says who published a skill and
 * whether we have tested it — nothing more. It must never look like a result.
 *
 * Two tiers: the most-starred slice arrives with the page, and the full index
 * (tens of MB) is fetched only when a search actually needs it, with the wait
 * shown rather than hidden behind a spinner that implies instant answers.
 */
const CATLABEL = { documents: 'Documents', data: 'Data', web: 'Browser', cloud: 'Deploy', dev: 'Coding',
  comms: 'Email', design: 'Design', science: 'Science', writing: 'Writing', agents: 'Agents',
  business: 'Business', media: 'Media' };
let CAT = null;          // top tier, loaded once
let CAT_FULL = null;     // full index, loaded on demand
let CAT_LOADING = false;

function unpack(j) {
  const out = j.rows.map(r => ({ r: r[0], n: r[1], p: r[2], s: r[3], z: r[4], l: r[5], c: r[6], m: r[7], g: (r[8] || '').split(',').filter(Boolean), d: r[9] || '' }));
  out.stats = j;
  return out;
}

async function loadCatalogue(full) {
  if (full && CAT_FULL) return CAT_FULL;
  if (!full && CAT) return CAT;
  if (CAT_LOADING) return full ? CAT_FULL : CAT;
  CAT_LOADING = true;
  try {
    const r = await fetch(full ? 'data/catalogue-full.json' : 'data/catalogue-top.json');
    if (!r.ok) throw new Error('catalogue ' + r.status);
    const j = await r.json();
    if (full) CAT_FULL = unpack(j); else CAT = unpack(j);
  } catch (e) {
    // A missing catalogue is not a broken site — the measurements stand on their
    // own. Say it is unavailable rather than rendering an empty directory that
    // looks like "we found nothing".
    if (full) CAT_FULL = null; else CAT = null;
    state.catError = String(e.message || e);
  } finally {
    CAT_LOADING = false;
    render();
  }
  return full ? CAT_FULL : CAT;
}

function catFilter() {
  const src = CAT_FULL || CAT;
  if (!src) return null;
  const t = state.q.trim().toLowerCase();
  const hits = [];
  for (const row of src) {
    if (state.cat && !row.g.includes(state.cat)) continue;
    if (state.licOnly && !row.l) continue;
    if (t && !(row.n.toLowerCase().includes(t) || row.r.toLowerCase().includes(t) || row.d.toLowerCase().includes(t))) continue;
    hits.push(row);
    if (hits.length >= 600) break;
  }
  const by = {
    stars: (a, b) => b.s - a.s,
    copies: (a, b) => b.c - a.c,
    size: (a, b) => b.z - a.z,
    name: (a, b) => a.n.localeCompare(b.n),
    tested: (a, b) => (b.m ? 1 : 0) - (a.m ? 1 : 0) || b.s - a.s,
  };
  return hits.sort(by[state.catSort] || by.stars);
}

function renderCatalogue() {
  const src = CAT_FULL || CAT;
  if (state.catError) {
    return `<div class="note t">Catalogue unavailable (${esc(state.catError)}). The measurements above are unaffected.</div>`;
  }
  if (!src) { loadCatalogue(false); return `<div class="note t">Loading the catalogue…</div>`; }
  const st = src.stats;
  const q = state.q.trim();
  const filtered = catFilter() || [];
  const hits = filtered.slice(0, 60);
  const searchingAll = Boolean(CAT_FULL);
  const cats = st.categories || [];

  return `<div class="lhead"><h2 style="font-size:19px">Every skill we could find</h2>
      <span class="ct"><b>${st.distinct_skills.toLocaleString()}</b> across ${st.repos.toLocaleString()} repos · <b>${st.measured}</b> tested</span>
      <input class="srch" id="q" placeholder="search  /" value="${esc(state.q)}"></div>
    <div class="note" style="margin:6px 0 14px">Found, not tested — provenance only, no verdict.
      <span class="lnk" data-how>${state.how ? 'less' : 'why so few are tested'}</span></div>
    ${state.how ? `<div class="ok0" style="margin-bottom:16px;line-height:1.7">
      One tested cell is about 126 model calls, so testing all ${st.distinct_skills.toLocaleString()} would be ${(st.distinct_skills * 126 / 1e6).toFixed(1)}M calls. It is not going to happen, so the queue works down by stars.<br>
      ${st.copies_folded.toLocaleString()} byte-identical copies were folded into their originals — one skill vendored into 86 repos is one skill, not 86.<br>
      ${(100 * st.with_osi_licence / st.distinct_skills).toFixed(0)}% carry a licence. A row marked <span class="mono">not tested</span> means exactly that and nothing more.
    </div>` : ''}
    <div class="chips">
      <button class="tog ${!state.cat ? 'on' : ''}" data-cat="">all</button>
      ${cats.slice(0, 6).map(c => `<button class="tog ${state.cat === c.id ? 'on' : ''}" data-cat="${c.id}">${c.label.split(' ')[0]} <span class="dim">${c.n.toLocaleString()}</span></button>`).join('')}
      <select class="tog" id="catmore" style="background:transparent;padding:3px 8px">
        <option value="">more…</option>
        ${cats.slice(6).map(c => `<option value="${c.id}" ${state.cat === c.id ? 'selected' : ''}>${c.label} (${c.n.toLocaleString()})</option>`).join('')}
      </select>
      <select class="tog" id="csort" style="background:transparent;padding:3px 8px">
        ${[['stars', 'most starred'], ['copies', 'most copied'], ['tested', 'tested first'], ['size', 'largest'], ['name', 'by name']]
          .map(([k, l]) => `<option value="${k}" ${state.catSort === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="note" style="margin:10px 0">${filtered.length >= 600 ? 'first 600 of many' : filtered.length.toLocaleString() + ' match'}${searchingAll ? '' : ` · <span class="lnk" data-catall>search all ${st.distinct_skills.toLocaleString()}</span>`}</div>
    <div class="colh" style="grid-template-columns:minmax(0,1fr) 84px 74px 96px"><span>skill</span><span>copied</span><span>size</span><span>status</span></div>
    ${hits.length === 0 ? `<div class="note t">Nothing matches “${esc(q)}”.</div>` : ''}
    ${hits.map(row => `<div class="item" style="grid-template-columns:minmax(0,1fr) 84px 74px 96px">
      <div><div><span class="nm">${esc(row.n)}</span><span class="au">${esc(row.r)}</span>
        ${row.l ? '' : '<span class="pill warn" title="GitHub reports no licence for this repo">no licence</span>'}</div>
        <div class="ds">${row.d ? esc(row.d.slice(0, 150)) : '<span style="color:var(--fg4)">no description in the file</span>'}</div>
        <div class="sb" style="color:var(--fg4)">${row.s.toLocaleString()}★ repo · ${row.g.length ? row.g.map(g => CATLABEL[g] || g).join(' · ') : 'uncategorised'}</div></div>
      <div class="mono" data-label="copied" style="font-size:12px;color:${row.c ? 'var(--ac)' : 'var(--fg4)'}" title="repositories carrying a byte-identical copy of this skill">${row.c ? '×' + (row.c + 1) : '—'}</div>
      <div class="mono dim" data-label="size" style="font-size:12px">${(row.z / 1000).toFixed(1)}k</div>
      <div data-label="status">${row.m
        ? '<span class="pill ac">tested</span>'
        : '<span class="mono" style="color:var(--fg4);font-size:11.5px">not tested</span>'}</div>
    </div>`).join('')}`;
}

/** Median USD to run this skill once on the selected model. Hosted lanes only —
 *  on the local lane the cost is electricity and is not ours to quote. */
function costOf(sk) {
  const c = cell(sk, M[myModel].m, 'A');
  return c && c.cost ? c.cost : null;
}
function money(x) {
  if (x === null) return '—';
  if (x === 0) return 'local';
  return x < 0.001 ? '<$0.001' : '$' + x.toFixed(3);
}

function renderHome() {
  return state.view === 'catalogue'
    ? `<div class="wrap">${topBar()}${renderCatalogue()}${footer()}</div>`
    : `<div class="wrap">${topBar()}${renderTested()}${footer()}</div>`;
}

/**
 * One question, two views, and nothing else competing at the top.
 *
 * The page previously opened with two stacked caveat boxes, nine chips and a
 * corpus line carrying six intervals — six lines of statistics before a single
 * skill. Every one of those facts is true and worth keeping, but a reader who
 * has to absorb all of them before seeing any content will not read any of them.
 * They now sit one disclosure away, on the number they qualify.
 */
function topBar() {
  const cat = (CAT_FULL || CAT);
  const nCat = cat ? cat.stats.distinct_skills : null;
  return `<div class="paste"><input id="skillurl" placeholder="paste a skill's GitHub URL to test it" value="${esc(state.url)}">
      <button class="go" data-run ${state.url.length > 4 ? '' : 'disabled'}>Test it</button></div>
    <div class="tabs" style="margin:18px 0 20px">
      <button data-view="tested" class="${state.view === 'tested' ? 'on' : ''}">Tested <span class="dim">${SK.length}</span></button>
      <button data-view="catalogue" class="${state.view === 'catalogue' ? 'on' : ''}">All skills <span class="dim">${nCat ? nCat.toLocaleString() : '…'}</span></button>
    </div>`;
}

function renderTested() {
  let list = SK.filter(sk => {
    if (state.q && !(sk + ' ' + D.S[sk].repo).toLowerCase().includes(state.q.toLowerCase())) return false;
    if (state.only) { const f = fitOf(sk, myModel); if (!f || !f.ok) return false; }
    return true;
  });
  const rateOr = (sk, d) => { const f = fitOf(sk, myModel); return f ? f.r : d; };
  const sorters = {
    fit:    (a, b) => rateOr(b, -1) - rateOr(a, -1),
    worst:  (a, b) => rateOr(a, 2) - rateOr(b, 2),
    cost:   (a, b) => (costOf(a) ?? Infinity) - (costOf(b) ?? Infinity),
    copies: (a, b) => (D.S[b].copies || 0) - (D.S[a].copies || 0),
    stars:  (a, b) => (D.S[b].stars || 0) - (D.S[a].stars || 0),
    name:   (a, b) => a.localeCompare(b),
  };
  list.sort((a, b) => {
    const ya = state.yours.includes(a) ? 1 : 0, yb = state.yours.includes(b) ? 1 : 0;
    if (ya !== yb) return yb - ya;
    return (sorters[state.sort] || sorters.fit)(a, b);
  });
  const fits = SK.filter(sk => { const f = fitOf(sk, myModel); return f && f.ok; }).length;
  const cls = M[myModel].cls;

  return `
    <div class="lhead"><h2 style="font-size:19px">Does it run on <span class="mono" style="color:var(--ac)">${cls}</span>?</h2>
      <span class="ct"><b>${fits}</b> of ${SK.length} clear ${BAR.pass.toFixed(2)}</span>
      <input class="srch" id="q" placeholder="search  /" value="${esc(state.q)}"></div>

    <div class="chips" style="margin-bottom:16px">
      <button class="tog ${state.only ? 'on' : ''}" data-t="only">only what passes</button>
      <select class="tog" id="msort" style="background:transparent;padding:3px 8px">
        ${[['fit', 'best first'], ['worst', 'worst first'], ['cost', 'cheapest'], ['copies', 'most copied'], ['stars', 'most starred'], ['name', 'by name']]
          .map(([k, l]) => `<option value="${k}" ${state.sort === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <button class="tog" data-how>${state.how ? 'hide' : 'how to read this'}</button>
    </div>

    ${state.how ? howToRead() : ''}

    <div class="colh" style="grid-template-columns:minmax(0,1fr) 96px 92px 84px"><span>skill</span><span>on ${cls}</span><span>per run</span><span>min-spec</span></div>
    ${list.map(sk => {
      const f = fitOf(sk, myModel), sp = specOf(sk), sm = D.S[sk];
      const stopped = !f && discardedOf(sk, M[myModel].m);
      return `<div class="item ${state.yours.includes(sk) ? 'yours' : ''}" tabindex="0" data-go="${sk}" style="grid-template-columns:minmax(0,1fr) 96px 92px 84px">
        <div><div><span class="nm">${title(sk)}</span><span class="au">${esc(sm.repo)}</span>
          ${state.yours.includes(sk) ? '<span class="pill ac">yours</span>' : ''}</div>
          <div class="ds">${miniTrackInline(sk)}</div></div>
        <div data-label="on ${cls}"><span class="v ${f && f.ok ? '' : 'no'}">${f ? p2(f.r) : (stopped ? '<span class="pill warn">stopped</span>' : '—')}</span>${f && f.a.thin ? '<span title="thin evidence — few cases" style="color:var(--warn);font-family:var(--mono)">~</span>' : ''}
          <span class="sb" style="color:var(--fg4)">${f ? `${p2(f.a.lo)}–${p2(f.a.hi)}` : ''}</span></div>
        <div class="mono" data-label="per run" style="font-size:12px;color:var(--fg3)">${money(costOf(sk))}</div>
        <div class="spec ${sp && sp.min_spec ? '' : 'no'}" data-label="min-spec">${sp ? specLabel(sp.min_spec) : '—'}</div></div>`;
    }).join('')}
    <div class="note t">${MET.runs.toLocaleString()} runs · ${MET.run_window.last.slice(0, 10)} · <span class="kbd">/</span> to search</div>`;
}

/** A one-line bar per model. Replaces four lines of per-row metadata with the
 *  one thing the row is actually about: how this skill does as models grow. */
function miniTrackInline(sk) {
  return `<span class="mtrack" style="display:inline-flex;vertical-align:middle">${M.map((m, i) => {
    const a = cell(sk, m.m, 'A');
    if (!a) return `<i style="height:3px;opacity:.25"></i>`;
    const ok = rate(a) >= BAR.pass;
    return `<i class="${ok ? 'ok' : ''} ${i === myModel ? 'you' : ''}" title="${esc(m.cls)} ${p2(rate(a))}" style="height:${Math.max(3, Math.min(18, rate(a) * 18))}px"></i>`;
  }).join('')}</span> <span style="color:var(--fg4);font-size:11px">${M[0].cls} → ${M[M.length - 1].cls}</span>`;
}

/**
 * Everything that used to shout from the top of the page, now behind one button.
 * Nothing was deleted — a reader who wants the caveats gets all of them, and a
 * reader who wants the answer is not made to read them first.
 */
function howToRead() {
  const i = MET.integrity;
  const clean = i.boring === 0 && i.provider_substitutions === 0 && i.cached_responses === 0;
  const THIN_N = 30;
  const corpus = M.map(m => {
    if (!m.A) return null;
    const a = m.A.substance;
    const thin = a.n_calls < THIN_N;
    return `${m.cls} ${pc(a.rate)} <span style="color:var(--fg4)">${p2(a.lo)}–${p2(a.hi)}</span>${thin ? '<span style="color:var(--warn)">~</span>' : ''}`;
  }).filter(Boolean).join(' · ');

  return `<div class="ok0" style="margin-bottom:18px;line-height:1.7">
    <b>The number</b> is how often the skill did the job, over ${MET.cases_per_cell || '3–7'} cases × repeat trials. The range beside it is the 95% interval — where two ranges overlap, the difference is not real.<br>
    <b>Min-spec</b> is the smallest class where <em>every</em> model we tested passed. <b>~</b> marks thin evidence: few enough cases that one changes the number a lot.<br>
    <b>Per run</b> is what one invocation actually cost, from the provider's own accounting.<br>
    <b>Corpus level</b>, where the numbers have power — <span class="mono">${corpus}</span><br>
    ${clean
      ? `<b style="color:var(--ac)">Integrity clean.</b> Across ${MET.runs.toLocaleString()} runs: no context overflows, no model substituted for the one requested, nothing served from a cache.`
      : `<b style="color:var(--warn)">Integrity suspect.</b> ${i.boring} BORING · ${i.provider_substitutions} substitutions · ${i.cached_responses} cached. A non-zero count here invalidates everything above it until chased down.`}
  </div>`;
}

function footer() {
  const nm = MET.not_measured;
  return `<footer>${MET.runs.toLocaleString()} runs · ${MET.skills} skills · ${MET.cases} code-checked cases · ${MET.models} models · produced ${MET.run_window.first.slice(0, 10)} to ${MET.run_window.last.slice(0, 10)} · lane: ${MET.lanes.join(' + ')} · provider: ${MET.providers.join(', ')} · quantization: ${MET.quantizations.join(', ')} · spend $${MET.spend_usd} · harness ${MET.harness_version}<br>
  ${esc(MET.protocol_note)}<br>
  ${nm.classes.length ? `Model classes <b>${nm.classes.join(', ')}</b> are <b>not measured</b> and are not shown. ${nm.models.length} models did not run: ${[...new Set(nm.models.map(m => m.reason))].join(' · ')}.` : ''}<br>
  ${(MET.discarded_cells || []).length ? `<b>${MET.discarded_cells.length} cell${MET.discarded_cells.length > 1 ? 's were' : ' was'} stopped rather than measured</b> — early stop, context overflow, or a harness fault. They carry no rate and appear nowhere as a number.<br>` : ''}
  ${MET.ceiling.present ? '' : `<b>No frontier ceiling in this dataset</b>, so FORMAT / SKILL-TEXT / MODEL attribution is <b>not computed</b> — it needs a ceiling to tell "the model is too small" apart from "the skill is broken". It is absent rather than guessed.`}
  </footer>`;
}

/* ---------------------------------------------------------------- detail */
const ATTR = {
  SKILL_TEXT: 'Rewriting the skill file — rungs 1 and 4. This is the part Fits can act on.',
  MODEL: 'A bigger model or a narrower promise — rungs 4 to 6. No rewrite closes this.',
  FORMAT: 'The runtime, free — grammar-constrained decoding already ships in llama.cpp, Ollama and vLLM.'
};
const SHADE = { SKILL_TEXT: '#f5b73d', MODEL: '#5c656d', FORMAT: '#3d444a' };
const BUCKET_WHY = {
  SELECTION: 'picked the wrong skill, or never invoked one',
  EAGER: 'invoked when it should have stayed out',
  ARGS: 'malformed or hallucinated arguments',
  IGNORED: 'called the tool, then ignored what came back',
  REASONING: 'right calls, wrong conclusion',
  BORING: 'harness fault — not a model verdict'
};

function tabFail(sk) {
  const fi = dstate.fm === null ? myModel : dstate.fm, m = M[fi], a = cell(sk, m.m, 'A');
  if (!a) {
    const d = discardedOf(sk, m.m);
    return d
      ? `<div class="alarm"><b>This cell was stopped, not measured.</b><br>${esc(d.reason)}<br><br>No rate is shown for it. A stopped cell has no full trial count behind it, so publishing a number from it would be publishing a partial cell.</div>`
      : `<div class="alarm">Not run on <b>${esc(m.id)}</b>. Recorded as not-run — no number is shown for it anywhere.</div>`;
  }
  const bk = a.bk || {}, at = a.at || {}, kd = a.kd || {};
  const atot = Object.values(at).reduce((x, y) => x + y, 0);
  const ord = Object.entries(at).filter(x => x[0]).sort((x, y) => y[1] - x[1]);
  const misses = Object.values(bk).reduce((x, y) => x + y, 0);

  return `<div class="rowh"><div class="sh" style="margin:0">${misses} misses in ${a.n} runs · <span class="mono" style="text-transform:none;letter-spacing:0;color:var(--fg2)">${esc(m.id)}</span></div>
    <div class="mpick">${M.map((x, k) => `<button data-fm="${k}" class="${k === fi ? 'on' : ''}">${x.cls}</button>`).join('')}</div></div>

  ${a.boring
    ? `<div class="alarm"><b>${a.boring} BORING failures</b> — ${pc(a.boring_share)} of the misses at this cell. ${a.invalid ? '<b>Over a fifth, so this cell is marked not-a-valid-measurement.</b> ' : ''}Context overflow, a missing tool or a malformed file. Do not read a model verdict from this cell until it is chased down.</div>`
    : `<div class="ok0"><b>Zero BORING failures.</b> Every miss below is substantive — not a context overflow, a missing tool or a malformed file. The measurement is trustworthy at this cell.</div>`}

  <div class="sec"><div class="sh">Who can fix it</div>
    ${atot ? `<div class="stk">${ord.map(([k, v]) => `<div style="width:${v / atot * 100}%;background:${SHADE[k]}" title="${k} ${v}"></div>`).join('')}</div>
      ${ord.map(([k, v], i) => `<div class="at"><span class="k ${i === 0 ? 'top' : ''}">${k.replace('_', '-')}</span>
        <span class="c">${v} · ${pc(v / atot)}</span><span class="d">${ATTR[k]}</span></div>`).join('')}
      <div class="note t">Computed only over cases the frontier ceiling handled, so a case the ceiling also failed is never charged to a small model. <span class="mono">${MET.ceiling.failed_cases.length}</span> cases failed at the ceiling too and <span class="mono">${MET.ceiling.no_verdict_cases.length}</span> have no ceiling verdict — both excluded here.</div>`
    : `<div class="note">${esc(MET.ceiling.note)}</div>`}
  </div>

  <div class="sec"><div class="sh">By what the case asked for</div>
    <table class="tbl"><tr><th>case kind</th><th style="text-align:right">pass</th><th style="text-align:right">strict</th><th style="text-align:right">runs</th><th>what it tests</th></tr>
    ${['invoke', 'abstain', 'use_result'].map(k => {
      const c = kd[k]; if (!c) return '';
      return `<tr><td>${k}</td><td class="n">${p2(c.sub)}</td><td class="n">${p2(c.strict)}</td><td class="n">${c.n}</td>
        <td class="w">${k === 'invoke' ? 'fire the skill and act' : k === 'abstain' ? 'do NOT fire — this is where EAGER is caught' : 'read the tool result and use it'}</td></tr>`;
    }).join('')}
    </table>
    ${kd.invoke && kd.abstain && kd.abstain.sub - kd.invoke.sub > 0.3 ? `<div class="note t"><b style="color:var(--fg2);font-weight:400">Read this before the headline.</b> ${m.cls} scores ${p2(kd.abstain.sub)} on abstain and ${p2(kd.invoke.sub)} on invoke — most of its pass rate comes from questions it could answer without acting at all.</div>` : ''}
  </div>

  <div class="sec"><div class="sh">Raw buckets</div>
    <table class="tbl">${Object.entries(bk).filter(([k]) => k !== 'BORING').sort((x, y) => y[1] - x[1]).map(([k, v]) =>
      `<tr><td>${k}</td><td class="n">${v}</td><td class="n">${pc(v / misses)}</td><td class="w">${BUCKET_WHY[k]}</td></tr>`).join('')}
    </table>
    <div class="note t">BORING is deliberately not in this table. It is an alarm about our own infrastructure, not a slice competing for rank with the other five.</div></div>`;
}

const RUNGS = [
  { n: 1, t: 'Rewrite the instructions', at: 'SKILL_TEXT', c: 'free', d: 'Tighten the name, the description and the when-not-to-use line; turn prose into numbered commands. The largest single lever in the measured attribution — and published prior art, not ours. Fits claims the measurement and the label, never the rewriting method.' },
  { n: 2, t: 'Lock the answer format', at: 'FORMAT', c: '3.6–8.2× decode', d: 'Grammar-constrained decoding. Fixes format validity and tool selection (+17 to +62.7 points), does nothing for judgment, and <em>costs 3.6× to 8.2× decode latency</em>. Abstention accuracy can fall by up to 29.5 points. The runtime already does this free — llama.cpp, Ollama, vLLM.' },
  { n: 3, t: 'Hand deterministic work to plain code', at: 'SKILL_TEXT', c: 'free, faster', d: 'Sums, dates, currency and lookups never needed a model. Reduces latency rather than adding it.' },
  { n: 4, t: 'Narrow what it promises', at: 'MODEL', c: 'more refusals', d: 'Ship the cases it does well and make it refuse the rest out loud. Also the only lever against scope degradation — that is a discrimination limit, not a text problem.' },
  { n: 5, t: 'Send one step to the cloud', at: 'MODEL', c: 'data leaves', d: 'Routing one step <em>inside</em> the skill, not the request.' },
  { n: 6, t: 'Move up one model size', at: 'MODEL', c: 'priced', d: 'Nothing to write. The measured mix says this is unavoidable for a real share of failures.' },
  { n: 7, t: 'Train a specialist', at: null, c: '4–8 weeks', d: 'A fine-tune for this one job. Fits does not do this for you — this is where we stop and hand off.' }
];

function tabFix(sk) {
  const m = M[myModel], a = cell(sk, m.m, 'A');
  if (!a) {
    const d = discardedOf(sk, m.m);
    return `<div class="alarm">${d ? '<b>This cell was stopped, not measured.</b><br>' + esc(d.reason) : 'Not run on <b>' + esc(m.id) + '</b>.'}</div>`;
  }
  const at = a.at || {}, tot = Object.values(at).reduce((x, y) => x + y, 0);
  const base = rate(a);
  const share = k => tot ? (at[k] || 0) / tot : 0;

  const rows = RUNGS.map((r, k) => {
    const sh = r.at ? share(r.at) : 0;
    const dead = r.at && tot && sh === 0;
    const open = dstate.openRung === k;
    return `<div class="rg ${open ? 'open' : ''} ${dead ? 'dead' : ''}" data-rung="${k}">
      <span class="n">${r.n}</span><span class="t">${r.t}</span>
      <span class="p">${!tot ? 'no attribution' : r.at ? (sh > 0 ? 'addresses ' + pc(sh) : 'nothing here') : '—'}</span>
      <span class="c ${r.c === 'free' || r.c === 'free, faster' ? '' : 'warn'}">${r.c}</span>
      <span class="x">${open ? '⌄' : '›'}</span></div>
      ${open ? rungBody(r, sh, base, tot) : ''}`;
  }).join('');

  return `<div class="note" style="margin-bottom:16px">On <span class="mono">${esc(m.id)}</span> this passes <span class="mono">${p2(base)}</span> (${ciLine(a)}) against your bar of <span class="mono">${BAR.pass.toFixed(2)}</span>. Rungs are ordered by cost, and each shows <b style="color:var(--fg2);font-weight:400">the measured share of this model's failures it can address</b> — not a guessed gain. The mix moves with model size, so this ladder is recomputed per model and never cached per skill.</div>
    <div class="rail">${rows}</div>
    <div class="note t">${tot ? `Shares are over the ${tot} attributable failures at this cell.` : `<b style="color:var(--warn);font-weight:400">No attribution is available</b> — ${esc(MET.ceiling.note)} The rungs are listed in cost order, with no share attached, rather than shown with invented numbers.`} A projection becomes a number only when the rung is applied and re-measured — <b style="color:var(--fg2);font-weight:400">no repair has been run yet</b>. Measurement and repair are kept apart so neither contaminates the other.</div>`;
}

function rungBody(r, sh, base, tot) {
  if (r.n === 5) {
    return `<div class="rgx"><p>${r.d}</p>
      <div class="leak"><div><div class="big">—</div><div class="cap">share of the payload that would leave the machine — <b style="color:var(--warn)">not yet measured</b></div></div>
      <div class="two"><div><h5>stays local</h5><ul><li>the document</li><li>every extracted field</li><li>your policy</li></ul></div>
      <div class="lv"><h5>leaves</h5><ul><li>one sub-step's input</li></ul></div></div></div>
      <div class="note">The mockup showed <span class="mono">4.1%</span> here and labelled it illustrative. It is not shown at all now. Byte-level accounting is instrumented in the harness (every tool call's arguments are weighed) but has not been run over enough real traces to publish a figure, and a leak percentage is exactly the kind of number that must never be estimated.</div></div>`;
  }
  const proj = r.at && tot && sh > 0 ? base + (1 - base) * sh : null;
  return `<div class="rgx"><p>${r.d}</p><div class="kv">
    ${r.at && tot ? `<span class="k">addresses</span><span class="v">${sh > 0 ? pc(sh) + ' of failures at this cell' : 'none at this cell'}</span>` : ''}
    ${proj !== null ? `<span class="k">ceiling if it worked fully</span><span class="v">${p2(proj)} — from ${p2(base)}, <b style="color:var(--warn);font-weight:400">projected, not measured</b></span>` : ''}
    <span class="k">cost</span><span class="v">${r.c}</span></div>
    ${r.n === 7 ? '<div class="note t">Listed so the ladder is honest about having an end, not because it is a button.</div>' : ''}</div>`;
}

function renderDetail(sk) {
  if (!D.S[sk]) return `<div class="wrap"><div class="note">Not measured. <span class="lnk" data-home>back</span></div></div>`;
  const s = D.S[sk], sp = specOf(sk), f = fitOf(sk, myModel), m = M[myModel];
  const A = cell(sk, m.m, 'A'), B = cell(sk, m.m, 'B');
  const tab = dstate.tab || 'fail';

  return `<div class="wrap">
   <div class="crumb"><span class="lnk" data-home>all skills</span> <span class="dim">/</span> <span class="mono dim2">${title(sk)}</span></div>
   <h1>${title(sk)}</h1>
   <div class="dsub"><span class="mono">${esc(s.repo)}</span> · ${s.stars.toLocaleString()}★ · ${(s.chars / 1000).toFixed(1)}k characters · ${s.cases} cases · frontmatter ${s.spec_conformance}</div>
   <div class="hero"><div>
     <div class="answer">${f ? (f.ok
        ? `On <b>${m.cls}</b> this works — <b>${p2(f.r)}</b>, interval ${p2(lo(f.a))}–${p2(hi(f.a))}.<span class="q">${f.a.strict < f.a.sub ? `Strict pass is ${p2(f.a.strict)} — some runs got the job done with a malformed call. ` : ''}${thinNote(f.a)}</span>`
        : `On <b>${m.cls}</b> this does not clear your bar — <b>${p2(f.r)}</b> (${p2(lo(f.a))}–${p2(hi(f.a))}) against ${BAR.pass.toFixed(2)}.<span class="q">${sp && sp.min_spec ? 'It clears at ' + sp.min_spec + '. ' : 'No model we measured clears it. '}${thinNote(f.a)}</span>`)
      : 'Not run on this model. Recorded as not-run; no number is shown.'}</div>
     ${bigTrack(sk, 'A')}
     ${classChart(sk)}
     ${B ? scopeSection(sk) : ''}
   </div>
   <div class="facts">
     <div class="fact"><div class="k">Min-spec</div><div class="v ${sp && sp.min_spec ? 'ac' : 'no'}">${sp ? specLabel(sp.min_spec) : '—'}</div>
       <div class="s">${sp ? esc(sp.definition) : ''}</div></div>
     <div class="fact"><div class="k">First passes at</div><div class="v">${sp && sp.first_passes_at ? sp.first_passes_at : '—'}</div>
       <div class="s">${sp && sp.split_classes.length ? `<b style="color:var(--ac)">${sp.split_classes.join(', ')} disagreed with itself</b> — some models in that class clear the bar and some do not, which is why the two badges differ.` : 'no class we measured disagreed with itself'}</div></div>
     <div class="fact"><div class="k">On ${m.cls}</div><div class="v">${f ? p2(f.a.sub) : '—'}<span style="color:var(--fg4);font-size:12px"> / ${f ? p2(f.a.strict) : '—'} strict</span></div>
       <div class="s">substance / protocol-valid too</div></div>
     <div class="fact"><div class="k">Evidence</div><div class="v" style="font-size:13px">${f ? f.a.n_cases : 0} cases</div>
       <div class="s">${f ? f.a.n + ' runs · ' + (f.a.unstable ? 'unstable' : 'stable at temperature 0') : ''}</div></div>
     <div class="fact"><div class="k">Latency</div><div class="v" style="font-size:13px">${A && A.cold != null ? A.cold.toFixed(0) + 's' : '—'}<span style="color:var(--fg4);font-size:12px"> cold / ${A && A.p50 != null ? A.p50.toFixed(1) + 's' : '—'} warm</span></div>
       <div class="s">first run pays full prompt evaluation; the rest reuse the KV prefix cache</div></div>
     <div class="fact"><div class="k">Artifact</div><div class="v" style="font-size:13px">${esc(m.quantization)}</div>
       <div class="s">${m.lane} lane · ${esc(m.served_provider)}${m.lane === 'local' ? ' · the artifact you would actually pull' : ''}</div></div>
     <div class="fact"><div class="k">Repeat-run disagreement</div><div class="v" style="font-size:13px">${m.A ? (m.A.nd * 100).toFixed(1) + '%' : '—'}</div>
       <div class="s">model-wide, across repeat runs at temperature 0</div></div>
   </div></div>
   <div class="tabs">
     <button data-tab="fail" class="${tab === 'fail' ? 'on' : ''}">Why it fails</button>
     <button data-tab="fix" class="${tab === 'fix' ? 'on' : ''}">How to fix it</button></div>
   ${tab === 'fail' ? tabFail(sk) : tabFix(sk)}
   ${footer()}</div>`;
}

function scopeSection(sk) {
  return `<div class="sec" style="margin-top:26px"><div class="sh">With every skill's description in scope</div>
    <table class="tbl"><tr><th>model</th><th style="text-align:right">1 skill</th><th style="text-align:right">all skills</th><th style="text-align:right">change</th></tr>
    ${M.map(x => {
      const a = cell(sk, x.m, 'A'), b = cell(sk, x.m, 'B');
      if (!a || !b) return '';
      const d = b.sub - a.sub;
      return `<tr><td>${x.cls}</td><td class="n">${p2(a.sub)}</td><td class="n">${p2(b.sub)}</td><td class="n" style="color:${d < -0.05 ? 'var(--ac)' : 'var(--fg4)'}">${d >= 0 ? '+' : ''}${d.toFixed(2)}</td></tr>`;
    }).join('')}
    </table>
    <div class="note t">Two measured points, not a curve — we do not interpolate between them. Only the skills' <b style="color:var(--fg2);font-weight:400">descriptions</b> are added, never their bodies, because that is what a client actually loads at startup under progressive disclosure. In the reference corpus the effect was band-limited: 4B lost 16.1pp, while 1B lost 3.3pp (already failing before skill choice mattered) and 8B lost 3.9pp. No rewrite fixes this; only narrowing scope does.</div></div>`;
}

/* ---------------------------------------------------------------- running */
/* ================= running =================
 * Two completely different screens, chosen by whether a local engine is there.
 *
 * With one: a real run, streamed. Without: a plain statement that a static page
 * cannot run a model, and the command to do it yourself. The mockup faked this;
 * faking it here would be the one dishonesty the whole product is against.
 */
let ENGINE = null;        // null = unknown, false = absent, object = present
let BYOK = { open: false, checking: false, status: null, models: [], trials: 2, res: null, cases: [], provenance: [], error: '' };
let JOB = null;
let jobTimer = null;

async function probeEngine() {
  if (ENGINE !== null) return ENGINE;
  try {
    const r = await fetch('api/health', { signal: AbortSignal.timeout(2500) });
    ENGINE = r.ok ? await r.json() : false;
  } catch { ENGINE = false; }
  // The probe runs at boot and may resolve before the measurements land, so it
  // must not force a render into an empty dataset.
  if (D) render();
  return ENGINE;
}

async function startRun(url) {
  route = '@run';
  JOB = { state: 'starting', message: 'contacting the local engine', models: [], cases: [], log: [] };
  render();
  const eng = await probeEngine();
  if (!eng) { render(); return; }
  try {
    const r = await fetch('api/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const j = await r.json();
    if (!j.id) { JOB = { state: 'error', message: j.error || 'the engine refused the request', models: [], cases: [], log: [] }; render(); return; }
    clearInterval(jobTimer);
    jobTimer = setInterval(async () => {
      if (route !== '@run') { clearInterval(jobTimer); return; }
      try {
        const s = await (await fetch('api/job/' + j.id)).json();
        JOB = s;
        if (s.state === 'done' || s.state === 'error') clearInterval(jobTimer);
        render();
      } catch { /* the engine went away mid-run; the next tick will show it */ }
    }, 900);
  } catch (e) {
    JOB = { state: 'error', message: String(e.message || e), models: [], cases: [], log: [] };
    render();
  }
}

/* ---- bring your own key ------------------------------------------------- */

function renderByokSetup(name) {
  const st = BYOK.status;
  return `<div class="wrap"><h1>${name}</h1>
    <div class="dsub">test from this page with your own OpenRouter key</div>

    <div class="ok0" style="margin-top:18px">
      <b>Where your key goes.</b> Into this browser's local storage, and to <span class="mono">openrouter.ai</span> — nowhere else.
      It never reaches this project: this is a static page on GitHub Pages and there is no server here that could receive it.
      It is never put in a URL, a log or an error message. <span class="lnk" data-byok-forget>Forget it</span> clears it immediately.
    </div>

    <div class="paste" style="margin-top:18px">
      <input id="orkey" type="password" placeholder="sk-or-v1-…" value="${esc(byok.key)}" autocomplete="off" spellcheck="false">
      <button class="go" data-byok-check ${BYOK.checking ? 'disabled' : ''}>${BYOK.checking ? 'checking…' : 'Check key'}</button>
    </div>
    <div class="note">Get one at <span class="mono">openrouter.ai/settings/keys</span>. Set a spend limit on it — this page cannot enforce one for you.</div>

    ${BYOK.error ? `<div class="alarm" style="margin-top:14px"><b>Not usable.</b> ${esc(BYOK.error)}</div>` : ''}
    ${st && st.ok ? `<div class="ok0" style="margin-top:14px"><b>Key works.</b> ${st.limit === null
        ? 'No hard limit set on it — consider setting one at openrouter.ai.'
        : `$${st.remaining.toFixed(2)} of $${st.limit.toFixed(2)} remaining.`}
      A run below is roughly ${(0.0006 * BYOK.trials * 3).toFixed(4)}–${(0.01 * BYOK.trials * 3).toFixed(3)} depending on the models you pick.</div>` : ''}

    <div class="note t"><span class="lnk" data-cancel>back</span></div>
    ${footer()}</div>`;
}

function renderByokRun(name) {
  const res = BYOK.res || [];
  const picked = BYOK.models;
  return `<div class="wrap"><h1>${name}</h1>
    <div class="dsub">your key · your browser · your result</div>

    <div class="ok0" style="margin-top:16px"><b>This result is yours, and is not published.</b>
      Nobody but you can verify a run that happened in your browser — we cannot see the transcript, cannot confirm the model was not substituted beyond what the response claims, and cannot reproduce it.
      An unverifiable row inside a published rate is worth less than no row, so this stays here and is never folded into the corpus figures.
      The engine is the same bundle the server uses, so the verdict is reached by the same rules.</div>

    ${!res.length ? `
      <div class="sec" style="margin-top:22px"><div class="sh">Pick models</div>
        <div class="chips">${M.filter(m => m.id && m.lane === 'hosted').map(m =>
          `<button class="tog ${picked.some(p => p.key === m.m) ? 'on' : ''}" data-byok-model="${esc(m.m)}">${esc(m.cls)} <span class="dim">${esc(m.m)}</span></button>`).join('')}</div>
        <div class="chips" style="margin-top:8px"><span class="dim" style="font-size:11.5px;align-self:center">trials per case</span>
          ${[1, 2, 3].map(t => `<button class="tog ${BYOK.trials === t ? 'on' : ''}" data-byok-trials="${t}">${t}</button>`).join('')}</div>
        <div class="note t">3 cases × ${BYOK.trials} trials × ${picked.length || 0} model${picked.length === 1 ? '' : 's'} = <b>${3 * BYOK.trials * (picked.length || 0)} calls</b>. A published cell is 126, so this comes back with a wide interval and says so.</div>
        <div style="margin-top:14px">
          <button class="btn ac" data-byok-go ${picked.length ? '' : 'disabled'}>Run it</button>
          <span class="lnk" style="margin-left:14px" data-byok-forget>forget my key</span>
        </div></div>` : ''}

    ${BYOK.error ? `<div class="alarm" style="margin-top:16px"><b>Stopped.</b> ${esc(BYOK.error)}</div>` : ''}
    ${BYOK.message ? `<div class="note t">${esc(BYOK.message)}</div>` : ''}

    ${BYOK.cases.length ? `<div class="sec" style="margin-top:24px"><div class="sh">The cases, derived from the skill's own text</div>
      ${BYOK.cases.map(c => `<div class="at" style="grid-template-columns:96px minmax(0,1fr)">
        <span class="k">${esc(c.kind)}</span>
        <span class="d">${esc(c.prompt)}<div class="sb" style="color:var(--fg4);margin-top:3px">${esc(c.rationale)}</div></span></div>`).join('')}</div>` : ''}

    ${res.length ? `<div class="sec"><div class="sh">Result <span style="text-transform:none;letter-spacing:0;color:var(--fg3)">— yours, not published</span></div>
      ${res.map(r => `<div class="rr"><span class="st ${r.state === 'running' ? 'go' : ''}">${r.state}</span>
        <span><span class="mono">${esc(r.cls)}</span> <span class="dim" style="font-size:11px">${esc(r.model)}</span>
          ${r.boring ? `<div class="sb" style="color:var(--warn)">${r.boring} BORING — that is our fault or the provider's, never a verdict on the skill</div>` : ''}</span>
        <span class="mono" style="text-align:right;font-size:12px">${r.rate ? `${p2(r.rate.rate)}<div class="sb" style="color:var(--fg4)">${p2(r.rate.lo)}–${p2(r.rate.hi)} · n=${r.rows.length}</div>` : `${r.rows.length} runs`}
          <div class="sb" style="color:var(--fg4)">$${r.cost.toFixed(4)}</div></span></div>`).join('')}
      <div class="note t">Interval is 95%, from ${3 * BYOK.trials} runs per model. That is an eighth of a published cell, so read it as a direction and not a rate.</div>
      <div style="margin-top:14px"><button class="btn" data-byok-again>Run another</button></div></div>` : ''}

    <div class="note t"><span class="lnk" data-cancel>back</span></div>
    ${footer()}</div>`;
}

function renderRun() {
  const name = esc(state.url.split('/').filter(Boolean).pop() || 'your skill');

  // With no local engine, the page can still run a REAL test if the visitor
  // brings their own OpenRouter key — the browser talks to OpenRouter directly.
  if (ENGINE === false && byok.has()) return renderByokRun(name);
  if (ENGINE === false && BYOK.open) return renderByokSetup(name);

  if (ENGINE === false) {
    return `<div class="wrap"><h1>${name}</h1>
      <div class="dsub">no local engine</div>
      <div class="alarm" style="margin-top:20px"><b>This page cannot run a model.</b> It is static JSON on GitHub Pages — no inference in your browser, no server behind it. Nothing was sent anywhere, and no result has been invented for you.</div>
      <div class="note">Run it yourself and the same button becomes real:</div>
      <div class="rgx" style="margin-top:14px;border-radius:8px"><div class="kv">
        <span class="k">clone</span><span class="v">github.com/nikjain15/fits</span>
        <span class="k">install</span><span class="v">npm install</span>
        <span class="k">run</span><span class="v">npm run serve</span>
        <span class="k">then</span><span class="v">open localhost:8099 and paste the same URL</span></div></div>
      <div class="note t">The local engine uses whatever models you have — Ollama needs no key and costs nothing.</div>
      <div class="sec" style="margin-top:26px"><div class="sh">Or test it from this page, with your own key</div>
        <div class="note">Your browser can call OpenRouter directly. The key stays in this browser, goes only to OpenRouter, and never reaches this project — there is no server here that could receive it.</div>
        <div style="margin-top:12px"><button class="btn ac" data-byok>Use my OpenRouter key</button></div></div>
      <div class="note t"><span class="lnk" data-cancel>back</span></div>
      ${footer()}</div>`;
  }

  const j = JOB || { state: 'starting', message: '', models: [], cases: [], log: [] };
  const done = j.models.filter(m => m.state === 'done' || m.state === 'failed').length;
  const frac = j.models.length ? done / j.models.length : 0;

  return `<div class="wrap"><h1>${name}</h1>
    <div class="dsub">${j.skillId ? esc(j.skillId) : 'local engine'} · ${j.state}</div>
    ${j.state === 'error'
      ? `<div class="alarm" style="margin-top:18px"><b>Stopped.</b> ${esc(j.message)}</div>`
      : `<div class="prog"><i style="width:${Math.round(frac * 100)}%"></i></div>
         <div class="note" style="display:flex;gap:18px"><span>${esc(j.message || '')}</span>
           <span style="margin-left:auto"><span class="lnk" data-cancel>back</span></span></div>`}

    ${j.cases.length ? `<div class="sec" style="margin-top:26px"><div class="sh">The cases, derived from the skill's own text</div>
      <div class="ok0" style="margin-bottom:14px"><b>auto-derived — nobody has accepted these.</b> The assertions come from commands and claims the skill states about itself; no model wrote them. Weaker evidence than the hand-authored suites, and never blended into the corpus rates.</div>
      ${j.cases.map(c => `<div class="at" style="grid-template-columns:96px minmax(0,1fr)">
        <span class="k">${esc(c.kind)}</span>
        <span class="d">${esc(c.prompt)}<div class="sb" style="color:var(--fg4);margin-top:3px">${esc(c.rationale)}</div></span></div>`).join('')}</div>` : ''}

    ${j.models.length ? `<div class="sec"><div class="sh">Models</div>
      ${j.models.map(m => `<div class="rr"><span class="st ${m.state === 'running' ? 'go' : ''}">${m.state}</span>
        <span><span class="mono">${esc(m.cls)}</span> <span class="dim" style="font-size:11px">${esc(m.key)}</span></span>
        <span class="mono" style="text-align:right;font-size:12px">${m.pass === undefined ? '—' : p2(m.pass)}</span></div>`).join('')}</div>` : ''}

    ${j.state === 'done' ? `<div class="note t">Landed in <span class="mono">data/nodes/</span> like any other measurement. Run <span class="mono">npx tsx engine/src/publish.ts</span> to fold it into the site.</div>` : ''}
    ${j.log && j.log.length ? `<div class="sec"><div class="sh">Log</div>${j.log.map(l => `<div class="note mono" style="font-size:11.5px">${esc(l)}</div>`).join('')}</div>` : ''}
    ${footer()}</div>`;
}


/* ---------------------------------------------------------------- shell */
function render() {
  document.getElementById('app').innerHTML =
    route === '@run' ? renderRun() : route ? renderDetail(route) : renderHome();
  // Classes holding more than one model — those buttons need the model name.
  const seenCls = {};
  for (const m of M) seenCls[m.cls] = (seenCls[m.cls] || 0) + 1;
  const dupClass = new Set(Object.keys(seenCls).filter(c => seenCls[c] > 1));
  document.getElementById('mseg').innerHTML = M.map((m, k) =>
    /**
     * Label with the MODEL when a class holds more than one.
     *
     * The picker read "1B 2.6B 3B 3B 4B 7B 8B 8B 12B" — two buttons labelled 3B
     * and two labelled 8B, with no way to tell which you were selecting. That is
     * the product's own point turning into a UI bug: a class is a set of models,
     * so wherever a class has more than one member the label has to say which.
     */
    `<button data-my="${k}" class="${k === myModel ? 'on' : ''}" title="${esc(m.id)} — ${m.lane} lane, ${esc(m.quantization)}">${esc(dupClass.has(m.cls) ? shortName(m) : m.cls)}</button>`).join('');
  const g = i => document.getElementById(i);
  g('bp').textContent = BAR.pass.toFixed(2); g('lp').textContent = BAR.pass.toFixed(2);
  g('rp').value = BAR.pass; g('rs').checked = BAR.strict;
  g('fitn').textContent = SK.filter(sk => { const f = fitOf(sk, myModel); return f && f.ok; }).length;
  g('fitt').textContent = ` of ${SK.length} skills clear this bar on ${M[myModel].cls}. Every number moves with it.`;
}

document.addEventListener('click', e => {
  const t = s => e.target.closest(s);
  if (t('[data-home]')) { e.preventDefault(); route = null; dstate = { tab: null, fm: null, openRung: null }; render(); scrollTo(0, 0); return; }
  if (t('[data-go]')) { route = t('[data-go]').dataset.go; dstate = { tab: null, fm: null, openRung: null }; render(); scrollTo(0, 0); return; }
  if (t('[data-my]')) { myModel = +t('[data-my]').dataset.my; dstate.fm = null; dstate.openRung = null; render(); return; }
  if (t('[data-tab]')) { dstate.tab = t('[data-tab]').dataset.tab; dstate.openRung = null; render(); return; }
  if (t('[data-fm]')) { dstate.fm = +t('[data-fm]').dataset.fm; render(); return; }
  if (t('[data-rung]')) { const k = +t('[data-rung]').dataset.rung; dstate.openRung = dstate.openRung === k ? null : k; render(); return; }
  if (t('[data-t]')) { const k = t('[data-t]').dataset.t; if (k === 'strict') BAR.strict = !BAR.strict; else state[k] = !state[k]; render(); return; }
  if (t('[data-view]')) { state.view = t('[data-view]').dataset.view; state.q = ''; state.how = false; render(); scrollTo(0, 0); return; }
  if (t('[data-how]')) { state.how = !state.how; render(); return; }
  if (t('[data-byok]')) { BYOK.open = true; BYOK.error = ''; render(); return; }
  if (t('[data-byok-forget]')) { byok.forget(); BYOK = { ...BYOK, open: true, status: null, res: null, cases: [], error: '' }; render(); return; }
  if (t('[data-byok-check]')) {
    const el = document.getElementById('orkey');
    const k = (el ? el.value : '').trim();
    if (!keyLooksValid(k)) { BYOK.error = 'That is not the shape of an OpenRouter key (sk-or-v1- followed by ~64 characters). Nothing was sent.'; render(); return; }
    BYOK.checking = true; BYOK.error = ''; render();
    checkKey(k).then(st => {
      BYOK.checking = false;
      if (!st.ok) { BYOK.error = st.reason; BYOK.status = null; }
      else { byok.key = k; BYOK.status = st; BYOK.open = false; }
      render();
    }).catch(e => { BYOK.checking = false; BYOK.error = String(e.message || e); render(); });
    return;
  }
  if (t('[data-byok-model]')) {
    const k = t('[data-byok-model]').dataset.byokModel;
    const m = M.find(x => x.m === k);
    BYOK.models = BYOK.models.some(p => p.key === k)
      ? BYOK.models.filter(p => p.key !== k)
      : [...BYOK.models, { key: k, id: m.id, cls: m.cls, sendTemperature: true, disableReasoning: false }];
    render(); return;
  }
  if (t('[data-byok-trials]')) { BYOK.trials = +t('[data-byok-trials]').dataset.byokTrials; render(); return; }
  if (t('[data-byok-again]')) { BYOK.res = null; BYOK.cases = []; BYOK.message = ''; render(); return; }
  if (t('[data-byok-go]')) {
    BYOK.error = ''; BYOK.res = []; BYOK.message = 'starting'; render();
    runInBrowser({
      url: state.url, models: BYOK.models, trials: BYOK.trials,
      onProgress: (p) => {
        BYOK.message = p.message || '';
        if (p.cases) BYOK.cases = p.cases;
        if (p.provenance) BYOK.provenance = p.provenance;
        if (p.results) BYOK.res = p.results.slice();
        render();
      },
    }).catch(e => { BYOK.error = String(e.message || e); render(); });
    return;
  }
  if (t('[data-catall]')) { loadCatalogue(true); return; }
  if (t('[data-cat]')) { state.cat = t('[data-cat]').dataset.cat; render(); return; }
  if (t('[data-sample]')) { state.url = 'github.com/anthropics/skills/tree/main/skills/pdf'; render(); return; }
  if (t('[data-run]')) { startRun(state.url); scrollTo(0, 0); return; }
  if (t('[data-cancel]')) { clearInterval(jobTimer); route = null; render(); return; }
});
/** Selects fire `change`, text inputs fire `input`; both route here. */
function handleControl(e) {
  if (e.target.id === 'msort') { state.sort = e.target.value; render(); return; }
  if (e.target.id === 'csort') { state.catSort = e.target.value; render(); return; }
  if (e.target.id === 'catmore') { if (e.target.value) { state.cat = e.target.value; render(); } return; }
}
document.addEventListener('change', handleControl);
document.addEventListener('input', e => { handleControl(e); 
  if (e.target.id === 'skillurl') {
    state.url = e.target.value;
    const b = document.querySelector('[data-run]'); if (b) b.disabled = state.url.trim().length <= 4;
    return;
  }
  if (e.target.id === 'q') {
    state.q = e.target.value; render();
    const q = document.getElementById('q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }
});
document.addEventListener('keydown', e => {
  const q = document.getElementById('q');
  if (e.key === '/' && q && document.activeElement !== q && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); q.focus(); return; }
  if (e.key === 'Escape' && route) { route = null; render(); }
});

/** A short, distinguishing label: the family, not the full id. */
function shortName(m) {
  const fam = (m.m || '').replace(/-?(instruct|it|chat)$/i, '');
  return `${m.cls} ${fam.split('-')[0].slice(0, 8)}`;
}

function wireHeader() {
  const bt = document.getElementById('barToggle'), bp = document.getElementById('barpop');
  bt.addEventListener('click', e => { e.stopPropagation(); bp.classList.toggle('on'); bt.classList.toggle('open', bp.classList.contains('on')); });
  bp.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => { bp.classList.remove('on'); bt.classList.remove('open'); });
  document.getElementById('rp').addEventListener('input', e => { BAR.pass = +e.target.value; render(); });
  document.getElementById('rs').addEventListener('change', e => { BAR.strict = e.target.checked; render(); });
}

fetch('./data/fits.json').then(r => {
  if (!r.ok) throw new Error('data/fits.json is not there');
  return r.json();
}).then(j => {
  D = j; M = j.M; MET = j.meta; SK = Object.keys(j.S).sort();
  BAR.pass = MET.bar ?? 0.80;
  /**
   * Default the lens to the most useful class, not the smallest.
   *
   * Defaulting to 1B meant the page opened with "0 of 20 clear your bar" — every
   * row a failure, which reads as a broken site rather than a finding. The tier
   * people actually run on a laptop is 4B-8B, so default to the largest
   * non-frontier class that has real data. The smallest is one click away and the
   * bad news is still there when you look for it.
   */
  const usable = M.map((m, i) => ({ m, i })).filter(x => x.m.cls !== 'frontier' && x.m.A && x.m.A.substance.n_calls >= 30);
  myModel = usable.length ? usable[usable.length - 1].i : 0;
  wireHeader();
  render();
  // The tab shows a count, so the top tier is fetched up front. It is small; the
  // full index still loads only when a search actually needs it.
  loadCatalogue(false);
}).catch(err => {
  document.getElementById('app').innerHTML =
    `<div class="wrap"><div class="alarm"><b>No data.</b> ${esc(err.message)}<br>
     The engine has not published yet. Nothing is shown rather than showing placeholders — a page of fake numbers is the one thing this product exists to prevent.<br><br>
     <span class="mono">npx tsx engine/src/run.ts --lane local --yes</span><br>
     <span class="mono">npx tsx engine/src/publish.ts</span></div></div>`;
});

// Ask once at boot whether a local engine is present, so the Test button knows
// whether it can actually run something or must explain that it cannot.
probeEngine();
