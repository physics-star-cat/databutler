// tests/uk-gov-process.test.js — UK government services: data, tool, server, REST mirror, changelog entries, freshness, discovery.
// Scaffolded by scripts/new-area.js. Every expectation is read from the module and its data — tool name, params,
// REST path, cadence, previous semantics, required params — so filling the data (or renaming a param or the REST
// path in the module) needs no edits here beyond pinning real figures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const router = require('../api/router');
const AREA_MODULE = require('../api/_areas/uk-gov-process');
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
  // Figures read from gov.uk on 2026-10-04 (docs/CURATION.md, "Verification log (uk-gov-process)").
  const fig = (cat, key) => {
    const f = DATA.categories[cat].figures.find((x) => x.key === key);
    assert.ok(f, `${cat}/${key}`);
    return f;
  };
  assert.equal(CATEGORIES.length, 16);
  // Passports: £102 / £115.50 from 8 April 2026 (were £94.50 / £107); overseas £116.50 / £130 (were £108 / £120.50)
  assert.equal(fig('passport-renewal-adult', 'fee-online-uk').value, 102);
  assert.equal(fig('passport-renewal-adult', 'fee-online-uk').previous.value, 94.5);
  assert.equal(fig('passport-renewal-adult', 'fee-online-uk').effectiveFrom, '2026-04-08');
  assert.equal(fig('passport-renewal-adult', 'fee-paper-uk').value, 115.5);
  assert.equal(fig('passport-renewal-adult', 'fee-online-overseas').value, 116.5);
  assert.equal(fig('passport-renewal-adult', 'fee-online-overseas').previous.value, 108);
  assert.equal(fig('passport-renewal-adult', 'fee-paper-overseas').value, 130);
  assert.equal(fig('passport-renewal-adult', 'fee-1-day-premium').value, 239.5);
  assert.equal(fig('passport-child', 'fee-online-uk').value, 66.5);
  assert.equal(fig('passport-child', 'fee-online-uk').previous.value, 61.5);
  assert.equal(fig('passport-child', 'fee-paper-uk').value, 80);
  assert.equal(fig('passport-child', 'validity').value, 5);
  // DVLA: renewal £14 online / £21.50 Post Office / £17 post; 10-year photocard; free and every 3 years from 70; provisional £34 / £43
  assert.equal(fig('driving-licence-renewal', 'fee-online').value, 14);
  assert.equal(fig('driving-licence-renewal', 'fee-post-office').value, 21.5);
  assert.equal(fig('driving-licence-renewal', 'photocard-interval').value, 10);
  assert.equal(fig('driving-licence-renewal', 'age-70-interval').value, 3);
  assert.equal(fig('provisional-licence', 'fee-online').value, 34);
  assert.equal(fig('provisional-licence', 'fee-post').value, 43);
  assert.equal(fig('change-address', 'fine').value, 1000);
  assert.equal(fig('vehicle-tax-sorn', 'replacement-v5c').value, 25);
  // Registration: births 42 days, £12.50 certificate; deaths 5 days; register to vote 16 (England/NI), 14 (Scotland/Wales)
  assert.equal(fig('register-birth', 'deadline').value, 42);
  assert.equal(fig('register-birth', 'certificate-fee').value, 12.5);
  assert.equal(fig('register-death', 'deadline').value, 5);
  assert.equal(fig('register-to-vote', 'age-scotland-wales').value, 14);
  assert.equal(fig('blue-badge', 'fee-england').value, 10);
  // Self Assessment 2025-26: register by 5 October 2026, paper 31 October 2026, online and pay 31 January 2027; MTD from 6 April 2026
  assert.equal(fig('self-assessment', 'register-by').value, '2026-10-05');
  assert.equal(fig('self-assessment', 'online-deadline').value, '2027-01-31');
  assert.equal(fig('self-assessment', 'mtd-income-tax-start').value, '2026-04-06');
  // Universal Credit 2026-27: £424.90 single 25+ (was £400.14), £303.94 per child (was £292.81), 2-child limit ended 6 April 2026
  assert.equal(fig('universal-credit', 'standard-allowance-single-25-plus').value, 424.9);
  assert.equal(fig('universal-credit', 'standard-allowance-single-25-plus').previous.value, 400.14);
  assert.equal(fig('universal-credit', 'child-element').value, 303.94);
  assert.equal(fig('universal-credit', 'two-child-limit').effectiveFrom, '2026-04-06');
  assert.equal(fig('universal-credit', 'capital-limit').value, 16000);
  // eVisa / ETA: expired BRPs not accepted for travel from 2 June 2025; ETA £20 from 8 April 2026 (was £16), enforced 25 February 2026
  assert.equal(fig('evisa', 'expired-brp-travel').effectiveFrom, '2025-06-02');
  assert.equal(fig('eta', 'fee').value, 20);
  assert.equal(fig('eta', 'fee').previous.value, 16);
  assert.equal(fig('eta', 'fee').effectiveFrom, '2026-04-08');
  assert.equal(fig('eta', 'enforced-from').value, '2026-02-25');
  assert.equal(fig('eta', 'rollout-european').value, '2025-04-02');
  // Every figure has a stable key and a quote; every service a start page and dated changes; every change since 2025.
  for (const { cat, f } of FIGURES) {
    assert.match(f.key, /^[a-z0-9-]+$/, `${cat}/${f.label} key`);
    assert.ok(f.quote, `${cat}/${f.key} quote`);
    if (f.previous) {
      assert.ok(f.effectiveFrom >= '2025-01-01', `${cat}/${f.key}: a previous value marks a change since 2025, dated`);
      assert.match(f.previous.source, /^https:\/\/(www\.gov\.uk|webarchive\.nationalarchives\.gov\.uk)\//, `${cat}/${f.key} previous.source`);
    }
  }
  for (const [k, c] of Object.entries(DATA.categories)) {
    assert.match(c.source, /^https:\/\/www\.gov\.uk\//, `${k} source on gov.uk`);
    assert.equal(c.contentApi, c.source.replace('https://www.gov.uk/', 'https://www.gov.uk/api/content/'), `${k} contentApi`);
    for (const ch of c.changes) assert.match(ch.date, ISO, `${k} change dated`);
  }
  const keys = FIGURES.map(({ cat, f }) => `${cat}/${f.key}`);
  assert.equal(new Set(keys).size, keys.length, 'figure keys unique');
});

test('aliases: common names resolve to a service; the listing carries them; near-misses rank aliases too', async () => {
  const run = TOOL_DEF.run;
  assert.equal(run({ service: 'passport' }).service, 'passport-renewal-adult');
  assert.equal(run({ service: 'passport' }).requested, 'passport');
  assert.equal(run({ service: 'BRP' }).service, 'evisa');
  assert.equal(run({ service: 'sorn' }).service, 'vehicle-tax-sorn');
  assert.equal(run({ service: 'Child Passport' }).service, 'passport-child');
  assert.equal(run({ service: 'eta' }).requested, undefined, 'an exact key carries no requested');
  const listing = run({});
  assert.equal(listing.aliases.passport, 'passport-renewal-adult');
  for (const target of Object.values(listing.aliases)) assert.ok(CATEGORIES.includes(target), `alias → ${target} exists`);
  const miss = run({ service: 'pasport' });
  assert.equal(miss.covered, false);
  assert.equal(miss.nearest[0], 'passport-renewal-adult');
  const viaRest = await get(rest, `/api/${REST_PATH}?service=passport`);
  assert.equal(viaRest.status, 200);
  assert.equal(viaRest.body.service, 'passport-renewal-adult');
  assert.equal(viaRest.body.cite.url, `https://databutler.dev/r/${REST_PATH}?service=passport`);
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
