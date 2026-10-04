// tests/uk-vehicle-rules.test.js — UK vehicle tax (VED) and MOT rules: data, tool, server, REST mirror, changelog entries, freshness, discovery.
// Scaffolded by scripts/new-area.js. Expectations derive from the module and its data (cadence, previous
// semantics, REST required params), so filling the data needs no edits here beyond pinning real figures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const router = require('../api/router');
const AREA_MODULE = require('../api/_areas/uk-vehicle-rules');
const WELL_KNOWN = require('../public/.well-known/changes.json');
const { ALL_TOOLS } = require('../api/_registry');
const { freshnessFor, DUE_WINDOW_DAYS } = require('../api/_freshness');
const { CHANGELOG_AREAS } = require('../api/_changelog');
const { plusDays, same } = require('../api/_area_kit');

const AREA = "uk-vehicle-rules";
const TOOL = "uk_vehicle_rules_lookup";
const DATA = AREA_MODULE.freshness.data; // the file the module serves (data/<slug>.json or data/<slug>/<year>.json)
const CADENCE = AREA_MODULE.freshness.cadenceDays; // null = calendar-driven
const PREVIOUS = AREA_MODULE.changelog.previous === true;
const REQUIRED = (AREA_MODULE.rest[0].required || []).includes('category');
const server = router.ROUTES[`mcp/${AREA}`];
const REST_PATH = AREA_MODULE.rest[0].path; // 'uk/vehicle-rules' — the REST mirror and cite path
const rest = router.ROUTES[REST_PATH];
const get = (h, url) => invoke(h, undefined, { method: 'GET', url });
const day = (iso) => new Date(`${iso}T12:00:00Z`);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = Object.keys(DATA.categories);
const FIGURES = Object.entries(DATA.categories).flatMap(([cat, c]) => c.figures.map((f) => ({ cat, f })));
const ENTRY_FIELDS = ['area', 'key', 'label', 'from', 'to', 'effectiveFrom', 'source', 'verifiedDate', 'note'];
const hasPrevious = (f) => f.previous && f.previous.value !== undefined && !same(f.previous.value, f.value);

test('data: verifiedDate, nextScheduledRefresh follows the cadence, every category sourced', () => {
  assert.equal(DATA.area, AREA);
  assert.match(DATA.verifiedDate, ISO);
  if (CADENCE === null) {
    assert.match(DATA.nextScheduledRefresh, ISO, 'calendar-driven: an ISO date set by hand');
    assert.ok(!Number.isNaN(Date.parse(DATA.nextScheduledRefresh)));
  } else {
    assert.equal(DATA.nextScheduledRefresh, plusDays(DATA.verifiedDate, CADENCE));
  }
  for (const [k, c] of Object.entries(DATA.categories)) {
    assert.ok(c.title, `${k} title`);
    assert.match(c.source, /^https?:\/\//, `${k} source is an official URL`);
    assert.ok(Array.isArray(c.figures) && c.figures.length, `${k} figures`);
    for (const f of c.figures) assert.ok(f.label && f.value !== undefined, `${k} figure`);
  }
  // Figures read from gov.uk on 2026-10-04 (docs/CURATION.md, "Verification log (uk-vehicle-rules)").
  const fig = (cat, key) => {
    const f = DATA.categories[cat].figures.find((x) => x.key === key);
    assert.ok(f, `${cat}/${key}`);
    return f;
  };
  assert.equal(DATA.taxYear, '2026-27');
  assert.equal(CADENCE, null, 'VED is calendar-driven: 1 April');
  assert.equal(DATA.nextScheduledRefresh, '2027-04-01');
  // ved-first-year: 13 CO2 bands, two columns; 1–50g/km £115 / £135 (was £110 / £130)
  assert.equal(DATA.categories['ved-first-year'].figures.length, 13);
  assert.deepEqual(fig('ved-first-year', 'co2-0g-km').value, { petrolRde2DieselAlternativeZeroEmission: 10, otherDiesel: 10 });
  assert.deepEqual(fig('ved-first-year', 'co2-1-to-50g-km').value, { petrolRde2DieselAlternativeZeroEmission: 115, otherDiesel: 135 });
  assert.deepEqual(fig('ved-first-year', 'co2-1-to-50g-km').previous.value, { petrolRde2DieselAlternativeZeroEmission: 110, otherDiesel: 130 });
  assert.deepEqual(fig('ved-first-year', 'co2-131-to-150g-km').value, { petrolRde2DieselAlternativeZeroEmission: 560, otherDiesel: 1410 });
  assert.deepEqual(fig('ved-first-year', 'co2-over-255g-km').value, { petrolRde2DieselAlternativeZeroEmission: 5690, otherDiesel: 5690 });
  for (const f of DATA.categories['ved-first-year'].figures) assert.equal(f.effectiveFrom, '2026-04-01');
  // ved-standard: £200 (was £195); 12 monthly DD £210; 6-month £110 / £105 DD; 5% surcharge
  assert.equal(fig('ved-standard', 'standard-rate-12-month').value, 200);
  assert.equal(fig('ved-standard', 'standard-rate-12-month').previous.value, 195);
  assert.equal(fig('ved-standard', 'standard-rate-12-monthly-direct-debit-total').value, 210);
  assert.equal(fig('ved-standard', 'standard-rate-6-month').value, 110);
  assert.equal(fig('ved-standard', 'standard-rate-6-month-direct-debit').value, 105);
  assert.equal(fig('ved-standard', 'direct-debit-surcharge').value, 5);
  // ved-expensive-car: £40,000 threshold (£50,000 zero-emission from 1 April 2026), £440 a year (was £425), 5 years, £640 total
  assert.equal(fig('ved-expensive-car', 'list-price-threshold').value, 40000);
  assert.equal(fig('ved-expensive-car', 'list-price-threshold-zero-emission').value, 50000);
  assert.equal(fig('ved-expensive-car', 'list-price-threshold-zero-emission').previous.value, 40000);
  assert.equal(fig('ved-expensive-car', 'annual-supplement').value, 440);
  assert.equal(fig('ved-expensive-car', 'annual-supplement').previous.value, 425);
  assert.equal(fig('ved-expensive-car', 'years-applied').value, 5);
  assert.equal(fig('ved-expensive-car', 'standard-plus-supplement-12-month').value, 640);
  // ved-2001-2017: bands A–M, 12-month single payment; A £20, D £170 (was £165), M £790 (was £760)
  assert.equal(DATA.categories['ved-2001-2017'].figures.length, 13);
  assert.equal(fig('ved-2001-2017', 'band-a').value, 20);
  assert.equal(fig('ved-2001-2017', 'band-d').value, 170);
  assert.equal(fig('ved-2001-2017', 'band-d').previous.value, 165);
  assert.equal(fig('ved-2001-2017', 'band-k').value, 445);
  assert.equal(fig('ved-2001-2017', 'band-m').value, 790);
  assert.equal(fig('ved-2001-2017', 'band-m').previous.value, 760);
  // ved-pre-2001: £230 / £375 (were £220 / £360)
  assert.equal(fig('ved-pre-2001', 'engine-not-over-1549cc').value, 230);
  assert.equal(fig('ved-pre-2001', 'engine-not-over-1549cc').previous.value, 220);
  assert.equal(fig('ved-pre-2001', 'engine-over-1549cc').value, 375);
  assert.equal(fig('ved-pre-2001', 'engine-over-1549cc').previous.value, 360);
  // ved-electric: taxable since 2025-04-01; £10 first year; £200 standard; £50,000 supplement threshold
  assert.equal(fig('ved-electric', 'taxable-from').value, '2025-04-01');
  assert.equal(fig('ved-electric', 'first-year-rate').value, 10);
  assert.equal(fig('ved-electric', 'standard-rate').value, 200);
  assert.equal(fig('ved-electric', 'expensive-car-supplement-threshold').value, 50000);
  assert.equal(fig('ved-electric', 'expensive-car-supplement-amount').value, 440);
  // historic: built before 1 January 1986 (was 1985) from 1 April 2026; registered before 8 January 1986; 40-year MOT exemption
  assert.equal(fig('historic', 'tax-exemption-built-before').value, '1986-01-01');
  assert.equal(fig('historic', 'tax-exemption-built-before').previous.value, '1985-01-01');
  assert.equal(fig('historic', 'tax-exemption-registered-before').value, '1986-01-08');
  assert.equal(fig('historic', 'mot-exemption-age').value, 40);
  // mot: first MOT at 3 years, 12 months validity, max fee car £54.85 / motorcycle £29.65 (unchanged since 2010 → no changelog entry), a month minus a day early
  assert.equal(fig('mot', 'first-mot-age-car').value, 3);
  assert.equal(fig('mot', 'validity').value, 12);
  assert.equal(fig('mot', 'max-fee-car').value, 54.85);
  assert.equal(fig('mot', 'max-fee-car').previous.value, 54.85);
  assert.equal(fig('mot', 'max-fee-motorcycle').value, 29.65);
  assert.equal(fig('mot', 'max-fee-motorcycle-sidecar').value, 37.80);
  assert.equal(fig('mot', 'max-fee-class-7-goods').value, 58.60);
  assert.equal(fig('mot', 'vat-on-fee').value, 'none');
  assert.match(fig('mot', 'early-renewal-keeping-expiry').value, /a month \(minus a day\)/);
  assert.match(fig('mot', 'retest-free-left-at-centre').value, /10 working days/);
  // penalties: £1,000 no MOT; £2,500 + 3 points dangerous; £80 untaxed
  assert.equal(fig('penalties', 'no-mot-fine').value, 1000);
  assert.equal(fig('penalties', 'dangerous-failed-mot-fine').value, 2500);
  assert.equal(fig('penalties', 'untaxed-vehicle-fine').value, 80);
  // Every figure has a stable key, a quote from the page and, where it carries a previous, that previous names its source.
  for (const { cat, f } of FIGURES) {
    assert.match(f.key, /^[a-z0-9-]+$/, `${cat}/${f.label} key`);
    assert.ok(f.quote, `${cat}/${f.key} quote`);
    if (f.previous) assert.match(f.previous.source, /^https:\/\/(www\.gov\.uk|webarchive\.nationalarchives\.gov\.uk)\//, `${cat}/${f.key} previous.source`);
  }
  const keys = FIGURES.map(({ cat, f }) => `${cat}/${f.key}`);
  assert.equal(new Set(keys).size, keys.length, 'figure keys unique within the file');
});

test('server: lists the tool with clean MCP keys and read-only annotations', async () => {
  const list = await rpc(server, 'tools/list');
  assert.deepEqual(list.body.result.tools.map((t) => t.name), [TOOL]);
  assert.deepEqual(Object.keys(list.body.result.tools[0]).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title']);
  assert.equal(ALL_TOOLS[TOOL].server, AREA);
  assert.equal(ALL_TOOLS[TOOL].freshness, AREA);
  // House rule: plain statements, no imperatives, in the tool description.
  assert.doesNotMatch(ALL_TOOLS[TOOL].description, /\b(use this|you should|always|never|call this|do not)\b/i);
});

test('happy path: a category answers with figures, source, verifiedDate, freshness and a cite permalink', async () => {
  const key = CATEGORIES[0];
  const { isError, data } = await callTool(server, TOOL, { category: key });
  assert.equal(isError, false);
  assert.equal(data.covered, undefined);
  assert.equal(data.category, key);
  assert.deepEqual(data.figures, DATA.categories[key].figures);
  assert.equal(data.source, DATA.categories[key].source);
  assert.equal(data.freshness.verifiedDate, DATA.verifiedDate);
  assert.equal(data.cite.url, `https://databutler.dev/r/${REST_PATH}?category=${encodeURIComponent(key)}`);
  assert.match(data.cite.text, new RegExp(`^databutler\\.dev, verified ${DATA.verifiedDate} against `));
});

test('near-miss: an unknown category is covered:false with nearest keys, never an error', async () => {
  const { isError, data } = await callTool(server, TOOL, { category: 'zzz-not-a-category' });
  assert.equal(isError, false);
  assert.equal(data.covered, false);
  assert.equal(data.requested, 'zzz-not-a-category');
  assert.ok(Array.isArray(data.nearest));
  assert.deepEqual(data.coverage, CATEGORIES);
  assert.equal(data.error, undefined);
});

test(`REST mirror: empty query → ${REQUIRED ? '400' : 'the listing'}; otherwise the tool with envelope + cite`, async () => {
  const empty = await get(rest, `/api/${REST_PATH}`);
  if (REQUIRED) {
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, /missing \?category=/);
  } else {
    assert.equal(empty.status, 200);
    assert.deepEqual(Object.keys(empty.body.categories), CATEGORIES);
    assert.ok(empty.body.freshness && empty.body.cite);
  }
  const miss = await get(rest, `/api/${REST_PATH}?category=zzz`);
  assert.equal(miss.status, 200);
  assert.equal(miss.body.covered, false);
  assert.ok(miss.body.freshness && miss.body.cite);
  const viaRouter = await get(router, `/api/router?route=${REST_PATH}&category=zzz`);
  assert.equal(viaRouter.status, 200);
});

test('changelog: the area is listed; a first commit records what the data says (previous → value, or null → value)', () => {
  assert.ok(CHANGELOG_AREAS.includes(AREA));
  const first = AREA_MODULE.changelog.diff(null, DATA);
  // With previous semantics a figure arrives as previous.value → value and an un-previoused figure records
  // nothing; without them every figure arrives as null → value.
  const arrivals = FIGURES.filter(({ f }) => !PREVIOUS || hasPrevious(f));
  assert.equal(first.length, arrivals.length);
  for (const { cat, f } of arrivals) {
    const e = first.find((x) => x.key.startsWith(`${cat}/`) && x.label === f.label);
    assert.ok(e, `entry for ${cat}/${f.label}`);
    for (const k of ENTRY_FIELDS) assert.ok(k in e, `${e.key} has ${k}`);
    assert.equal(e.area, AREA);
    assert.deepEqual(e.from, PREVIOUS ? f.previous.value : null);
    assert.deepEqual(e.to, f.value);
    assert.equal(e.verifiedDate, DATA.verifiedDate);
    assert.equal(e.effectiveFrom, f.effectiveFrom || '2026-04-01', `${e.key} effectiveFrom is 1 April`);
    assert.equal(e.taxYear, DATA.taxYear);
    assert.equal(e.note, '', 'notes are filled by scripts/changelog.js (changelog.note), never by diff()');
  }
  assert.deepEqual(AREA_MODULE.changelog.diff(DATA, DATA), [], 'nothing moved');
  if (first.length && AREA_MODULE.changelog.note) {
    assert.ok(AREA_MODULE.changelog.note(first[0], null, DATA).length > 0, 'changelog.note pre-fills a note');
  }
});

test('freshness: fresh before nextScheduledRefresh, due from that day, overdue after the window', () => {
  const next = DATA.nextScheduledRefresh;
  if (CADENCE !== null) assert.equal(freshnessFor(AREA, day(DATA.verifiedDate)).staleness, 'fresh');
  assert.equal(freshnessFor(AREA, day(plusDays(next, -1))).staleness, 'fresh');
  assert.equal(freshnessFor(AREA, day(next)).staleness, 'due');
  assert.equal(freshnessFor(AREA, day(plusDays(next, DUE_WINDOW_DAYS + 1))).staleness, 'overdue');
});

test('discovery: the area appears in /.well-known/changes.json (run node scripts/sync-areas.js)', () => {
  const entry = WELL_KNOWN.areas.find((a) => a.name === AREA);
  assert.ok(entry, 'area in the discovery document');
  assert.equal(entry.cadence, AREA_MODULE.discovery.cadence);
});
