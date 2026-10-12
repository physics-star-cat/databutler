// tests/facts-index.test.js — the Verified Facts index (api/_facts.js) built from the area modules' `facts` blocks:
// key grammar, uniqueness, aliases, counts derived from the data, pinned real values, the changelog ↔ fact key mapping.
const test = require('node:test');
const assert = require('node:assert/strict');
const { AREAS, factAreas } = require('../api/_areas');
const { figureKey, slug, FACT_KEY } = require('../api/_area_kit');
const { hashOf } = require('../api/_facts_sign');
const F = require('../api/_facts');

const RATES = require('../data/uk/rates/2026-27.json');
const US = require('../data/us-rates.json');
const DE = require('../data/de-rates.json');
const VED = require('../data/uk-vehicle-rules/2026-27.json');
const GOV = require('../data/uk-gov-process.json');
const EXAMS = require('../data/uk-exam-dates.json');
const POLICY = require('../data/policy-rates.json');
const CHANGELOG = require('../data/changelog.json');

const GRAMMAR = /^[a-z][a-z0-9-]*(\/[a-z0-9][a-z0-9.-]*){1,5}$/;
const fig = (data, cat, pred) => data.categories[cat].figures.find(pred);

test('the kit and the test agree on the key grammar of spec §3.1', () => {
  assert.equal(String(FACT_KEY), String(GRAMMAR));
});

test('every key matches the grammar, is unique, and no key is a reserved single segment', () => {
  assert.ok(F.FACT_COUNT > 400, `${F.FACT_COUNT} facts`);
  for (const k of F.INDEX.keys()) {
    assert.match(k, GRAMMAR);
    assert.ok(!F.RESERVED.has(k) && !F.RESERVED.has(k.split('/')[0]), `${k} collides with a reserved /f/<word> path`);
    assert.ok(k.split('/').length >= 2);
  }
  assert.equal(new Set(F.INDEX.keys()).size, F.INDEX.size);
});

test('aliases are unique, never a key, and point at existing keys; gb/… and <area>:<changelog key> forms exist', () => {
  for (const [alias, key] of F.ALIASES) {
    assert.ok(!F.INDEX.has(alias), `alias ${alias} is a key`);
    assert.ok(F.INDEX.has(key), `alias ${alias} → missing ${key}`);
  }
  assert.equal(F.ALIASES.get('gb/income-tax/personal-allowance'), 'uk/income-tax/personal-allowance');
  assert.equal(F.ALIASES.get('uk-rates:income-tax/personal-allowance'), 'uk/income-tax/personal-allowance');
  assert.equal(F.ALIASES.get('uk/national-insurance/primary-threshold'), 'uk/national-insurance/primary-threshold-employee-pays-above-this');
  assert.equal(F.ALIASES.get('uk/gov/passport/fee-online-uk'), 'uk/gov/passport-renewal-adult/fee-online-uk');
  assert.equal(F.ALIASES.get('policy-rates:boe/bank-rate'), 'uk/bank-rate');
  // curated aliases are listed on the record; the mechanical classes are not
  assert.ok(F.INDEX.get('uk/national-insurance/primary-threshold-employee-pays-above-this').aliases.includes('uk/national-insurance/primary-threshold'));
  assert.equal(F.INDEX.get('uk/income-tax/personal-allowance').aliases, undefined);
});

test('counts per area equal the figures in each data file (derived, not typed); facts: null areas publish none', () => {
  const byArea = {};
  for (const m of F.META.values()) byArea[m.area] = (byArea[m.area] || 0) + 1;
  for (const a of factAreas()) {
    if (a.facts.list) continue;
    const data = a.freshness.data;
    const n = Object.values(data.categories).reduce((s, c) => s + (c.figures || []).length, 0);
    assert.equal(byArea[a.area], n, a.area);
  }
  for (const a of AREAS) if (!a.facts) assert.equal(byArea[a.area], undefined, a.area);
  assert.deepEqual(factAreas().map((a) => a.area).sort(), ['de-rates', 'policy-rates', 'uk-exam-dates', 'uk-gov-process', 'uk-rates', 'uk-vehicle-rules', 'us-rates']);
});

test('policy-rates contributes exactly six keys, one per bank figure', () => {
  const keys = [...F.META].filter(([, m]) => m.area === 'policy-rates').map(([k]) => k);
  assert.deepEqual(keys, ['uk/bank-rate', 'us/fed-funds/lower', 'us/fed-funds/upper', 'eu/ecb/deposit-facility', 'eu/ecb/main-refinancing', 'eu/ecb/marginal-lending']);
  assert.equal(F.INDEX.get('uk/bank-rate').value, POLICY.banks.boe.figures[0].value);
  assert.equal(F.INDEX.get('uk/bank-rate').effectiveFrom, POLICY.banks.boe.effectiveFrom);
  assert.equal(F.INDEX.get('us/fed-funds/upper').value, POLICY.banks.fed.figures.find((f) => f.key === 'target-range-upper').value);
  assert.equal(F.INDEX.get('eu/ecb/deposit-facility').source, POLICY.banks.ecb.source);
});

test('every record carries hash = hashOf(record), an https source, verifiedDate and the protocol', () => {
  for (const periods of F.PERIODS.values()) {
    for (const r of periods) {
      assert.equal(r.hash, hashOf(r), r.key);
      assert.match(r.source, /^https:\/\//, r.key);
      assert.match(r.verifiedDate, /^\d{4}-\d{2}-\d{2}$/, r.key);
      assert.equal(r.protocol, 'verified-facts/0.2');
      assert.ok(Object.isFrozen(r));
    }
  }
});

test('pinned real figures read from the data files', () => {
  const pa = fig(RATES, 'income-tax', (f) => slug(f.label) === 'personal-allowance');
  const rec = F.INDEX.get('uk/income-tax/personal-allowance');
  assert.equal(rec.value, 12570);
  assert.equal(rec.value, pa.value);
  assert.equal(rec.period, RATES.taxYear);
  assert.equal(rec.effectiveFrom, `${RATES.taxYear.slice(0, 4)}-04-06`);
  assert.equal(rec.quote, pa.quote);
  assert.deepEqual(rec.previous, { value: pa.previous.value, period: pa.previous.taxYear, effectiveFrom: '2025-04-06', source: pa.previous.source });

  assert.equal(F.INDEX.get('us/social-security/wage-base').value, fig(US, 'social-security', (f) => f.key === 'wage-base').value);
  assert.equal(F.INDEX.get('us/social-security/wage-base').period, US.taxYear);
  assert.equal(F.INDEX.get('de/income-tax/grundfreibetrag').value, fig(DE, 'income-tax', (f) => f.key === 'grundfreibetrag').value);
  const ml27 = fig(DE, 'minimum-wage', (f) => f.key === 'mindestlohn-2027');
  assert.equal(F.INDEX.get('de/minimum-wage/mindestlohn-2027').period, ml27.effectiveFrom.slice(0, 4), 'a figure fixed for next year carries that year');
  assert.deepEqual(F.INDEX.get('uk/ved-first-year/co2-0g-km').value, fig(VED, 'ved-first-year', (f) => f.key === 'co2-0g-km').value);
  const fee = fig(GOV, 'passport-renewal-adult', (f) => figureKey(f) === 'fee-online-uk');
  assert.equal(F.INDEX.get('uk/gov/passport-renewal-adult/fee-online-uk').value, fee.value);
  assert.equal(F.INDEX.get('uk/gov/passport-renewal-adult/fee-online-uk').effectiveFrom, fee.effectiveFrom);
  const gcse = fig(EXAMS, 'results', (f) => f.key === 'jcq-gcse-results-day');
  assert.equal(F.INDEX.get('uk/exams/results/jcq-gcse-results-day').value, gcse.value);
  assert.equal(F.INDEX.get('uk/exams/results/jcq-gcse-results-day').period, gcse.series);
});

test('a previous period is served only with its own source and a period label or start date', () => {
  for (const [key, periods] of F.PERIODS) {
    if (periods.length < 2) continue;
    const [cur, prev] = periods;
    assert.ok(prev.source, key);
    assert.ok(prev.period || prev.effectiveFrom, key);
    assert.equal(prev.verifiedDate, cur.verifiedDate, key);
    assert.notEqual(prev.hash, cur.hash, `${key}: a prior period is a different claim`);
    if (cur.effectiveFrom) assert.ok(prev.effectiveTo < cur.effectiveFrom, key);
  }
  assert.equal(F.PERIODS.get('uk/income-tax/personal-allowance')[1].period, '2025-26');
  assert.equal(F.PERIODS.get('uk/income-tax/personal-allowance')[1].effectiveTo, '2026-04-05');
});

test('the changelog mapping round-trips for every changelog entry of a facts area', () => {
  const areas = new Set(factAreas().map((a) => a.area));
  const entries = CHANGELOG.filter((e) => areas.has(e.area));
  assert.ok(entries.length > 100);
  for (const e of entries) {
    const k = F.factKeyFor(e);
    assert.ok(k && F.INDEX.has(k), `${e.area}:${e.key} → ${k}`);
    assert.deepEqual(F.changelogKeyFor(k), { area: e.area, key: e.key });
  }
  assert.equal(F.factKeyFor({ area: 'vehicles', key: 'fr-recalls/dataset' }), null);
});

test('listFacts: one entry per key with hash; namespace filter', () => {
  const all = F.listFacts();
  assert.equal(all.length, F.FACT_COUNT);
  assert.ok(all.every((e) => e.key && e.hash && e.verifiedDate && 'unit' in e && 'period' in e));
  const us = F.listFacts({ namespace: 'us' });
  assert.ok(us.length > 40 && us.every((e) => e.key.startsWith('us/')));
  assert.deepEqual(F.listFacts({ namespace: 'eu' }).map((e) => e.key), ['eu/ecb/deposit-facility', 'eu/ecb/main-refinancing', 'eu/ecb/marginal-lending']);
});
