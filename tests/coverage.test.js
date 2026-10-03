const test = require('node:test');
const assert = require('node:assert/strict');
const { coverageFor, AREAS } = require('../api/_coverage');
const AREA_KEYS = require('../api/_areas').AREAS.map((a) => a.area);

test('coverage: all areas, each with a notCovered list', () => {
  const all = coverageFor();
  assert.deepEqual(all.areas, AREA_KEYS);
  for (const k of ['uk-rates', 'uk-exams', 'provenance', 'stats', 'vehicles', 'tax', 'software-eol', 'policy-rates']) assert.ok(AREA_KEYS.includes(k), k);
  assert.equal(Object.keys(all['software-eol'].products).length, 14);
  assert.deepEqual(Object.keys(all['policy-rates'].banks), ['boe', 'fed', 'ecb']);
  assert.equal(all.tax.countries.es.computed, false);
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
  assert.deepEqual(miss.nearest, ['de-rates', 'uk-rates', 'us-rates'], 'every rates area is one edit away; alphabetical on a tie');
  assert.deepEqual(Object.keys(AREAS), AREA_KEYS);
});
