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
  assert.equal(all.vehicles.jpRecalls.models, require('../data/vehicles/jp-recalls.json').counts.models);
  for (const a of all.areas) assert.ok(Array.isArray(all[a].notCovered), a);
  assert.ok(all['uk-rates'].categories.includes('income-tax'));
  assert.deepEqual(all['uk-exams'].boards, { aqa: { gcse: ['Physics', 'Biology', 'Chemistry', 'Combined Science: Trilogy', 'Mathematics'] } });
});

test('coverage: one area, and near-miss for unknown', () => {
  assert.equal(coverageFor('UK-Rates').area, 'uk-rates');
  const miss = coverageFor('rates');
  assert.equal(miss.covered, false);
  // nearest(): substring matches first, then edit distance, then alphabetical — derive the expectation from the area
  // list so a new "<cc>-rates" area never touches this test.
  const ratesAreas = AREA_KEYS.filter((k) => k.includes('rates'));
  const expected = ratesAreas.sort((a, b) => (a.length - b.length) || a.localeCompare(b)).slice(0, 3);
  assert.deepEqual(miss.nearest, expected, 'every rates area is a substring hit; shorter (fewer edits) first, alphabetical on a tie');
  assert.ok(miss.nearest.includes('uk-rates'));
  assert.deepEqual(Object.keys(AREAS), AREA_KEYS);
});
