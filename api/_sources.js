/**
 * Source-page checking shared by scripts/sources.js (writes data/sources.json)
 * and api/cron/watch-sources.js (compares against it). gov.uk pages go via
 * the JSON content API (public_updated_at + body); everything else is fetched
 * as HTML and body-hashed after stripping chrome.
 */
const crypto = require('node:crypto');

const UA = 'databutler-curation/1.0 (+https://databutler.dev)';
const TIMEOUT_MS = 8000;

function govukContentUrl(url) {
  const u = new URL(url);
  return u.hostname === 'www.gov.uk' ? `https://www.gov.uk/api/content${u.pathname}` : null;
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function govukBodyText(content) {
  const d = (content && content.details) || {};
  const parts = Array.isArray(d.parts) ? d.parts.map((p) => p.body || '') : [];
  return stripHtml([d.body || '', ...parts].join(' '));
}

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

async function fetchText(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/html' }, redirect: 'follow', signal: c.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

async function checkSource(url) {
  const api = govukContentUrl(url);
  if (api) {
    try {
      const j = JSON.parse(await fetchText(api));
      return { url, updatedAt: j.public_updated_at || null, bodyHash: hash(govukBodyText(j)), via: 'govuk-content-api' };
    } catch { /* fall through to the HTML page */ }
  }
  const html = await fetchText(url);
  return { url, updatedAt: null, bodyHash: hash(stripHtml(html)), via: 'html' };
}

/**
 * Legacy collector over raw data files (rates categories, exam specUrls, bank
 * pages). The watcher and scripts/sources.js now use api/_areas.js sourceUrls()
 * — every area module's sources() — so a new area needs no change here.
 */
function sourceUrls({ rates = [], exams = [], policy = [] }) {
  const urls = new Set();
  for (const r of rates) for (const c of Object.values(r.categories || {})) if (c.source) urls.add(c.source);
  for (const e of exams) for (const s of e.specs || []) if (s.specUrl) urls.add(s.specUrl);
  for (const p of policy) for (const b of Object.values(p.banks || {})) if (b.source) urls.add(b.source);
  return [...urls];
}

function compareSource(seen, current) {
  if (!seen) return { status: 'new' };
  if ((seen.updatedAt || null) !== (current.updatedAt || null)) {
    return { status: 'changed', field: 'updatedAt', from: seen.updatedAt || null, to: current.updatedAt || null };
  }
  if (seen.bodyHash !== current.bodyHash) {
    return { status: 'changed', field: 'bodyHash', from: seen.bodyHash, to: current.bodyHash };
  }
  return { status: 'same' };
}

/**
 * Pages the watcher cannot read (403, CAPTCHA): data/sources.json records them as
 * `{ url, unreachable: '<reason>', checkedAt }` (scripts/sources.js writes that when a fetch fails),
 * and an area module may declare one up front with `unreachable` on its sources() entry. Merged here,
 * in watch order, with the area that watches each — the Monday cron skips these instead of filing
 * errors, and coverage and docs/CURATION.md list them.
 *   sources — [{ url, label, area, unreachable? }] (api/_areas.js sourceList())
 *   seen    — data/sources.json
 */
function unreachableSources(sources, seen) {
  const byUrl = new Map((seen || []).map((s) => [s.url, s]));
  const out = [];
  for (const s of sources) {
    const recorded = byUrl.get(s.url);
    // A page fetched fine since it was declared unreachable counts as reachable (the record wins).
    const reason = recorded ? recorded.unreachable : s.unreachable;
    if (reason) out.push({ url: s.url, label: s.label, area: s.area, reason, ...(recorded && recorded.checkedAt ? { checkedAt: recorded.checkedAt } : {}) });
  }
  return out;
}

/** The Monday watch list: URLs to fetch and compare, and the unreachable ones skipped (never filed as errors). */
function watchPlan(sources, seen) {
  const skipped = unreachableSources(sources, seen);
  const skip = new Set(skipped.map((s) => s.url));
  return { check: sources.map((s) => s.url).filter((u) => !skip.has(u)), skipped };
}

module.exports = { checkSource, sourceUrls, compareSource, unreachableSources, watchPlan, govukContentUrl, govukBodyText, stripHtml, UA };
