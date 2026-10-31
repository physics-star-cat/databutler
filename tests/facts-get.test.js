// tests/facts-get.test.js — Verified Facts `get` (docs/FACTS_PROTOCOL.md §5, §7): max_age and the freshness contract,
// aliases, period / as_of selection, periodsHeld, misses with candidates, batch, and the withdrawn shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadAreas } = require('../api/_areas');
const { plusDays } = require('../api/_area_kit');
const { freshnessFor } = require('../api/_freshness');
const { withNow } = require('./fake-clock');
const F = require('../api/_facts');

const PA = 'uk/income-tax/personal-allowance';
const VERIFIED = F.INDEX.get(PA).verifiedDate;
const at = (day) => new Date(`${day}T12:00:00Z`);

test('get: the full current record; with no max_age, fresh unless the area is overdue, maxAgeDays null', () => {
  const now = at(plusDays(VERIFIED, 3));
  const r = F.getFact(PA, {}, now);
  assert.equal(r.key, PA);
  assert.equal(r.value, 12570);
  assert.equal(r.ageDays, 3);
  assert.equal(r.maxAgeDays, null);
  const overdue = freshnessFor('uk-rates', now).staleness === 'overdue';
  assert.equal(r.status, overdue ? 'stale' : 'fresh');
  assert.equal(r.cite.url, `https://databutler.dev/f/${PA}`);
  assert.deepEqual(Object.keys(r).slice(0, 2), ['protocol', 'key']);
  // the publisher's own freshness: a year after nextScheduledRefresh the answer is stale even without max_age
  const late = F.getFact(PA, {}, at(plusDays(F.INDEX.get(PA).nextScheduledRefresh, 60)));
  assert.equal(late.status, 'stale');
  assert.equal(late.maxAgeDays, null);
});

test('max_age: 30d one day past → stale with ageDays/maxAgeDays; P6M = 180; 1y = 365; 12w = 84; bad → covered:false + example', () => {
  const r = F.getFact(PA, { max_age: '30d' }, at(plusDays(VERIFIED, 31)));
  assert.deepEqual([r.status, r.ageDays, r.maxAgeDays], ['stale', 31, 30]);
  assert.equal(r.value, 12570, 'a stale answer still carries its value');
  assert.equal(F.getFact(PA, { max_age: '30d' }, at(plusDays(VERIFIED, 30))).status, 'fresh');
  assert.equal(F.getFact(PA, { max_age: 'P6M' }, at(VERIFIED)).maxAgeDays, 180);
  assert.equal(F.getFact(PA, { max_age: '1y' }, at(VERIFIED)).maxAgeDays, 365);
  assert.equal(F.getFact(PA, { max_age: '12w' }, at(VERIFIED)).maxAgeDays, 84);
  assert.equal(F.getFact(PA, { max_age: 'P30D' }, at(VERIFIED)).maxAgeDays, 30);
  for (const bad of ['soon', '30x', 'P', '-3d']) {
    const b = F.getFact(PA, { max_age: bad }, at(VERIFIED));
    assert.equal(b.covered, false, bad);
    assert.equal(b.example, '30d');
  }
});

test('the clock: getFact defaults to now (withNow pins it)', async () => {
  await withNow(plusDays(VERIFIED, 31), async () => {
    assert.equal(F.getFact(PA, { max_age: '30d' }).status, 'stale');
  });
});

test('aliases: gb/… and the changelog form answer the canonical key with requestedKey; loose case and slashes normalise', () => {
  for (const alias of ['gb/income-tax/personal-allowance', 'uk-rates:income-tax/personal-allowance']) {
    const r = F.getFact(alias, {}, at(VERIFIED));
    assert.equal(r.key, PA, alias);
    assert.equal(r.requestedKey, alias);
  }
  const r = F.getFact(`/f/${PA.toUpperCase()}/`, {}, at(VERIFIED));
  assert.equal(r.key, PA);
  assert.equal(r.requestedKey, undefined, 'case and slashes are not an alias');
});

test('period: the previous value with its own source; a period not held → covered:false with periodsHeld', () => {
  const prev = F.INDEX.get(PA).previous;
  const r = F.getFact(PA, { period: '2025-26' }, at(VERIFIED));
  assert.equal(r.period, '2025-26');
  assert.equal(r.value, prev.value);
  assert.equal(r.source, prev.source);
  assert.equal(r.verifiedDate, VERIFIED);
  assert.notEqual(r.hash, F.INDEX.get(PA).hash);
  assert.equal(r.cite.url, `https://databutler.dev/f/${PA}?period=2025-26`);
  const miss = F.getFact(PA, { period: '2019-20' }, at(VERIFIED));
  assert.equal(miss.covered, false);
  assert.deepEqual(miss.periodsHeld, ['2026-27', '2025-26']);
});

test('as_of: the value in force that day; before anything held → covered:false; with period → covered:false', () => {
  const r = F.getFact(PA, { as_of: '2026-03-01' }, at(VERIFIED));
  assert.equal(r.period, '2025-26');
  assert.ok(r.effectiveFrom <= '2026-03-01' && '2026-03-01' < '2026-04-06');
  assert.equal(F.getFact(PA, { as_of: '2026-04-06' }, at(VERIFIED)).period, '2026-27');
  assert.equal(F.getFact(PA, { as_of: '2026-04-05' }, at(VERIFIED)).period, '2025-26');
  assert.equal(F.getFact(PA, { as_of: '2019-01-01' }, at(VERIFIED)).covered, false);
  const both = F.getFact(PA, { as_of: '2026-03-01', period: '2025-26' }, at(VERIFIED));
  assert.equal(both.covered, false);
  assert.match(both.error, /mutually exclusive/);
  assert.equal(F.getFact(PA, { as_of: '2026-02-30' }, at(VERIFIED)).covered, false);
  // a figure with no period label is still dated: Bank Rate before the last decision
  const br = F.getFact('uk/bank-rate', { as_of: F.PERIODS.get('uk/bank-rate')[1].effectiveFrom }, at(VERIFIED));
  assert.equal(br.value, F.INDEX.get('uk/bank-rate').previous.value);
});

test('unknown key with no confident resolution → covered:false, ≤ 5 candidates, the index URL', () => {
  const r = F.getFact('zz/nothing/here', {}, at(VERIFIED));
  assert.equal(r.covered, false);
  assert.equal(r.error, 'unknown key');
  assert.equal(r.requestedKey, 'zz/nothing/here');
  assert.ok(Array.isArray(r.candidates) && r.candidates.length <= 5);
  assert.equal(r.index, 'https://databutler.dev/f');
});

test('batch: results in request order, count, batch status stale if any record is; misses do not fail it; > 50 keys refused', () => {
  const keys = [PA, 'us/social-security/wage-base', 'zz/missing/key'];
  const b = F.getFacts(keys, { max_age: '400d' }, at(VERIFIED));
  assert.equal(b.count, 3);
  assert.deepEqual(b.results.map((r) => r.key || r.requestedKey), keys);
  assert.equal(b.results[2].covered, false);
  assert.equal(b.status, 'fresh');
  assert.equal(F.getFacts(keys, { max_age: '1d' }, at(plusDays(VERIFIED, 30))).status, 'stale');
  assert.deepEqual(F.getFact(keys.join(','), {}, at(VERIFIED)).results.map((r) => r.key || r.requestedKey), keys, 'a comma list is a batch');
  const big = F.getFacts(Array.from({ length: 51 }, () => PA), {}, at(VERIFIED));
  assert.equal(big.covered, false);
  assert.equal(big.limit, 50);
  assert.equal(F.getFacts(Array.from({ length: 50 }, () => PA), {}, at(VERIFIED)).count, 50);
});

test('fixture area: withdrawn records answer value null + withdrawn + supersededBy; curated aliases; periods via periodStart', () => {
  const { areas } = loadAreas(path.join(__dirname, 'fixtures/areas-facts'));
  const X = F.makeFacts(areas);
  assert.equal(X.FACT_COUNT, 2);
  const w = X.getFact('xx/widgets/old-allowance', {}, at('2026-10-02'));
  assert.equal(w.value, null);
  assert.equal(w.withdrawn, '2026-06-30');
  assert.equal(w.supersededBy, 'xx/widgets/limit');
  assert.equal(w.status, 'fresh');
  const lim = X.getFact('xx/widgets/max', {}, at('2026-10-02'));
  assert.equal(lim.key, 'xx/widgets/limit');
  assert.deepEqual(lim.aliases, ['xx/widgets/max']);
  assert.equal(X.getFact('xx/widgets/limit', { as_of: '2025-06-01' }, at('2026-10-02')).value, 90);
  assert.equal(X.getFact('xx/widgets/limit', { period: '2025' }, at('2026-10-02')).effectiveTo, '2025-12-31');
  assert.equal(X.factKeyFor({ area: 'facts-fixture', key: 'widgets/limit' }), 'xx/widgets/limit');
});
