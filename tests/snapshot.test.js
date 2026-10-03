// tests/snapshot.test.js — public-surface regression guard for the area kit.
//
// Captured on master @ 2c0845b BEFORE the area-kit refactor, so that "everything
// now derives from api/_areas/*.js" can be proven not to have changed what agents
// and crawlers see. What is pinned, and how strictly:
//   servers.json   tools/list + initialize for every focused MCP server and the
//                  front door — byte-for-byte (these are what registries list)
//   api-index.json GET /api — deep-equal with object keys sorted (JSON key order
//                  carries no meaning; the text does)
//   routes.json    router route set, citation (/r) route set, every tool's cite
//                  path — exact
//   rest.json      every REST mirror called with an empty query (the 400 messages
//                  and listings) plus a few offline happy paths — exact, minus
//                  freshness.staleness, which moves with the calendar
//   sitemap.xml, well-known.json — exact
//   llms.txt       same set of non-blank lines (order is immaterial to a reader)
//
// Refresh deliberately, never casually:  UPDATE_SNAPSHOTS=1 node --test tests/snapshot.test.js
// and read the git diff of tests/snapshots/ before committing it. Adding an area
// legitimately changes the index, llms.txt, sitemap and discovery document.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { invoke, rpc } = require('./helpers');
const router = require('../api/router');
const apiIndex = require('../api/index');
const { ROUTES: CITE_ROUTES } = require('../api/_routes/r');
const { SERVERS, ALL_TOOLS } = require('../api/_registry');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(__dirname, 'snapshots');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const get = (url) => invoke(router, undefined, { method: 'GET', url });

/** Recursively sort object keys so two JSON documents compare by content. */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
const stripStaleness = (body) => {
  if (body && body.freshness && typeof body.freshness === 'object') {
    const { staleness, ...rest } = body.freshness;
    return { ...body, freshness: rest };
  }
  return body;
};

function snapshot(name, actual, { compare = (a, b) => assert.deepEqual(a, b), serialise = (v) => JSON.stringify(v, null, 2) + '\n', parse = JSON.parse } = {}) {
  const file = path.join(DIR, name);
  if (UPDATE || !fs.existsSync(file)) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, serialise(actual));
    return;
  }
  compare(actual, parse(fs.readFileSync(file, 'utf8')));
}

const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'snapshot', version: '0' } };

// Every REST mirror, called with an empty query: the 400 messages and the
// no-argument listings are public behaviour. Network-backed routes 400 before
// they reach the network. Then a few offline happy paths.
const REST_EMPTY = [
  'uk/rates', 'uk/exams/topic', 'uk/exams/specs', 'uk/exams/papers', 'provenance/domain', 'provenance/package', 'stats',
  'vehicles/uk/mot', 'vehicles/uk/search', 'vehicles/uk/recalls', 'vehicles/uk/recalls-search', 'vehicles/fr/recalls', 'vehicles/fr/search',
  'vehicles/jp/recalls', 'vehicles/jp/complaints', 'vehicles/eu/safety-gate', 'tax/take-home', 'software-eol/status', 'software-eol/timeline', 'policy-rates',
];
const REST_HAPPY = [
  'uk/rates?category=vat', 'uk/exams/topic?topic=electricity&board=aqa&subject=physics', 'uk/exams/papers?board=aqa',
  'stats?op=distribution&dist=normal&at=1.96', 'vehicles/uk/recalls?make=vauxhall&model=corsa', 'vehicles/fr/recalls?brand=peugeot&model=208',
  'vehicles/jp/complaints?make=honda&model=n-box', 'software-eol/status?product=nodejs&version=18.19.0', 'policy-rates?bank=boe', 'policy-rates?bank=boj',
  'changes?since=2026-06-01&area=uk-rates',
];

test('snapshot: tools/list and initialize for every MCP server, byte for byte', async () => {
  const out = {};
  for (const key of [...Object.keys(SERVERS).map((k) => `mcp/${k}`), 'mcp']) {
    const h = router.ROUTES[key];
    const init = await rpc(h, 'initialize', INIT);
    const list = await rpc(h, 'tools/list');
    out[key] = { serverInfo: init.body.result.serverInfo, instructions: init.body.result.instructions, tools: list.body.result.tools };
  }
  snapshot('servers.json', out);
});

test('snapshot: GET /api index (keys sorted)', async () => {
  const r = await invoke(apiIndex, undefined, { method: 'GET', url: '/api' });
  snapshot('api-index.json', canon(r.body));
});

test('snapshot: router routes, citation routes and every tool\'s cite path', () => {
  const cites = {};
  // cite({}) → the /r path plus the query keys the tool knows how to pass through
  for (const [name, t] of Object.entries(ALL_TOOLS)) {
    const c = t.cite ? t.cite({}) : null;
    cites[name] = c ? { path: c.path, queryKeys: Object.keys(c.query || {}).sort() } : null;
  }
  snapshot('routes.json', { router: Object.keys(router.ROUTES).sort(), cite: Object.keys(CITE_ROUTES).sort(), citeTargets: cites });
});

test('snapshot: REST mirrors — empty-query behaviour and offline happy paths', async () => {
  const out = {};
  for (const route of REST_EMPTY) {
    const r = await get(`/api/router?route=${route}`);
    out[`/api/${route}`] = { status: r.status, body: stripStaleness(r.body) };
  }
  for (const q of REST_HAPPY) {
    const [route, qs] = q.split('?');
    const r = await get(`/api/router?route=${route}&${qs}`);
    out[`/api/${q}`] = { status: r.status, body: stripStaleness(r.body) };
  }
  snapshot('rest.json', out);
});

test('snapshot: static public files — sitemap, discovery document, llms.txt lines', () => {
  const text = { compare: assert.equal, serialise: (s) => s, parse: (s) => s };
  snapshot('sitemap.xml', read('public/sitemap.xml'), text);
  snapshot('well-known.json', read('public/.well-known/changes.json'), text);
  const lines = (s) => s.split('\n').map((l) => l.trimEnd()).filter(Boolean).sort();
  snapshot('llms.txt', read('public/llms.txt'), { ...text, compare: (a, b) => assert.deepEqual(lines(a), lines(b)) });
});
