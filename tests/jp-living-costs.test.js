// tests/jp-living-costs.test.js — Japan daily-life official figures: data, tool, server, REST mirror, changelog entries, freshness, discovery.
// Scaffolded by scripts/new-area.js. Every expectation is read from the module and its data — tool name, params,
// REST path, cadence, previous semantics, required params — so filling the data (or renaming a param or the REST
// path in the module) needs no edits here beyond pinning real figures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const router = require('../api/router');
const AREA_MODULE = require('../api/_areas/jp-living-costs');
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
  // Pinned figures, read from the official pages on 2026-10-24 (docs/CURATION.md "Verification log (jp-living-costs)").
  const fig = (cat, key) => {
    const f = DATA.categories[cat].figures.find((x) => x.key === key);
    assert.ok(f, `${cat}/${key}`);
    return f;
  };
  const pins = {
    'minimum-wage': { 'national-weighted-average': 1177, tokyo: 1280, kanagawa: 1279, osaka: 1231, miyazaki: 1085, kochi: 1086, okinawa: 1086, saga: 1095, hokkaido: 1131, aomori: 1090, iwate: 1090 },
    'health-insurance': { tokyo: 9.85, hokkaido: 10.28, aomori: 9.85, iwate: 9.51, niigata: 9.21, saga: 10.55, okinawa: 9.44, 'long-term-care': 1.62, 'child-rearing-levy': 0.23 },
    pension: { 'kosei-nenkin-rate': 18.3, 'kokumin-nenkin-premium': 17920, 'kokumin-nenkin-premium-from-2027-04': 18290, 'kiso-nenkin-full-monthly': 70608, 'kiso-nenkin-full-monthly-born-before-1956-04-02': 70408 },
    'employment-insurance': { 'general-employee': 5, 'general-employer': 8.5, 'general-total': 13.5, 'agriculture-sake-total': 15.5, 'construction-employee': 6, 'construction-employer': 10.5, 'construction-total': 16.5 },
    benefits: { 'child-allowance-under-3': 15000, 'child-allowance-3-to-high-school': 10000, 'child-allowance-third-child': 30000, 'childbirth-lump-sum': 500000 },
    'consumption-tax': { 'standard-rate': 10, 'standard-rate-national': 7.8, 'standard-rate-local': 2.2, 'reduced-rate': 8, 'reduced-rate-national': 6.24, 'reduced-rate-local': 1.76 },
    'income-tax': { 'basic-deduction-2026-income-up-to-1.32m': 1040000, 'basic-deduction-2026-income-6.55m-to-23.5m': 620000, 'employment-income-deduction-minimum': 740000 },
    'resident-tax': { 'per-capita-levy-total': 5000, 'per-capita-levy-prefectural': 1000, 'per-capita-levy-municipal': 3000, 'forest-environment-tax': 1000 },
  };
  for (const [cat, figs] of Object.entries(pins)) for (const [key, v] of Object.entries(figs)) assert.equal(fig(cat, key).value, v, `${cat}/${key}`);

  // Minimum wage: all 47 prefectures plus the national weighted average, each with its own 発効日 and the FY2025 amount.
  const mw = DATA.categories['minimum-wage'].figures;
  assert.equal(mw.length, 48);
  for (const f of mw) {
    assert.match(f.effectiveFrom, /^2026-(10|11|12)-\d{2}$/, f.key);
    assert.ok(f.effectiveFrom >= '2026-10-01' && f.effectiveFrom <= '2026-12-02', f.key);
    assert.ok(f.previous && f.previous.value < f.value && f.previous.period === '2025', f.key);
    assert.equal(f.period, '2026');
  }
  assert.equal(fig('minimum-wage', 'tokyo').previous.value, 1226);
  assert.equal(fig('minimum-wage', 'saga').previous.value + 65, fig('minimum-wage', 'saga').value, 'biggest rise: Saga +65');
  for (const [key, from] of Object.entries({ tokyo: '2026-10-01', aomori: '2026-10-29', kagoshima: '2026-10-25', kyoto: '2026-11-16', iwate: '2026-12-01', kumamoto: '2026-12-01', okinawa: '2026-12-02' })) {
    assert.equal(fig('minimum-wage', key).effectiveFrom, from, key);
  }
  // Health insurance: 47 prefectures, none raised, seven unchanged.
  const hi = DATA.categories['health-insurance'].figures.filter((f) => f.previous && f.key !== 'long-term-care');
  assert.equal(hi.length, 47);
  assert.ok(hi.every((f) => f.value <= f.previous.value && f.effectiveFrom === '2026-03-01'));
  assert.deepEqual(hi.filter((f) => f.value === f.previous.value).map((f) => f.key).sort(), ['akita', 'aomori', 'kanagawa', 'okinawa', 'shimane', 'tochigi', 'yamagata']);
  assert.equal(fig('health-insurance', 'tokyo').previous.value, 9.91);
  // Employment insurance carries the FY2025 rates the leaflet prints; the FY2027 pension premium carries FY2026's.
  assert.equal(fig('employment-insurance', 'general-total').previous.value, 14.5);
  assert.equal(fig('employment-insurance', 'construction-total').previous.value, 17.5);
  assert.equal(fig('pension', 'kokumin-nenkin-premium-from-2027-04').previous.value, 17920);
  assert.equal(fig('pension', 'kokumin-nenkin-premium-from-2027-04').effectiveFrom, '2027-04-01');
  assert.equal(fig('pension', 'kiso-nenkin-full-monthly').previous.value, 69308);
  // 高額療養費: three consecutive tables.
  assert.equal(fig('benefits', 'high-cost-medical-under-70').effectiveTo, '2026-07-31');
  assert.equal(fig('benefits', 'high-cost-medical-under-70-from-2026-08').effectiveFrom, '2026-08-01');
  assert.equal(fig('benefits', 'high-cost-medical-under-70-from-2026-08').value.resident_tax_exempt.annual_cap, 290000);
  assert.equal(Object.keys(fig('benefits', 'high-cost-medical-under-70-from-2027-08').value).length, 13);
  // Holidays 2027: 17 days, including the substitute holiday on 2027-03-22.
  const hol = fig('holidays', '2027').value;
  assert.equal(hol.length, 17);
  assert.ok(hol.some((h) => h.date === '2027-03-22' && h.name === '休日'));
  // Income tax tables.
  assert.equal(fig('income-tax', 'basic-deduction-table').value['2026_2027']['<=1.32m'], 1040000);
  assert.equal(fig('income-tax', 'basic-deduction-table').value['2028_and_after']['<=1.32m'], 990000);
  // The pending 1% food consumption-tax rate is not published.
  assert.ok(!DATA.categories['consumption-tax'].figures.some((f) => f.value === 1 || /food-temporary/.test(f.key)));
  // Every figure carries a key, the Japanese term and the quoted row it was read from.
  for (const { cat, f } of FIGURES) assert.ok(f.key && f.term && f.quote && f.source, `${cat}/${f.label}`);
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
