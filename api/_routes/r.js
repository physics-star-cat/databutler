/**
 * Citation permalink: GET /r/<route>?<query> (rewritten to /api/r?path=…).
 * Stateless — re-runs the tool and renders answer + source + verified date
 * for a human following an agent's citation. noindex: not a search play.
 *
 * The route table derives from the area modules: every REST mirror gets a
 * citation route of the same path (same tool, same args), plus each area's
 * `cite` overrides (stats picks its tool from ?op=). The hub tools' routes
 * (changes, coverage, catalogue) are added here.
 */
const { CORS, handleOptions, queryParams } = require('../_lib');
const { ALL_TOOLS } = require('../_registry');
const { withEnvelope, findSource } = require('../_envelope');
const { whatChangedSince, coverage, catalogue } = require('../_hub');
const { trackEvent } = require('../_track');
const { citeRoutes } = require('../_areas');
const { qs } = require('../_area_kit');

const ROUTES = {};
for (const [p, c] of Object.entries(citeRoutes())) {
  ROUTES[p] = {
    tool: (q) => ALL_TOOLS[typeof c.tool === 'function' ? c.tool(q) : c.tool],
    args: c.args,
    rest: (q) => `/api/${p}${qs(q)}`,
    hint: c.hint || 'did not resolve to a tool — check the query',
  };
}
ROUTES.changes = { tool: () => whatChangedSince, args: (q) => q, rest: (q) => `/api/changes${qs(q)}` };
ROUTES.coverage = { tool: () => coverage, args: (q) => q, rest: () => '/api' };
ROUTES.catalogue = { tool: () => catalogue, args: (q) => q, rest: () => '/api' };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Text-node escaping (no attribute context): only & < > need escaping in
// HTML text content, so a JSON blob's quotes stay literal and readable.
const escText = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function collectUrls(obj, out = new Set()) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v) && /source|url|papers|docs|link|pdf/i.test(k)) out.add(v);
    else if (v && typeof v === 'object') collectUrls(v, out);
  }
  return out;
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} — Data Butler</title>
<style>body{background:#0d1117;color:#e6edf3;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:820px;margin:6vh auto;padding:0 20px;line-height:1.6}
a{color:#7ee787}pre{background:#161b22;padding:12px;border-radius:6px;overflow:auto;font-size:.85rem}.quiet{color:#8b949e;font-size:.9rem}code{background:#161b22;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>🤵 ${esc(title)}</h1>${body}
<p class="quiet">Data Butler serves verified reference data to AI agents. This page reproduces one answer with its provenance so a human can check it. <a href="/">databutler.dev</a> · <a href="/api">/api</a></p></body></html>`;
}

function html(res, status, body, { noStore = false } = {}) {
  const cacheControl = noStore ? 'no-store' : 'public, max-age=300';
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': cacheControl, ...CORS });
  res.end(body);
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('cite_page_view', req);
  const { path: p = '', ...q } = queryParams(req);
  const key = String(p).replace(/^\/+|\/+$/g, '');
  const route = ROUTES[key];
  if (!route) {
    return html(res, 404, page('No such citation route', `<p>Unknown route <code>/r/${esc(key)}</code>.</p><p>Routes: ${Object.keys(ROUTES).map((r) => `<code>/r/${r}</code>`).join(', ')}.</p>`), { noStore: true });
  }
  const tool = route.tool(q);
  if (!tool) return html(res, 404, page('No such tool', `<p>Route <code>/r/${esc(key)}</code> ${esc(route.hint)}.</p>`), { noStore: true });
  const args = route.args(q);
  let result;
  try {
    result = await tool.run(args);
  } catch {
    result = { covered: false, message: 'The live lookup failed upstream; try again shortly, or open the source directly.' };
  }
  const data = withEnvelope(tool, args, result);
  const { freshness, cite, attribution, docs, note, ...answer } = data;
  const urls = [...collectUrls(answer)];
  const source = findSource(answer);
  const when = freshness ? (freshness.staleness === 'live' ? `computed live ${freshness.verifiedDate}` : `verified ${freshness.verifiedDate} (${freshness.staleness}; next scheduled refresh ${freshness.nextScheduledRefresh})`) : '';
  const body = `
<p class="quiet">Query: <code>${escText(JSON.stringify(args))}</code></p>
<h2>Answer</h2><pre>${escText(JSON.stringify(answer, null, 2))}</pre>
<h2>Provenance</h2>
<p>${esc(when)}${source ? ` against <a href="${esc(source)}" rel="nofollow">${esc(source)}</a>` : ''}.</p>
${urls.length ? `<ul>${urls.map((u) => `<li><a href="${esc(u)}" rel="nofollow">${esc(u)}</a></li>`).join('')}</ul>` : ''}
<h2>Verify it yourself</h2>
<p>Open the source link above; the figures should match what is shown here. Machine-readable version: <a href="${esc(route.rest(q))}">${esc(route.rest(q))}</a>.</p>
${cite ? `<p class="quiet">Cite as: ${esc(cite.text)} — <a href="${esc(cite.url)}">${esc(cite.url)}</a></p>` : ''}`;
  html(res, 200, page(`Citation: ${key}`, body), { noStore: answer.covered === false });
};

module.exports.ROUTES = ROUTES;
