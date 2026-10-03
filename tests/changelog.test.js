// tests/changelog.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { changesSince, mergeEntries, COVERAGE_START } = require('../api/_changelog');
const { diff: diffRates } = require('../api/_areas/uk-rates').changelog;
const { diff: diffExams } = require('../api/_areas/uk-exams').changelog;
const rp = require('./fixtures/rates-prev.json'), rn = require('./fixtures/rates-next.json');
const ep = require('./fixtures/exams-prev.json'), en = require('./fixtures/exams-next.json');
const rr = require('./fixtures/rates-removed.json'), er = require('./fixtures/exams-removed.json');

test('diffRates: changed value, shifted band, new category; unchanged skipped', () => {
  const d = diffRates(rp, rn);
  const keys = d.map((e) => e.key).sort();
  assert.deepEqual(keys, ['income-tax/basic-rate', 'income-tax/personal-allowance', 'isa/annual-isa-allowance']);
  const pa = d.find((e) => e.key === 'income-tax/personal-allowance');
  assert.equal(pa.from, 12570); assert.equal(pa.to, 13070); assert.equal(pa.unit, 'GBP/year');
  assert.equal(pa.effectiveFrom, '2027-04-06'); assert.equal(pa.taxYear, '2027-28');
  assert.equal(pa.source, 'https://www.gov.uk/income-tax-rates'); assert.equal(pa.verifiedDate, '2027-04-07');
  assert.equal(pa.note, ''); assert.equal(pa.area, 'uk-rates');
  const br = d.find((e) => e.key === 'income-tax/basic-rate');
  assert.equal(br.from, 20); assert.equal(br.to, 20); assert.equal(br.fromBand, '£12,571 to £50,270'); assert.equal(br.band, '£13,071 to £50,270');
  const isa = d.find((e) => e.key === 'isa/annual-isa-allowance');
  assert.equal(isa.from, null); assert.equal(isa.to, 20000);
});

test('diffRates with no previous file records every figure as new', () => {
  assert.equal(diffRates(null, rp).length, 3);
});

test('diffExams: topic moves, duration change, added spec', () => {
  const d = diffExams(ep, en);
  const keys = d.map((e) => e.key).sort();
  assert.deepEqual(keys, ['8461/spec', '8463/paper-1/topics', '8463/paper-2/durationMinutes', '8463/paper-2/topics']);
  const p1 = d.find((e) => e.key === '8463/paper-1/topics');
  assert.deepEqual(p1.from, ['Energy', 'Electricity']); assert.deepEqual(p1.to, ['Energy']);
  assert.equal(p1.specCode, '8463'); assert.equal(p1.board, 'AQA'); assert.equal(p1.verifiedDate, '2027-09-02');
  assert.equal(p1.effectiveFrom, null);
  assert.equal(d.find((e) => e.key === '8461/spec').to, 'covered');
});

test('diffRates: removed figure and removed category are both recorded', () => {
  const d = diffRates(rp, rr);
  const keys = d.map((e) => e.key).sort();
  assert.deepEqual(keys, ['income-tax/basic-rate', 'income-tax/personal-allowance', 'vat/standard-rate']);
  const pa = d.find((e) => e.key === 'income-tax/personal-allowance');
  assert.equal(pa.from, 12570); assert.equal(pa.to, null); assert.equal(pa.unit, 'GBP/year');
  assert.equal(pa.area, 'uk-rates'); assert.equal(pa.verifiedDate, '2027-04-07');
  const br = d.find((e) => e.key === 'income-tax/basic-rate');
  assert.equal(br.from, 20); assert.equal(br.to, null);
  const vat = d.find((e) => e.key === 'vat/standard-rate');
  assert.equal(vat.from, 20); assert.equal(vat.to, null); assert.equal(vat.source, 'https://www.gov.uk/vat-rates');
});

test('diffExams: removed spec and removed paper are both recorded', () => {
  const d = diffExams(en, er);
  const keys = d.map((e) => e.key).sort();
  assert.deepEqual(keys, ['8461/spec', '8463/paper-2/topics']);
  const removedSpec = d.find((e) => e.key === '8461/spec');
  assert.equal(removedSpec.from, 'covered'); assert.equal(removedSpec.to, 'removed');
  assert.equal(removedSpec.board, 'AQA'); assert.equal(removedSpec.subject, 'Biology');
  const removedPaper = d.find((e) => e.key === '8463/paper-2/topics');
  assert.deepEqual(removedPaper.from, ['Forces', 'Electricity']); assert.equal(removedPaper.to, null);
  assert.equal(removedPaper.specCode, '8463');
});

test('mergeEntries dedupes on area/key/verifiedDate and reports added', () => {
  const a = diffRates(rp, rn);
  const first = mergeEntries([], a);
  assert.equal(first.added.length, 3);
  const second = mergeEntries(first.merged, a);
  assert.equal(second.added.length, 0);
  assert.equal(second.merged.length, 3);
});

test('changesSince filters by date and area, newest first, warns before coverage start', () => {
  const entries = [...diffRates(rp, rn), ...diffExams(ep, en)];
  const r = changesSince({ since: '2027-06-01' }, entries);
  assert.equal(r.count, 4); // only the exams entries (verified 2027-09-02)
  assert.equal(r.entries[0].area, 'uk-exams');
  const rates = changesSince({ since: '2027-01-01', area: 'uk-rates' }, entries);
  assert.equal(rates.count, 3);
  const early = changesSince({ since: '2025-01-01' }, []);
  assert.equal(early.count, 0);
  assert.match(early.note, new RegExp(COVERAGE_START));
  assert.equal(changesSince({ since: 'yesterday' }).covered, false);
  assert.equal(changesSince({ since: '2026-01-01', area: 'stats' }).covered, false);
});

test('changesSince includes entries whose effectiveFrom is after since even if verified earlier', () => {
  const e = { area: 'uk-rates', key: 'k', from: 1, to: 2, effectiveFrom: '2027-04-06', verifiedDate: '2026-11-27', source: 'https://x', note: '' };
  assert.equal(changesSince({ since: '2027-01-01' }, [e]).count, 1);
});
