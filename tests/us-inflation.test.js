// tests/us-inflation.test.js — US inflation (CPI-U): data, tool, server, REST mirror, changelog entries, freshness, discovery.
// Scaffolded by scripts/new-area.js. Every expectation is read from the module and its data — tool name, params,
// REST path, cadence, previous semantics, required params — so filling the data (or renaming a param or the REST
// path in the module) needs no edits here beyond pinning real figures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const router = require('../api/router');
const AREA_MODULE = require('../api/_areas/us-inflation');
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
  // Read from the BLS on 2026-10-31 (docs/CURATION.md "Verification log (us-inflation)").
  const f = (k) => DATA.categories['cpi-u'].figures.find((x) => x.key === k);
  assert.deepEqual(DATA.categories['cpi-u'].figures.map((x) => x.key),
    ['annual-rate', 'index', 'annual-average-2021', 'annual-average-2022', 'annual-average-2023', 'annual-average-2024', 'annual-average-2025']);
  assert.equal(f('annual-rate').value, 3.7);
  assert.equal(f('annual-rate').period, '2026-09');
  assert.equal(f('annual-rate').effectiveFrom, '2026-10-14');
  assert.equal(f('annual-rate').source, 'https://www.bls.gov/news.release/archives/cpi_10142026.htm');
  assert.deepEqual(f('annual-rate').previous, { value: 3.4, period: '2026-08', effectiveFrom: '2026-09-11', source: 'https://www.bls.gov/news.release/archives/cpi_09112026.htm', title: 'August 2026 Consumer Price Index release' });
  assert.match(f('annual-rate').quote, /increased 3\.7 percent over the last 12 months to an index level of 336\.940 \(1982-84=100\)/);
  assert.equal(f('index').value, 336.94);
  assert.equal(f('index').unit, 'index, 1982-84=100');
  assert.equal(f('index').quote, 'CUUR0000SA0 2026 M09 (September) 336.940');
  assert.deepEqual(f('index').previous, { value: 334.98, period: '2026-08', effectiveFrom: '2026-09-11', source: 'https://data.bls.gov/timeseries/CUUR0000SA0' });
  const averages = { 2021: [270.97, '2022-01-12'], 2022: [292.655, '2023-01-12'], 2023: [304.702, '2024-01-11'], 2024: [313.689, '2025-01-15'], 2025: [321.943, '2026-01-13'] };
  for (const [y, [v, from]] of Object.entries(averages)) {
    assert.equal(f(`annual-average-${y}`).value, v, `${y} average`);
    assert.equal(f(`annual-average-${y}`).period, y);
    assert.equal(f(`annual-average-${y}`).effectiveFrom, from, `${y} average released with the December CPI`);
  }
  assert.deepEqual(DATA.latestRelease, { referenceMonth: '2026-09', date: '2026-10-14', source: 'https://www.bls.gov/news.release/archives/cpi_10142026.htm' });
  assert.deepEqual(DATA.nextRelease, { referenceMonth: '2026-10', date: '2026-11-10', source: 'https://www.bls.gov/schedule/news_release/cpi.htm' });
  assert.equal(DATA.nextScheduledRefresh, DATA.nextRelease.date);
  assert.match(DATA.licence, /is in the public domain/);
});

test('script: builds the committed figures from the saved BLS fixture, offline', () => {
  const S = require('../scripts/us-inflation');
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, 'fixtures/us-inflation');
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const raw = { api: JSON.parse(read('api.json')), archive: read('archive.html'), schedule: read('schedule.txt'), releases: { '2026-09': read('release-2026-09.txt'), '2026-08': read('release-2026-08.txt') } };
  const built = S.buildFrom(raw, { fetched: read('fetched.txt').trim(), via: 'fixture' });
  assert.deepEqual(built.categories, DATA.categories, 'the committed categories are exactly what the script builds');
  assert.equal(built.nextScheduledRefresh, DATA.nextScheduledRefresh);
  assert.deepEqual(built.releaseSchedule, DATA.releaseSchedule);
  // The 12-month change is cross-checked against the two published index levels.
  assert.equal(S.twelveMonth(336.94, 324.8), 3.7);
  assert.equal(S.twelveMonth(334.98, 323.976), 3.4);
  const wrong = { ...raw, releases: { ...raw.releases, '2026-09': raw.releases['2026-09'].replace('increased 3.7 percent', 'increased 3.8 percent') } };
  assert.throws(() => S.buildFrom(wrong, { fetched: '2026-10-31', via: 'x' }), /release states 3\.8%, the indexes give 3\.7%/);
  const badIndex = { ...raw, releases: { ...raw.releases, '2026-09': raw.releases['2026-09'].replace('336.940', '336.941') } };
  assert.throws(() => S.buildFrom(badIndex, { fetched: '2026-10-31', via: 'x' }), /index level 336\.941 ≠ API 336\.940/);
  // The next release is the first scheduled day after verifiedDate.
  assert.equal(S.buildFrom(raw, { fetched: '2026-11-10', via: 'x' }).nextRelease.date, '2026-12-10');
  // A failed API request never becomes data.
  assert.throws(() => S.buildFrom({ ...raw, api: { status: 'REQUEST_NOT_PROCESSED', message: ['limit'] } }, { fetched: '2026-10-31', via: 'x' }), /status REQUEST_NOT_PROCESSED/);
});

test('script: a year-ago month BLS never published (October 2025) takes the release figure, quoted as such', () => {
  const S = require('../scripts/us-inflation');
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, 'fixtures/us-inflation');
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const api = JSON.parse(read('api.json'));
  const oct25 = api.Results.series[0].data.find((d) => d.year === '2025' && d.period === 'M10');
  assert.equal(oct25.value, '-', 'the fixture keeps the gap as BLS publishes it');
  // Shift: pretend 2025-10 is the year-ago month of the newest release by relabelling Sep 2025 as missing.
  const sep25 = api.Results.series[0].data.find((d) => d.year === '2025' && d.period === 'M09');
  sep25.value = '-';
  sep25.footnotes = [{ code: 'X', text: 'Data unavailable due to the 2025 lapse in appropriations' }];
  const raw = { api, archive: read('archive.html'), schedule: read('schedule.txt'), releases: { '2026-09': read('release-2026-09.txt'), '2026-08': read('release-2026-08.txt') } };
  const rate = S.buildFrom(raw, { fetched: '2026-10-31', via: 'x' }).categories['cpi-u'].figures[0];
  assert.equal(rate.value, 3.7);
  assert.match(rate.quote, /2025 M09 not published \(Data unavailable due to the 2025 lapse in appropriations\), so the change is the release's own figure/);
});

test('facts: us/cpi-u keys, periods, scheduled nextExpectedChange and the reviewed aliases', () => {
  const F = require('../api/_facts');
  const rate = F.getFact('us/cpi-u/annual-rate');
  assert.equal(rate.value, 3.7);
  assert.equal(rate.period, '2026-09');
  assert.equal(rate.effectiveFrom, '2026-10-14');
  assert.equal(rate.changeCadence, 'scheduled');
  assert.equal(rate.nextExpectedChange, DATA.nextRelease.date);
  assert.deepEqual(rate.previous, { value: 3.4, period: '2026-08', effectiveFrom: '2026-09-11', source: 'https://www.bls.gov/news.release/archives/cpi_09112026.htm' });
  assert.deepEqual([...rate.aliases].sort(), ['us/cpi/annual-rate', 'us/inflation/cpi', 'us/inflation/rate']);
  for (const alias of ['us/inflation/cpi', 'us/inflation/rate', 'us/cpi/annual-rate']) assert.equal(F.getFact(alias).key, 'us/cpi-u/annual-rate', alias);
  const index = F.getFact('us/cpi-u/index');
  assert.equal(index.value, 336.94);
  assert.equal(index.unit, 'index, 1982-84=100');
  assert.equal(index.nextExpectedChange, DATA.nextRelease.date);
  const avg = F.getFact('us/cpi-u/annual-average-2025');
  assert.equal(avg.value, 321.943);
  assert.equal(avg.period, '2025');
  assert.equal(avg.changeCadence, 'irregular', 'a published annual average is final: no expected day');
  assert.equal(avg.nextExpectedChange, null);
  assert.equal(F.getFact('us/cpi-u/annual-rate', { period: '2026-08' }).value, 3.4, 'the prior month is served as its own period');
  for (const q of ['US inflation rate', 'consumer price index', 'CPI-U', 'cost of living US']) {
    const r = F.resolveFact(q);
    assert.ok(r.candidates.length && r.candidates[0].key.startsWith('us/cpi-u/'), `${q} → ${r.candidates[0] && r.candidates[0].key}`);
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
