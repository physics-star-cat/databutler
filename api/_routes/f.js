/**
 * Verified Facts over HTTPS (docs/FACTS_PROTOCOL.md §9.1), rewritten here by vercel.json:
 *
 *   GET  /f/{key}?max_age=&as_of=&period=   one record — JSON, ?format=txt|html or Accept: text/plain|text/html
 *   GET  /f?keys=k1,k2  ·  POST /f {keys}    batch (≤ 50 keys)
 *   GET  /f                                  the index (?namespace=, ?format=html for the Dataset page)
 *   GET  /f/resolve?q=&namespace=&limit=     resolve a question or a guessed key
 *   /facts                                   alias of /f
 *
 * The rewrite passes the key as ?key=; it is stripped from req.url like the router strips ?route=.
 * Records cache an hour at the edge (status is a function of the day); misses are no-store.
 */
const { CORS, handleOptions } = require('../_lib');
const { trackEvent, trackFacts } = require('../_track');
const F = require('../_facts');
const R = require('../_facts_render');
const { FACTS_PROTOCOL, PUBLISHER } = require('../_changelog');

const CACHE = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';
const FORMATS = ['json', 'txt', 'html'];
const LINK = '</.well-known/facts.json>; rel="describedby"';
const httpDate = (day) => new Date(`${day}T00:00:00Z`).toUTCString();

/**
 * ?format= wins; else Accept (text/html → html, text/plain → txt); else JSON. Unknown format → null.
 * `neg` is set by the Accept-conditioned rewrites in vercel.json, so each format gets its own CDN
 * cache key — Vercel's cache otherwise served whichever format was asked for first to everyone.
 */
function formatOf(format, accept, neg) {
  if (format !== undefined && format !== '') {
    const f = String(format).toLowerCase().trim();
    if (f === 'text') return 'txt';
    return FORMATS.includes(f) ? f : null;
  }
  if (neg === 'html' || neg === 'txt') return neg;
  const a = String(accept || '').toLowerCase();
  if (a.includes('text/html')) return 'html';
  if (a.startsWith('text/plain')) return 'txt';
  return 'json';
}

function send(res, status, body, { format = 'json', headers = {}, cache = 'no-store' } = {}) {
  const type = { json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8', html: 'text/html; charset=utf-8' }[format];
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache, Vary: 'Accept', Link: LINK, ...CORS, ...headers });
  res.end(format === 'json' ? JSON.stringify(body, null, 1) : body);
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    return typeof req.body === 'object' ? req.body : JSON.parse(String(req.body));
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

/** A single record, or the answer that stands in for one. */
function sendRecord(req, res, r, format) {
  if (r.covered === false) {
    const status = r.error === 'unknown key' ? 404 : r.error ? 400 : 200;
    return send(res, status, format === 'txt' ? R.txt(r) : r, { format: format === 'html' ? 'json' : format });
  }
  const etag = `"${r.hash}"`;
  const headers = { ETag: etag, 'Last-Modified': httpDate(r.verifiedDate), 'X-Facts-Status': r.status };
  if (String(req.headers['if-none-match'] || '') === etag) {
    res.writeHead(304, { 'Cache-Control': CACHE, Vary: 'Accept', ...headers, ...CORS });
    return res.end();
  }
  const body = format === 'txt' ? `${R.txt(r)}\n` : format === 'html' ? R.html(r) : r;
  return send(res, 200, body, { format, headers, cache: CACHE });
}

function sendBatch(res, b, format) {
  if (b.covered === false) return send(res, 400, b);
  const headers = { 'X-Facts-Status': b.status };
  if (format === 'txt') return send(res, 200, `${b.results.map((r) => `${r.key || r.requestedKey}\t${R.txt(r)}`).join('\n')}\n`, { format: 'txt', headers, cache: CACHE });
  return send(res, 200, b, { headers, cache: CACHE });
}

function index(q, format) {
  const list = F.listFacts({ namespace: q.namespace });
  const generated = list.reduce((m, e) => (e.verifiedDate > m ? e.verifiedDate : m), '');
  if (format === 'html') {
    const records = list.map((e) => F.INDEX.get(e.key));
    return { format: 'html', body: R.indexHtml(records, { generated }) };
  }
  if (format === 'txt') return { format: 'txt', body: `${list.map((e) => e.key).join('\n')}\n` };
  return {
    format: 'json',
    body: {
      protocol: FACTS_PROTOCOL, publisher: PUBLISHER, count: list.length, generated,
      ...(q.namespace ? { namespace: String(q.namespace).toLowerCase().trim() } : {}),
      get: 'https://databutler.dev/f/{key}', resolve: 'https://databutler.dev/f/resolve?q={q}',
      facts: list,
    },
  };
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  const u = new URL(req.url, 'https://databutler.dev');
  const key = (u.searchParams.get('key') || '').replace(/^\/+|\/+$/g, '');
  u.searchParams.delete('key');
  const neg = u.searchParams.get('neg');
  u.searchParams.delete('neg');
  req.url = u.pathname + u.search;
  const q = Object.fromEntries(u.searchParams);
  const format = formatOf(q.format, req.headers.accept, neg);
  if (!format) return send(res, 400, { protocol: FACTS_PROTOCOL, covered: false, error: `format must be one of ${FORMATS.join(', ')} (got "${q.format}")` });
  const opts = { max_age: q.max_age, as_of: q.as_of, period: q.period };

  if (req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { protocol: FACTS_PROTOCOL, covered: false, error: 'body must be JSON: { "keys": [...], "max_age": "30d" }' }); }
    await trackEvent('agent_api_f_batch', req);
    const keys = Array.isArray(body.keys) ? body.keys : typeof body.keys === 'string' ? body.keys.split(',') : [];
    const batch = F.getFacts(keys, { max_age: body.max_age, as_of: body.as_of, period: body.period });
    await trackFacts(req, 'rest', 'get', batch);
    return sendBatch(res, batch, format === 'txt' ? 'txt' : 'json');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { protocol: FACTS_PROTOCOL, error: 'GET /f/{key}, GET /f?keys=, POST /f {keys}' }, { headers: { Allow: 'GET, POST, OPTIONS' } });
  }

  if (!key && q.keys !== undefined) {
    await trackEvent('agent_api_f_batch', req);
    const batch = F.getFacts(q.keys, opts);
    await trackFacts(req, 'rest', 'get', batch);
    return sendBatch(res, batch, format === 'txt' ? 'txt' : 'json');
  }
  if (!key || key === 'index') {
    await trackEvent('agent_api_f_index', req);
    const out = index(q, format);
    return send(res, 200, out.body, { format: out.format, cache: CACHE });
  }
  if (key === 'resolve') {
    await trackEvent('agent_api_f_resolve', req);
    const r = F.resolveFact(q.q, { namespace: q.namespace, limit: q.limit });
    await trackFacts(req, 'rest', 'resolve', r);
    return send(res, r.covered === false ? 400 : 200, r, { cache: r.covered === false ? 'no-store' : CACHE });
  }
  await trackEvent(format === 'html' ? 'fact_page_view' : 'agent_api_f_get', req);
  const r = F.getFact(key, opts);
  await trackFacts(req, format === 'html' ? 'page' : 'rest', 'get', r);
  if (r.results) return sendBatch(res, r, format === 'txt' ? 'txt' : 'json'); // /f/k1,k2
  return sendRecord(req, res, r, format);
};

module.exports.CACHE = CACHE;
module.exports.formatOf = formatOf;
