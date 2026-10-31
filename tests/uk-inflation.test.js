// tests/uk-inflation.test.js — UK inflation (CPI, CPIH): data, tool, server, REST mirror, changelog entries, freshness, discovery.
// Scaffolded by scripts/new-area.js. Every expectation is read from the module and its data — tool name, params,
// REST path, cadence, previous semantics, required params — so filling the data (or renaming a param or the REST
// path in the module) needs no edits here beyond pinning real figures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const router = require('../api/router');
const AREA_MODULE = require('../api/_areas/uk-inflation');
const WELL_KNOWN = require('../public/.well-known/changes.json');
const { ALL_TOOLS } = require('../api/_registry');
const { freshnessFor, DUE_WINDOW_DAYS } = require('../api/_freshness');
const { CHANGELOG_AREAS } = require('../api/_changelog');
const { plusDays, same } = require('../api/_area_kit');

const AREA = AREA_MODULE.area;
const TOOL_DEF = AREA_MODULE.server.tools[0];
const TOOL = TOOL_DEF.name;
const [PARAM, ...FILTERS] = Object.keys(TOOL_DEF.inputSchema.properties); // the first names the category; the rest narrow its figures
const REST = AREA_MODULE.rest.find((r) => r.tool === TOOL);
const REST_PATH = REST.path;
const DATA = AREA_MODULE.freshness.data; // the file the module serves (data/<slug>.json or data/<slug>/<year>.json)
const CADENCE = AREA_MODULE.freshness.cadenceDays; // null = calendar-driven
const PREVIOUS = AREA_MODULE.changelog.previous === true;
const REQUIRED = (REST.required || []).includes(PARAM);
const server = router.ROUTES[`mcp/${AREA_MODULE.server.key || AREA}`];
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
  // Pinned from the ONS series JSON (release of 21 October 2026, reference month September 2026), docs/CURATION.md.
  const fig = (cat, key) => DATA.categories[cat].figures.find((f) => f.key === key);
  const pin = (cat, key, value, period, effectiveFrom) => {
    const f = fig(cat, key);
    assert.ok(f, `${cat}/${key}`);
    assert.equal(f.value, value, `${cat}/${key} value`);
    assert.equal(f.period, period, `${cat}/${key} period`);
    assert.equal(f.effectiveFrom, effectiveFrom, `${cat}/${key} effectiveFrom`);
    assert.match(f.source, /^https:\/\/www\.ons\.gov\.uk\/economy\/inflationandpriceindices\/timeseries\/(d7g7|l55o|d7bt)\/mm23$/);
    assert.ok(f.quote.startsWith('CPI'), `${cat}/${key} quotes the ONS series line`);
    return f;
  };
  assert.equal(pin('cpi', 'annual-rate', 3.5, '2026-09', '2026-10-21').quote, 'CPI ANNUAL RATE 00: ALL ITEMS 2015=100, 2026 SEP: 3.5');
  assert.deepEqual(fig('cpi', 'annual-rate').previous, {
    value: 3.1, period: '2026-08', effectiveFrom: '2026-09-16',
    source: 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23', quote: 'CPI ANNUAL RATE 00: ALL ITEMS 2015=100, 2026 AUG: 3.1',
  });
  assert.equal(pin('cpi', 'index-level', 144.1, '2026-09', '2026-10-21').unit, 'index, 2015=100');
  assert.equal(fig('cpi', 'index-level').previous.value, 143.6);
  assert.equal(pin('cpih', 'annual-rate', 3.6, '2026-09', '2026-10-21').quote, 'CPIH ANNUAL RATE 00: ALL ITEMS 2015=100, 2026 SEP: 3.6');
  assert.equal(fig('cpih', 'annual-rate').previous.value, 3.3);
  pin('cpi', 'annual-average-2021', 2.6, '2021', '2022-01-19');
  pin('cpi', 'annual-average-2022', 9.1, '2022', '2023-01-18');
  pin('cpi', 'annual-average-2023', 7.3, '2023', '2024-01-17');
  pin('cpi', 'annual-average-2024', 2.5, '2024', '2025-01-15');
  assert.equal(pin('cpi', 'annual-average-2025', 3.4, '2025', '2026-01-21').quote, 'CPI ANNUAL RATE 00: ALL ITEMS 2015=100, 2025: 3.4');
  assert.equal(DATA.releaseDate, '2026-10-21');
  assert.equal(DATA.nextRelease, '2026-11-18');
  assert.equal(DATA.nextScheduledRefresh, DATA.nextRelease);
  assert.match(DATA.licence, /Open Government Licence v3\.0/);
});

test('script: scripts/uk-inflation.js rebuilds the committed file from the saved ONS responses (offline)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { buildFrom, ukDay, parseLongDate, monthPeriod, SERIES_IDS } = require('../scripts/uk-inflation');
  const dir = path.join(__dirname, 'fixtures/uk-inflation');
  const raw = Object.fromEntries(SERIES_IDS.map((id) => [id, JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'))]));
  const built = buildFrom(raw, { verifiedDate: DATA.verifiedDate, via: DATA.fetchedVia });
  assert.deepEqual(built, DATA);
  assert.equal(ukDay('2026-10-20T23:00:00.000Z'), '2026-10-21', 'BST: 23:00Z is the next UK day');
  assert.equal(ukDay('2026-01-21T00:00:00.000Z'), '2026-01-21', 'GMT');
  assert.equal(parseLongDate('18 November 2026'), '2026-11-18');
  assert.equal(monthPeriod('2026 SEP'), '2026-09');
  // A mixed snapshot (series on different releases) is refused, never written.
  const stale = { ...raw, l55o: { ...raw.l55o, description: { ...raw.l55o.description, releaseDate: '2026-09-15T23:00:00.000Z' } } };
  assert.throws(() => buildFrom(stale, { verifiedDate: DATA.verifiedDate }), /disagree on description\.releaseDate/);
  assert.throws(() => buildFrom({ d7g7: raw.d7g7 }, { verifiedDate: DATA.verifiedDate }), /missing series data/);
});

test('facts: uk/cpi/* and uk/cpih/* records with period, previous, scheduled nextExpectedChange and aliases', () => {
  const facts = require('../api/_facts');
  const get = (k) => facts.getFact(k, {}, new Date(`${DATA.verifiedDate}T12:00:00Z`));
  const r = get('uk/cpi/annual-rate');
  assert.equal(r.key, 'uk/cpi/annual-rate');
  assert.equal(r.value, 3.5);
  assert.equal(r.unit, '%');
  assert.equal(r.period, '2026-09');
  assert.equal(r.effectiveFrom, '2026-10-21');
  assert.equal(r.changeCadence, 'scheduled');
  assert.equal(r.nextExpectedChange, '2026-11-18');
  assert.deepEqual({ value: r.previous.value, period: r.previous.period }, { value: 3.1, period: '2026-08' });
  assert.equal(get('uk/cpih/annual-rate').value, 3.6);
  assert.equal(get('uk/cpi/index-level').unit, 'index, 2015=100');
  const avg = get('uk/cpi/annual-average-2022');
  assert.equal(avg.value, 9.1);
  assert.equal(avg.period, '2022');
  assert.equal(avg.changeCadence, 'irregular');
  assert.equal(avg.nextExpectedChange, null);
  for (const [alias, target] of [['uk/inflation/cpi', 'uk/cpi/annual-rate'], ['uk/inflation/cpih', 'uk/cpih/annual-rate'], ['uk/inflation/rate', 'uk/cpi/annual-rate']]) {
    assert.equal(get(alias).key, target, alias);
  }
});

test('server: lists the tool with clean MCP keys and read-only annotations', async () => {
  const list = await rpc(server, 'tools/list');
  assert.deepEqual(list.body.result.tools.map((t) => t.name), [TOOL]);
  assert.deepEqual(Object.keys(list.body.result.tools[0]).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title']);
  assert.ok(TOOL_DEF.title.length <= 40, 'tool title within the 40-character cap');
  assert.equal(ALL_TOOLS[TOOL].freshness, AREA);
  // House rule: plain statements, no imperatives, in the tool description.
  assert.doesNotMatch(ALL_TOOLS[TOOL].description, /\b(use this|you should|always|never|call this|do not)\b/i);
});

test('happy path: a category answers with figures, source, verifiedDate, freshness and a cite permalink', async () => {
  if (!CATEGORIES.length) {
    // TODO data: until a category exists, the listing is the happy path.
    const { isError, data } = await callTool(server, TOOL, {});
    assert.equal(isError, false);
    assert.deepEqual(data.categories, {});
    assert.equal(data.cite.url, `https://databutler.dev/r/${REST_PATH}`);
    return;
  }
  const key = CATEGORIES[0];
  const { isError, data } = await callTool(server, TOOL, { [PARAM]: key });
  assert.equal(isError, false);
  assert.equal(data.covered, undefined);
  assert.equal(data.category, key);
  assert.deepEqual(data.figures, DATA.categories[key].figures);
  assert.equal(data.source, DATA.categories[key].source);
  assert.equal(data.freshness.verifiedDate, DATA.verifiedDate);
  assert.equal(data.cite.url, `https://databutler.dev/r/${REST_PATH}?${PARAM}=${encodeURIComponent(key)}`);
  assert.match(data.cite.text, new RegExp(`^databutler\\.dev, verified ${DATA.verifiedDate} against `));
});

test('filters: each further param narrows the figures by the field of that name; an unknown value is a near-miss', async () => {
  for (const field of FILTERS) {
    const hit = FIGURES.find(({ f }) => f[field] !== undefined && f[field] !== null && f[field] !== '');
    if (!hit) continue; // TODO data: no figure carries this field yet
    const want = String(hit.f[field]).toLowerCase();
    const { data } = await callTool(server, TOOL, { [PARAM]: hit.cat, [field]: hit.f[field] });
    assert.ok(data.figures.length >= 1, `${field} keeps at least the figure it was read from`);
    for (const f of data.figures) assert.equal(String(f[field]).toLowerCase(), want);
    const miss = (await callTool(server, TOOL, { [PARAM]: hit.cat, [field]: 'zzz-not-a-value' })).data;
    assert.equal(miss.covered, false);
    assert.equal(miss.field, field);
    assert.ok(Array.isArray(miss.nearest) && Array.isArray(miss.coverage));
  }
});

test('near-miss: an unknown category is covered:false with nearest keys, never an error', async () => {
  const { isError, data } = await callTool(server, TOOL, { [PARAM]: 'zzz-not-a-category' });
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
    assert.match(empty.body.error, new RegExp(`missing \\?${PARAM}=`));
  } else {
    assert.equal(empty.status, 200);
    assert.deepEqual(Object.keys(empty.body.categories), CATEGORIES);
    assert.ok(empty.body.freshness && empty.body.cite);
  }
  const miss = await get(rest, `/api/${REST_PATH}?${PARAM}=zzz`);
  assert.equal(miss.status, 200);
  assert.equal(miss.body.covered, false);
  assert.ok(miss.body.freshness && miss.body.cite);
  const viaRouter = await get(router, `/api/router?route=${REST_PATH}&${PARAM}=zzz`);
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
    if (f.key) assert.equal(e.key, `${cat}/${f.key}`, 'a figure that carries key is keyed by it');
    assert.deepEqual(e.from, PREVIOUS ? f.previous.value : null);
    assert.deepEqual(e.to, f.value);
    assert.match(e.effectiveFrom, ISO);
    assert.equal(e.verifiedDate, DATA.verifiedDate);
    assert.equal(e.note, '', 'notes are filled by scripts/changelog.js (changelog.note), never by diff()');
  }
  assert.deepEqual(AREA_MODULE.changelog.diff(DATA, DATA), [], 'nothing moved');
  if (first.length && AREA_MODULE.changelog.note) {
    const note = AREA_MODULE.changelog.note(first[0], null, DATA);
    assert.ok(note.length > 0, 'changelog.note pre-fills a note');
    assert.doesNotMatch(note, /\{\w+\}/, 'every placeholder in the note template is filled');
  }
});

test('sources: each watched URL once, every category source among them', () => {
  const urls = AREA_MODULE.sources().map((s) => s.url);
  assert.equal(new Set(urls).size, urls.length);
  for (const c of Object.values(DATA.categories)) assert.ok(urls.includes(c.source), c.source);
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
