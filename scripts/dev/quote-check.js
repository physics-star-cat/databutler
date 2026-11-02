#!/usr/bin/env node
/**
 * Triage for the Monday watcher's `source-changed` pages: did a FIGURE move, or only the page?
 *
 * For each URL, fetch the page the way the watcher does (gov.uk through the content API body, anything else as
 * stripped HTML — api/_sources.js) and test every served Verified Facts record whose `source` is that URL: each
 * fragment of the record's `quote` (split on "…" and " | ", curators' "(column …)" notes dropped) must still appear
 * in the page text, whitespace and quote marks normalised.
 *
 *   node scripts/dev/quote-check.js --changed          every URL with `changedAt` in data/source-checks.json
 *   node scripts/dev/quote-check.js <url> [<url> …]    just these
 *   node scripts/dev/quote-check.js --changed --json   machine-readable
 *
 * Every fragment present → the page changed, the figures did not: refresh the baseline (node scripts/sources.js, or
 * refreshSources([...urls]) for a subset) and re-run scripts/check-sources.js. A missing fragment → open the page and
 * read; a moved figure gets a `previous` entry and a new verifiedDate (docs/ADDING_AN_AREA.md, FACTS_PROTOCOL.md).
 * PDF sources are not fetched here (pdftotext them by hand). Network required; nothing is written.
 */
const fs = require('node:fs');
const path = require('node:path');
const { govukContentUrl, govukBodyText, stripHtml, UA } = require('../../api/_sources');
const F = require('../../api/_facts');

const ROOT = path.resolve(__dirname, '../..');

/** Page text as the watcher hashes it. */
async function pageText(url) {
  const headers = { 'User-Agent': UA, Accept: 'application/json, text/html' };
  const api = govukContentUrl(url);
  if (api) {
    const r = await fetch(api, { headers });
    if (r.ok) return govukBodyText(await r.json());
  }
  const r = await fetch(url, { headers, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const type = r.headers.get('content-type') || '';
  if (/pdf/i.test(type) || /\.pdf(\?|$)/i.test(url)) throw new Error('pdf: not checked here');
  return stripHtml(await r.text());
}

/**
 * Page and quote text made comparable: case, quote marks, dashes and NBSPs unified; list and table punctuation
 * (";" ":" and the "." a curator put after a stripped note) dropped, because a gov.uk bullet list reads as plain
 * spaces once the tags are gone and curators join its items with semicolons.
 */
const norm = (s) => String(s)
  .replace(/[‘’′]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ')
  .replace(/\s*[–—-]\s*/g, '-').replace(/[;:]/g, ' ').replace(/\s+\./g, '.').replace(/\.\s/g, ' ')
  .replace(/\s+/g, ' ').trim().replace(/\.$/, '').toLowerCase();

/** The pieces of a quote that must each appear on the page. */
function fragments(quote) {
  return String(quote || '')
    .replace(/\((columns?|row)\b[^)]*\)/gi, ' ')   // curators' table notes, not page text
    .split(/…|\.\.\.|\s\|\s|\s—\s/)
    .map(norm)
    .filter((f) => f.length >= 6);
}

/** Every served record with a quote, grouped by source URL. */
function recordsBySource() {
  const by = new Map();
  for (const { key } of F.listFacts()) {
    const r = F.getFact(key);
    if (!r || !r.source || !r.quote || r.value === null) continue;
    if (!by.has(r.source)) by.set(r.source, []);
    by.get(r.source).push({ key: r.key, verifiedDate: r.verifiedDate, quote: r.quote });
  }
  return by;
}

function changedUrls() {
  const file = path.join(ROOT, 'data/source-checks.json');
  if (!fs.existsSync(file)) return [];
  return Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))).filter(([, e]) => e.changedAt).map(([u]) => u);
}

async function checkUrl(url, records) {
  let text;
  try { text = norm(await pageText(url)); } catch (e) { return { url, error: e.message, records: records.length }; }
  const missing = [];
  for (const r of records) for (const f of fragments(r.quote)) if (!text.includes(f)) missing.push({ key: r.key, fragment: f });
  return { url, records: records.length, verified: [...new Set(records.map((r) => r.verifiedDate))].sort(), missing };
}

async function run(urls) {
  const by = recordsBySource();
  const out = [];
  for (const url of urls) out.push(await checkUrl(url, by.get(url) || []));
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const urls = args.includes('--changed') ? changedUrls() : args.filter((a) => !a.startsWith('--'));
  if (!urls.length) { console.error('usage: quote-check.js --changed | <url> …'); process.exit(2); }
  run(urls).then((results) => {
    if (json) { console.log(JSON.stringify(results, null, 2)); return; }
    for (const r of results) {
      if (r.error) { console.log(`?    ${r.url}\n       ${r.records} record(s); could not check: ${r.error}`); continue; }
      const tag = r.records === 0 ? 'none' : r.missing.length ? 'READ' : 'ok  ';
      console.log(`${tag} ${r.url}\n       ${r.records} record(s), verified ${r.verified.join(', ') || '-'}; ${r.missing.length} fragment(s) missing`);
      for (const m of r.missing) console.log(`       - ${m.key}: "${m.fragment}"`);
    }
  }, (e) => { console.error(e); process.exit(1); });
}

module.exports = { run, checkUrl, fragments, norm, recordsBySource, changedUrls, pageText };
