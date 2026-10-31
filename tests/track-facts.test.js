// Fact-demand tracking (api/_track.js): records which facts agents ask for, but never free text —
// the promise in public/privacy.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../api/_facts');
const { factLookups, keyShaped } = require('../api/_track');

test('a hit records the canonical key', () => {
  const [l] = factLookups('get', F.getFact('uk/income-tax/personal-allowance', {}));
  assert.equal(l.fact_key, 'uk/income-tax/personal-allowance');
  assert.ok(['hit', 'stale'].includes(l.fact_result));
});

test('an auto-resolved loose key records the canonical key, not the text', () => {
  const [l] = factLookups('get', F.getFact('personal allowance', {}));
  assert.equal(l.fact_key, 'uk/income-tax/personal-allowance');
  assert.equal(l.fact_result, 'resolved');
});

test('a key-shaped miss is recorded with its nearest candidate', () => {
  const [l] = factLookups('get', F.getFact('us/fha/loan-limit-2026', {}));
  assert.equal(l.fact_result, 'miss');
  assert.equal(l.fact_key, 'us/fha/loan-limit-2026');
  assert.match(l.fact_nearest, /^[a-z]{2}\//);
});

test('a free-text miss never records the text', () => {
  const text = 'what is my neighbour john smith salary at 12 high street';
  const [l] = factLookups('get', F.getFact(text, {}));
  assert.equal(l.fact_result, 'miss');
  assert.equal(l.fact_key, '(free-text)');
  assert.ok(!JSON.stringify(l).includes('john'));
});

test('resolve records only the matched key, never the question', () => {
  const q = 'NI primary threshold for my employee Jane';
  const ls = factLookups('resolve', F.resolveFact(q, {}));
  assert.equal(ls.length, 1);
  assert.ok(!JSON.stringify(ls).toLowerCase().includes('jane'));
  assert.match(ls[0].fact_key, /^(uk\/|\(none\))/);
});

test('a batch records one lookup per key', () => {
  const ls = factLookups('get', F.getFacts(['uk/bank-rate', 'x/y'], {}));
  assert.deepEqual(ls.map((l) => l.fact_result), ['hit', 'miss']);
});

test('keyShaped rejects anything that is not a key', () => {
  for (const bad of ['hello world', 'uk', 'UK/../etc', 'uk/a@b.com', 'uk/acct/1234567', 'x'.repeat(120), '']) {
    assert.equal(keyShaped(bad), '', bad);
  }
  assert.equal(keyShaped('UK/Income-Tax/Personal-Allowance'), 'uk/income-tax/personal-allowance');
});
