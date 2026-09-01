const test = require('node:test');
const assert = require('node:assert/strict');
const { freshnessFor, DUE_WINDOW_DAYS } = require('../api/_freshness');

const day = (iso) => new Date(`${iso}T12:00:00Z`);

test('rates: fresh before nextScheduledRefresh, due within window, overdue after', () => {
  const f = freshnessFor('uk-rates', day('2026-09-01'));
  assert.equal(f.verifiedDate, '2026-08-31');
  assert.equal(f.nextScheduledRefresh, '2027-04-06');
  assert.equal(f.staleness, 'fresh');
  assert.equal(freshnessFor('uk-rates', day('2027-04-06')).staleness, 'due');
  assert.equal(freshnessFor('uk-rates', day('2027-04-20')).staleness, 'due');
  assert.equal(freshnessFor('uk-rates', day('2027-04-21')).staleness, 'overdue');
  assert.equal(DUE_WINDOW_DAYS, 14);
});

test('exams dataset and live tools', () => {
  assert.equal(freshnessFor('uk-exams', day('2026-09-01')).nextScheduledRefresh, '2027-09-01');
  const live = freshnessFor('live', day('2026-09-01'));
  assert.deepEqual(live, { verifiedDate: '2026-09-01', nextScheduledRefresh: null, staleness: 'live' });
  assert.equal(freshnessFor('nope'), null);
});
