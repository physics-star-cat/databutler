/**
 * One serverless function for every /api/* route except /api itself.
 *
 * Vercel's Hobby plan allows 12 serverless functions per deployment and the
 * estate has 25 endpoints, so the handlers live under api/_routes/ (an
 * underscore directory is never deployed as functions) and vercel.json
 * rewrites /api/<route> here. The route is read from ?route=, which the
 * rewrite adds, then stripped from req.url again so every handler sees the
 * URL it always did (/api/uk/rates?category=…). Public pages outside /api
 * (/r/…, /changes, /changes.rss, /changes.atom, /protocol) are rewritten here too.
 */
const { sendJson, ATTRIBUTION } = require('./_lib');

const ROUTES = {
  'mcp': require('./_routes/mcp'),
  'mcp/provenance': require('./_routes/mcp/provenance'),
  'mcp/stats': require('./_routes/mcp/stats'),
  'mcp/uk-exams': require('./_routes/mcp/uk-exams'),
  'mcp/uk-rates': require('./_routes/mcp/uk-rates'),
  'mcp/vehicles': require('./_routes/mcp/vehicles'),
  'mcp/tax': require('./_routes/mcp/tax'),
  'changes': require('./_routes/changes'),
  'changes-page': require('./_routes/changes-page'),
  'changes-feed': require('./_routes/changes-feed'),
  'protocol': require('./_routes/protocol'),
  'r': require('./_routes/r'),
  'stats': require('./_routes/stats'),
  'cron/watch-sources': require('./_routes/cron/watch-sources'),
  'uk/rates': require('./_routes/uk/rates'),
  'uk/exams/papers': require('./_routes/uk/exams/papers'),
  'uk/exams/specs': require('./_routes/uk/exams/specs'),
  'uk/exams/topic': require('./_routes/uk/exams/topic'),
  'provenance/domain': require('./_routes/provenance/domain'),
  'provenance/package': require('./_routes/provenance/package'),
  'vehicles/uk/mot': require('./_routes/vehicles/uk/mot'),
  'vehicles/uk/search': require('./_routes/vehicles/uk/search'),
  'vehicles/uk/recalls': require('./_routes/vehicles/uk/recalls'),
  'vehicles/uk/recalls-search': require('./_routes/vehicles/uk/recalls-search'),
  'vehicles/fr/recalls': require('./_routes/vehicles/fr/recalls'),
  'vehicles/fr/search': require('./_routes/vehicles/fr/search'),
  'vehicles/jp/recalls': require('./_routes/vehicles/jp/recalls'),
  'vehicles/jp/complaints': require('./_routes/vehicles/jp/complaints'),
  'vehicles/eu/safety-gate': require('./_routes/vehicles/eu/safety-gate'),
  'tax/take-home': require('./_routes/tax/take-home'),
};

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
