// tests/facts-publish.test.js — the publisher side of Verified Facts v0.3: /protocol/publish (the L1 recipe, the digest
// check, the levels), /facts/publishers rendered from data/publishers.json + data/publisher-checks.json with static
// level badges, and scripts/check-publishers.js run in-process against the router.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { invoke, rewriteFor, routeOf, routerFetch, VERCEL } = require('./helpers');
const router = require('../api/router');
const { rows, html } = require('../api/_routes/publishers');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const get = (url, headers = {}) => invoke(router, undefined, { method: 'GET', url, headers });
const via = async (p) => { const rw = rewriteFor(p); assert.ok(rw, p); return get(rw.destination); };

test('/protocol/publish: an indexable page of docs/PUBLISH_FACTS.md; ?format=md is the file; bundled with the function', async () => {
  assert.equal(routeOf(rewriteFor('/protocol/publish').destination), 'protocol');
  const r = await via('/protocol/publish');
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'], /^text\/html/);
  assert.ok(r.raw.includes('<link rel="canonical" href="https://databutler.dev/protocol/publish">'));
  assert.match(r.raw, /<title>Publish your figures as Verified Facts in an afternoon/);
  assert.doesNotMatch(r.raw, /<meta name="robots"/);
  const md = await get('/api/router?route=protocol&doc=publish&format=md');
  assert.equal(md.raw, read('docs/PUBLISH_FACTS.md'));
  assert.match(VERCEL.functions['api/router.js'].includeFiles, /docs\/PUBLISH_FACTS\.md/);
});

test('docs/PUBLISH_FACTS.md carries the L1 recipe, the digest check and the three levels', () => {
  const md = read('docs/PUBLISH_FACTS.md');
  for (const s of ['facts-source.json', 'npx verified-facts static facts-source.json --out public --check', 'Commit `public/`', 'npx verified-facts check https://', 'facts.digest', 'what_changed_since', 'If-None-Match', '**L1**', '**L2**', '**L3**', 'https://databutler.dev/facts/publishers']) {
    assert.ok(md.includes(s), s);
  }
  // the recipe's example is valid generator input
  const src = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(md)[1]);
  const { buildStatic } = require('../scripts/facts-static');
  assert.equal(buildStatic(src).conformance, 'L1');
  // the vendoring list matches what the vendoring test copies
  for (const f of ['scripts/facts-static.js', 'scripts/facts-check.js', 'api/_jcs.js', 'api/_facts_sign.js', 'api/_schema_check.js', 'fact.v0.json', 'well-known-facts.v0.json', 'well-known-changes.v0.json']) assert.ok(md.includes(f), f);
});

test('home page and llms.txt link /protocol/publish (one line in llms.txt)', () => {
  assert.match(read('public/index.html'), /<a href="\/protocol\/publish">/);
  const lines = read('public/llms.txt').split('\n').filter((l) => l.includes('/protocol/publish'));
  assert.equal(lines.length, 1);
});

test('/facts/publishers: rewritten before /facts/(.*); lists every entry of data/publishers.json with a badge', async () => {
  const LIST = require('../data/publishers.json');
  assert.equal(routeOf(rewriteFor('/facts/publishers').destination), 'publishers');
  assert.equal(routeOf(rewriteFor('/facts/uk/bank-rate').destination), 'f', 'fact pages still route to f');
  const r = await via('/facts/publishers');
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'], /^text\/html/);
  assert.ok(r.raw.includes('<link rel="canonical" href="https://databutler.dev/facts/publishers">'));
  for (const p of LIST.publishers) assert.ok(r.raw.includes(`href="${p.facts}"`), p.facts);
  assert.match(r.raw, /<img src="\/badge\/facts-(L1|L2|L3|unchecked|failing)\.svg"/);
  const j = await get('/api/router?route=publishers&format=json');
  assert.equal(j.body.count, LIST.publishers.length);
  assert.ok(LIST.publishers.some((p) => p.facts === 'https://databutler.dev/.well-known/facts.json'), 'Data Butler is listed');
  for (const p of LIST.publishers) {
    assert.match(p.facts, /^https:\/\/[^/]+\/\.well-known\/facts\.json$/);
    assert.match(p.listed, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(p.name);
  }
});

test('badges: static SVGs for L1, L2, L3, unchecked and failing, served from public/ untouched', () => {
  for (const b of ['L1', 'L2', 'L3', 'unchecked', 'failing']) {
    const p = `public/badge/facts-${b}.svg`;
    const svg = read(p);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /aria-label="verified facts: /);
    assert.doesNotMatch(svg, /<script|href=/, 'no script, no external reference');
    assert.equal(rewriteFor(`/badge/facts-${b}.svg`), undefined);
  }
});

test('rows(): the badge is the level the check reached — unchecked without a check, failing on an error or none reached', () => {
  const list = { publishers: [
    { facts: 'https://a.example/.well-known/facts.json', name: 'A', listed: '2026-10-31' },
    { facts: 'https://b.example/.well-known/facts.json', name: 'B', listed: '2026-10-31' },
    { facts: 'https://c.example/.well-known/facts.json', name: 'C', listed: '2026-10-31' },
    { facts: 'https://d.example/.well-known/facts.json', name: 'D', listed: '2026-10-31' },
  ] };
  const checks = {
    'https://a.example/.well-known/facts.json': { checkedAt: '2026-11-02', protocol: 'verified-facts/0.3', declared: 'L3', reached: 'L1', ok: false, count: 4, failed: [{ item: 15, level: 'L3', detail: 'unsigned' }] },
    'https://b.example/.well-known/facts.json': { checkedAt: '2026-11-02', protocol: 'verified-facts/0.3', declared: 'L3', reached: 'L3', ok: true, count: 9, failed: [] },
    'https://c.example/.well-known/facts.json': { checkedAt: '2026-11-02', error: 'ENOTFOUND' },
  };
  const r = rows(list, checks);
  assert.deepEqual(r.map((x) => [x.name, x.badge]), [['B', 'L3'], ['A', 'L1'], ['C', 'failing'], ['D', 'unchecked']], 'sorted by level reached, then name');
  const page = html(r);
  assert.match(page, /declares L3, reached L1; 4 facts/);
  assert.match(page, /failing: item 15 \(L3\)/);
  assert.match(page, /not checked yet/);
  assert.match(page, /the check could not run \(ENOTFOUND\)/);
});

test('scripts/check-publishers.js against the router: Data Butler reaches L3; the owner marker rides on its requests', async () => {
  const { run, siteOf } = require('../scripts/check-publishers');
  assert.equal(siteOf('https://databutler.dev/.well-known/facts.json'), 'https://databutler.dev');
  const inner = routerFetch();
  let marked = 0;
  let total = 0;
  const fetchFn = async (url, init = {}) => { total += 1; if ((init.headers || {})['x-databutler-owner'] === '1') marked += 1; return inner(url, init); };
  const out = await run({ dry: true, fetchFn, list: { publishers: [{ facts: 'https://databutler.dev/.well-known/facts.json', name: 'Data Butler', listed: '2026-10-31' }] } });
  const c = out['https://databutler.dev/.well-known/facts.json'];
  assert.equal(c.reached, 'L3', JSON.stringify(c.failed));
  assert.equal(c.protocol, 'verified-facts/0.3');
  assert.equal(c.declared, 'L3');
  assert.ok(c.count > 400);
  assert.deepEqual(c.failed, []);
  assert.equal(marked, total, 'every request to databutler.dev is marked as the owner\'s');
});
