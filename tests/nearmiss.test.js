const test = require('node:test');
const assert = require('node:assert/strict');
const { levenshtein, nearest } = require('../api/_text');
const { ratesLookup, topicLookup } = require('../api/_lib');

test('nearest: substring hits first, then edit distance, capped', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.deepEqual(nearest('tax', ['income-tax', 'vat', 'isa', 'capital-gains'], 2), ['income-tax', 'vat']);
  assert.deepEqual(nearest('', ['a', 'b']), []);
});

test('ratesLookup unknown category → near-miss, not error', () => {
  const r = ratesLookup('incme tax');
  assert.equal(r.covered, false);
  assert.equal(r.requested, 'incme tax');
  assert.ok(r.nearest.includes('income-tax'));
  assert.ok(r.coverage.includes('vat'));
  assert.equal(r.error, undefined);
});

test('topicLookup: unknown board and unknown topic are near-misses', () => {
  const noSpec = topicLookup({ board: 'edexcel', subject: 'physics', topic: 'waves' });
  assert.equal(noSpec.covered, false);
  assert.deepEqual(noSpec.nearest.boards, ['aqa']);
  assert.ok(Array.isArray(noSpec.coverage));
  const noTopic = topicLookup({ board: 'aqa', subject: 'physics', topic: 'zzzz' });
  assert.equal(noTopic.covered, false);
  assert.ok(noTopic.nearest.topics.length > 0);
  assert.ok(noTopic.matchedSpecs.length > 0);
});
