// tests/cache.test.js — REST answers are edge-cacheable; errors and near-misses are not
const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke } = require('./helpers');
const router = require('../api/router');
const get = (url) => invoke(router, undefined, { method: 'GET', url });

test('curated REST answer: 1 h at the edge, a day stale-while-revalidate', async () => {
  const r = await get('/api/router?route=uk/rates&category=vat');
  assert.equal(r.status, 200);
  assert.match(r.headers['Cache-Control'], /s-maxage=3600/);
  assert.match(r.headers['Cache-Control'], /stale-while-revalidate=86400/);
});

test('missing required param (400) is never cached', async () => {
  const r = await get('/api/router?route=policy-rates');
  assert.equal(r.status, 400);
  assert.ok(!/s-maxage/.test(r.headers['Cache-Control'] || ''));
});

test('a near-miss (covered:false) is not cached', async () => {
  const r = await get('/api/router?route=policy-rates&bank=boj');
  assert.equal(r.body.covered, false);
  assert.equal(r.headers['Cache-Control'], 'no-store');
});

test('live tools get the short window', () => {
  const { cacheHeaders } = require('../api/_rest');
  assert.match(cacheHeaders({ openWorld: true })['Cache-Control'], /s-maxage=300/);
});

test('a fact record caches 1 h at the edge; a fact miss is never cached', async () => {
  const hit = await get('/api/router?route=f&key=uk/income-tax/personal-allowance');
  assert.match(hit.headers['Cache-Control'], /s-maxage=3600/);
  const miss = await get('/api/router?route=f&key=zz/no/such-fact');
  assert.equal(miss.status, 404);
  assert.equal(miss.headers['Cache-Control'], 'no-store');
});
