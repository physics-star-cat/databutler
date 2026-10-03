/**
 * GET /protocol (rewritten to /api/router?route=protocol): the Verified
 * Changes protocol specification, docs/CHANGES_PROTOCOL.md rendered to an
 * indexable HTML page. The markdown file is the source of truth; this handler
 * only renders it (api/_markdown.js) and caches like /changes. ?format=md
 * returns the markdown itself for agents that prefer it.
 */
const fs = require('node:fs');
const path = require('node:path');
const { CORS, handleOptions, queryParams } = require('../_lib');
const { renderMarkdown, summary } = require('../_markdown');
const { STYLE } = require('../_changes_render');
const { PROTOCOL, PROTOCOL_URL, WELL_KNOWN_URL, SCHEMA_URL } = require('../_changelog');
const { trackEvent } = require('../_track');

const SPEC_PATH = path.join(__dirname, '..', '..', 'docs', 'CHANGES_PROTOCOL.md');
const CACHE = 'public, max-age=300, s-maxage=3600';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Rendered once per cold start: the file does not change between deploys. */
function page(md) {
  const { title, description } = summary(md);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Data Butler</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(PROTOCOL_URL)}">
<link rel="alternate" type="text/markdown" href="${esc(`${PROTOCOL_URL}?format=md`)}">
<link rel="alternate" type="application/json" title="Discovery document" href="${esc(WELL_KNOWN_URL)}">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/icon.png" type="image/png" sizes="512x512">
<style>${STYLE}pre{background:#161b22;padding:12px 14px;border-radius:6px;overflow-x:auto;font-size:.88rem}pre code{background:none;padding:0}</style></head><body>
<p class="quiet"><a href="/">databutler.dev</a> · <a href="/changes">/changes</a> · <a href="${esc(WELL_KNOWN_URL)}">/.well-known/changes.json</a> · <a href="${esc(SCHEMA_URL)}">schema</a> · <a href="${esc(`${PROTOCOL_URL}?format=md`)}">markdown</a></p>
${renderMarkdown(md)}
<footer class="quiet"><p>${esc(PROTOCOL)} — reference implementation: Data Butler. <a href="/">databutler.dev</a> · <a href="/changes">/changes</a> · <a href="/api">/api</a> · <a href="/llms.txt">llms.txt</a> · <a href="/privacy">Privacy</a></p></footer></body></html>`;
}

let cached = null;
function load() {
  if (!cached) {
    const md = fs.readFileSync(SPEC_PATH, 'utf8');
    cached = { md, html: page(md) };
  }
  return cached;
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('protocol_page_view', req);
  const { format } = queryParams(req);
  const { md, html } = load();
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
