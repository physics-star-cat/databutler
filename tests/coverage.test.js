const test = require('node:test');
const assert = require('node:assert/strict');
const { coverageFor, AREAS } = require('../api/_coverage');

test('coverage: all areas, each with a notCovered list', () => {
  const all = coverageFor();
  assert.deepEqual(all.areas, ['uk-rates', 'uk-exams', 'provenance', 'stats', 'vehicles']);
  assert.equal(all.vehicles.frRecalls.fiches, 1663);
  assert.equal(all.vehicles.jpRecalls.models, 75);
  for (const a of all.areas) assert.ok(Array.isArray(all[a].notCovered), a);
  assert.ok(all['uk-rates'].categories.includes('income-tax'));
  assert.deepEqual(all['uk-exams'].boards, { aqa: { gcse: ['Physics', 'Biology', 'Chemistry', 'Combined Science: Trilogy', 'Mathematics'] } });
});

test('coverage: one area, and near-miss for unknown', () => {
  assert.equal(coverageFor('UK-Rates').area, 'uk-rates');
  const miss = coverageFor('rates');
  assert.equal(miss.covered, false);
  assert.deepEqual(miss.nearest[0], 'uk-rates');
  assert.deepEqual(Object.keys(AREAS), ['uk-rates', 'uk-exams', 'provenance', 'stats', 'vehicles']);
});
