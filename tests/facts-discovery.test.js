// tests/facts-discovery.test.js — Verified Facts discovery (docs/FACTS_PROTOCOL.md §9.3, §10): facts.json, changes.json's
// pointer, openapi.json, ai-catalog.json, /protocol/facts, the spec's example, llms.txt, the sitemap — and every served
// record, miss and batch validating against the published schema (the conformance backbone).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { invoke, rewriteFor, routeOf } = require('./helpers');
const { validate, assertValid } = require('../api/_schema_check');
const { FACTS_WELL_KNOWN_URL } = require('../api/_changelog');
const { cardServers } = require('../api/_hub');
const router = require('../api/router');
const F = require('../api/_facts');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const FACT = readJson('public/schema/fact.v0.json');
const WKF = readJson('public/schema/well-known-facts.v0.json');
const WKC = readJson('public/schema/well-known-changes.v0.json');
const FACTS_JSON = readJson('public/.well-known/facts.json');
const CHANGES_JSON = readJson('public/.well-known/changes.json');
const OPENAPI = readJson('public/openapi.json');
const CATALOG = readJson('public/.well-known/ai-catalog.json');
const sub = (name) => ({ ...FACT.$defs[name], $defs: FACT.$defs });
const get = (url) => invoke(router, undefined, { method: 'GET', url });

test('schemas: draft 2020-12 with $id = served URL', () => {
  assert.equal(FACT.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(FACT.$id, 'https://databutler.dev/schema/fact.v0.json');
  assert.equal(WKF.$id, 'https://databutler.dev/schema/well-known-facts.v0.json');
  assert.deepEqual(WKF.required, ['protocol', 'publisher', 'conformance', 'facts', 'namespaces', 'hash', 'schema']);
  for (const p of ['/schema/fact.v0.json', '/schema/well-known-facts.v0.json', '/.well-known/facts.json', '/.well-known/jwks.json', '/.well-known/ai-catalog.json', '/openapi.json']) {
    assert.equal(rewriteFor(p), undefined, `${p} is served from public/ untouched`);
  }
});

test('/.well-known/facts.json validates; count, examples, namespaces and authorities agree with the index', () => {
  assertValid(WKF, FACTS_JSON, 'facts.json');
  assert.equal(FACTS_JSON.facts.count, F.FACT_COUNT);
  assert.equal(FACTS_JSON.conformance, 'L3');
  assert.equal(FACTS_JSON.facts.filtering, 'server');
  for (const k of FACTS_JSON.facts.examples) assert.ok(F.INDEX.has(k), k);
  assert.equal(FACTS_JSON.namespaces.reduce((n, x) => n + x.count, 0), F.FACT_COUNT);
  for (const ns of FACTS_JSON.namespaces) {
    const hosts = new Set();
    for (const [k, periods] of F.PERIODS) if (F.namespaceOf(k) === ns.name) for (const r of periods) hosts.add(new URL(r.source).hostname);
    assert.deepEqual([...ns.authorities].sort(), [...hosts].sort(), `${ns.name}: every source host is declared, and only those`);
  }
  assert.equal(FACTS_JSON.changes, 'https://databutler.dev/.well-known/changes.json');
  assert.equal(FACTS_JSON.keys, 'https://databutler.dev/.well-known/jwks.json');
  assert.deepEqual(FACTS_JSON.mcp.tools, ['get_fact', 'resolve_fact', 'what_changed_since']);
  assert.equal(routeOf(rewriteFor(new URL(FACTS_JSON.mcp.serverCard).pathname).destination), 'server-card');
  assert.equal(routeOf(rewriteFor(new URL(FACTS_JSON.facts.get.replace('{key}', 'uk/bank-rate')).pathname).destination), 'f');
});

test('/.well-known/changes.json validates against the updated schema and points at facts.json', () => {
  assertValid(WKC, CHANGES_JSON, 'changes.json');
  assert.equal(CHANGES_JSON.facts, FACTS_WELL_KNOWN_URL);
  assert.equal(CHANGES_JSON.protocol, 'verified-changes/0.1', 'v0.1 stays on the wire');
});

test('openapi.json: 3.1, four operations, every path dispatches to f or changes, x-verified-facts 0.3', () => {
  assert.match(OPENAPI.openapi, /^3\.1/);
  assert.equal(OPENAPI['x-verified-facts'], '0.3');
  assert.deepEqual(OPENAPI.servers, [{ url: 'https://databutler.dev' }]);
  const ops = Object.values(OPENAPI.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
  assert.deepEqual(ops.sort(), ['getFact', 'getFacts', 'resolveFact', 'whatChangedSince']);
  for (const p of Object.keys(OPENAPI.paths)) {
    const route = routeOf(rewriteFor(p.replace('{key}', 'uk/income-tax/personal-allowance')).destination);
    assert.ok(['f', 'changes'].includes(route), `${p} → ${route}`);
  }
});

test('ai-catalog.json: one MCP Server Card entry per server, each URL dispatching to server-card', () => {
  assert.equal(CATALOG.specVersion, '1.0');
  const servers = Object.values(cardServers());
  assert.equal(CATALOG.entries.length, servers.length);
  for (const e of CATALOG.entries) {
    assert.equal(e.type, 'application/mcp-server-card+json');
    assert.match(e.identifier, /^urn:air:databutler\.dev:mcp:/);
    assert.equal(routeOf(rewriteFor(new URL(e.url).pathname).destination), 'server-card', e.url);
  }
  assert.equal(new Set(CATALOG.entries.map((e) => e.identifier)).size, CATALOG.entries.length);
});

test('/protocol/facts: indexable HTML of the spec; ?format=md is the file byte for byte; unknown doc → 404', async () => {
  const r = await get('/api/router?route=protocol&doc=facts');
  assert.equal(r.status, 200);
  assert.match(String(r.raw), /<title>Verified Facts protocol[^<]*<\/title>/);
  assert.ok(String(r.raw).includes('<link rel="canonical" href="https://databutler.dev/protocol/facts">'));
  assert.doesNotMatch(String(r.raw), /<meta name="robots"/, 'indexable (the spec text itself mentions noindex)');
  assert.match(String(r.raw), /href="https:\/\/databutler\.dev\/protocol">verified-changes\/0\.1/, 'cross-links the changes spec');
  assert.match(String(r.raw), /<table><thead><tr><th>Layer<\/th>/, 'the spec\'s tables render as tables');
  const md = await get('/api/router?route=protocol&doc=facts&format=md');
  assert.equal(md.raw, read('docs/FACTS_PROTOCOL.md'));
  assert.equal((await get('/api/router?route=protocol&doc=nope')).status, 404);
  assert.match(String((await get('/api/router?route=protocol')).raw), /<title>Verified Changes protocol/);
});

test('the spec\'s ```json discovery example is the served facts.json (sync-areas owns it)', () => {
  const spec = read('docs/FACTS_PROTOCOL.md');
  const hit = [...spec.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).find((o) => o && o.namespaces && o.facts);
  assert.deepEqual(hit, FACTS_JSON);
});

test('every served record (every period) validates against fact.v0.json; a miss against $defs/miss; a batch against $defs/batch', () => {
  for (const [key, periods] of F.PERIODS) {
    for (const r of periods) {
      const served = r.period !== null && r !== F.INDEX.get(key) ? F.getFact(key, { period: r.period }) : r === F.INDEX.get(key) ? F.getFact(key) : F.getFact(key, { as_of: r.effectiveFrom });
      assert.equal(served.hash, r.hash, `${key} ${r.period}`);
      const v = validate(FACT, served);
      assert.ok(v.ok, `${key}: ${v.errors.join('; ')}`);
      for (const k of ['status', 'ageDays', 'maxAgeDays']) assert.ok(k in served, `${key} ${k} (L2)`);
    }
  }
  assertValid(sub('miss'), F.getFact('zz/nothing/here'), 'miss');
  assertValid(sub('miss'), F.getFact('threshold'), 'miss with candidates');
  assertValid(sub('batch'), F.getFacts(['uk/bank-rate', 'zz/nope/x']), 'batch');
  assertValid(sub('resolve'), F.resolveFact('NI primary threshold'), 'resolve');
});

test('the index validates against $defs/index', async () => {
  const r = await get('/api/router?route=f');
  assertValid(sub('index'), r.body, 'index');
});

test('llms.txt carries the two spec §10.3 lines; the sitemap lists /facts, /protocol/facts and every fact page — never /f/', () => {
  const llms = read('public/llms.txt');
  assert.ok(llms.includes('- `GET https://databutler.dev/f/uk/income-tax/personal-allowance?max_age=30d` — one verified official figure by key'));
  assert.ok(llms.includes('- `GET https://databutler.dev/.well-known/facts.json` — Verified Facts protocol discovery (verified-facts/0.3)'));
  const sitemap = read('public/sitemap.xml');
  for (const p of ['/facts', '/protocol/facts', '/protocol/publish', '/facts/publishers']) assert.ok(sitemap.includes(`<loc>https://databutler.dev${p}</loc>`), p);
  const pages = [...sitemap.matchAll(/<loc>https:\/\/databutler\.dev\/facts\/([^<]+)<\/loc>/g)].map((m) => m[1]).filter((k) => k !== 'publishers');
  assert.deepEqual(pages.sort(), [...F.INDEX.keys()].sort());
  assert.doesNotMatch(sitemap, /<loc>https:\/\/databutler\.dev\/f[/<]/, 'the negotiating /f URLs are machine URLs, not sitemap pages');
});

test('README catalogue names /api/mcp/facts; index.html names /facts/<key> and links the publisher guide', () => {
  assert.match(read('README.md'), /\| Verified Facts — `\/api\/mcp\/facts` \| `get_fact`, `resolve_fact`, `what_changed_since`/);
  assert.match(read('public/index.html'), /href="\/facts\/uk\/income-tax\/personal-allowance"/);
  assert.match(read('public/index.html'), /href="\/protocol\/publish"/);
});

/* ---------------- v0.3 discovery ---------------- */

test('v0.3 facts.json: protocol 0.3, facts.page template, digest over every fact and per namespace', () => {
  const { digestOf } = require('../api/_facts_sign');
  assert.equal(FACTS_JSON.protocol, 'verified-facts/0.3');
  assert.equal(FACTS_JSON.facts.page, 'https://databutler.dev/facts/{key}');
  assert.equal(routeOf(rewriteFor(new URL(FACTS_JSON.facts.page.replace('{key}', 'uk/bank-rate')).pathname).destination), 'f');
  assert.equal(FACTS_JSON.facts.digest, F.DIGEST);
  assert.equal(FACTS_JSON.facts.digest, digestOf([...F.INDEX.values()].map((r) => [r.key, r.hash])), 'sha256 over JCS of sorted [key, hash] pairs');
  for (const ns of FACTS_JSON.namespaces) {
    assert.match(ns.digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(ns.digest, digestOf([...F.INDEX.values()].filter((r) => F.namespaceOf(r.key) === ns.name)), ns.name);
  }
});

test('v0.3 schemas accept 0.2 and 0.3 documents alike, and nothing else', () => {
  const v02 = { ...FACTS_JSON, protocol: 'verified-facts/0.2', facts: { ...FACTS_JSON.facts } };
  delete v02.facts.page; delete v02.facts.digest;
  v02.namespaces = v02.namespaces.map(({ digest, ...n }) => n);
  assertValid(WKF, v02, 'a 0.2 facts.json still validates');
  assert.equal(validate(WKF, { ...FACTS_JSON, protocol: 'verified-facts/0.9' }).ok, false);
  const rec = F.getFact('uk/income-tax/personal-allowance');
  assertValid(FACT, rec, '0.3 record');
  const old = { ...rec, protocol: 'verified-facts/0.2' };
  for (const k of ['changeCadence', 'nextExpectedChange', 'sourceCheckedAt', 'staleReason']) delete old[k];
  assertValid(FACT, old, 'a 0.2 record still validates');
  assert.equal(validate(FACT, { ...rec, staleReason: 'because' }).ok, false, 'staleReason is an enum');
  assert.equal(validate(FACT, { ...rec, changeCadence: 'often' }).ok, false, 'changeCadence is an enum');
  // the protocol enum appears everywhere the record, miss, batch, index and resolve name it
  const enums = JSON.stringify(FACT).match(/"protocol":\{"enum":\["verified-facts\/0\.2","verified-facts\/0\.3"\]\}/g) || [];
  assert.equal(enums.length, 5);
  assert.doesNotMatch(JSON.stringify(FACT) + JSON.stringify(WKF), /"const":"verified-facts\/0\.2"/);
});
