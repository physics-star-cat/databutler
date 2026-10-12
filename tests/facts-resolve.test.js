// tests/facts-resolve.test.js — Verified Facts `resolve` (docs/FACTS_PROTOCOL.md §6): natural-language fixtures, the
// published scoring's bounds and order, limit and namespace, and the §6.3 rule for `best` and auto-resolution in get.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../api/_facts');

// The NI threshold's canonical key carries its label's parenthetical (fact keys = changelog keys); the short form is a
// curated alias, so resolve answers the canonical key the alias names.
const NI_PT = F.ALIASES.get('uk/national-insurance/primary-threshold');

const FIXTURES = [
  ['what is the UK personal allowance', 'uk/income-tax/personal-allowance'],
  ['NI primary threshold', NI_PT],
  ['US social security wage base 2026', 'us/social-security/wage-base'],
  ['Grundfreibetrag', 'de/income-tax/grundfreibetrag'],
  ['ECB deposit rate', 'eu/ecb/deposit-facility'],
  ['bank of england base rate', 'uk/bank-rate'],
  ['adult passport renewal fee online', 'uk/gov/passport-renewal-adult/fee-online-uk'],
  ['GCSE results day 2027', 'uk/exams/results/jcq-gcse-results-day'],
  ['VED first year zero emission', 'uk/ved-first-year/co2-0g-km'],
  ['income tax personal allowence', 'uk/income-tax/personal-allowance'],
  ['income-tax/personal-allowance', 'uk/income-tax/personal-allowance'],
];

test('natural-language fixtures: the expected key ranks first', () => {
  assert.ok(F.INDEX.has(NI_PT));
  for (const [q, key] of FIXTURES) {
    const r = F.resolveFact(q);
    assert.equal(r.candidates[0] && r.candidates[0].key, key, `${q} → ${JSON.stringify(r.candidates.slice(0, 3).map((c) => [c.key, c.score]))}`);
  }
});

test('matched names how a candidate matched: synonym, fuzzy, key-suffix', () => {
  assert.ok(F.resolveFact('NI primary threshold').candidates[0].matched.includes('synonym:ni'));
  assert.ok(F.resolveFact('income tax personal allowence').candidates[0].matched.some((m) => m.startsWith('fuzzy:allowence')));
  assert.ok(F.resolveFact('income-tax/personal-allowance').candidates[0].matched.includes('key-suffix'));
  assert.deepEqual(F.resolveFact('uk/income-tax/personal-allowance').candidates, [
    { ...F.resolveFact('uk/income-tax/personal-allowance').candidates[0], key: 'uk/income-tax/personal-allowance', score: 1, matched: ['key'] },
  ]);
  assert.equal(F.resolveFact('gb/income-tax/personal-allowance').candidates[0].score, 0.95);
});

test('scores are in [0, 1], descending, ties broken by key; candidates carry label, unit, period, verifiedDate', () => {
  for (const q of ['threshold', 'rate', 'personal allowance', 'passport fee', 'minimum wage 21']) {
    const c = F.resolveFact(q, { limit: 20 }).candidates;
    assert.ok(c.length > 0, q);
    for (let i = 0; i < c.length; i++) {
      assert.ok(c[i].score >= 0 && c[i].score <= 1, q);
      if (i) assert.ok(c[i - 1].score > c[i].score || (c[i - 1].score === c[i].score && c[i - 1].key < c[i].key), `${q} order at ${i}`);
      for (const k of ['key', 'label', 'unit', 'period', 'verifiedDate', 'score', 'matched']) assert.ok(k in c[i], `${q} ${k}`);
    }
  }
  assert.deepEqual(F.resolveFact('threshold').candidates, F.resolveFact('threshold').candidates, 'deterministic');
});

test('limit 1–20 is honoured (default 5); namespace filters', () => {
  assert.equal(F.resolveFact('threshold').candidates.length, 5);
  assert.equal(F.resolveFact('threshold', { limit: 1 }).candidates.length, 1);
  assert.equal(F.resolveFact('threshold', { limit: 50 }).candidates.length, 20);
  const us = F.resolveFact('threshold', { namespace: 'us', limit: 20 });
  assert.ok(us.candidates.length > 0 && us.candidates.every((c) => c.key.startsWith('us/')));
  assert.equal(us.namespace, 'us');
  assert.ok(F.resolveFact('federal standard deduction single').candidates.every((c) => c.key.startsWith('us/')), 'jurisdiction words filter');
  assert.equal(F.resolveFact('').covered, false);
});

test('best: present for an unambiguous query (full record), absent for an ambiguous one', () => {
  const pa = F.resolveFact('what is the UK personal allowance');
  assert.equal(pa.best.key, 'uk/income-tax/personal-allowance');
  assert.equal(pa.best.value, 12570);
  assert.ok(pa.best.hash && pa.best.status);
  assert.ok(pa.candidates[0].score >= 0.8 && pa.candidates[1].score <= pa.candidates[0].score - 0.2);
  const amb = F.resolveFact('threshold');
  assert.equal(amb.best, undefined);
  assert.match(amb.hint, /pick a key/);
  assert.equal(F.resolveFact('rate').best, undefined, 'one content word never carries a confident answer');
  assert.equal(F.resolveFact('ECB deposit rate').best.key, 'eu/ecb/deposit-facility');
});

test('get auto-resolves a loose key only under the §6.3 rule; otherwise it misses with candidates', () => {
  const r = F.getFact('uk income tax personal allowance');
  assert.equal(r.key, 'uk/income-tax/personal-allowance');
  assert.equal(r.requestedKey, 'uk income tax personal allowance');
  assert.ok(r.resolved.score >= 0.8);
  assert.ok(Array.isArray(r.resolved.matched));
  const loose = F.getFact('uk/personal-allowance');
  assert.equal(loose.key, 'uk/income-tax/personal-allowance');
  const miss = F.getFact('threshold');
  assert.equal(miss.covered, false);
  assert.ok(miss.candidates.length > 0 && miss.candidates.length <= 5);
  assert.equal(F.getFact('gcse results day').key, 'uk/exams/results/jcq-gcse-results-day');
});
