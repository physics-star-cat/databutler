/**
 * GET /protocol and /protocol/facts (rewritten to /api/router?route=protocol[&doc=facts]): the two
 * protocol specifications — Verified Changes (docs/CHANGES_PROTOCOL.md) and Verified Facts
 * (docs/FACTS_PROTOCOL.md) — rendered to indexable HTML pages. The markdown files are the source of
 * truth; this handler only renders them (api/_markdown.js) and caches like /changes. ?format=md
 * returns the markdown itself for agents that prefer it. Each page's footer links the other spec.
 */
const fs = require('node:fs');
const path = require('node:path');
const { CORS, handleOptions, queryParams, sendJson } = require('../_lib');
const { renderMarkdown, summary } = require('../_markdown');
const { STYLE } = require('../_changes_render');
const {
  PROTOCOL, PROTOCOL_URL, WELL_KNOWN_URL, SCHEMA_URL, FACTS_PROTOCOL, FACTS_SPEC_URL, FACTS_WELL_KNOWN_URL, FACT_SCHEMA_URL,
} = require('../_changelog');
const { trackEvent } = require('../_track');

const DOCS_DIR = path.join(__dirname, '..', '..', 'docs');
const DOCS = {
  changes: { path: path.join(DOCS_DIR, 'CHANGES_PROTOCOL.md'), url: PROTOCOL_URL, wellKnown: WELL_KNOWN_URL, schema: SCHEMA_URL, protocol: PROTOCOL, other: 'facts', home: '/changes', event: 'protocol_page_view' },
  facts: { path: path.join(DOCS_DIR, 'FACTS_PROTOCOL.md'), url: FACTS_SPEC_URL, wellKnown: FACTS_WELL_KNOWN_URL, schema: FACT_SCHEMA_URL, protocol: FACTS_PROTOCOL, other: 'changes', home: '/f', event: 'protocol_facts_page_view' },
};
const SPEC_PATH = DOCS.changes.path;
const CACHE = 'public, max-age=300, s-maxage=3600';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Rendered once per cold start: the files do not change between deploys. */
function page(md, d) {
  const { title, description } = summary(md);
  const o = DOCS[d.other];
  const wkName = d.wellKnown.replace('https://databutler.dev', '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Data Butler</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(d.url)}">
<link rel="alternate" type="text/markdown" href="${esc(`${d.url}?format=md`)}">
<link rel="alternate" type="application/json" title="Discovery document" href="${esc(d.wellKnown)}">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/icon.png" type="image/png" sizes="512x512">
<style>${STYLE}pre{background:#161b22;padding:12px 14px;border-radius:6px;overflow-x:auto;font-size:.88rem}pre code{background:none;padding:0}table{border-collapse:collapse;font-size:.85rem;margin:.6rem 0}td,th{text-align:left;padding:3px 8px;vertical-align:top;border-bottom:1px solid #21262d}th{color:#8b949e}</style></head><body>
<p class="quiet"><a href="/">databutler.dev</a> · <a href="${esc(d.home)}">${esc(d.home)}</a> · <a href="${esc(d.wellKnown)}">${esc(wkName)}</a> · <a href="${esc(d.schema)}">schema</a> · <a href="${esc(`${d.url}?format=md`)}">markdown</a></p>
${renderMarkdown(md)}
<footer class="quiet"><p>${esc(d.protocol)} — reference implementation: Data Butler. See also <a href="${esc(o.url)}">${esc(o.protocol)}</a>. <a href="/">databutler.dev</a> · <a href="/changes">/changes</a> · <a href="/f">/f</a> · <a href="/api">/api</a> · <a href="/llms.txt">llms.txt</a> · <a href="/privacy">Privacy</a></p></footer></body></html>`;
}

const cached = {};
function load(doc) {
  if (!cached[doc]) {
    const md = fs.readFileSync(DOCS[doc].path, 'utf8');
    cached[doc] = { md, html: page(md, DOCS[doc]) };
  }
  return cached[doc];
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  const { format, doc } = queryParams(req);
  const which = String(doc || 'changes').toLowerCase().trim();
  if (!DOCS[which]) return sendJson(res, 404, { error: `unknown protocol document "${doc}" — /protocol (Verified Changes) or /protocol/facts (Verified Facts)` }, { 'Cache-Control': 'no-store' });
  await trackEvent(DOCS[which].event, req);
  const { md, html } = load(which);
  const asMarkdown = String(format || '').toLowerCase().trim() === 'md';
  res.writeHead(200, {
    'Content-Type': asMarkdown ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': CACHE,
    ...CORS,
  });
  res.end(asMarkdown ? md : html);
};

module.exports.CACHE = CACHE;
module.exports.SPEC_PATH = SPEC_PATH;
module.exports.DOCS = DOCS;
