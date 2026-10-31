// tests/us-rates.test.js — US federal rates & thresholds (tax year 2026): data, tool, server, hub phrases,
// REST mirror, citation page, changelog entries (prior year → current), calendar-driven freshness, watcher sources.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const router = require('../api/router');
const AREA_MODULE = require('../api/_areas/us-rates');
const DATA = require('../data/us-rates.json');
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

const AREA = 'us-rates';
const TOOL = 'us_rates_lookup';
const server = router.ROUTES[`mcp/${AREA}`];
const rest = router.ROUTES['us/rates'];
const get = (h, url) => invoke(h, undefined, { method: 'GET', url });
const day = (iso) => new Date(`${iso}T12:00:00Z`);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = ['income-tax', 'social-security', 'medicare', 'retirement', 'hsa', 'estate-gift', 'social-security-benefits', 'medicare-costs', 'capital-gains'];
const OFFICIAL = /^https:\/\/www\.(irs\.gov|federalregister\.gov|ssa\.gov|cms\.gov|medicare\.gov|ecfr\.gov)\//;
const ENTRY_FIELDS = ['area', 'key', 'label', 'from', 'to', 'effectiveFrom', 'source', 'verifiedDate', 'note'];
const figure = (cat, key) => DATA.categories[cat].figures.find((f) => f.key === key);
const value = (cat, key) => figure(cat, key).value;
const SCHEDULES = ['brackets-single', 'brackets-married-joint', 'brackets-head-of-household', 'brackets-married-separate'];
/** Figures whose arrival the changelog records: those with a prior-year value that differs (schedules: prior-year bracket bounds). */
const changed = () => Object.entries(DATA.categories).flatMap(([cat, c]) => c.figures.filter((f) => f.previous && f.previous.value !== undefined && !same(f.previous.value, f.value)).map((f) => ({ cat, f })));

/* ---------------- data ---------------- */

test('data: tax year 2026, calendar-driven refresh, every figure keyed, sourced, quoted and dated', () => {
  assert.equal(DATA.area, AREA);
  assert.equal(DATA.taxYear, '2026');
  assert.match(DATA.verifiedDate, ISO);
  assert.equal(AREA_MODULE.freshness.cadenceDays, null, 'calendar-driven: nextScheduledRefresh is set by hand');
  assert.equal(DATA.nextScheduledRefresh, '2026-11-01', 'the IRS inflation-adjustment release window');
  assert.match(DATA.licence, /public domain/);
  assert.match(DATA.verificationMethod, /never written from memory/);
  assert.deepEqual(Object.keys(DATA.categories), CATEGORIES);
  for (const [k, c] of Object.entries(DATA.categories)) {
    assert.ok(c.title && c.scope, `${k} title + scope`);
    assert.match(c.source, OFFICIAL, `${k} source is an official page`);
    assert.ok(Array.isArray(c.figures) && c.figures.length, `${k} figures`);
    assert.equal(new Set(c.figures.map((f) => f.key)).size, c.figures.length, `${k} figure keys unique`);
    for (const f of c.figures) {
      assert.match(f.key, /^[a-z0-9-]+$/, `${k} key`);
      assert.ok(f.label && f.value !== undefined && f.unit, `${k}/${f.key} label, value, unit`);
      assert.match(f.effectiveFrom, ISO, `${k}/${f.key} effectiveFrom`);
      assert.match(f.source, OFFICIAL, `${k}/${f.key} source`);
      assert.ok(typeof f.quote === 'string' && f.quote.length > 20, `${k}/${f.key} quote (the verification evidence)`);
      assert.ok(f.verifiedDate >= DATA.verifiedDate, `${k}/${f.key} verifiedDate: the file date is the oldest figure's`);
      if (f.previous) assert.ok(['2025', '2026'].includes(f.previous.taxYear) && (f.previous.value !== undefined || Array.isArray(f.previous.bracketUpperBounds)) && f.previous.source, `${k}/${f.key} previous`);
    }
  }
  // Rate schedules: one figure per filing status, seven bracket rows each, 10 % → 37 %, with the 2025 upper bounds as previous.
  for (const key of SCHEDULES) {
    const f = figure('income-tax', key);
    assert.ok(Array.isArray(f.value) && f.value.length === 7, `${key}: 7 rows`);
    assert.deepEqual(f.value.map((row) => row.rate), [10, 12, 22, 24, 32, 35, 37], `${key}: marginal rates`);
    assert.equal(f.previous.bracketUpperBounds.length, 6, `${key}: six 2025 bounds`);
  }
  assert.deepEqual(value('income-tax', 'brackets-married-joint').map((row) => row.notOver).slice(0, 6), [24800, 100800, 211400, 403550, 512450, 768700], 'MFJ bounds as in Rev. Proc. 2025-32 (app.py had 512,400 / 768,400)');
  assert.deepEqual(value('income-tax', 'brackets-head-of-household').map((row) => row.notOver).slice(0, 6), [17700, 67450, 105700, 201750, 256200, 640600], 'HoH bounds (app.py had 67,400 / 201,775 / 256,225)');
  // Figures as read from the documents on 2026-10-03 (docs/CURATION.md verification log).
  assert.equal(value('income-tax', 'standard-deduction-single'), 16100);
  assert.equal(value('income-tax', 'standard-deduction-married-joint'), 32200);
  assert.equal(value('income-tax', 'standard-deduction-head-of-household'), 24150);
  assert.equal(value('social-security', 'wage-base'), 184500);
  assert.equal(value('social-security', 'employee-rate'), 6.2);
  assert.equal(value('medicare', 'rate'), 1.45);
  assert.equal(value('medicare', 'additional-rate'), 0.9);
  assert.equal(value('medicare', 'additional-threshold-single'), 200000);
  assert.equal(value('retirement', '401k-elective-deferral'), 24500);
  assert.equal(value('retirement', 'ira-limit'), 7500);
  assert.equal(value('hsa', 'contribution-self-only'), 4400);
  assert.equal(value('hsa', 'contribution-family'), 8750);
  assert.equal(value('estate-gift', 'basic-exclusion'), 15000000);
  assert.equal(value('estate-gift', 'annual-gift-exclusion'), 19000);
  assert.equal(figure('social-security', 'wage-base').previous.value, 176100);
  // Added 2026-10-31, each read that day from the page named in its source.
  const ssb = 'social-security-benefits';
  assert.deepEqual(['bend-point-first', 'bend-point-second', 'bend-point-first-2027', 'bend-point-second-2027'].map((k) => value(ssb, k)), [1286, 7749, 1340, 8077]);
  assert.deepEqual(['earnings-test-lower', 'earnings-test-higher', 'earnings-test-lower-2027', 'earnings-test-higher-2027'].map((k) => value(ssb, k)), [24480, 65160, 25560, 67920]);
  assert.equal(value(ssb, 'max-benefit-at-fra-2027'), 4188);
  assert.equal(value(ssb, 'cola-2027'), 3.6);
  assert.equal(figure(ssb, 'cola-2027').effectiveFrom, '2026-12-01');
  assert.equal(value('social-security', 'cola'), 2.8, 'the served key keeps meaning the December 2025 COLA');
  assert.deepEqual(value(ssb, 'full-retirement-age-by-birth-year').at(-1), { born: '1960 and later', years: 67, months: 0 });
  assert.equal(value(ssb, 'delayed-credit-annual'), 8);
  assert.equal(value('medicare-costs', 'part-b-standard-premium'), 202.9);
  assert.equal(value('medicare-costs', 'part-b-deductible'), 283);
  assert.equal(value('medicare-costs', 'part-a-deductible'), 1736);
  assert.equal(value('medicare-costs', 'part-d-out-of-pocket-limit'), 2100);
  assert.equal(value('medicare-costs', 'irmaa-individual-return').length, 6);
  assert.equal(value('medicare-costs', 'irmaa-joint-return').length, 6);
  assert.deepEqual(value('medicare-costs', 'irmaa-joint-return').at(-1), { magiAtLeast: 750000, partBAdjustment: 487, partBTotalPremium: 689.9, partDAdjustment: 91 });
  assert.deepEqual(value('medicare-costs', 'irmaa-married-separate').at(-1), { magiAtLeast: 391000, partBAdjustment: 487, partBTotalPremium: 689.9, partDAdjustment: 91 }, 'CMS $487.00; the SSA page prints $487.90 for this row');
  assert.equal(value('capital-gains', 'zero-rate-max-married-joint'), 98900);
  assert.equal(value('capital-gains', 'fifteen-rate-max-married-joint'), 613700);
  assert.equal(value('capital-gains', 'niit-threshold-married-joint'), 250000);
  assert.equal(value('retirement', 'qcd-limit'), 111000);
  assert.equal(value('income-tax', 'senior-deduction'), 6000);
  assert.equal(value('income-tax', 'senior-deduction-phase-out-rate'), 6);
  const table = value('retirement', 'uniform-lifetime-table');
  assert.equal(table.length, 49);
  assert.deepEqual([72, 73, 75, 100].map((age) => table.find((r) => r.age === age).applicableDenominator), [27.4, 26.5, 24.6, 6.4]);
  const y1959 = value('retirement', 'rmd-applicable-age-by-birth-year').find((r) => r.bornFrom === '1959-01-01');
  assert.equal(y1959.applicableAge, null, 'reserved in the final regulations');
  assert.equal(y1959.proposedApplicableAge, 73);
});

/* ---------------- registry, server, hub ---------------- */

test('server: lists the tool with clean MCP keys; registered on its own server, not at the front door; plain-statement description', async () => {
  const list = await rpc(server, 'tools/list');
  assert.deepEqual(list.body.result.tools.map((t) => t.name), [TOOL]);
  assert.deepEqual(Object.keys(list.body.result.tools[0]).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title']);
  const t = ALL_TOOLS[TOOL];
  assert.equal(t.server, AREA);
  assert.equal(t.serverUrl, 'https://databutler.dev/api/mcp/us-rates');
  assert.equal(t.freshness, AREA);
  assert.equal(t.annotations.readOnlyHint, true);
  assert.equal(t.annotations.openWorldHint, false);
  assert.ok(!DIRECT.includes(TOOL), 'not on the front door — reachable through call');
  assert.doesNotMatch(t.description, /\b(use this|you should|always|never|call this|do not|use when|use whenever|use to)\b/i);
  for (const c of CATEGORIES) assert.ok(t.description.includes(c), `description names ${c}`);
  assert.match(t.inputSchema.properties.category.description, /income-tax, social-security, medicare, retirement, hsa, estate-gift, social-security-benefits, medicare-costs, capital-gains/);
  assert.match(SERVERS[AREA].instructions, /us_rates_lookup/);
  const init = await rpc(server, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.body.result.serverInfo.name, 'databutler-us-rates');
});

test('hub: what_changed_since, coverage, catalogue and call mention the area; coverage lists what is not covered', () => {
  assert.match(whatChangedSince.description, /US federal tax thresholds/);
  assert.ok(whatChangedSince.inputSchema.properties.area.enum.includes(AREA));
  assert.match(coverage.description, /US federal rate categories/);
  assert.match(catalogue.description, /us_rates_lookup/);
  assert.match(HUB_TOOLS.find((t) => t.name === 'call').description, /us_rates_lookup/);
  const cov = coverageFor(AREA);
  assert.deepEqual(cov.categories, CATEGORIES);
  assert.deepEqual(cov.taxYears, ['2026']);
  assert.ok(cov.notCovered.some((s) => /state income tax/.test(s)) && cov.notCovered.some((s) => /AMT/.test(s)) && cov.notCovered.some((s) => /EITC/.test(s)) && cov.notCovered.some((s) => /collectibles/.test(s)));
});

/* ---------------- tool ---------------- */

test('listing: no category → taxYear, categories with titles and usage, with envelope + cite', async () => {
  const { isError, data } = await callTool(server, TOOL, {});
  assert.equal(isError, false);
  assert.equal(data.taxYear, '2026');
  assert.deepEqual(Object.keys(data.categories), CATEGORIES);
  assert.equal(data.categories['income-tax'], DATA.categories['income-tax'].title);
  assert.equal(data.cite.url, 'https://databutler.dev/r/us/rates');
  assert.ok(data.freshness.verifiedDate === DATA.verifiedDate && data.freshness.nextScheduledRefresh === '2026-11-01');
});

test('happy path: a category answers with figures (source, quote, verifiedDate, previous), taxYear, freshness and a cite permalink', async () => {
  for (const key of CATEGORIES) {
    const { isError, data } = await callTool(server, TOOL, { category: key });
    assert.equal(isError, false, key);
    assert.equal(data.covered, undefined, key);
    assert.equal(data.category, key);
    assert.equal(data.taxYear, '2026');
    assert.equal(data.currency, 'USD');
    assert.deepEqual(data.figures, DATA.categories[key].figures);
    assert.equal(data.source, DATA.categories[key].source);
    assert.equal(data.title, DATA.categories[key].title);
    assert.equal(data.freshness.verifiedDate, DATA.verifiedDate);
    assert.equal(data.cite.url, `https://databutler.dev/r/us/rates?category=${key}`);
    assert.equal(data.cite.text, `databutler.dev, verified ${DATA.verifiedDate} against ${DATA.categories[key].source}`);
  }
  // Like uk_rates_lookup, a key or title containing the input resolves (case-insensitive).
  assert.equal((await callTool(server, TOOL, { category: 'Social' })).data.category, 'social-security');
  assert.equal((await callTool(server, TOOL, { category: 'estate' })).data.category, 'estate-gift');
});

test('near-miss: an unknown category is covered:false with nearest keys and coverage, never an error', async () => {
  const { isError, data } = await callTool(server, TOOL, { category: 'incme' });
  assert.equal(isError, false);
  assert.equal(data.covered, false);
  assert.equal(data.requested, 'incme');
  assert.ok(data.nearest.includes('income-tax'));
  assert.deepEqual(data.coverage, CATEGORIES);
  assert.equal(data.error, undefined);
  assert.ok(data.freshness && data.cite);
});

/* ---------------- REST + /r ---------------- */

test('REST mirror /api/us/rates: listing without ?category=, figures with it, covered:false on a miss; envelope on each', async () => {
  const listing = await get(rest, '/api/us/rates');
  assert.equal(listing.status, 200);
  assert.deepEqual(Object.keys(listing.body.categories), CATEGORIES);
  const hit = await get(rest, '/api/us/rates?category=retirement');
  assert.equal(hit.status, 200);
  assert.equal(hit.body.category, 'retirement');
  assert.equal(hit.body.figures.find((f) => f.key === '401k-elective-deferral').value, 24500);
  assert.equal(hit.body.cite.url, 'https://databutler.dev/r/us/rates?category=retirement');
  const miss = await get(rest, '/api/us/rates?category=zzz');
  assert.equal(miss.status, 200);
  assert.equal(miss.body.covered, false);
  assert.ok(miss.body.freshness && miss.body.cite);
  const viaRouter = await get(router, '/api/router?route=us/rates&category=hsa');
  assert.equal(viaRouter.status, 200);
  assert.equal(viaRouter.body.category, 'hsa');
});

test('/r/us/rates renders a citation page with the official source', async () => {
  const res = await get(r, '/api/r?path=us/rates&category=social-security');
  assert.equal(res.status, 200);
  assert.match(String(res.raw), /federalregister\.gov/);
  assert.match(String(res.raw), /184500/);
});

/* ---------------- changelog ---------------- */

test('changelog diff: a figure\'s arrival records prior year → current (from its previous block), per-figure effectiveFrom and source', () => {
  assert.ok(CHANGELOG_AREAS.includes(AREA));
  const expected = changed();
  assert.ok(expected.length >= 20, 'most figures moved for 2026');
  const first = AREA_MODULE.changelog.diff(null, DATA);
  assert.equal(first.length, expected.length + SCHEDULES.length, 'one entry per figure with a differing prior-year value plus one per schedule; unchanged or un-previoused figures record nothing');
  for (const { cat, f } of expected) {
    const e = first.find((x) => x.key === `${cat}/${f.key}`);
    assert.ok(e, `${cat}/${f.key}`);
    for (const k of ENTRY_FIELDS) assert.ok(k in e, `${e.key} has ${k}`);
    assert.equal(e.area, AREA);
    assert.deepEqual(e.from, f.previous.value);
    assert.deepEqual(e.to, f.value);
    assert.equal(e.effectiveFrom, f.effectiveFrom);
    assert.equal(e.source, f.source);
    assert.equal(e.unit, f.unit);
    assert.equal(e.taxYear, AREA_MODULE.facts.period(DATA, f));
    assert.equal(e.verifiedDate, f.verifiedDate);
    assert.equal(e.note, '');
  }
  assert.ok(first.some((e) => e.key === 'social-security/wage-base' && e.from === 176100 && e.to === 184500 && e.effectiveFrom === '2026-01-01'));
  assert.ok(!first.some((e) => e.key === 'retirement/401k-catch-up-60-63'), 'remains $11,250 — no entry');
  assert.ok(!first.some((e) => e.key === 'estate-gift/annual-gift-exclusion'), 'remains $19,000 — no entry');
  assert.ok(!first.some((e) => e.key === 'medicare/rate'), 'no prior-year block — no entry');
  // Schedules arrive as 2025 bracket upper bounds → 2026 bracket upper bounds.
  for (const key of SCHEDULES) {
    const e = first.find((x) => x.key === `income-tax/${key}`);
    assert.ok(e, key);
    assert.deepEqual(e.from, figure('income-tax', key).previous.bracketUpperBounds);
    assert.deepEqual(e.to, value('income-tax', key).map((row) => row.notOver).slice(0, 6));
    assert.equal(e.effectiveFrom, '2026-01-01'); assert.equal(e.taxYear, '2026'); assert.equal(e.note, '');
  }
  assert.deepEqual(first.find((e) => e.key === 'income-tax/brackets-single').from, [11925, 48475, 103350, 197300, 250525, 626350]);
  assert.deepEqual(AREA_MODULE.changelog.diff(DATA, DATA), [], 'nothing moved');
  // A later refresh: one moved value → one from → to entry keyed by the stable key; a dropped figure → to: null.
  const next = JSON.parse(JSON.stringify(DATA));
  next.verifiedDate = '2026-11-20'; next.taxYear = '2027';
  const arrival = JSON.parse(JSON.stringify(DATA));
  arrival.categories.hsa.figures.push({ key: 'zzz', label: 'New', value: 1, unit: 'USD', effectiveFrom: '2026-01-01', source: 'https://www.irs.gov/', quote: 'q', verifiedDate: '2026-11-01' });
  assert.deepEqual(AREA_MODULE.changelog.diff(DATA, arrival).map((e) => [e.key, e.from, e.to, e.verifiedDate]), [['hsa/zzz', null, 1, '2026-11-01']], 'a figure new to a published file is logged null → value');
  const wb = next.categories['social-security'].figures.find((f) => f.key === 'wage-base');
  wb.value = 190000; wb.effectiveFrom = '2027-01-01';
  next.categories.hsa.figures = next.categories.hsa.figures.filter((f) => f.key !== 'excepted-benefit-hra');
  const diff = AREA_MODULE.changelog.diff(DATA, next);
  assert.deepEqual(diff.map((e) => [e.key, e.from, e.to, e.effectiveFrom, e.taxYear]).sort(), [
    ['hsa/excepted-benefit-hra', 2200, null, '2026-01-01', '2027'],
    ['social-security/wage-base', 184500, 190000, '2027-01-01', '2027'],
  ]);
});

test('changelog.json: the first-commit entries are recorded, each with a maintainer note naming the IRS/SSA document', () => {
  const mine = CHANGELOG.filter((e) => e.area === AREA);
  assert.ok(mine.length >= changed().length + SCHEDULES.length, 'every arrival entry committed');
  for (const e of mine) {
    assert.ok(e.note.length > 20, `${e.key} note`);
    assert.match(e.note, /Rev\. Proc\.|Notice 20|Federal Register|IR-20|SSA|CMS|Medicare\.gov|Publication|FS-2025|Net Investment|CFR/, `${e.key} note names the document`);
    assert.match(e.source, /^https:\/\//);
  }
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
  assert.match(entry.description, /IRS/);
});

test('sources: the watcher gets its pages, ssa.gov and ecfr.gov declared as browser-only, and sources.json knows them', () => {
  const urls = AREA_MODULE.sources().map((s) => s.url);
  assert.equal(urls.length, 12);
  assert.ok(urls.every((u) => OFFICIAL.test(u)));
  for (const s of AREA_MODULE.sources()) if (/ssa\.gov|ecfr\.gov/.test(s.url)) assert.match(s.unreachable, /automated fetches/, 'declared: a browser reads these');
  assert.ok(urls.includes('https://www.irs.gov/newsroom/news-releases-for-current-month'));
  assert.ok(urls.includes('https://www.irs.gov/taxtopics/tc751'));
  for (const s of AREA_MODULE.sources()) assert.ok(s.label.length > 20, s.url);
  const all = sourceUrls();
  for (const u of urls) assert.ok(all.includes(u), `watched: ${u}`);
  const seen = new Set(SEEN.map((s) => s.url));
  for (const u of urls) assert.ok(seen.has(u), `data/sources.json has ${u} (run node scripts/changelog.js)`);
});
