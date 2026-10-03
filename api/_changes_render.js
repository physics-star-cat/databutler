/**
 * Pure renderers for the public changelog: HTML page (/changes), RSS 2.0
 * (/changes.rss) and Atom (/changes.atom). No I/O, no clock — the same
 * entries always render to the same bytes, so feeds and caches stay quiet
 * until the data actually changes. Entries come from _changelog.listEntries.
 */
const { COVERAGE_START, CHANGELOG_AREAS, PROTOCOL } = require('./_changelog');

const BASE = 'https://databutler.dev';
const PAGE_URL = `${BASE}/changes`;
const TITLE = 'Data Butler changelog — what changed in the official facts';
const DESCRIPTION =
  'A changelog of verified official facts: UK tax and National Insurance thresholds, exam specifications, ' +
  'and official vehicle datasets (French RappelConso recalls, Japanese MLIT recalls and complaints), plus ' +
  'central-bank policy rates (Bank of England, Fed, ECB). ' +
  'Each entry records what changed (from → to), when it took effect, the official source, the date it was ' +
  'verified, and a maintainer note.';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Fragment id for an entry; also its feed guid (PAGE_URL#anchor), so a guid is a real permalink. */
const entryAnchor = (e) => `${slug(e.area)}-${slug(e.key)}-${e.verifiedDate}`;
const entryGuid = (e) => `${PAGE_URL}#${entryAnchor(e)}`;

/** Query string for a view: only area survives into canonical/feed links — since is an infinite space. */
const viewQuery = (area) => (area && area !== 'all' ? `?area=${encodeURIComponent(area)}` : '');
const feedUrl = (format, area) => `${PAGE_URL}.${format}${viewQuery(area)}`;

function fmtValue(v, unit) {
  if (v === null || v === undefined) return 'none';
  if (Array.isArray(v)) return v.length ? v.map((x) => fmtValue(x)).join(', ') : 'none';
  if (typeof v === 'object') return JSON.stringify(v);
  return unit ? `${v} ${unit}` : String(v);
}

/** Dataset-specific context a reader needs to place the entry (tax year, spec). */
function context(e) {
  if (e.area === 'uk-rates') return e.taxYear ? `tax year ${e.taxYear}` : '';
  if (e.area === 'uk-exams') return [e.board, e.level, e.subject, e.specCode ? `(${e.specCode})` : ''].filter(Boolean).join(' ');
  if (e.area === 'policy-rates') return [e.bankName, e.decisionDate ? `decision ${e.decisionDate}` : ''].filter(Boolean).join(', ');
  return '';
}

/** "from → to" as plain text, with bands when a threshold band moved. */
function changeText(e) {
  let s = `${fmtValue(e.from, e.unit)} → ${fmtValue(e.to, e.unit)}`;
  if (e.fromBand !== undefined || e.band !== undefined) s += ` (band ${fmtValue(e.fromBand)} → ${fmtValue(e.band)})`;
  return s;
}

const monthKey = (day) => String(day).slice(0, 7);
function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1] || m} ${y}`;
}

/** Entries grouped by verifiedDate month, order preserved (newest first in → newest first out). */
function groupByMonth(entries) {
  const groups = [];
  for (const e of entries) {
    const key = monthKey(e.verifiedDate);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(e); else groups.push({ key, label: monthLabel(key), entries: [e] });
  }
  return groups;
}

/* ---------------- HTML ---------------- */

const STYLE = 'body{background:#0d1117;color:#e6edf3;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:820px;margin:6vh auto;padding:0 20px;line-height:1.6}' +
  'a{color:#7ee787}h1{font-size:1.5rem}h2{font-size:1.15rem;border-bottom:1px solid #30363d;padding-bottom:4px;margin-top:2.5rem}h3{font-size:1rem;margin-bottom:.2rem}' +
  'code{background:#161b22;padding:2px 6px;border-radius:4px}.quiet{color:#8b949e;font-size:.9rem}' +
  'article{margin:1.2rem 0 1.6rem}dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 14px;margin:.3rem 0;font-size:.92rem}dt{color:#8b949e}dd{margin:0}' +
  '.area{display:inline-block;background:#1f3b2a;color:#7ee787;border-radius:4px;padding:0 6px;font-size:.8rem;margin-right:6px}nav a{margin-right:10px}nav .on{font-weight:bold;text-decoration:none}';

function head({ title, canonical, area, robots }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(DESCRIPTION)}">
${robots ? `<meta name="robots" content="${esc(robots)}">\n` : ''}<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" type="application/rss+xml" title="Data Butler changelog (RSS)" href="${esc(feedUrl('rss', area))}">
<link rel="alternate" type="application/atom+xml" title="Data Butler changelog (Atom)" href="${esc(feedUrl('atom', area))}">
<link rel="alternate" type="application/json" title="Data Butler changelog (JSON)" href="${esc(`${BASE}/api/changes?since=${COVERAGE_START}${area && area !== 'all' ? `&area=${encodeURIComponent(area)}` : ''}`)}">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/icon.png" type="image/png" sizes="512x512">
<style>${STYLE}</style></head><body>`;
}

const FOOT = `<footer class="quiet"><p>Data Butler serves verified reference data to AI agents; this page is the human-readable record of what moved. <a href="/">databutler.dev</a> · <a href="/api">/api</a> · <a href="/llms.txt">llms.txt</a> · <a href="/privacy">Privacy</a></p>
<p>Published under the <a href="/protocol">Verified Changes protocol</a> (${PROTOCOL}) — any site can publish its changes this way; discovery document at <a href="/.well-known/changes.json"><code>/.well-known/changes.json</code></a>.</p></footer></body></html>`;

function renderEntryHtml(e) {
  const ctx = context(e);
  return `<article id="${esc(entryAnchor(e))}">
<h3><span class="area">${esc(e.area)}</span>${esc(e.label || e.key)}</h3>
<dl>
<dt>Changed</dt><dd><code>${esc(fmtValue(e.from, e.unit))}</code> → <code>${esc(fmtValue(e.to, e.unit))}</code>${e.fromBand !== undefined || e.band !== undefined ? ` <span class="quiet">(band ${esc(fmtValue(e.fromBand))} → ${esc(fmtValue(e.band))})</span>` : ''}</dd>
${ctx ? `<dt>Context</dt><dd>${esc(ctx)}</dd>\n` : ''}<dt>Effective from</dt><dd>${esc(e.effectiveFrom || 'not dated by the source')}</dd>
<dt>Official source</dt><dd>${e.source ? `<a href="${esc(e.source)}" rel="nofollow">${esc(e.source)}</a>` : 'none recorded'}</dd>
<dt>Maintainer note</dt><dd>${e.note ? esc(e.note) : '<span class="quiet">none yet</span>'}</dd>
<dt>Verified</dt><dd>${esc(e.verifiedDate)}</dd>
<dt>Key</dt><dd><code>${esc(e.key)}</code> · <a href="#${esc(entryAnchor(e))}">permalink</a></dd>
</dl>
</article>`;
}

function intro(area, since) {
  const nav = ['all', ...CHANGELOG_AREAS].map((a) => {
    const on = (area || 'all') === a;
    return `<a href="${esc(`/changes${viewQuery(a)}`)}"${on ? ' class="on"' : ''}>${esc(a)}</a>`;
  }).join('');
  return `<h1>🤵 What changed in the official facts</h1>
<p>${esc(DESCRIPTION)} Entries are generated by scripts from committed data files and annotated by the maintainer — never written from memory. Coverage starts ${esc(COVERAGE_START)}.</p>
<p>Also available as <a href="${esc(feedUrl('rss', area))}">RSS</a>, <a href="${esc(feedUrl('atom', area))}">Atom</a>, JSON at <a href="${esc(`/api/changes?since=${COVERAGE_START}${area && area !== 'all' ? `&area=${encodeURIComponent(area)}` : ''}`)}"><code>/api/changes?since=YYYY-MM-DD</code></a>, or over MCP: the <code>what_changed_since</code> tool at <code>POST /api/mcp</code> takes a date (an agent's training cutoff) and returns the entries after it.</p>
<nav class="quiet">Area: ${nav}${since ? ` · since <code>${esc(since)}</code> (<a href="${esc(`/changes${viewQuery(area)}`)}">clear</a>)` : ''}</nav>`;
}

/**
 * The /changes page. entries: already filtered + newest first (listEntries).
 * area/since: the filters in force (for the intro, canonical and feed links).
 */
function renderChangesHtml({ entries, area = 'all', since = null } = {}) {
  const canonical = `${PAGE_URL}${viewQuery(area)}`;
  const title = area && area !== 'all' ? `${TITLE} (${area})` : TITLE;
  let body;
  if (!entries.length) {
    body = since
      ? `<p>No recorded changes since ${esc(since)}${area && area !== 'all' ? ` in ${esc(area)}` : ''}. Figures served are current as of their verifiedDate — <a href="/api">/api</a> returns them with source and verifiedDate.</p>`
      : `<p>No entries recorded yet${area && area !== 'all' ? ` for ${esc(area)}` : ''}. Every figure served was verified on or after ${esc(COVERAGE_START)}; the first itemised change will appear here.</p>`;
  } else {
    body = groupByMonth(entries).map((g) => `<h2>${esc(g.label)}</h2>\n${g.entries.map(renderEntryHtml).join('\n')}`).join('\n');
    body += `\n<p class="quiet">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${since ? ` since ${esc(since)}` : ''}.</p>`;
  }
  return `${head({ title, canonical, area })}\n${intro(area, since)}\n${body}\n${FOOT}`;
}

/** 400 page for a bad filter — no canonical, not for indexing. */
function renderErrorHtml(message) {
  return `${head({ title: 'Bad changelog filter — Data Butler', canonical: PAGE_URL, area: 'all', robots: 'noindex' })}
<h1>🤵 Bad changelog filter</h1>
<p>${esc(message)}</p>
<p>Areas: ${CHANGELOG_AREAS.map((a) => `<a href="${esc(`/changes?area=${a}`)}"><code>${esc(a)}</code></a>`).join(', ')} — or <a href="/changes">every area</a>. <code>since</code> is an ISO date, e.g. <code>/changes?since=${esc(COVERAGE_START)}</code>.</p>
${FOOT}`;
}

/* ---------------- feeds ---------------- */

const rfc822 = (day) => new Date(`${day}T00:00:00Z`).toUTCString(); // "Fri, 02 Oct 2026 00:00:00 GMT"
const atomDate = (day) => `${day}T00:00:00Z`;
const itemTitle = (e) => `${e.area}: ${e.label || e.key} — ${changeText(e)}`;
function itemSummary(e) {
  const ctx = context(e);
  return [
    `${e.label || e.key}: ${changeText(e)}.`,
    ctx ? `Context: ${ctx}.` : '',
    `Effective from ${e.effectiveFrom || 'undated'}; verified ${e.verifiedDate}.`,
    e.source ? `Official source: ${e.source}` : '',
    e.note ? `Note: ${e.note}` : '',
  ].filter(Boolean).join(' ');
}

function renderRss({ entries, area = 'all' } = {}) {
  const items = entries.map((e) => `<item>
<title>${xml(itemTitle(e))}</title>
<link>${xml(e.source || entryGuid(e))}</link>
<guid isPermaLink="true">${xml(entryGuid(e))}</guid>
<pubDate>${rfc822(e.verifiedDate)}</pubDate>
<category>${xml(e.area)}</category>
<description>${xml(itemSummary(e))}</description>
</item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${xml(area && area !== 'all' ? `${TITLE} (${area})` : TITLE)}</title>
<link>${xml(`${PAGE_URL}${viewQuery(area)}`)}</link>
<description>${xml(DESCRIPTION)}</description>
<language>en-gb</language>
<atom:link href="${xml(feedUrl('rss', area))}" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>
`;
}

function renderAtom({ entries, area = 'all' } = {}) {
  const updated = entries.length ? entries[0].verifiedDate : COVERAGE_START;
  const items = entries.map((e) => `<entry>
<id>${xml(entryGuid(e))}</id>
<title>${xml(itemTitle(e))}</title>
<link rel="alternate" href="${xml(e.source || entryGuid(e))}"/>
<published>${atomDate(e.verifiedDate)}</published>
<updated>${atomDate(e.verifiedDate)}</updated>
<category term="${xml(e.area)}"/>
<summary type="text">${xml(itemSummary(e))}</summary>
</entry>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>${xml(`${PAGE_URL}${viewQuery(area)}`)}</id>
<title>${xml(area && area !== 'all' ? `${TITLE} (${area})` : TITLE)}</title>
<subtitle>${xml(DESCRIPTION)}</subtitle>
<link rel="alternate" type="text/html" href="${xml(`${PAGE_URL}${viewQuery(area)}`)}"/>
<link rel="self" type="application/atom+xml" href="${xml(feedUrl('atom', area))}"/>
<updated>${atomDate(updated)}</updated>
<author><name>Data Butler</name><uri>${BASE}/</uri></author>
${items}
</feed>
`;
}

module.exports = {
  renderChangesHtml, renderErrorHtml, renderRss, renderAtom,
  entryAnchor, entryGuid, groupByMonth, monthLabel, changeText, rfc822,
  PAGE_URL, TITLE, DESCRIPTION, STYLE,
};
