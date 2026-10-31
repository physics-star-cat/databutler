// tests/facts-mcp.test.js — Verified Facts over MCP (docs/FACTS_PROTOCOL.md §9.2, §10.5): the three-tool databutler-facts
// server, get_fact/resolve_fact at the front door (cap 11), factKey on what_changed_since, Server Cards.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rpc, callTool, invoke } = require('./helpers');
const router = require('../api/router');
const frontDoor = require('../api/_routes/mcp');
const { frontDoorTools } = require('../api/_areas');
const { SERVERS } = require('../api/_registry');
const { getFact, resolveFact, EXAMPLES } = require('../api/_facts_tools');
const { cardServers } = require('../api/_hub');
const { serverCard, CARD_SCHEMA } = require('../api/_server_card');
const F = require('../api/_facts');

const facts = router.ROUTES['mcp/facts'];
const IMPERATIVE = /\b(use this|you should|always|never|call this|do not|use when|use whenever|use to)\b/i;
const PA = 'uk/income-tax/personal-allowance';

test('/api/mcp/facts: tools/list is exactly get_fact, resolve_fact, what_changed_since with titles and read-only annotations', async () => {
  const r = await rpc(facts, 'tools/list');
  const tools = r.body.result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['get_fact', 'resolve_fact', 'what_changed_since']);
  for (const t of tools) {
    assert.deepEqual(Object.keys(t).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title']);
    assert.ok(t.title);
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.annotations.destructiveHint, false);
    assert.equal(t.annotations.idempotentHint, true);
    assert.equal(t.annotations.openWorldHint, false);
  }
  assert.equal(tools[0].title, 'Get a verified fact');
  assert.equal(tools[1].title, 'Find the key for a fact');
});

test('initialize: serverInfo databutler-facts; instructions mention get_fact and max_age', async () => {
  const r = await rpc(facts, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(r.body.result.serverInfo.name, 'databutler-facts');
  assert.match(r.body.result.instructions, /get_fact/);
  assert.match(r.body.result.instructions, /max_age/);
});

test('get_fact: a signed record, cite.url = the /f page, freshness from the area (not live)', async () => {
  const { isError, data } = await callTool(facts, 'get_fact', { key: PA, max_age: '30d' });
  assert.equal(isError, false);
  assert.equal(data.key, PA);
  assert.equal(data.value, 12570);
  assert.ok(data.signature && data.signature.jws);
  assert.equal(data.cite.url, `https://databutler.dev/f/${PA}`);
  assert.notEqual(data.freshness.staleness, 'live');
  assert.equal(data.freshness.verifiedDate, require('../data/uk/rates/2026-27.json').verifiedDate);
  assert.equal(data.maxAgeDays, 30);
});

test('get_fact: comma batch → results; miss → isError false, covered:false, candidates', async () => {
  const b = await callTool(facts, 'get_fact', { key: `${PA},us/social-security/wage-base` });
  assert.equal(b.data.count, 2);
  assert.deepEqual(b.data.results.map((r) => r.key), [PA, 'us/social-security/wage-base']);
  const m = await callTool(facts, 'get_fact', { key: 'threshold' });
  assert.equal(m.isError, false);
  assert.equal(m.data.covered, false);
  assert.ok(m.data.candidates.length > 0);
});

test('resolve_fact: ECB deposit rate → eu/ecb/deposit-facility with best', async () => {
  const { data } = await callTool(facts, 'resolve_fact', { q: 'ECB deposit rate' });
  assert.equal(data.candidates[0].key, 'eu/ecb/deposit-facility');
  assert.equal(data.best.key, 'eu/ecb/deposit-facility');
});

test('what_changed_since: entries of a facts area carry a factKey that resolves in the index', async () => {
  const { data } = await callTool(facts, 'what_changed_since', { since: '2026-06-01', area: 'uk-rates' });
  assert.ok(data.entries.length > 0);
  for (const e of data.entries) {
    assert.ok(F.INDEX.has(e.factKey), `${e.key} → ${e.factKey}`);
    assert.deepEqual(F.changelogKeyFor(e.factKey), { area: e.area, key: e.key });
  }
  const v = await callTool(facts, 'what_changed_since', { since: '2026-06-01', area: 'vehicles' });
  assert.ok(v.data.entries.every((e) => e.factKey === undefined), 'areas without facts carry none');
});

test('descriptions are plain statements; every example key in get_fact resolves', () => {
  for (const t of [getFact, resolveFact]) assert.doesNotMatch(t.description, IMPERATIVE, t.name);
  assert.ok(EXAMPLES.length >= 6);
  for (const k of EXAMPLES) {
    assert.ok(F.INDEX.has(k) || F.ALIASES.has(k), k);
    assert.ok(getFact.description.includes(`\`${k}\``), k);
  }
});

test('front door lists the direct tools + what_changed_since, get_fact, resolve_fact, coverage, catalogue, call (11); call does not reach get_fact', async () => {
  const r = await rpc(frontDoor, 'tools/list');
  const names = r.body.result.tools.map((t) => t.name);
  assert.deepEqual(names, [...frontDoorTools(), 'what_changed_since', 'get_fact', 'resolve_fact', 'coverage', 'catalogue', 'call']);
  assert.ok(names.length <= 11);
  const init = await rpc(frontDoor, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.match(init.body.result.instructions, /get_fact returns one figure by key/);
  assert.doesNotMatch(init.body.result.instructions, /from memory|never quote|cite it/i);
  const direct = await callTool(frontDoor, 'get_fact', { key: 'uk/bank-rate' });
  assert.equal(direct.data.key, 'uk/bank-rate');
  const viaCall = await callTool(frontDoor, 'call', { tool: 'get_fact', arguments: { key: 'uk/bank-rate' } });
  assert.equal(viaCall.data.covered, false, 'facts tools are listed directly, not in the call catalogue');
  assert.match(viaCall.data.hint, /catalogue/);
});

test('Server Cards: one per server (front door, facts, every area server), schema-shaped; unknown → 404', async () => {
  const servers = cardServers();
  assert.deepEqual(Object.keys(servers), ['databutler', 'facts', ...Object.keys(SERVERS)]);
  for (const [key, s] of Object.entries(servers)) {
    const r = await invoke(router, undefined, { method: 'GET', url: `/api/router?route=server-card&server=${key}` });
    assert.equal(r.status, 200, key);
    assert.match(r.headers['Content-Type'], /^application\/mcp-server-card\+json/);
    assert.match(r.headers['Cache-Control'], /max-age=86400/);
    assert.equal(r.headers['Access-Control-Allow-Origin'], '*');
    const c = r.body;
    assert.equal(c.$schema, CARD_SCHEMA);
    assert.match(c.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    assert.ok(c.description.length >= 1 && c.description.length <= 100, key);
    assert.match(c.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(c.remotes, [{ type: 'streamable-http', url: s.url, supportedProtocolVersions: ['2025-06-18'] }]);
    assert.equal(c._meta['dev.databutler/facts'], 'https://databutler.dev/.well-known/facts.json');
    assert.deepEqual(c, serverCard(s));
  }
  assert.equal((await invoke(router, undefined, { method: 'GET', url: '/api/router?route=server-card&server=nope' })).status, 404);
});

test('server-facts.json: the registry manifest of the facts server', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server-facts.json'), 'utf8'));
  assert.equal(m.name, 'io.github.physics-star-cat/databutler-facts');
  assert.equal(m.description, cardServers().facts.description);
  assert.ok(m.description.length <= 100);
  assert.deepEqual(m.remotes, [{ type: 'streamable-http', url: 'https://databutler.dev/api/mcp/facts' }]);
});
