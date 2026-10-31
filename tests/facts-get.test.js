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
  assert.equal(r.cite.url, `https://databutler.dev/facts/${PA}`, 'v0.3: cite.url is the fact page');
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
  assert.equal(r.cite.url, `https://databutler.dev/facts/${PA}?period=2025-26`);
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

/* ---------------- v0.3: expected-change awareness (spec §4, §5.3) ---------------- */

/** The fixture area with a facts.expected and (optionally) another verifiedDate; makeFacts over it. */
function withExpected(expected, { verifiedDate = '2026-10-01', sourceChecks = {}, seenSources = [] } = {}) {
  const { areas } = loadAreas(path.join(__dirname, 'fixtures/areas-facts'));
  const a = areas[0];
  const data = { ...a.freshness.data, verifiedDate };
  return F.makeFacts([{ ...a, freshness: { ...a.freshness, data }, facts: { ...a.facts, expected } }], { signatures: { signatures: {} }, sourceChecks, seenSources });
}
const LIMIT = 'xx/widgets/limit';
const OLD = 'xx/widgets/old-allowance';

test('v0.3 (a) nextExpectedChange yesterday, verified before it → stale, staleReason expected-change-passed, value still present', () => {
  const X = withExpected({ changeCadence: 'scheduled', dates: ['2026-10-10'] });
  const r = X.getFact(LIMIT, {}, at('2026-10-11'));
  assert.equal(r.changeCadence, 'scheduled');
  assert.equal(r.nextExpectedChange, '2026-10-10');
  assert.equal(r.status, 'stale');
  assert.equal(r.staleReason, 'expected-change-passed');
  assert.equal(r.value, 100, 'a stale answer is still an answer');
  // on the day itself the test already fails ("today or earlier")
  assert.equal(X.getFact(LIMIT, {}, at('2026-10-10')).staleReason, 'expected-change-passed');
  // whatever max_age was, when max_age itself passes
  const lax = X.getFact(LIMIT, { max_age: '365d' }, at('2026-10-11'));
  assert.deepEqual([lax.status, lax.staleReason, lax.maxAgeDays], ['stale', 'expected-change-passed', 365]);
  // field order: the two fields follow nextScheduledRefresh; staleReason follows maxAgeDays
  const keys = Object.keys(r);
  assert.deepEqual(keys.slice(keys.indexOf('nextScheduledRefresh'), keys.indexOf('nextScheduledRefresh') + 3), ['nextScheduledRefresh', 'changeCadence', 'nextExpectedChange']);
  assert.equal(keys[keys.indexOf('maxAgeDays') + 1], 'staleReason');
});

test('v0.3 (b) verified after the expected change → fresh (statusFor and a re-verified area)', () => {
  const X = withExpected({ changeCadence: 'scheduled', dates: ['2026-10-10'] }, { verifiedDate: '2026-10-12' });
  const r = X.getFact(LIMIT, {}, at('2026-10-13'));
  assert.equal(r.status, 'fresh');
  assert.equal(r.staleReason, undefined);
  assert.equal(r.nextExpectedChange, null, 'no named date after the verification: null, never a guess');
  const s = X.statusFor({ key: LIMIT, verifiedDate: '2026-10-12', nextExpectedChange: '2026-10-10' }, null, at('2026-10-13'));
  assert.equal(s.status, 'fresh');
});

test('v0.3 (c) nextExpectedChange tomorrow → fresh; annual MM-DD dates roll to the next year after verifiedDate', () => {
  const X = withExpected({ changeCadence: 'annual', dates: ['10-12'] });
  const r = X.getFact(LIMIT, {}, at('2026-10-11'));
  assert.deepEqual([r.nextExpectedChange, r.status], ['2026-10-12', 'fresh']);
  const Y = withExpected({ changeCadence: 'annual', dates: ['04-06'] }, { verifiedDate: '2026-10-04' });
  assert.equal(Y.getFact(LIMIT, {}, at('2026-10-05')).nextExpectedChange, '2027-04-06');
  const { nextDateAfter } = require('../api/_area_kit');
  assert.equal(nextDateAfter('2026-04-06', ['04-06']), '2027-04-06', 'strictly after the verification day');
  assert.equal(nextDateAfter('2026-03-01', ['04-06', '2026-03-20']), '2026-03-20', 'the earliest candidate wins');
  assert.equal(nextDateAfter('2026-11-02', ['2026-11-01']), null);
  assert.throws(() => nextDateAfter('2026-01-01', ['April']), /neither/);
});

test('v0.3 (d) max_age failing on a record whose expected change also passed → staleReason max-age (the caller\'s test first)', () => {
  const X = withExpected({ changeCadence: 'scheduled', dates: ['2026-10-10'] });
  const r = X.getFact(LIMIT, { max_age: '1d' }, at('2026-10-11'));
  assert.deepEqual([r.status, r.staleReason, r.ageDays, r.maxAgeDays], ['stale', 'max-age', 10, 1]);
});

test('v0.3 (e) nextExpectedChange null → v0.2 behaviour; no expected block → no fields at all', () => {
  const X = withExpected({ changeCadence: 'irregular', dates: [] });
  const r = X.getFact(LIMIT, {}, at('2026-10-11'));
  assert.deepEqual([r.changeCadence, r.nextExpectedChange, r.status, r.staleReason], ['irregular', null, 'fresh', undefined]);
  assert.equal(X.getFact(LIMIT, { max_age: '30d' }, at('2026-11-01')).staleReason, 'max-age');
  const { areas } = loadAreas(path.join(__dirname, 'fixtures/areas-facts'));
  const plain = F.makeFacts(areas, { sourceChecks: {}, seenSources: [] }).getFact(LIMIT, {}, at('2026-10-11'));
  for (const k of ['changeCadence', 'nextExpectedChange', 'sourceCheckedAt', 'staleReason']) assert.equal(k in plain, false, k);
  // the publisher's own cadence (no max_age): overdue → stale with cadence-overdue
  const late = plain.nextScheduledRefresh;
  const o = F.makeFacts(areas).getFact(LIMIT, {}, at(plusDays(late, 30)));
  assert.deepEqual([o.status, o.staleReason], ['stale', 'cadence-overdue']);
});

test('v0.3 (f) a batch of one fresh and one expected-change-stale record → batch status stale', () => {
  const X = withExpected((r) => (r.key === LIMIT ? { changeCadence: 'scheduled', dates: ['2026-10-10'] } : { changeCadence: 'irregular', dates: [] }));
  const b = X.getFacts([OLD, LIMIT], {}, at('2026-10-11'));
  assert.deepEqual(b.results.map((r) => r.status), ['fresh', 'stale']);
  assert.equal(b.status, 'stale');
});

test('v0.3 previous-period records carry no expected-change fields (that value has ended)', () => {
  const X = withExpected({ changeCadence: 'scheduled', dates: ['2026-10-10'] });
  const p = X.getFact(LIMIT, { period: '2025' }, at('2026-10-11'));
  assert.equal(p.value, 90);
  assert.equal('nextExpectedChange' in p, false);
  assert.equal(p.status, 'fresh');
});

test('v0.3 real data: every current record names a changeCadence from the enum, and nextExpectedChange is null or after verifiedDate', () => {
  const { CHANGE_CADENCES } = require('../api/_areas');
  for (const r of F.INDEX.values()) {
    assert.ok(CHANGE_CADENCES.includes(r.changeCadence), `${r.key}: ${r.changeCadence}`);
    assert.ok(r.nextExpectedChange === null || r.nextExpectedChange > r.verifiedDate, `${r.key}: ${r.nextExpectedChange} vs ${r.verifiedDate}`);
  }
  assert.equal(F.INDEX.get(PA).changeCadence, 'annual');
  assert.equal(F.INDEX.get('uk/mot/max-fee-car').changeCadence, 'irregular', 'fees change by order on no fixed date');
  assert.match(F.INDEX.get('uk/ved-standard/standard-rate-12-month').nextExpectedChange, /-04-01$/);
  assert.match(F.INDEX.get('uk/minimum-wage/18-to-20').nextExpectedChange, /-04-01$/);
  assert.match(F.INDEX.get('us/social-security/wage-base').nextExpectedChange, /-01-01$/);
  assert.match(F.INDEX.get('de/income-tax/grundfreibetrag').nextExpectedChange, /-01-01$/);
});

/* ---------------- v0.3: sourceCheckedAt and the source-changed test (spec §4, §5.3) ---------------- */

const SRC = 'https://example.gov/widgets';

test('v0.3 sourceCheckedAt: the newest successful automated fetch of source; absent when no check has run', () => {
  const X = withExpected(undefined, { sourceChecks: { [SRC]: { checkedAt: '2026-10-05', contentHash: 'abc' } }, seenSources: [{ url: SRC, checkedAt: '2026-10-01', bodyHash: 'abc' }] });
  const r = X.getFact(LIMIT, {}, at('2026-10-06'));
  assert.equal(r.sourceCheckedAt, '2026-10-05');
  assert.equal(r.status, 'fresh');
  assert.equal(X.listFacts().find((e) => e.key === LIMIT).sourceCheckedAt, '2026-10-05', 'index entries carry it too');
  // the baseline alone counts (scripts/sources.js fetched it); an unreachable entry never does
  const Y = withExpected(undefined, { seenSources: [{ url: SRC, checkedAt: '2026-10-02', bodyHash: 'abc' }] });
  assert.equal(Y.getFact(LIMIT, {}, at('2026-10-06')).sourceCheckedAt, '2026-10-02');
  const Z = withExpected(undefined, { seenSources: [{ url: SRC, unreachable: 'HTTP 403', checkedAt: '2026-10-02' }] });
  assert.equal('sourceCheckedAt' in Z.getFact(LIMIT, {}, at('2026-10-06')), false, 'never fabricate a date');
  // sourceCheckedAt is presentation: the claim hash does not move
  assert.equal(r.hash, withExpected(undefined).getFact(LIMIT, {}, at('2026-10-06')).hash);
});

test('v0.3 source-changed: the check saw source change after verifiedDate → stale (value returned); re-verified after → fresh', () => {
  const checks = { [SRC]: { checkedAt: '2026-10-05', contentHash: 'def', changedAt: '2026-10-05' } };
  const X = withExpected(undefined, { sourceChecks: checks });
  const r = X.getFact(LIMIT, {}, at('2026-10-06'));
  assert.deepEqual([r.status, r.staleReason, r.value], ['stale', 'source-changed', 100]);
  assert.equal(X.getFact(LIMIT, { max_age: '30d' }, at('2026-10-06')).staleReason, 'source-changed', 'whatever max_age was');
  assert.equal(X.getFact(LIMIT, { max_age: '1d' }, at('2026-10-06')).staleReason, 'max-age', 'the caller\'s own test is reported first');
  const later = withExpected(undefined, { verifiedDate: '2026-10-06', sourceChecks: checks });
  assert.equal(later.getFact(LIMIT, {}, at('2026-10-07')).status, 'fresh', 'a re-verification on or after the change clears it');
  // the expected-change test ranks before source-changed
  const both = withExpected({ changeCadence: 'scheduled', dates: ['2026-10-04'] }, { sourceChecks: checks });
  assert.equal(both.getFact(LIMIT, {}, at('2026-10-06')).staleReason, 'expected-change-passed');
});
