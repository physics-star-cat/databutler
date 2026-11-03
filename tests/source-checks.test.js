// tests/source-checks.test.js — Verified Facts v0.3 watchers: scripts/check-sources.js (data/source-checks.json, the
// input of sourceCheckedAt and the source-changed test), scripts/expected-changes.js and the one "Re-verify: expected
// change passed" issue (spec §11 item 18), and the workflow that runs them. No network: checkSource is injected.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { nextChecks, serialise } = require('../scripts/check-sources');
const { planExpectedIssue, EXPECTED_TITLE, LABEL } = require('../api/_github');
const F = require('../api/_facts');

const ROOT = path.join(__dirname, '..');
const U = 'https://www.gov.uk/income-tax-rates';
const V = 'https://www.example.gov/other';
const BASE = [{ url: U, bodyHash: 'aaa', updatedAt: '2024-11-07T14:57:18+00:00', checkedAt: '2026-10-04' }];
const ok = (url, contentHash, updatedAt = null) => ({ url, ok: true, contentHash, updatedAt });

test('nextChecks: a page that matches the baseline records checkedAt and its hash, no changedAt', () => {
  const n = nextChecks({}, BASE, [ok(U, 'aaa', '2024-11-07T14:57:18+00:00')], '2026-11-02');
  assert.deepEqual(n[U], { checkedAt: '2026-11-02', contentHash: 'aaa', updatedAt: '2024-11-07T14:57:18+00:00' });
});

test('nextChecks: differing from the baseline sets changedAt to the first day seen, kept while unchanged, moved when it moves again', () => {
  const w1 = nextChecks({}, BASE, [ok(U, 'bbb', '2026-11-01T10:00:00+00:00')], '2026-11-02');
  assert.equal(w1[U].changedAt, '2026-11-02');
  const w2 = nextChecks(w1, BASE, [ok(U, 'bbb', '2026-11-01T10:00:00+00:00')], '2026-11-09');
  assert.deepEqual([w2[U].checkedAt, w2[U].changedAt], ['2026-11-09', '2026-11-02'], 'the first sighting is kept');
  const w3 = nextChecks(w2, BASE, [ok(U, 'ccc', '2026-11-12T10:00:00+00:00')], '2026-11-16');
  assert.equal(w3[U].changedAt, '2026-11-16', 'a further change is a new change');
  // once the maintainer re-verifies and scripts/sources.js rewrites the baseline, the page matches again
  const rebased = [{ ...BASE[0], bodyHash: 'ccc', updatedAt: '2026-11-12T10:00:00+00:00' }];
  assert.equal(nextChecks(w3, rebased, [ok(U, 'ccc', '2026-11-12T10:00:00+00:00')], '2026-11-23')[U].changedAt, undefined);
});

test('nextChecks: a failed fetch keeps the last success and records lastFailure; never creates a dated entry', () => {
  const w1 = nextChecks({}, BASE, [ok(U, 'aaa', '2024-11-07T14:57:18+00:00')], '2026-11-02');
  const w2 = nextChecks(w1, BASE, [{ url: U, ok: false, error: 'HTTP 503' }], '2026-11-09');
  assert.equal(w2[U].checkedAt, '2026-11-02');
  assert.deepEqual(w2[U].lastFailure, { at: '2026-11-09', error: 'HTTP 503' });
  assert.equal(nextChecks({}, BASE, [{ url: V, ok: false, error: 'timeout' }], '2026-11-02')[V], undefined, 'no fabricated date');
  // a later success clears lastFailure
  assert.equal(nextChecks(w2, BASE, [ok(U, 'aaa', '2024-11-07T14:57:18+00:00')], '2026-11-16')[U].lastFailure, undefined);
});

test('nextChecks: no baseline → a change between two checks still counts; unwatched URLs are dropped; output sorted and stable', () => {
  const w1 = nextChecks({}, [], [ok(V, 'x')], '2026-11-02');
  assert.equal(w1[V].changedAt, undefined, 'a first sighting is not a change');
  const w2 = nextChecks(w1, [], [ok(V, 'y')], '2026-11-09');
  assert.equal(w2[V].changedAt, '2026-11-09');
  const dropped = nextChecks({ ...w2, 'https://gone.example/': { checkedAt: '2026-10-01', contentHash: 'z' } }, [], [ok(V, 'y')], '2026-11-16', [V]);
  assert.deepEqual(Object.keys(dropped), [V]);
  const both = nextChecks({}, BASE, [ok(V, 'y'), ok(U, 'aaa', '2024-11-07T14:57:18+00:00')], '2026-11-02');
  assert.deepEqual(Object.keys(both), [U, V].sort());
  assert.equal(serialise(both), serialise(nextChecks({}, BASE, [ok(U, 'aaa', '2024-11-07T14:57:18+00:00'), ok(V, 'y')], '2026-11-02')));
});

test('run(): checks every watched page through the injected fetcher, skips unreachable ones, writes nothing with dry', async () => {
  const { run, OUT } = require('../scripts/check-sources');
  const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  const seen = [];
  const r = await run({ dry: true, day: '2026-11-02', checkSource: async (url) => { seen.push(url); return { url, bodyHash: 'h', updatedAt: null }; } });
  const { watchPlan } = require('../api/_sources');
  const { sourceList } = require('../api/_areas');
  const plan = watchPlan(sourceList(), require('../data/sources.json'));
  assert.deepEqual([...new Set(seen)].sort(), [...plan.check].sort(), 'every watched page (a differing page is fetched twice)');
  assert.equal(Object.keys(r.next).length, plan.check.length);
  assert.ok(Object.values(r.next).every((e) => e.checkedAt === '2026-11-02'));
  assert.equal(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null, before, '--dry writes nothing');
});

test('run(): a page that differs from the baseline is fetched once more, and a second fetch that matches wins (flapping lists); a real change stays', async () => {
  const { run } = require('../scripts/check-sources');
  const baseline = require('../data/sources.json').filter((s) => !s.unreachable);
  const flapper = baseline[0].url;
  const moved = baseline[1].url;
  const calls = new Map();
  const fetcher = async (url) => {
    const n = (calls.get(url) || 0) + 1;
    calls.set(url, n);
    const b = baseline.find((s) => s.url === url);
    if (url === flapper) return { url, bodyHash: n === 1 ? 'other-order' : b.bodyHash, updatedAt: b.updatedAt || null };
    if (url === moved) return { url, bodyHash: 'really-new', updatedAt: b.updatedAt || null };
    return { url, bodyHash: b.bodyHash, updatedAt: b.updatedAt || null };
  };
  const r = await run({ dry: true, day: '2026-11-09', checkSource: fetcher });
  assert.equal(calls.get(flapper), 2, 'fetched again after differing');
  assert.equal(r.next[flapper].changedAt, undefined, 'the matching second fetch wins');
  assert.equal(r.next[flapper].contentHash, baseline[0].bodyHash);
  assert.equal(calls.get(moved), 2, 'a real change is also fetched again');
  assert.equal(r.next[moved].changedAt, '2026-11-09', 'and stays a change');
  assert.ok(baseline.slice(2).every((s) => calls.get(s.url) === 1), 'matching pages are fetched once');
});

test('the served sourceCheckedAt comes from those files and never precedes the baseline fetch of the same URL', () => {
  const SEEN = require('../data/sources.json');
  const byUrl = new Map(SEEN.filter((s) => !s.unreachable).map((s) => [s.url, s.checkedAt]));
  for (const r of F.INDEX.values()) {
    if (!r.sourceCheckedAt) { assert.ok(!byUrl.has(r.source) || !F.sourceCheckOf(r), r.key); continue; }
    assert.match(r.sourceCheckedAt, /^\d{4}-\d{2}-\d{2}$/);
    if (byUrl.has(r.source)) assert.ok(r.sourceCheckedAt >= byUrl.get(r.source), r.key);
  }
});

/* ---------------- the expected-change list and its issue ---------------- */

test('expectedChangesPassed: every record past nextExpectedChange and verified before it, sorted; area filter', () => {
  const boe = F.INDEX.get('uk/bank-rate');
  const day = new Date(`${boe.nextExpectedChange}T12:00:00Z`);
  const list = F.expectedChangesPassed(day);
  assert.ok(list.some((p) => p.key === 'uk/bank-rate'));
  for (const p of list) {
    const r = F.INDEX.get(p.key);
    assert.ok(r.nextExpectedChange <= boe.nextExpectedChange && r.verifiedDate < r.nextExpectedChange, p.key);
    assert.equal(F.getFact(p.key, {}, day).staleReason === 'expected-change-passed' || F.getFact(p.key, {}, day).staleReason === 'max-age', true);
  }
  const sorted = [...list].sort((x, y) => x.nextExpectedChange.localeCompare(y.nextExpectedChange) || x.key.localeCompare(y.key));
  assert.deepEqual(list, sorted);
  assert.deepEqual(F.expectedChangesPassed(day, { area: 'policy-rates' }).map((p) => p.key), ['uk/bank-rate']);
  assert.deepEqual(F.expectedChangesPassed(new Date(`${boe.verifiedDate}T12:00:00Z`), { area: 'policy-rates' }), []);
});

test('planExpectedIssue: opens one issue, updates its body when the list moves, nothing when unchanged or empty', () => {
  const passed = [{ key: 'uk/bank-rate', area: 'policy-rates', nextExpectedChange: '2026-11-05', verifiedDate: '2026-10-31', changeCadence: 'scheduled' }];
  assert.deepEqual(planExpectedIssue([], []), []);
  const [o] = planExpectedIssue(passed, []);
  assert.equal(o.action, 'open');
  assert.equal(o.issue.title, EXPECTED_TITLE);
  assert.deepEqual(o.issue.labels, [LABEL]);
  assert.match(o.issue.body, /`uk\/bank-rate` — expected change 2026-11-05 \(scheduled\), verified 2026-10-31/);
  assert.match(o.issue.body, /expected-change-passed/);
  assert.deepEqual(planExpectedIssue(passed, [{ number: 7, title: EXPECTED_TITLE, body: o.issue.body }]), [], 'unchanged → nothing');
  const more = [...passed, { key: 'us/fed-funds/upper', area: 'policy-rates', nextExpectedChange: '2026-12-09', verifiedDate: '2026-10-31', changeCadence: 'scheduled' }];
  const [u] = planExpectedIssue(more, [{ number: 7, title: EXPECTED_TITLE, body: o.issue.body }]);
  assert.deepEqual([u.action, u.number], ['update', 7]);
  assert.match(u.issue.body, /us\/fed-funds\/upper/);
});

test('scripts/expected-changes.js: prints the list, plans the issue through the injected GitHub client, --strict exits 1', async () => {
  const { main } = require('../scripts/expected-changes');
  const boe = F.INDEX.get('uk/bank-rate');
  const now = new Date(`${boe.nextExpectedChange}T12:00:00Z`);
  const applied = [];
  const github = { listOpenIssues: async () => [], applyExpectedPlan: async (plan) => { applied.push(...plan); return plan.map((p) => p.action); } };
  const log = console.log;
  const out = [];
  console.log = (s) => out.push(String(s));
  try {
    assert.equal(await main(['--area', 'policy-rates', '--issue'], { now, github }), 0);
    assert.equal(await main(['--area', 'policy-rates', '--strict'], { now, github }), 1);
    assert.equal(await main(['--area', 'policy-rates', '--strict'], { now: new Date(`${boe.verifiedDate}T12:00:00Z`), github }), 0);
  } finally { console.log = log; }
  assert.match(out.join('\n'), /uk\/bank-rate {2}expected/);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].action, 'open');
});

test('the workflow runs the expected-change check daily (policy rates) and the source check + commit on Mondays', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/watch-sources.yml'), 'utf8');
  assert.match(yml, /cron: '30 6 \* \* \*'/);
  assert.match(yml, /node scripts\/expected-changes\.js --area policy-rates --issue/);
  assert.match(yml, /node scripts\/expected-changes\.js --issue/);
  assert.match(yml, /node scripts\/check-sources\.js/);
  assert.match(yml, /git add data\/source-checks\.json/);
  assert.match(yml, /issues: write/);
  assert.match(yml, /node --test tests\/\*\.test\.js/, 'tests pass before the commit that deploys');
});
