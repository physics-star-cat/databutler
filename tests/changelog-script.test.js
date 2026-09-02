const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePorcelain } = require('../scripts/changelog');

test('parsePorcelain parses modified, untracked, renamed and deleted porcelain lines', () => {
  const text = [
    ' M data/uk/rates/2026-27.json',
    '?? data/uk/exams/new-spec.json',
    'R  data/uk/rates/2025-26.json -> data/uk/rates/2026-27.json',
    ' D data/uk/exams/old-spec.json',
  ].join('\n');
  assert.deepEqual(parsePorcelain(text), [
    { status: ' M', path: 'data/uk/rates/2026-27.json' },
    { status: '??', path: 'data/uk/exams/new-spec.json' },
    { status: 'R ', path: 'data/uk/rates/2026-27.json' },
    { status: ' D', path: 'data/uk/exams/old-spec.json' },
  ]);
});

test('parsePorcelain: renamed file outside data/ (renamed into data/) keeps new path only', () => {
  const text = 'R  scripts/old.js -> data/uk/rates/renamed.json';
  assert.deepEqual(parsePorcelain(text), [
    { status: 'R ', path: 'data/uk/rates/renamed.json' },
  ]);
});

test('parsePorcelain: blank lines are ignored', () => {
  assert.deepEqual(parsePorcelain(''), []);
  assert.deepEqual(parsePorcelain('\n\n'), []);
});
