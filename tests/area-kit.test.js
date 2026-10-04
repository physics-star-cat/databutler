// tests/area-kit.test.js — the shared helpers in api/_area_kit.js and the generators in scripts/sync-areas.js
// that the scaffold relies on: diffCategories option semantics, the house categories lookup, note templates,
// registry manifests, roadmap numbering and retiring a planned row.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../api/_area_kit');
const { retirePlanned, manifest, GENERATED, plan } = require('../scripts/sync-areas');
const { expectedDirty, newAreas } = require('../scripts/changelog');

const file = (figures, extra = {}) => ({
  area: 't', verifiedDate: '2026-10-04', nextScheduledRefresh: '2027-01-01',
  categories: { 'income-tax': { title: 'Income tax', source: 'https://example.gov/income-tax', figures } },
  ...extra,
});

/* ---------------- diffCategories ---------------- */

test('diffCategories default: a first commit records null → value for every figure; later diffs record moves, adds and removals', () => {
  const next = file([{ label: 'Personal allowance', value: 12570, unit: 'GBP' }, { label: 'Basic rate', value: 20, unit: '%' }]);
  const first = K.diffCategories('t', null, next);
  assert.deepEqual(first.map((e) => [e.key, e.from, e.to, e.unit, e.effectiveFrom, e.source, e.note]), [
    ['income-tax/personal-allowance', null, 12570, 'GBP', '2026-10-04', 'https://example.gov/income-tax', ''],
    ['income-tax/basic-rate', null, 20, '%', '2026-10-04', 'https://example.gov/income-tax', ''],
  ]);
  assert.deepEqual(K.diffCategories('t', next, next), []);
  const later = file([{ label: 'Personal allowance', value: 13070, unit: 'GBP' }], { verifiedDate: '2027-04-06' });
  assert.deepEqual(K.diffCategories('t', next, later).map((e) => [e.key, e.from, e.to]), [
    ['income-tax/personal-allowance', 12570, 13070], ['income-tax/basic-rate', 20, null],
  ]);
});

test('diffCategories previous: true — arrival records previous.value → value; a previous without .value, or equal to value, records nothing', () => {
  const next = file([
    { key: 'pa', label: 'Personal allowance', value: 12570, previous: { value: 12500, taxYear: '2025-26' } },
    { key: 'br', label: 'Basic rate', value: 20, previous: { value: 20 } },
    { key: 'hr', label: 'Higher rate', value: 40 },
    { key: 'sched', label: 'Schedule', value: [1, 2], previous: { bracketUpperBounds: [1] } }, // a previous with no .value is not comparable
  ]);
  const first = K.diffCategories('t', null, next, { previous: true, key: (f) => f.key });
  assert.deepEqual(first.map((e) => [e.key, e.from, e.to]), [['income-tax/pa', 12500, 12570]]);
  // once in the file, previous is ignored and values are compared
  const later = file([{ key: 'pa', label: 'Personal allowance', value: 13070, previous: { value: 12570 } }, { key: 'hr', label: 'Higher rate', value: 45 }]);
  assert.deepEqual(K.diffCategories('t', next, later, { previous: true, key: (f) => f.key }).map((e) => [e.key, e.from, e.to]).sort(), [
    ['income-tax/br', 20, null], ['income-tax/hr', 40, 45], ['income-tax/pa', 12570, 13070], ['income-tax/sched', [1, 2], null],
  ]);
});

test('diffCategories options: key, effectiveFrom, per-figure source, extra', () => {
  const next = file([{ key: 'k1', label: 'Figure one', value: 1, effectiveFrom: '2027-01-01', source: 'https://example.gov/figure-one' }], { taxYear: '2026' });
  const [e] = K.diffCategories('t', null, next, { key: (f) => f.key, effectiveFrom: (n, f) => f.effectiveFrom || `${n.taxYear}-01-01`, extra: (n) => ({ taxYear: n.taxYear }) });
  assert.equal(e.key, 'income-tax/k1');
  assert.equal(e.effectiveFrom, '2027-01-01');
  assert.equal(e.source, 'https://example.gov/figure-one', 'the figure\'s own source wins over the category\'s');
  assert.equal(e.taxYear, '2026');
});

/* ---------------- categoriesLookup / areaHeader ---------------- */

const DATA = file([{ label: 'Personal allowance', value: 12570, quote: 'The standard Personal Allowance is £12,570.' }], { taxYear: '2026-27', jurisdiction: 'UK', currency: 'GBP' });
DATA.categories['national-insurance'] = { title: 'National Insurance', source: 'https://example.gov/ni', figures: [{ label: 'Class 1', value: 8 }] };

test('areaHeader: area, then taxYear/taxYearRuns/jurisdiction/currency when present, then verifiedDate', () => {
  assert.deepEqual(Object.keys(K.areaHeader(DATA, 't')), ['area', 'taxYear', 'jurisdiction', 'currency', 'verifiedDate']);
  assert.deepEqual(K.areaHeader({ verifiedDate: 'd' }, 'x'), { area: 'x', verifiedDate: 'd' });
});

test('categoriesLookup: listing, exact key, substring of key or title, near-miss with nearest + coverage', () => {
  const lookup = K.categoriesLookup(DATA, 't');
  const listing = lookup({});
  assert.deepEqual(listing, { ...K.areaHeader(DATA, 't'), categories: { 'income-tax': 'Income tax', 'national-insurance': 'National Insurance' }, usage: 'pass category=<key> for figures' });
  assert.deepEqual(lookup({ category: '' }), listing);
  assert.equal(lookup({ category: 'income-tax' }).category, 'income-tax');
  assert.equal(lookup({ category: ' INCOME ' }).category, 'income-tax', 'substring of the key, case/space-insensitive');
  assert.equal(lookup({ category: 'insurance' }).category, 'national-insurance', 'substring of the title');
  assert.deepEqual(lookup({ category: 'income-tax' }).figures, DATA.categories['income-tax'].figures);
  const miss = lookup({ category: 'zzz' });
  assert.deepEqual(miss, { covered: false, requested: 'zzz', message: 'unknown category "zzz"', nearest: ['income-tax', 'national-insurance'], coverage: ['income-tax', 'national-insurance'] });
});

test('categoriesLookup options: substring off → exact only; nearest off → no nearest list; custom header', () => {
  const strict = K.categoriesLookup(DATA, 't', { substring: false, nearest: false, header: (d, a) => ({ area: a, v: d.verifiedDate }) });
  assert.equal(strict({ category: 'income' }).covered, false);
  assert.equal(strict({ category: 'income' }).nearest, undefined);
  assert.deepEqual(Object.keys(strict({})), ['area', 'v', 'categories', 'usage']);
  assert.equal(K.categoriesLookup(DATA, 't', { exact: false })({ category: 'income-tax' }).category, 'income-tax', 'substring still finds an exact key');
});

/* ---------------- findFigure / noteTemplate ---------------- */

test('findFigure resolves <cat>/<key> (key or slug(label)) to the figure and its category', () => {
  assert.equal(K.findFigure(DATA, 'income-tax/personal-allowance').figure.value, 12570);
  assert.equal(K.findFigure(DATA, 'income-tax/nope'), null);
  assert.equal(K.findFigure(DATA, 'no-slash'), null);
  assert.equal(K.findFigure(null, 'a/b'), null);
});

test('noteTemplate: default "{label}: {from} → {to} ({document})" uses the figure\'s quote, else the source; custom placeholders', () => {
  const note = K.noteTemplate();
  const entry = { key: 'income-tax/personal-allowance', label: 'Personal allowance', from: 12500, to: 12570, unit: 'GBP', source: 'https://example.gov/income-tax' };
  assert.equal(note(entry, null, DATA), 'Personal allowance: 12500 → 12570 (The standard Personal Allowance is £12,570.)');
  const unquoted = { key: 'national-insurance/class-1', label: 'Class 1', from: null, to: 8, source: 'https://example.gov/ni' };
  assert.equal(note(unquoted, null, DATA), 'Class 1: none → 8 (https://example.gov/ni)');
  assert.equal(K.noteTemplate('{key} {from}→{to} {unit} {missing}')(entry, null, DATA), 'income-tax/personal-allowance 12500→12570 GBP {missing}');
  assert.equal(K.noteTemplate('{label} ({document})')({ key: 'x/y', label: 'Gone', from: 1, to: null }, null, { categories: {} }), 'Gone', 'an empty document drops its parentheses');
  assert.equal(note({ key: 'income-tax/personal-allowance', label: 'PA', from: [1, 2], to: [1, 3], source: 's' }, null, DATA), 'PA: [1,2] → [1,3] (The standard Personal Allowance is £12,570.)');
});

/* ---------------- sync-areas generators ---------------- */

test('manifest(): the server-<key>.json shape, from server.description', () => {
  const text = manifest('x', { serverName: 'databutler-x', url: 'https://databutler.dev/api/mcp/x', description: 'Desc — with “quotes” & ü.' });
  const m = JSON.parse(text);
  assert.deepEqual(m, {
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    name: 'io.github.physics-star-cat/databutler-x', description: 'Desc — with “quotes” & ü.',
    repository: { url: 'https://github.com/physics-star-cat/databutler', source: 'github' }, version: '1.0.0',
    websiteUrl: 'https://databutler.dev/api', remotes: [{ type: 'streamable-http', url: 'https://databutler.dev/api/mcp/x' }],
  });
  assert.ok(text.endsWith('}\n'));
  assert.ok(GENERATED().includes('server-uk-rates.json') && GENERATED().includes('README.md'));
});

test('retirePlanned removes only the named rows, only between the roadmap and catalogue blocks', () => {
  const text = [
    '<!-- sync-areas:roadmap start -->', '| 1 | **Area** | x | y |', '| 7 | **Gen** | x | y |', '<!-- sync-areas:roadmap end -->',
    'Planned:', '| # | V | E | S |', '|---|---|---|---|', '| 7 | **Current-docs** | — | parked |', '| 12c | **Rates, further** | x | y |', '| 12 | **Twelve** | x | y |',
    '<!-- sync-areas:catalogue start -->', '| 7 | keep | me | too |', '<!-- sync-areas:catalogue end -->',
  ].join('\n');
  const out = retirePlanned(text, ['7', '12c']);
  assert.ok(out.includes('| 7 | **Gen** |'), 'roadmap block untouched');
  assert.ok(out.includes('| 7 | keep | me | too |'), 'catalogue block untouched');
  assert.ok(!out.includes('**Current-docs**') && !out.includes('**Rates, further**'));
  assert.ok(out.includes('| 12 | **Twelve** |'), '12 is not 12c');
  assert.equal(retirePlanned(text, []), text);
});

test('the README roadmap is numbered 1..N in area order and every live area has a manifest in the plan', () => {
  const { AREAS } = require('../api/_areas');
  const readme = plan().find(([rel]) => rel === 'README.md')[1];
  const rows = readme.split('\n').filter((l) => /^\| \d+ \| \*\*/.test(l) && readme.indexOf(l) < readme.indexOf('<!-- sync-areas:roadmap end -->'));
  assert.deepEqual(rows.map((l) => Number(l.split('|')[1].trim())), AREAS.map((_, i) => i + 1));
  const manifests = plan().map(([rel]) => rel).filter((r) => r.startsWith('server-'));
  assert.deepEqual(manifests.sort(), AREAS.filter((a) => a.server).map((a) => `server-${a.server.key || a.area}.json`).sort());
});

/* ---------------- changelog script helpers ---------------- */

test('changelog.js: a new area (data not in git) may leave its module, test, manifest, CURATION, snapshots and generated files dirty; otherwise nothing', () => {
  const fresh = newAreas();
  const dirty = [...expectedDirty()];
  if (!fresh.length) { assert.deepEqual(dirty, []); return; }
  for (const a of fresh) {
    assert.ok(dirty.includes(`api/_areas/${a.area}.js`) && dirty.includes(`tests/${a.area}.test.js`), a.area);
    if (a.server) assert.ok(dirty.includes(`server-${a.server.key || a.area}.json`));
  }
  for (const rel of ['README.md', 'docs/CURATION.md', 'public/llms.txt', 'tests/snapshots/rest.json']) assert.ok(dirty.includes(rel), rel);
  assert.ok(!dirty.includes('api/_area_kit.js') && !dirty.includes('scripts/changelog.js'), 'kit files are never expected dirty');
});

/* ---------------- kit v3: params/filters, sources, note placeholders, loader, changelog script ---------------- */

test('categoriesLookup param + filters: the named argument picks the category, further ones narrow its figures', () => {
  const D = file([{ label: 'A', value: 1, board: 'AQA' }, { label: 'B', value: 2, board: 'ocr' }, { label: 'C', value: 3 }]);
  const run = K.categoriesLookup(D, 't', { param: 'kind', filters: ['board'] });
  assert.match(run({}).usage, /^pass kind=<key> for figures; board=<value> to narrow them$/);
  assert.equal(run({ kind: 'income-tax' }).figures.length, 3);
  const aqa = run({ kind: 'income', board: 'aqa' });
  assert.deepEqual(aqa.figures.map((f) => f.label), ['A']); assert.deepEqual(aqa.filters, { board: 'aqa' });
  const miss = run({ kind: 'income-tax', board: 'wjec' });
  assert.equal(miss.covered, false); assert.equal(miss.field, 'board'); assert.deepEqual(miss.coverage, ['aqa', 'ocr']);
  assert.equal(run({ kind: 'zzz' }).message, 'unknown kind "zzz"');
  // the default stays uk_rates_lookup's: { category }
  assert.equal(K.categoriesLookup(D, 't')({ category: 'income-tax' }).category, 'income-tax');
});

test('categorySources: category then figure sources, each URL once, unreachable by URL or hostname', () => {
  const D = file([{ label: 'A', value: 1, source: 'https://blocked.example/a.pdf' }, { label: 'B', value: 2, source: 'https://example.gov/income-tax' }]);
  D.categories.other = { title: 'Other', source: 'https://example.gov/income-tax', figures: [] };
  const s = K.categorySources(D, { extra: [{ url: 'https://example.gov/extra', label: 'Extra' }], unreachable: { 'blocked.example': 'HTTP 403' } });
  assert.deepEqual(s.map((x) => x.url), ['https://example.gov/income-tax', 'https://blocked.example/a.pdf', 'https://example.gov/extra']);
  assert.equal(s[1].unreachable, 'HTTP 403'); assert.equal(s[0].unreachable, undefined);
  assert.deepEqual(K.categorySources(D, { figures: false }).map((x) => x.url), ['https://example.gov/income-tax']);
});

test('noteTemplate: {title} and {previousDocument}; figureKey is the default key on both sides', () => {
  const D = file([{ key: 'pa', label: 'Personal allowance', value: 12570, previous: { value: 12500, title: 'Rates 2025-26', source: 'https://example.gov/2025' } },
    { key: 'br', label: 'Basic rate', value: 21, previous: { value: 20, source: 'https://example.gov/2025-br' } }]);
  const entries = K.diffCategories('t', null, D, { previous: true });
  assert.deepEqual(entries.map((e) => e.key), ['income-tax/pa', 'income-tax/br'], 'figure.key used without passing key');
  const note = K.noteTemplate('{title} — {label}: {from} → {to} (previously {previousDocument})');
  assert.equal(note(entries[0], null, D), 'Income tax — Personal allowance: 12500 → 12570 (previously Rates 2025-26)');
  assert.equal(note(entries[1], null, D), 'Income tax — Basic rate: 20 → 21 (previously https://example.gov/2025-br)');
  assert.equal(K.noteTemplate('{label} ({previousDocument})')({ ...entries[0], key: 'income-tax/none' }, null, D), 'Personal allowance', 'an empty () is dropped');
});

test('mergeEntries/entryId live in the kit (pure) and api/_changelog re-exports them', () => {
  const C = require('../api/_changelog');
  assert.equal(C.mergeEntries, K.mergeEntries); assert.equal(C.entryId, K.entryId);
  const e = { area: 'a', key: 'k', verifiedDate: '2026-10-04' };
  assert.deepEqual(K.mergeEntries([e], [e, { ...e, key: 'j' }]).added.map((x) => x.key), ['j']);
});

test('area loader: a script area whose data file is not written yet is unavailable (clear error); a hand-curated one still throws', () => {
  const { loadAreas, UNAVAILABLE } = require('../api/_areas');
  assert.deepEqual(UNAVAILABLE, [], 'the committed repo has every data file');
  const warn = console.warn; console.warn = () => {};
  try {
    const { areas, unavailable } = loadAreas(require('node:path').join(__dirname, 'fixtures/areas-missing-data'));
    assert.deepEqual(areas, []);
    assert.equal(unavailable.length, 1);
    assert.equal(unavailable[0].area, 'script-area'); assert.equal(unavailable[0].script, 'scripts/script-area.js');
    assert.match(unavailable[0].error, /data\/does-not-exist-yet\.json does not exist yet — run `node scripts\/script-area\.js`/);
    assert.throws(() => loadAreas(require('node:path').join(__dirname, 'fixtures/areas-missing-curated')), /Cannot find module/);
  } finally { console.warn = warn; }
});

test('sources: unreachable pages (recorded or declared) are skipped by the watcher and listed; a later good fetch wins', () => {
  const { unreachableSources, watchPlan } = require('../api/_sources');
  const sources = [
    { url: 'https://a/1', label: 'one', area: 'x' },
    { url: 'https://b/2', label: 'two', area: 'x', unreachable: 'CAPTCHA' },
    { url: 'https://c/3', label: 'three', area: 'y' },
    { url: 'https://d/4', label: 'four', area: 'y', unreachable: 'HTTP 403' },
  ];
  const seen = [{ url: 'https://a/1', bodyHash: 'h' }, { url: 'https://c/3', unreachable: 'HTTP 403', checkedAt: '2026-10-04' }, { url: 'https://d/4', bodyHash: 'ok' }];
  assert.deepEqual(unreachableSources(sources, seen).map((u) => [u.url, u.area, u.reason]), [['https://b/2', 'x', 'CAPTCHA'], ['https://c/3', 'y', 'HTTP 403']]);
  assert.deepEqual(watchPlan(sources, seen).check, ['https://a/1', 'https://d/4']);
  // live: jcq.org.uk is recorded, skipped, and named in coverage and CURATION
  const { sourceList } = require('../api/_areas');
  const live = unreachableSources(sourceList(), require('../data/sources.json'));
  assert.ok(live.some((u) => u.area === 'uk-exam-dates' && /jcq\.org\.uk/.test(u.url)));
  for (const u of live) assert.ok(require('../data/sources.json').some((s) => s.url === u.url && s.unreachable), `${u.url} recorded in data/sources.json`);
  const { coverageFor } = require('../api/_coverage');
  assert.ok(coverageFor('uk-exam-dates').unreachableSources.some((u) => /jcq/.test(u.url)));
  assert.equal(coverageFor('us-rates').unreachableSources, undefined);
  const curation = require('node:fs').readFileSync(require('node:path').join(__dirname, '../docs/CURATION.md'), 'utf8');
  for (const u of live) assert.ok(curation.includes(`| ${u.area} | ${u.url} |`), `CURATION lists ${u.url}`);
});

test('scripts/changelog.js: a new area\'s fetch script, logic module and fixtures need no --allow-dirty; plain script-area message', () => {
  const { newAreaFiles, allowedPath, scriptAreaMessage } = require('../scripts/changelog');
  const allowed = new Set(newAreaFiles({ area: 'uk-thing', server: {} }));
  for (const p of ['scripts/uk-thing.js', 'scripts/uk_thing.js', 'api/_uk_thing.js', 'api/_uk-thing.js', 'tests/fixtures/uk-thing/a.json', 'tests/fixtures/uk_thing.csv', 'server-uk-thing.json']) {
    assert.ok(allowedPath(allowed, p), p);
  }
  assert.ok(!allowedPath(allowed, 'scripts/other.js'));
  assert.equal(scriptAreaMessage({ area: 'calendar', changelog: { script: 'scripts/calendar.js' } }, true),
    "calendar: this area's entries come from scripts/calendar.js; changelog.js only re-hashed its sources.");
});

test('scripts/_git.js: --redo drops only the area\'s entries that HEAD does not have', () => {
  const { splitUncommitted } = require('../scripts/_git');
  const committed = require('../data/changelog.json');
  const extra = [{ area: 'uk-rates', key: 'zzz/new', verifiedDate: '2099-01-01' }, { area: 'us-rates', key: 'zzz/new', verifiedDate: '2099-01-01' }];
  const { kept, dropped } = splitUncommitted([...committed, ...extra], 'uk-rates');
  assert.deepEqual(dropped, [extra[0]]);
  assert.equal(kept.length, committed.length + 1);
});
