// tests/facts-http.test.js — Verified Facts over HTTPS (docs/FACTS_PROTOCOL.md §9.1) through api/router.js: every /f
// representation and header, the 404 shape, batch GET/POST, the index, reserved paths, rewrite dispatch, caching, CORS.
const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke, rewriteFor, routeOf, VERCEL } = require('./helpers');
const { withNow } = require('./fake-clock');
const { plusDays } = require('../api/_area_kit');
const router = require('../api/router');
const F = require('../api/_facts');

const PA = 'uk/income-tax/personal-allowance';
const REC = F.INDEX.get(PA);
const get = (url, headers = {}) => invoke(router, undefined, { method: 'GET', url, headers });
const fact = (key, qs = '', headers) => get(`/api/router?route=f&key=${encodeURIComponent(key)}${qs}`, headers);

test('GET /f/{key}: 200 JSON record with ETag = hash, Last-Modified = verifiedDate, edge cache, X-Facts-Status, Link, CORS', async () => {
  const r = await fact(PA);
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'], /^application\/json/);
  assert.equal(r.body.key, PA);
  assert.equal(r.body.value, 12570);
  assert.equal(r.headers.ETag, `"${REC.hash}"`);
  assert.match(r.headers.ETag, /^"sha256:[0-9a-f]{64}"$/);
  assert.equal(r.headers['Last-Modified'], new Date(`${REC.verifiedDate}T00:00:00Z`).toUTCString());
  assert.match(r.headers['Cache-Control'], /s-maxage=3600/);
  assert.match(r.headers['Cache-Control'], /stale-while-revalidate=86400/);
  assert.equal(r.headers['X-Facts-Status'], r.body.status);
  assert.equal(r.headers.Link, '</.well-known/facts.json>; rel="describedby"');
  assert.equal(r.headers['Access-Control-Allow-Origin'], '*');
  const again = await fact(PA, '', { 'if-none-match': r.headers.ETag });
  assert.equal(again.status, 304);
});

test('max_age with a pinned clock: stale in the header and the body, value still served', async () => {
  await withNow(plusDays(REC.verifiedDate, 31), async () => {
    const r = await fact(PA, '&max_age=30d');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'stale');
    assert.equal(r.headers['X-Facts-Status'], 'stale');
    assert.equal(r.body.maxAgeDays, 30);
    assert.equal(r.body.value, 12570);
  });
});

test('txt: one line by ?format=txt or Accept: text/plain', async () => {
  const line = /^12570 GBP\/year \(2026-27, from 2026-04-06\) verified \d{4}-\d{2}-\d{2} (fresh|stale) https:\/\/www\.gov\.uk\//;
  const a = await fact(PA, '&format=txt');
  assert.match(a.headers['Content-Type'], /^text\/plain/);
  assert.match(a.raw, line);
  assert.equal(a.raw.trim().split('\n').length, 1);
  const b = await fact(PA, '', { accept: 'text/plain' });
  assert.match(b.raw, line);
});

test('html: indexable fact page with canonical, JSON alternate and a schema.org Claim', async () => {
  for (const r of [await fact(PA, '&format=html'), await fact(PA, '', { accept: 'text/html,application/xhtml+xml' })]) {
    assert.match(r.headers['Content-Type'], /^text\/html/);
    assert.doesNotMatch(r.raw, /noindex/);
    assert.ok(r.raw.includes(`<link rel="canonical" href="https://databutler.dev/facts/${PA}">`), 'v0.3: canonical is the /facts page');
    assert.ok(r.raw.includes(`<link rel="alternate" type="application/json" title="This fact as JSON" href="https://databutler.dev/f/${PA}?format=json">`), 'the JSON alternate stays on /f');
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(r.raw)[1]);
    assert.equal(ld['@type'], 'Claim');
    assert.equal(ld.datePublished, REC.verifiedDate);
    assert.equal(ld.appearance.url, REC.source);
    assert.ok(r.raw.includes(REC.source));
  }
  assert.equal((await fact(PA, '&format=xml')).status, 400);
});

test('unknown key: 404 JSON { error, requestedKey, candidates, index }, no-store', async () => {
  const r = await fact('zz/nothing/here');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'unknown key');
  assert.equal(r.body.requestedKey, 'zz/nothing/here');
  assert.ok(Array.isArray(r.body.candidates));
  assert.equal(r.body.index, 'https://databutler.dev/f');
  assert.equal(r.headers['Cache-Control'], 'no-store');
  const loose = await fact('threshold');
  assert.equal(loose.status, 404);
  assert.ok(loose.body.candidates.length > 0);
  const period = await fact(PA, '&period=2019-20');
  assert.equal(period.status, 200);
  assert.equal(period.body.covered, false);
  assert.equal(period.headers['Cache-Control'], 'no-store');
  assert.equal((await fact(PA, '&max_age=soon')).status, 400);
});

test('reserved path /f/resolve answers the resolve document', async () => {
  const r = await get('/api/router?route=f&key=resolve&q=NI%20primary%20threshold');
  assert.equal(r.status, 200);
  assert.equal(r.body.protocol, 'verified-facts/0.3');
  assert.equal(r.body.candidates[0].key, F.ALIASES.get('uk/national-insurance/primary-threshold'));
  assert.equal((await get('/api/router?route=f&key=resolve')).status, 400);
});

test('batch: GET ?keys= (misses inside do not fail it), POST {keys}, 51 keys → 400', async () => {
  const r = await get(`/api/router?route=f&keys=${PA},us/social-security/wage-base,zz/missing/key`);
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 3);
  assert.equal(r.body.results[2].covered, false);
  assert.equal(r.headers['X-Facts-Status'], r.body.status);
  const p = await invoke(router, { keys: [PA, 'de/income-tax/grundfreibetrag'], max_age: '400d' }, { method: 'POST', url: '/api/router?route=f' });
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.results.map((x) => x.key), [PA, 'de/income-tax/grundfreibetrag']);
  const big = await get(`/api/router?route=f&keys=${Array.from({ length: 51 }, () => PA).join(',')}`);
  assert.equal(big.status, 400);
  assert.equal(big.headers['Cache-Control'], 'no-store');
  const comma = await fact(`${PA},us/social-security/wage-base`);
  assert.equal(comma.body.count, 2, '/f/k1,k2 is a batch too');
});

test('index: JSON with count = FACT_COUNT and hashes; HTML with a Dataset whose variableMeasured covers every key', async () => {
  const r = await get('/api/router?route=f');
  assert.equal(r.status, 200);
  assert.equal(r.body.count, F.FACT_COUNT);
  assert.ok(r.body.facts[0].hash);
  assert.match(r.body.generated, /^\d{4}-\d{2}-\d{2}$/);
  const ns = await get('/api/router?route=f&namespace=de');
  assert.ok(ns.body.count > 40 && ns.body.facts.every((e) => e.key.startsWith('de/')));
  const h = await get('/api/router?route=f&format=html');
  assert.match(h.headers['Content-Type'], /^text\/html/);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(h.raw)[1]);
  assert.equal(ld['@type'], 'Dataset');
  assert.equal(ld.variableMeasured.length, F.FACT_COUNT);
  assert.equal(ld.distribution[0].contentUrl, 'https://databutler.dev/f');
});

test('trailing slash and OPTIONS', async () => {
  const r = await fact(`${PA}/`);
  assert.equal(r.status, 200);
  assert.equal(r.body.key, PA);
  const o = await invoke(router, undefined, { method: 'OPTIONS', url: `/api/router?route=f&key=${PA}` });
  assert.equal(o.status, 204);
});

test('vercel rewrites dispatch /f, /f/<key>, /facts, /protocol/facts and server cards to the intended route', () => {
  const pa = rewriteFor(`/f/${PA}`);
  assert.equal(routeOf(pa.destination), 'f');
  assert.equal(new URL(pa.destination, 'https://x').searchParams.get('key'), PA);
  assert.equal(routeOf(rewriteFor('/f').destination), 'f');
  assert.equal(routeOf(rewriteFor('/f/resolve').destination), 'f');
  assert.equal(routeOf(rewriteFor('/facts').destination), 'f');
  assert.equal(new URL(rewriteFor('/facts').destination, 'https://x').searchParams.get('page'), '1');
  const spec = rewriteFor('/protocol/facts');
  assert.equal(routeOf(spec.destination), 'protocol');
  assert.equal(new URL(spec.destination, 'https://x').searchParams.get('doc'), 'facts');
  const card = rewriteFor('/api/mcp/facts/server-card');
  assert.equal(routeOf(card.destination), 'server-card');
  assert.equal(new URL(card.destination, 'https://x').searchParams.get('server'), 'facts');
  assert.equal(routeOf(rewriteFor('/api/mcp/facts').destination), 'mcp/facts', 'the server itself still routes as mcp/facts');
  assert.match(VERCEL.functions['api/router.js'].includeFiles, /docs\/FACTS_PROTOCOL\.md/);
});

test('fact pages: HTML and text requests rewrite to their own CDN cache key; JSON keeps the plain one; Vary: Accept', async () => {
  // Vercel cached whichever format was requested first and served it to everyone (2026-10-25: Googlebot got JSON).
  const PA = 'uk/income-tax/personal-allowance';
  const html = rewriteFor(`/f/${PA}`, { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' });
  const txt = rewriteFor(`/f/${PA}`, { accept: 'text/plain' });
  const json = rewriteFor(`/f/${PA}`, { accept: 'application/json' });
  const neg = (r) => new URL(r.destination, 'https://databutler.dev').searchParams.get('neg');
  assert.equal(neg(html), 'html');
  assert.equal(neg(txt), 'txt');
  assert.equal(neg(json), null);
  assert.equal(neg(rewriteFor('/f', { accept: 'text/html' })), 'html');
  const router = require('../api/router');
  const r = await invoke(router, undefined, { method: 'GET', url: `/api/router?route=f&key=${PA}&neg=html`, headers: { accept: 'application/json' } });
  assert.match(String(r.headers['Content-Type']), /text\/html/);
  assert.equal(r.headers.Vary, 'Accept');
  const q = await invoke(router, undefined, { method: 'GET', url: `/api/router?route=f&key=${PA}&neg=html&format=json`, headers: {} });
  assert.match(String(q.headers['Content-Type']), /application\/json/, '?format= still wins');
});

/* ---------------- v0.3: /facts/{key}, the page that never negotiates (spec §9.1) ---------------- */

/** Dispatch a public path as Vercel would (vercel.json rewrite, then the router). */
async function viaVercel(p, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const rw = rewriteFor(p.split('?')[0], lower);
  assert.ok(rw, `no rewrite for ${p}`);
  const qs = p.includes('?') ? `&${p.split('?')[1]}` : '';
  return invoke(router, undefined, { method: 'GET', url: `${rw.destination}${qs}`, headers: lower });
}
const BINGBOT = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';

test('v0.3 GET /facts/<key> with Accept: */* (Bingbot) → 200 text/html, canonical /facts/<key>, the JSON-LD record', async () => {
  for (const headers of [{ 'user-agent': BINGBOT, accept: '*/*' }, {}, { accept: 'text/plain' }, { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }, { accept: 'application/json, text/html' }]) {
    const r = await viaVercel(`/facts/${PA}`, headers);
    assert.equal(r.status, 200, JSON.stringify(headers));
    assert.match(r.headers['Content-Type'], /^text\/html/, JSON.stringify(headers));
    assert.ok(r.raw.includes(`<link rel="canonical" href="https://databutler.dev/facts/${PA}">`));
    assert.ok(r.raw.includes(`href="https://databutler.dev/f/${PA}?format=json"`), 'links the machine URL');
    assert.doesNotMatch(r.raw, /noindex/);
    assert.match(r.raw, /next expected change/);
  }
  // ?format= does not negotiate on the page either
  assert.match((await viaVercel(`/facts/${PA}?format=json`)).headers['Content-Type'], /^text\/html/);
});

test('v0.3 GET /facts/<key> with Accept: application/json → 302 to /f/<key> (query kept), no-store; /facts → /f', async () => {
  const r = await viaVercel(`/facts/${PA}?max_age=30d`, { accept: 'application/json' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.Location, `/f/${PA}?max_age=30d`);
  assert.equal(r.headers['Cache-Control'], 'no-store', 'a cached redirect must never reach a browser or a crawler');
  const rw = rewriteFor(`/facts/${PA}`, { accept: 'application/json' });
  assert.equal(new URL(rw.destination, 'https://x').searchParams.get('neg'), 'json', 'its own CDN cache key');
  const idx = await viaVercel('/facts', { accept: 'application/json' });
  assert.deepEqual([idx.status, idx.headers.Location], [302, '/f']);
});

test('v0.3 GET /f/<key> with Accept: */* → JSON as before; with text/html → HTML canonical to /facts/<key>', async () => {
  const j = await viaVercel(`/f/${PA}`, { accept: '*/*' });
  assert.match(j.headers['Content-Type'], /^application\/json/);
  assert.equal(j.body.cite.url, `https://databutler.dev/facts/${PA}`);
  const h = await viaVercel(`/f/${PA}`, { accept: 'text/html' });
  assert.match(h.headers['Content-Type'], /^text\/html/);
  assert.ok(h.raw.includes(`<link rel="canonical" href="https://databutler.dev/facts/${PA}">`));
});

test('v0.3 GET /facts → the HTML index page, canonical /facts, every key linked to its /facts page', async () => {
  const r = await viaVercel('/facts', { accept: '*/*' });
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'], /^text\/html/);
  assert.ok(r.raw.includes('<link rel="canonical" href="https://databutler.dev/facts">'));
  for (const k of [...F.INDEX.keys()].slice(0, 25)) assert.ok(r.raw.includes(`<a href="/facts/${k}">`), k);
  assert.doesNotMatch(r.raw, /<a href="\/f\/[a-z]/);
});

test('v0.3 /facts misses and batches: 404 HTML with candidates (noindex); k1,k2 → one noindex page', async () => {
  const m = await viaVercel('/facts/zz/nothing/here');
  assert.equal(m.status, 404);
  assert.match(m.headers['Content-Type'], /^text\/html/);
  assert.match(m.raw, /noindex/);
  assert.equal(m.headers['Cache-Control'], 'no-store');
  const b = await viaVercel(`/facts/${PA},uk/bank-rate`);
  assert.equal(b.status, 200);
  assert.match(b.raw, /noindex/);
  assert.ok(b.raw.includes('<a href="/facts/uk/bank-rate">'));
});

test('v0.3 cite.url on every record starts with https://databutler.dev/facts/', () => {
  for (const [key, periods] of F.PERIODS) {
    assert.ok(F.getFact(key).cite.url.startsWith(`https://databutler.dev/facts/${key}`), key);
    for (const r of periods.slice(1)) {
      const served = r.period !== null ? F.getFact(key, { period: r.period }) : F.getFact(key, { as_of: r.effectiveFrom });
      assert.ok(served.cite.url.startsWith(`https://databutler.dev/facts/${key}?`), `${key} ${r.period}`);
    }
  }
});

/* ---------------- v0.3: the index digest and its ETag (spec §5.6) ---------------- */

test('v0.3 GET /f: digest in the body, ETag = "<digest>", If-None-Match → 304; per namespace likewise', async () => {
  const r = await get('/api/router?route=f');
  assert.match(r.body.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(r.body.digest, F.DIGEST);
  assert.equal(r.headers.ETag, `"${F.DIGEST}"`);
  const again = await get('/api/router?route=f', { 'if-none-match': r.headers.ETag });
  assert.equal(again.status, 304);
  assert.equal(again.headers.ETag, r.headers.ETag);
  assert.equal(again.raw, undefined, 'no body');
  assert.equal((await get('/api/router?route=f', { 'if-none-match': `W/${r.headers.ETag}` })).status, 304, 'weak comparison');
  assert.equal((await get('/api/router?route=f', { 'if-none-match': '"sha256:0000"' })).status, 200);
  const de = await get('/api/router?route=f&namespace=de');
  assert.equal(de.body.digest, F.digestFor('de'));
  assert.notEqual(de.body.digest, r.body.digest);
  assert.equal(de.headers.ETag, `"${F.digestFor('de')}"`);
  const none = await get('/api/router?route=f&namespace=zz');
  assert.equal(none.body.count, 0);
  assert.equal(none.headers.ETag, undefined, 'an empty selection has no digest');
  // index entries carry the v0.3 fields
  const e = r.body.facts.find((x) => x.key === 'uk/bank-rate');
  assert.equal(e.changeCadence, 'scheduled');
  assert.equal(e.nextExpectedChange, require('../data/policy-rates.json').banks.boe.nextDecision);
});
