/**
 * One serverless function for every /api/* route except /api itself.
 *
 * Vercel's Hobby plan allows 12 serverless functions per deployment and the
 * estate has 30+ endpoints, so the handlers live under api/_routes/ (an
 * underscore directory is never deployed as functions) and vercel.json
 * rewrites /api/<route> here. The route is read from ?route=, which the
 * rewrite adds, then stripped from req.url again so every handler sees the
 * URL it always did (/api/uk/rates?category=…). Public pages outside /api
 * (/r/…, /changes, /changes.rss, /changes.atom, /protocol) are rewritten here too.
 *
 * Per-area routes are derived from the area modules (api/_areas/<area>.js):
 * one MCP server per module with a `server` (mcp/<key>) and one REST mirror per
 * `rest` entry — or the hand-written handler under api/_routes/ that a rest
 * entry names with `handler` (the stats endpoint's op dispatch).
 */
const { sendJson, ATTRIBUTION } = require('./_lib');
const { SERVERS } = require('./_registry');
const { restRoutes } = require('./_areas');
const { makeMcpHandler } = require('./_mcp');
const { restMirror } = require('./_rest');

const ROUTES = {
  'mcp': require('./_routes/mcp'),
  'changes': require('./_routes/changes'),
  'changes-page': require('./_routes/changes-page'),
  'changes-feed': require('./_routes/changes-feed'),
  'protocol': require('./_routes/protocol'),
  'r': require('./_routes/r'),
  'cron/watch-sources': require('./_routes/cron/watch-sources'),
};

for (const [key, server] of Object.entries(SERVERS)) ROUTES[`mcp/${key}`] = makeMcpHandler(server);
for (const r of restRoutes()) {
  if (ROUTES[r.path]) throw new Error(`api/_areas: REST path "${r.path}" declared twice`);
  ROUTES[r.path] = r.handler ? require('./_routes/' + r.handler) : restMirror(r);
}

/** Route name from ?route= (set by the rewrite) or, failing that, the path. */
function resolve(req) {
  const u = new URL(req.url, 'https://databutler.dev');
  let route = u.searchParams.get('route');
  if (route === null) route = u.pathname.replace(/^\/api\/?/, '');
  u.searchParams.delete('route');
  route = route.replace(/^\/+|\/+$/g, '');
  u.pathname = `/api/${route}`;
  return { route, url: u.pathname + u.search };
}

module.exports = (req, res) => {
  const { route, url } = resolve(req);
  const handler = ROUTES[route];
  if (!handler) {
    return sendJson(res, 404, { error: `unknown route /api/${route}. GET /api lists every endpoint.`, ...ATTRIBUTION });
  }
  req.url = url;
  return handler(req, res);
};

module.exports.ROUTES = ROUTES;
