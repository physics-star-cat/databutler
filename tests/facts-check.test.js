// tests/facts-check.test.js — the public conformance checker (scripts/facts-check.js, spec §11): the L1 fixture passes L1
// and fails L2 on the server items; Data Butler's own router passes L3 (the weekly self-check); tampering is caught.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { routerFetch } = require('./helpers');
const { checkSite, format } = require('../scripts/facts-check');
const { buildStatic } = require('../scripts/facts-static');

const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/facts-static/facts-source.json'), 'utf8'));
const item = (report, n) => report.results.find((r) => r.item === n);

/** A static host serving the generator's output (plus a minimal changes.json naming facts) — no server logic at all. */
function staticFetch(files, origin = 'https://cars.example.org') {
  const all = {
    ...files,
    '.well-known/changes.json': JSON.stringify({
      protocol: 'verified-changes/0.1', publisher: SRC.publisher, areas: [], endpoints: { json: `${origin}/changes.json` },
      schema: 'https://databutler.dev/schema/changes.v0.json', facts: `${origin}/.well-known/facts.json`,
    }),
  };
  return async (url) => {
    const u = new URL(url);
    const body = u.origin === origin ? all[decodeURIComponent(u.pathname).replace(/^\//, '')] : undefined;
    const status = body === undefined ? 404 : 200;
    return { status, headers: { get: (n) => (/content-type/i.test(n) ? (status === 200 ? 'application/json' : 'text/html') : null) }, text: async () => body || 'not found' };
  };
}

test('the L1 fixture passes L1 and fails L2 on the server items (8, 9, 11, 13)', async () => {
  const { files } = buildStatic(SRC);
  const r = await checkSite('https://cars.example.org', { fetchFn: staticFetch(files), offline: true });
  assert.equal(r.declared, 'L1');
  assert.equal(r.reached, 'L1', format(r));
  assert.equal(r.ok, true);
  for (const n of [1, 2, 3, 5, 6, 7]) assert.equal(item(r, n).ok, true, `item ${n}: ${item(r, n).detail}`);
  const l2 = await checkSite('https://cars.example.org', { fetchFn: staticFetch(files), offline: true, level: 'L2' });
  assert.equal(l2.ok, false);
  for (const n of [8, 9, 11, 13]) assert.equal(item(l2, n).ok, false, `item ${n} fails for a static publisher`);
  assert.deepEqual(Object.keys(l2.results[0]).sort(), ['detail', 'item', 'level', 'ok']);
});

test('Data Butler\'s own router passes L3 offline — the self-check the Monday watcher runs', async () => {
  const r = await checkSite('https://databutler.dev', { fetchFn: routerFetch(), offline: true, sample: 40 });
  assert.equal(r.declared, 'L3');
  assert.equal(r.reached, 'L3', format(r));
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map((x) => x.item), Array.from({ length: 18 }, (_, i) => i + 1));
});

test('a tampered record fails item 3 (hash) and item 15 (signature)', async () => {
  const inner = routerFetch();
  const tampering = async (url, init) => {
    const res = await inner(url, init);
    if (!new URL(url).pathname.startsWith('/f/uk/income-tax/personal-allowance')) return res;
    const text = (await res.text()).replace('"value": 12570', '"value": 99999');
    return { ...res, text: async () => text };
  };
  const r = await checkSite('https://databutler.dev', { fetchFn: tampering, offline: true });
  assert.equal(item(r, 3).ok, false);
  assert.match(item(r, 3).detail, /uk\/income-tax\/personal-allowance: hash/);
  assert.equal(r.ok, false);
  // with the hash recomputed to match, the signature still catches it
  const { hashOf } = require('../api/_facts_sign');
  const forging = async (url, init) => {
    const res = await inner(url, init);
    if (new URL(url).pathname !== '/f/uk/income-tax/personal-allowance' || new URL(url).search || (init && init.headers)) return res;
    const rec = JSON.parse(await res.text());
    const forged = { ...rec, value: 99999 };
    forged.hash = hashOf(forged);
    return { ...res, text: async () => JSON.stringify(forged) };
  };
  const forged = await checkSite('https://databutler.dev', { fetchFn: forging, offline: true, sample: 1 });
  assert.equal(item(forged, 3).ok, false, 'the index still carries the true hash');
  assert.equal(item(forged, 15).ok, false, item(forged, 15).detail);
  assert.match(item(forged, 15).detail, /uk\/income-tax\/personal-allowance: signature EdDSA signature does not verify/);
});
