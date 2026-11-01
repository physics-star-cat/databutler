// tests/jp-vehicle-costs.test.js — Japan vehicle statutory costs: data, tool, server, REST mirror, changelog entries, freshness, discovery.
// Scaffolded by scripts/new-area.js. Every expectation is read from the module and its data — tool name, params,
// REST path, cadence, previous semantics, required params — so filling the data (or renaming a param or the REST
// path in the module) needs no edits here beyond pinning real figures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const router = require('../api/router');
const AREA_MODULE = require('../api/_areas/jp-vehicle-costs');
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
  // Pinned figures, read from the official pages on 2026-10-24 (docs/CURATION.md "Verification log (jp-vehicle-costs)").
  const fig = (cat, key) => {
    const f = DATA.categories[cat].figures.find((x) => x.key === key);
    assert.ok(f, `${cat}/${key}`);
    return f;
  };
  const pins = {
    'weight-tax': {
      'passenger-eco-per-0.5t-2y': 5000, 'passenger-standard-per-0.5t-2y': 8200, 'passenger-13y-per-0.5t-2y': 11400, 'passenger-18y-per-0.5t-2y': 12600,
      'passenger-eco-per-0.5t-1y': 2500, 'passenger-standard-per-0.5t-1y': 4100, 'passenger-13y-per-0.5t-1y': 5700, 'passenger-18y-per-0.5t-1y': 6300,
      'kei-eco-2y': 5000, 'kei-standard-2y': 6600, 'kei-13y-2y': 8200, 'kei-18y-2y': 8800,
    },
    'weight-tax-eco': { 'first-inspection-exemption': 0, period: '2026-05-01/2028-04-30' },
    cali: {
      'passenger-12m': 12250, 'passenger-24m': 18560, 'passenger-25m': 19070, 'passenger-36m': 24690, 'passenger-37m': 25180,
      'kei-12m': 12300, 'kei-24m': 18660, 'kei-25m': 19170, 'kei-36m': 24830, 'kei-37m': 25330,
      'revision-date': '2026-11-01', 'current-table-applies-from': '2026-11-01',
    },
    'inspection-fee': {
      'standard-bring-in': 2600, 'small-bring-in': 2500, 'standard-small-certificate-counter': 2100, 'standard-small-certificate-oss': 1850,
      'kei-bring-in': 2500, 'kei-certificate-counter': 2100, 'kei-certificate-oss': 1850, 'technical-information-fee': 400,
    },
    'kei-tax': { 'passenger-private-standard': 10800, 'passenger-private-old': 7200, 'passenger-private-heavy-13y': 12900, 'green-reduction-ev-fy2026': 2700 },
  };
  for (const [cat, figs] of Object.entries(pins)) for (const [key, v] of Object.entries(figs)) assert.equal(fig(cat, key).value, v, `${cat}/${key}`);
  // The full 2-year table agrees with the per-0.5 t rates (n × rate for n half-tonnes).
  const table = fig('weight-tax', 'passenger-table-2y').value;
  Object.values(table).forEach((row, i) => assert.deepEqual(row, { eco: 5000 * (i + 1), standard: 8200 * (i + 1), over13y: 11400 * (i + 1), over18y: 12600 * (i + 1) }));
  assert.deepEqual(fig('auto-tax', 'passenger-registered-from-2019-10').value['1.5-2.0L'], 36000);
  assert.deepEqual(fig('auto-tax', 'passenger-registered-before-2019-10').value['1.5-2.0L'], 39500);
  assert.deepEqual(fig('auto-tax', 'passenger-heavy-13y').value['1.5-2.0L'], 45400);
  assert.equal(fig('auto-tax', 'passenger-registered-from-2019-10').value['>6.0L'], 110000);
  // Inspection fees carry the pre-2026-04-01 amount from NALTEC's fee-change notice.
  assert.equal(fig('inspection-fee', 'standard-bring-in').previous.value, 2300);
  assert.equal(fig('inspection-fee', 'kei-certificate-oss').previous.value, 1600);
  // Since 2026-11-01 the revised 自賠責 table is on the base keys (spec §3.3: period is a parameter, not part of the key);
  // each carries the 2023 table as previous, dated so it is served as its own period. 25/37-month amounts come from GIROJ's table.
  const table2023 = { 'passenger-12m': 11500, 'passenger-24m': 17650, 'passenger-25m': 18160, 'passenger-36m': 23690, 'passenger-37m': 24190,
    'kei-12m': 11440, 'kei-24m': 17540, 'kei-25m': 18040, 'kei-36m': 23520, 'kei-37m': 24010 };
  const caliFigs = DATA.categories.cali.figures.filter((x) => /^(passenger|kei)-\d+m$/.test(x.key));
  assert.equal(caliFigs.length, 10);
  for (const f of caliFigs) {
    assert.equal(f.effectiveFrom, '2026-11-01', f.key);
    assert.equal(f.effectiveTo, undefined, f.key);
    assert.equal(f.verifiedDate, '2026-11-01', f.key);
    assert.deepEqual([f.previous.value, f.previous.effectiveFrom], [table2023[f.key], '2023-04-01'], f.key);
    assert.ok(f.previous.source && f.previous.quote, `${f.key}: the 2023 table is sourced and quoted`);
  }
  assert.ok(!DATA.categories.cali.figures.some((x) => x.key.endsWith('-from-2026-11')), 'the -from-2026-11 figures are aliases now, not figures');
  // Every figure carries a key, the Japanese term and the quoted row it was read from.
  for (const { cat, f } of FIGURES) assert.ok(f.key && f.term && f.quote, `${cat}/${f.label}`);
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
    assert.equal(e.verifiedDate, f.verifiedDate || DATA.verifiedDate, 'a figure re-verified on its own day dates its entry by that day');
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

test('facts: the 自賠責 revision of 2026-11-01 is on the base keys; the -from-2026-11 keys are aliases; the 2023 table answers as_of', () => {
  const facts = require('../api/_facts');
  const now = new Date('2026-11-01T12:00:00Z');
  const r = facts.getFact('jp/cali/passenger-24m', {}, now);
  assert.equal(r.value, 18560);
  assert.equal(r.effectiveFrom, '2026-11-01');
  assert.equal(r.effectiveTo, null);
  assert.equal(r.changeCadence, 'irregular');
  assert.equal(r.nextExpectedChange, null, 'no next revision date is known');
  assert.deepEqual([r.previous.value, r.previous.effectiveFrom], [17650, '2023-04-01']);
  for (const [v, m, value] of [['passenger', 12, 12250], ['passenger', 25, 19070], ['passenger', 37, 25180], ['kei', 24, 18660], ['kei', 37, 25330]]) {
    const a = facts.getFact(`jp/cali/${v}-${m}m-from-2026-11`, {}, now);
    assert.equal(a.key, `jp/cali/${v}-${m}m`, 'alias resolves to the base key');
    assert.equal(a.value, value);
    assert.ok((a.aliases || []).includes(`jp/cali/${v}-${m}m-from-2026-11`), 'the record lists its alias');
  }
  const old = facts.getFact('jp/cali/passenger-24m', { as_of: '2026-10-15' }, now);
  assert.equal(old.value, 17650, 'a policy starting before the switch gets the 2023 table');
  assert.equal(facts.getFact('jp/cali/current-table-applies-from', {}, now).value, '2026-11-01');
});
