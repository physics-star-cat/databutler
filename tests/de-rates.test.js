// tests/de-rates.test.js — German rates & thresholds (Veranlagungszeitraum 2026): data, tool, server, hub phrases,
// REST mirror, citation page, changelog entries (previous → current, 2027 steps), calendar-driven freshness, watcher sources.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const router = require('../api/router');
const AREA_MODULE = require('../api/_areas/de-rates');
const DATA = require('../data/de-rates.json');
const CHANGELOG = require('../data/changelog.json');
const SEEN = require('../data/sources.json');
const WELL_KNOWN = require('../public/.well-known/changes.json');
const { ALL_TOOLS, SERVERS } = require('../api/_registry');
const { freshnessFor, DUE_WINDOW_DAYS } = require('../api/_freshness');
const { CHANGELOG_AREAS } = require('../api/_changelog');
const { DIRECT, whatChangedSince, coverage, catalogue, HUB_TOOLS } = require('../api/_hub');
const { coverageFor } = require('../api/_coverage');
const { sourceUrls } = require('../api/_areas');
const { plusDays, same } = require('../api/_area_kit');
const r = require('../api/_routes/r');

const AREA = 'de-rates';
const TOOL = 'de_rates_lookup';
const server = router.ROUTES[`mcp/${AREA}`];
const rest = router.ROUTES['de/rates'];
const get = (h, url) => invoke(h, undefined, { method: 'GET', url });
const day = (iso) => new Date(`${iso}T12:00:00Z`);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = ['income-tax', 'social-insurance', 'minimum-wage', 'minijob', 'kindergeld', 'kinderfreibetrag', 'sparer-pauschbetrag', 'arbeitnehmer-pauschbetrag', 'entfernungspauschale'];
const ENTRY_FIELDS = ['area', 'key', 'label', 'from', 'to', 'effectiveFrom', 'source', 'verifiedDate', 'note'];
const OFFICIAL = /^https:\/\/www\.(gesetze-im-internet\.de|recht\.bund\.de|bmas\.de|bundesgesundheitsministerium\.de|deutsche-rentenversicherung\.de|minijob-zentrale\.de|bmfsfj\.de|bundesanzeiger\.de)\//;
const figure = (cat, key) => DATA.categories[cat].figures.find((f) => f.key === key);
const value = (cat, key) => figure(cat, key).value;
/** Figures whose arrival the changelog records: those with a previous value that differs. */
const changed = () => Object.entries(DATA.categories).flatMap(([cat, c]) => c.figures.filter((f) => f.previous && !same(f.previous.value, f.value)).map((f) => ({ cat, f })));

/* ---------------- data ---------------- */

test('data: VZ 2026, calendar-driven refresh, every figure keyed, termed (German + English), sourced, quoted and dated', () => {
  assert.equal(DATA.area, AREA);
  assert.equal(DATA.taxYear, '2026');
  assert.equal(DATA.currency, 'EUR');
  assert.match(DATA.verifiedDate, ISO);
  assert.equal(AREA_MODULE.freshness.cadenceDays, null, 'calendar-driven: nextScheduledRefresh is set by hand');
  assert.equal(DATA.nextScheduledRefresh, '2026-12-15', 'when the SV-Rechengrößen-VO and the tax changes for 2027 are normally final');
  assert.match(DATA.licence, /§ 5 UrhG/);
  assert.deepEqual(Object.keys(DATA.categories), CATEGORIES);
  for (const [k, c] of Object.entries(DATA.categories)) {
    assert.ok(c.title && c.scope, `${k} title + scope`);
    assert.match(c.source, OFFICIAL, `${k} source is an official page`);
    assert.ok(Array.isArray(c.figures) && c.figures.length, `${k} figures`);
    assert.equal(new Set(c.figures.map((f) => f.key)).size, c.figures.length, `${k} figure keys unique`);
    for (const f of c.figures) {
      assert.match(f.key, /^[a-z0-9-]+$/, `${k} key`);
      assert.ok(typeof f.term === 'string' && f.term.length > 2, `${k}/${f.key} German term`);
      assert.ok(typeof f.label === 'string' && f.label.length > 5 && f.label !== f.term, `${k}/${f.key} English label alongside the term`);
      assert.ok(f.value !== undefined && f.unit, `${k}/${f.key} value, unit`);
      assert.match(f.effectiveFrom, ISO, `${k}/${f.key} effectiveFrom`);
      assert.match(f.source, OFFICIAL, `${k}/${f.key} source`);
      assert.ok(typeof f.quote === 'string' && f.quote.length > 20, `${k}/${f.key} quote (the verification evidence)`);
      assert.equal(f.verifiedDate, DATA.verifiedDate, `${k}/${f.key} verifiedDate`);
      if (f.previous) assert.ok(f.previous.taxYear && f.previous.value !== undefined && (f.previous.source || f.derived || same(f.previous.value, f.value)), `${k}/${f.key} previous (sourced when it differs, unless derived)`);
    }
  }
  // Social-insurance rates carry the employee/employer split.
  for (const key of ['kv-allgemeiner-beitragssatz', 'rv-beitragssatz', 'av-beitragssatz', 'pv-beitragssatz', 'kv-durchschnittlicher-zusatzbeitrag']) {
    const f = figure('social-insurance', key);
    assert.ok(typeof f.employeeShare === 'number' && typeof f.employerShare === 'number', `${key} shares`);
    assert.equal(Math.round((f.employeeShare + f.employerShare) * 100) / 100, f.value, `${key} shares sum to the rate`);
  }
  // Figures as read from the statutes and pages on 2026-10-03 (docs/CURATION.md verification log).
  assert.equal(value('income-tax', 'grundfreibetrag'), 12348);
  assert.equal(figure('income-tax', 'grundfreibetrag').previous.value, 12096);
  assert.equal(value('income-tax', 'tarif-zonen').length, 5);
  assert.equal(value('income-tax', 'spitzensteuersatz-schwelle'), 69879);
  assert.equal(value('income-tax', 'reichensteuer-schwelle'), 277826);
  assert.equal(value('income-tax', 'soli-freigrenze-einzel'), 20350);
  assert.equal(value('social-insurance', 'bbg-rv-av-monat'), 8450);
  assert.equal(value('social-insurance', 'bbg-kv-pv-monat'), 5812.5);
  assert.equal(value('social-insurance', 'jaeg-jahr'), 77400);
  assert.equal(value('social-insurance', 'bezugsgroesse-jahr'), 47460);
  assert.equal(value('social-insurance', 'kv-durchschnittlicher-zusatzbeitrag'), 2.9);
  assert.equal(value('social-insurance', 'rv-beitragssatz'), 18.6);
  assert.equal(value('social-insurance', 'av-beitragssatz'), 2.6);
  assert.equal(value('social-insurance', 'pv-beitragssatz'), 3.6);
  assert.equal(value('minimum-wage', 'mindestlohn-2026'), 13.9);
  assert.equal(value('minimum-wage', 'mindestlohn-2027'), 14.6);
  assert.equal(figure('minimum-wage', 'mindestlohn-2027').effectiveFrom, '2027-01-01');
  assert.equal(value('minijob', 'geringfuegigkeitsgrenze-2026'), 603);
  assert.equal(value('minijob', 'geringfuegigkeitsgrenze-2027'), 633);
  assert.equal(value('kindergeld', 'kindergeld'), 259);
  assert.equal(value('kinderfreibetrag', 'kinderfreibetrag'), 3414);
  assert.equal(value('kinderfreibetrag', 'bea-freibetrag'), 1464);
  assert.equal(value('sparer-pauschbetrag', 'sparer-pauschbetrag'), 1000);
  assert.equal(value('arbeitnehmer-pauschbetrag', 'arbeitnehmer-pauschbetrag'), 1230);
  assert.equal(value('entfernungspauschale', 'entfernungspauschale'), 0.38);
});

/* ---------------- registry, server, hub ---------------- */

test('server: lists the tool with clean MCP keys; registered on its own server, not at the front door; plain-statement description', async () => {
  const list = await rpc(server, 'tools/list');
  assert.deepEqual(list.body.result.tools.map((t) => t.name), [TOOL]);
  assert.deepEqual(Object.keys(list.body.result.tools[0]).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title']);
  const t = ALL_TOOLS[TOOL];
  assert.equal(t.server, AREA);
  assert.equal(t.serverUrl, 'https://databutler.dev/api/mcp/de-rates');
  assert.equal(t.freshness, AREA);
  assert.equal(t.annotations.readOnlyHint, true);
  assert.equal(t.annotations.openWorldHint, false);
  assert.ok(!DIRECT.includes(TOOL), 'not on the front door — reachable through call');
  assert.doesNotMatch(t.description, /\b(use this|you should|always|never|call this|do not|use when|use whenever|use to)\b/i);
  for (const c of CATEGORIES) assert.ok(t.description.includes(c), `description names ${c}`);
  assert.match(t.description, /Kirchensteuer/);
  assert.match(SERVERS[AREA].instructions, /de_rates_lookup/);
  const init = await rpc(server, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.body.result.serverInfo.name, 'databutler-de-rates');
});

test('hub: what_changed_since, coverage, catalogue and call mention the area; coverage lists what is not covered', () => {
  assert.match(whatChangedSince.description, /German tax and social-insurance thresholds/);
  assert.ok(whatChangedSince.inputSchema.properties.area.enum.includes(AREA));
  assert.match(coverage.description, /German rate categories/);
  assert.match(catalogue.description, /de_rates_lookup/);
  assert.match(HUB_TOOLS.find((t) => t.name === 'call').description, /de_rates_lookup/);
  const cov = coverageFor(AREA);
  assert.deepEqual(cov.categories, CATEGORIES);
  assert.deepEqual(cov.taxYears, ['2026']);
  for (const re of [/Kirchensteuer/, /Lohnsteuerklassen/, /Gewerbesteuer/, /2027 draft/]) assert.ok(cov.notCovered.some((s) => re.test(s)), String(re));
  assert.ok(cov.notCovered.find((s) => /2027 draft/.test(s)).includes('not served'));
});

/* ---------------- tool ---------------- */

test('listing: no category → taxYear, categories with titles and usage, with envelope + cite', async () => {
  const { isError, data } = await callTool(server, TOOL, {});
  assert.equal(isError, false);
  assert.equal(data.taxYear, '2026');
  assert.deepEqual(Object.keys(data.categories), CATEGORIES);
  assert.equal(data.categories.kindergeld, DATA.categories.kindergeld.title);
  assert.equal(data.cite.url, 'https://databutler.dev/r/de/rates');
  assert.ok(data.freshness.verifiedDate === DATA.verifiedDate && data.freshness.nextScheduledRefresh === '2026-12-15');
});

test('happy path: a category answers with figures (term, label, source, quote, previous), taxYear, freshness and a cite permalink', async () => {
  for (const key of CATEGORIES) {
    const { isError, data } = await callTool(server, TOOL, { category: key });
    assert.equal(isError, false, key);
    assert.equal(data.covered, undefined, key);
    assert.equal(data.category, key);
    assert.equal(data.taxYear, '2026');
    assert.equal(data.currency, 'EUR');
    assert.deepEqual(data.figures, DATA.categories[key].figures);
    assert.equal(data.source, DATA.categories[key].source);
    assert.equal(data.title, DATA.categories[key].title);
    assert.equal(data.freshness.verifiedDate, DATA.verifiedDate);
    assert.equal(data.cite.url, `https://databutler.dev/r/de/rates?category=${key}`);
    assert.equal(data.cite.text, `databutler.dev, verified ${DATA.verifiedDate} against ${DATA.categories[key].source}`);
  }
  // Like uk_rates_lookup, a key or title containing the input resolves (case-insensitive).
  assert.equal((await callTool(server, TOOL, { category: 'Mindestlohn' })).data.category, 'minimum-wage');
  assert.equal((await callTool(server, TOOL, { category: 'sozialversicherung' })).data.category, 'social-insurance');
  assert.equal((await callTool(server, TOOL, { category: 'kindergeld' })).data.category, 'kindergeld');
});

test('near-miss: an unknown category is covered:false with nearest keys and coverage, never an error', async () => {
  const { isError, data } = await callTool(server, TOOL, { category: 'kirchensteuer' });
  assert.equal(isError, false);
  assert.equal(data.covered, false);
  assert.equal(data.requested, 'kirchensteuer');
  assert.ok(Array.isArray(data.nearest) && data.nearest.length);
  assert.deepEqual(data.coverage, CATEGORIES);
  assert.equal(data.error, undefined);
  assert.ok(data.freshness && data.cite);
});

/* ---------------- REST + /r ---------------- */

test('REST mirror /api/de/rates: listing without ?category=, figures with it, covered:false on a miss; envelope on each', async () => {
  const listing = await get(rest, '/api/de/rates');
  assert.equal(listing.status, 200);
  assert.deepEqual(Object.keys(listing.body.categories), CATEGORIES);
  const hit = await get(rest, '/api/de/rates?category=social-insurance');
  assert.equal(hit.status, 200);
  assert.equal(hit.body.category, 'social-insurance');
  assert.equal(hit.body.figures.find((f) => f.key === 'bbg-rv-av-monat').value, 8450);
  assert.equal(hit.body.cite.url, 'https://databutler.dev/r/de/rates?category=social-insurance');
  const miss = await get(rest, '/api/de/rates?category=zzz');
  assert.equal(miss.status, 200);
  assert.equal(miss.body.covered, false);
  assert.ok(miss.body.freshness && miss.body.cite);
  const viaRouter = await get(router, '/api/router?route=de/rates&category=minijob');
  assert.equal(viaRouter.status, 200);
  assert.equal(viaRouter.body.category, 'minijob');
});

test('/r/de/rates renders a citation page with the official source', async () => {
  const res = await get(r, '/api/r?path=de/rates&category=income-tax');
  assert.equal(res.status, 200);
  assert.match(String(res.raw), /gesetze-im-internet\.de\/estg\/__32a\.html/);
  assert.match(String(res.raw), /12348/);
});

/* ---------------- changelog ---------------- */

test('changelog diff: a figure\'s arrival records previous → current; the fixed 2027 steps are logged under 2027', () => {
  assert.ok(CHANGELOG_AREAS.includes(AREA));
  const expected = changed();
  assert.ok(expected.length >= 15);
  const first = AREA_MODULE.changelog.diff(null, DATA);
  assert.equal(first.length, expected.length, 'one entry per figure with a differing previous value; unchanged or un-previoused figures record nothing');
  for (const { cat, f } of expected) {
    const e = first.find((x) => x.key === `${cat}/${f.key}`);
    assert.ok(e, `${cat}/${f.key}`);
    for (const k of ENTRY_FIELDS) assert.ok(k in e, `${e.key} has ${k}`);
    assert.equal(e.area, AREA);
    assert.deepEqual(e.from, f.previous.value);
    assert.deepEqual(e.to, f.value);
    assert.equal(e.effectiveFrom, f.effectiveFrom);
    assert.equal(e.source, f.source);
    assert.equal(e.term, f.term);
    assert.equal(e.label, `${f.term} / ${f.label}`, 'entries carry both names');
    assert.equal(e.verifiedDate, DATA.verifiedDate);
    assert.equal(e.note, '');
  }
  const by = (k) => first.find((e) => e.key === k);
  assert.deepEqual([by('income-tax/grundfreibetrag').from, by('income-tax/grundfreibetrag').to, by('income-tax/grundfreibetrag').effectiveFrom, by('income-tax/grundfreibetrag').taxYear], [12096, 12348, '2026-01-01', '2026']);
  assert.deepEqual([by('minimum-wage/mindestlohn-2027').from, by('minimum-wage/mindestlohn-2027').to, by('minimum-wage/mindestlohn-2027').effectiveFrom, by('minimum-wage/mindestlohn-2027').taxYear], [13.9, 14.6, '2027-01-01', '2027']);
  assert.deepEqual([by('minijob/geringfuegigkeitsgrenze-2027').from, by('minijob/geringfuegigkeitsgrenze-2027').to, by('minijob/geringfuegigkeitsgrenze-2027').effectiveFrom, by('minijob/geringfuegigkeitsgrenze-2027').taxYear], [603, 633, '2027-01-01', '2027']);
  assert.deepEqual([by('social-insurance/pv-beitragssatz').from, by('social-insurance/pv-beitragssatz').effectiveFrom], [3.4, '2025-01-01'], 'the PV rate last moved in 2025 — its real effective date is kept');
  assert.equal(typeof by('entfernungspauschale/entfernungspauschale').from, 'string', 'the 2025 two-tier rule has no single number');
  assert.ok(!first.some((e) => e.key === 'kinderfreibetrag/bea-freibetrag'), 'unchanged since 2021 — no entry');
  assert.ok(!first.some((e) => e.key === 'sparer-pauschbetrag/sparer-pauschbetrag'), 'unchanged since 2023 — no entry');
  assert.deepEqual(AREA_MODULE.changelog.diff(DATA, DATA), [], 'nothing moved');
  // A later refresh: one moved value → one from → to entry keyed by the stable key.
  const next = JSON.parse(JSON.stringify(DATA));
  next.verifiedDate = '2026-12-10'; next.taxYear = '2027';
  const kg = next.categories.kindergeld.figures.find((f) => f.key === 'kindergeld');
  kg.value = 262; kg.effectiveFrom = '2027-01-01';
  const diff = AREA_MODULE.changelog.diff(DATA, next);
  assert.deepEqual(diff.map((e) => [e.key, e.from, e.to, e.effectiveFrom, e.taxYear]), [['kindergeld/kindergeld', 259, 262, '2027-01-01', '2027']]);
});

test('changelog.json: the first-commit entries are recorded, each with a maintainer note naming the Gesetz/Verordnung', () => {
  const mine = CHANGELOG.filter((e) => e.area === AREA);
  assert.ok(mine.length >= changed().length, 'every arrival entry committed');
  for (const e of mine) {
    assert.ok(e.note.length > 20, `${e.key} note`);
    assert.match(e.note, /BGBl|Verordnung|Gesetz|Bekanntmachung|Bundesanzeiger|MiLoV5|SteFeG|StÄndG|PBAV|SGB/, `${e.key} note names the act`);
    assert.match(e.source, /^https:\/\//);
  }
  assert.ok(mine.some((e) => e.key === 'minimum-wage/mindestlohn-2027' && e.effectiveFrom === '2027-01-01'));
  assert.ok(mine.some((e) => e.key === 'minijob/geringfuegigkeitsgrenze-2027' && e.effectiveFrom === '2027-01-01'));
  assert.equal(new Set(mine.map((e) => `${e.key}|${e.verifiedDate}`)).size, mine.length, 'entry identity unique');
});

/* ---------------- freshness, discovery, sources ---------------- */

test('freshness: fresh until the hand-set nextScheduledRefresh, due for the window, then overdue', () => {
  assert.equal(freshnessFor(AREA, day(DATA.verifiedDate)).staleness, 'fresh');
  assert.equal(freshnessFor(AREA, day(plusDays(DATA.nextScheduledRefresh, -1))).staleness, 'fresh');
  assert.equal(freshnessFor(AREA, day(DATA.nextScheduledRefresh)).staleness, 'due');
  assert.equal(freshnessFor(AREA, day(plusDays(DATA.nextScheduledRefresh, DUE_WINDOW_DAYS + 1))).staleness, 'overdue');
});

test('discovery: the area appears in /.well-known/changes.json with its cadence', () => {
  const entry = WELL_KNOWN.areas.find((a) => a.name === AREA);
  assert.ok(entry, 'area in the discovery document');
  assert.equal(entry.cadence, AREA_MODULE.discovery.cadence);
  assert.match(entry.description, /Grundfreibetrag/);
});

test('sources: the watcher gets the statute pages and ministry tables, no bundesfinanzministerium.de, and sources.json knows them', () => {
  const urls = AREA_MODULE.sources().map((s) => s.url);
  assert.equal(urls.length, 12);
  assert.ok(urls.every((u) => OFFICIAL.test(u)));
  assert.ok(!urls.some((u) => u.includes('bundesfinanzministerium.de')), 'BMF serves a CAPTCHA to automated fetches');
  for (const u of ['https://www.gesetze-im-internet.de/estg/__32a.html', 'https://www.gesetze-im-internet.de/estg/__66.html', 'https://www.bundesgesundheitsministerium.de/beitraege', 'https://www.minijob-zentrale.de/DE/die-minijobs/minijob-mit-verdienstgrenze']) assert.ok(urls.includes(u), u);
  for (const s of AREA_MODULE.sources()) assert.ok(s.label.length > 10, s.url);
  const all = sourceUrls();
  for (const u of urls) assert.ok(all.includes(u), `watched: ${u}`);
  const seen = new Set(SEEN.map((s) => s.url));
  for (const u of urls) assert.ok(seen.has(u), `data/sources.json has ${u} (run node scripts/changelog.js)`);
});
