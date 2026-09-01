const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke } = require('./helpers');
const r = require('../api/r');
const { ALL_TOOLS } = require('../api/_registry');

const get = (url) => invoke(r, undefined, { method: 'GET', url });

test('/r/uk/rates renders the answer, source link, verified date, noindex', async () => {
  const res = await get('/api/r?path=uk/rates&category=income-tax');
  assert.equal(res.status, 200);
  assert.match(res.headers['Content-Type'], /text\/html/);
  assert.equal(res.headers['X-Robots-Tag'], 'noindex');
  const html = String(res.raw);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /https:\/\/www\.gov\.uk\/income-tax-rates/);
  assert.match(html, /Personal Allowance/);
  assert.match(html, /verified 2026-08-31/);
  assert.match(html, /href="\/api\/uk\/rates\?category=income-tax"/);
});

test('/r/stats decodes JSON-encoded query values', async () => {
  const res = await get('/api/r?path=stats&op=descriptive&data=%5B1%2C2%2C3%5D');
  assert.equal(res.status, 200);
  assert.match(String(res.raw), /"mean": 2/);
});

test('/r/changes and /r/coverage route to hub tools', async () => {
  assert.equal((await get('/api/r?path=changes&since=2026-06-01')).status, 200);
  assert.match(String((await get('/api/r?path=coverage')).raw), /uk-exams/);
});

test('unknown route → 404 listing routes; HTML is escaped', async () => {
  const res = await get('/api/r?path=nope/<script>');
  assert.equal(res.status, 404);
  assert.doesNotMatch(String(res.raw), /<script>/);
  assert.match(String(res.raw), /uk\/rates/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('a thrown tool error renders a generic message, never the raw error, and is not cached', async () => {
  const original = ALL_TOOLS.uk_rates_lookup.run;
  ALL_TOOLS.uk_rates_lookup.run = () => { throw new Error('ENOTFOUND upstream.example'); };
  try {
    const res = await get('/api/r?path=uk/rates&category=income-tax');
    assert.equal(res.status, 200);
    const html = String(res.raw);
    assert.match(html, /The live lookup failed upstream/);
    assert.doesNotMatch(html, /ENOTFOUND/);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  } finally {
    ALL_TOOLS.uk_rates_lookup.run = original;
  }
});
