/**
 * GET /facts/publishers (rewritten to /api/router?route=publishers): every listed Verified Facts publisher with the
 * level the Monday conformance check reached, as a level badge (/badge/facts-L1.svg …). The list is
 * data/publishers.json (edited by hand, one entry per facts.json); the results are data/publisher-checks.json
 * (written by scripts/check-publishers.js, committed by .github/workflows/watch-sources.yml). A publisher not yet
 * checked shows "not checked", never a level it merely declares. ?format=json returns the same rows.
 */
const { CORS, handleOptions, queryParams } = require('../_lib');
const { STYLE } = require('../_changes_render');
const { FACTS_PROTOCOL, FACTS_SPEC_URL } = require('../_changelog');
const { trackEvent } = require('../_track');
const LIST = require('../../data/publishers.json');

let CHECKS = {};
try { CHECKS = require('../../data/publisher-checks.json'); } catch { /* no check has run yet */ }

const URL_SELF = 'https://databutler.dev/facts/publishers';
const CACHE = 'public, max-age=300, s-maxage=3600';
const LEVELS = ['L1', 'L2', 'L3'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** One row per listed publisher: the list entry plus its check, and the badge it earns. */
function rows(list = LIST, checks = CHECKS) {
  return list.publishers.map((p) => {
    const c = checks[p.facts] || null;
    const badge = !c ? 'unchecked' : c.error || !c.reached ? 'failing' : c.reached;
    return { ...p, check: c, badge, badgeUrl: `/badge/facts-${badge}.svg` };
  }).sort((x, y) => (LEVELS.indexOf(y.check && y.check.reached) - LEVELS.indexOf(x.check && x.check.reached)) || String(x.name).localeCompare(String(y.name)));
}

function html(list = rows()) {
  const tr = list.map((r) => {
    const c = r.check;
    const status = !c ? 'not checked yet — the Monday job checks every listed publisher'
      : c.error ? `the check could not run (${c.error})`
        : `${c.protocol || '?'}; declares ${c.declared || '?'}, reached ${c.reached || 'none'}${c.count !== null && c.count !== undefined ? `; ${c.count} facts` : ''}`;
    const failing = c && c.failed && c.failed.length ? `<br><span class="quiet">failing: ${c.failed.map((f) => `item ${esc(f.item)} (${esc(f.level)})`).join(', ')}</span>` : '';
    return `<tr><td><a href="${esc(r.site || r.facts)}">${esc(r.name)}</a>${r.note ? `<br><span class="quiet">${esc(r.note)}</span>` : ''}</td>
<td><img src="${esc(r.badgeUrl)}" alt="verified facts: ${esc(r.badge)}" height="20"></td>
<td>${esc(status)}${failing}</td><td>${esc(c ? c.checkedAt : '—')}</td><td><a href="${esc(r.facts)}">facts.json</a></td></tr>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verified Facts publishers, with the level each one reaches — Data Butler</title>
<meta name="description" content="Sites that publish official figures as Verified Facts, each re-checked every Monday with the public conformance checker and shown with the level it reaches.">
<link rel="canonical" href="${URL_SELF}">
<link rel="alternate" type="application/json" href="${URL_SELF}?format=json">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/icon.png" type="image/png" sizes="512x512">
<style>${STYLE}table{border-collapse:collapse;font-size:.85rem;width:100%}td,th{text-align:left;padding:5px 8px 5px 0;vertical-align:top;border-bottom:1px solid #21262d}th{color:#8b949e;font-weight:normal}img{vertical-align:middle}</style></head><body>
<p class="quiet"><a href="/">databutler.dev</a> · <a href="/facts">/facts</a> · <a href="${esc(FACTS_SPEC_URL)}">Verified Facts protocol</a> · <a href="/protocol/publish">publish your own</a></p>
<h1>Verified Facts publishers</h1>
<p>Every site here publishes official figures under <a href="${esc(FACTS_SPEC_URL)}">${esc(FACTS_PROTOCOL)}</a>: one figure per key, with its official source, the day a person verified it and a hash; at L3 a signature. Each is re-checked every Monday with the public conformance checker (<code>npx verified-facts check &lt;site&gt;</code>, offline, 25 keys sampled), and the badge shows the level that check reached, not the level the site declares.</p>
<table><tr><th>publisher</th><th>level</th><th>last check</th><th>checked</th><th>discovery</th></tr>
${tr}
</table>
<p>To be listed: publish at L1 or above (<a href="/protocol/publish">the recipe</a>), then open an issue at <a href="https://github.com/physics-star-cat/databutler/issues">github.com/physics-star-cat/databutler</a> with your <code>facts.json</code> URL. Badges for your own README: <code>https://databutler.dev/badge/facts-L1.svg</code>, <code>facts-L2.svg</code>, <code>facts-L3.svg</code>.</p>
<footer class="quiet"><p>${esc(FACTS_PROTOCOL)} — reference implementation: Data Butler. <a href="/">databutler.dev</a> · <a href="/facts">/facts</a> · <a href="/llms.txt">llms.txt</a> · <a href="/privacy">Privacy</a></p></footer></body></html>`;
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  const { format } = queryParams(req);
  await trackEvent('facts_publishers_page_view', req);
  const list = rows();
  if (String(format || '').toLowerCase().trim() === 'json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': CACHE, ...CORS });
    return res.end(JSON.stringify({ protocol: FACTS_PROTOCOL, url: URL_SELF, count: list.length, publishers: list }, null, 1));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': CACHE, ...CORS });
  return res.end(html(list));
};

module.exports.rows = rows;
module.exports.html = html;
