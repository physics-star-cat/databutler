// tests/uk-exam-dates.test.js — UK exam dates and spec changes: data, tool, server, REST mirror, changelog entries, freshness, discovery.
// Scaffolded by scripts/new-area.js; the tool takes {kind, board, qualification} rather than the kit's `category`, so the
// happy-path, near-miss and REST tests name those parameters. Expectations otherwise derive from the module and its data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const router = require('../api/router');
const AREA_MODULE = require('../api/_areas/uk-exam-dates');
const WELL_KNOWN = require('../public/.well-known/changes.json');
const { ALL_TOOLS } = require('../api/_registry');
const { freshnessFor, DUE_WINDOW_DAYS } = require('../api/_freshness');
const { CHANGELOG_AREAS } = require('../api/_changelog');
const { plusDays, same } = require('../api/_area_kit');

const AREA = 'uk-exam-dates';
const TOOL = 'uk_exam_dates';
const REST_PATH = 'uk/exam-dates';
const DATA = AREA_MODULE.freshness.data; // data/uk-exam-dates.json
const CADENCE = AREA_MODULE.freshness.cadenceDays; // null = calendar-driven
const PREVIOUS = AREA_MODULE.changelog.previous === true;
const server = router.ROUTES[`mcp/${AREA}`];
const rest = router.ROUTES[REST_PATH];
const get = (h, url) => invoke(h, undefined, { method: 'GET', url });
const day = (iso) => new Date(`${iso}T12:00:00Z`);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = Object.keys(DATA.categories);
const FIGURES = Object.entries(DATA.categories).flatMap(([cat, c]) => c.figures.map((f) => ({ cat, f })));
const ENTRY_FIELDS = ['area', 'key', 'label', 'from', 'to', 'effectiveFrom', 'source', 'verifiedDate', 'note'];
const hasPrevious = (f) => f.previous && f.previous.value !== undefined && !same(f.previous.value, f.value);
const figure = (cat, key) => DATA.categories[cat].figures.find((f) => f.key === key);

test('data: verifiedDate, nextScheduledRefresh follows the cadence, every category sourced, every figure quoted', () => {
  assert.equal(DATA.area, AREA);
  assert.match(DATA.verifiedDate, ISO);
  if (CADENCE === null) {
    assert.match(DATA.nextScheduledRefresh, ISO, 'calendar-driven: an ISO date set by hand');
    assert.ok(!Number.isNaN(Date.parse(DATA.nextScheduledRefresh)));
  } else {
    assert.equal(DATA.nextScheduledRefresh, plusDays(DATA.verifiedDate, CADENCE));
  }
  assert.deepEqual(KINDS, ['results', 'timetable', 'deadlines', 'spec-changes']);
  for (const [k, c] of Object.entries(DATA.categories)) {
    assert.ok(c.title, `${k} title`);
    assert.match(c.source, /^https?:\/\//, `${k} source is an official URL`);
    assert.ok(Array.isArray(c.figures) && c.figures.length, `${k} figures`);
    const keys = new Set();
    for (const f of c.figures) {
      assert.ok(f.label && f.value !== undefined, `${k} figure`);
      assert.ok(f.key && !keys.has(f.key), `${k}/${f.key} has a unique key`);
      keys.add(f.key);
      assert.match(f.source, /^https?:\/\//, `${k}/${f.key} source`);
      assert.ok(f.quote && f.document, `${k}/${f.key} carries the quoted row and the document it came from`);
      assert.ok(f.board in DATA.boards, `${k}/${f.key} board ${f.board} is described in boards`);
      if (k !== 'spec-changes') assert.match(f.value, ISO, `${k}/${f.key} is an ISO date`);
      if (f.previous && f.previous.value !== null) assert.match(f.previous.value, ISO, `${k}/${f.key} previous is an ISO date`);
    }
  }
  // Pinned from the documents (docs/CURATION.md, "Verification log (uk-exam-dates)").
  assert.equal(figure('results', 'jcq-a-level-results-day').value, '2027-08-12');
  assert.equal(figure('results', 'jcq-a-level-results-day').previous.value, '2026-08-13');
  assert.equal(figure('results', 'jcq-gcse-results-day').value, '2027-08-19');
  assert.equal(figure('results', 'jcq-gcse-results-day').previous.value, '2026-08-20');
  assert.equal(figure('results', 'jcq-gcse-november-2026-results-day').value, '2027-01-13');
  assert.equal(figure('results', 'sqa-results-day').value, '2027-08-10');
  assert.equal(figure('results', 'sqa-results-day').previous.value, '2026-08-04');
  assert.equal(figure('timetable', 'jcq-first-exam').value, '2027-05-10');
  assert.equal(figure('timetable', 'jcq-last-gcse-exam').value, '2027-06-18');
  assert.equal(figure('timetable', 'jcq-last-a-level-exam').value, '2027-06-22');
  assert.equal(figure('timetable', 'jcq-contingency-day').value, '2027-06-23');
  assert.equal(figure('timetable', 'jcq-contingency-day').previous.value, '2026-06-24');
  assert.equal(figure('timetable', 'aqa-gcse-maths-paper-2').value, '2027-05-27');
  assert.equal(figure('timetable', 'aqa-gcse-maths-paper-2').previous.value, '2026-06-03');
  assert.equal(figure('timetable', 'pearson-gcse-maths-paper-1').value, '2027-05-14');
  assert.equal(figure('timetable', 'pearson-gcse-maths-paper-1').previous, undefined, 'Pearson no longer serves its 2026 PDFs — no previous claimed');
  assert.equal(figure('timetable', 'ocr-a-level-maths-paper-1').value, '2027-05-26');
  assert.equal(figure('timetable', 'wjec-eduqas-gcse-maths-component-2').value, '2027-05-27');
  // The same paper falls on the same day at every board (JCQ common slots).
  for (const [a, b] of [['aqa-gcse-maths-paper-1', 'pearson-gcse-maths-paper-1'], ['aqa-gcse-maths-paper-1', 'ocr-gcse-maths-paper-1'], ['aqa-gcse-english-language-paper-2', 'wjec-eduqas-gcse-english-language-component-2'], ['aqa-a-level-maths-paper-3', 'pearson-a-level-maths-paper-3']]) {
    assert.equal(figure('timetable', a).value, figure('timetable', b).value, `${a} and ${b} share a JCQ slot`);
  }
  for (const board of ['aqa', 'pearson', 'ocr', 'wjec-eduqas']) {
    const rows = DATA.categories.timetable.figures.filter((f) => f.board === board && f.series === 'summer-2027');
    assert.ok(rows.length >= 6, `${board} has summer-2027 paper dates`);
    assert.ok(rows.every((f) => f.status === 'final'), `${board} summer-2027 timetable is final`);
  }
  assert.equal(figure('deadlines', 'jcq-entries-deadline').value, '2027-02-21');
  assert.equal(figure('deadlines', 'wjec-late-fee-from').value, '2027-03-19');
  assert.equal(figure('deadlines', 'ocr-very-late-entry-fee-from').value, '2027-04-22');
  assert.equal(figure('spec-changes', 'ocr-a-level-psychology-h569').value.firstTeaching, '2027-09');
  assert.deepEqual(figure('spec-changes', 'dfe-reformed-gcses-a-levels').value.gcseFirstTeaching, ['2029', '2030']);
  assert.equal(figure('spec-changes', 'ofqual-british-sign-language-gcse').value.accreditedSpecification, null);
});

test('server: lists the tool with clean MCP keys and read-only annotations', async () => {
  const list = await rpc(server, 'tools/list');
  assert.deepEqual(list.body.result.tools.map((t) => t.name), [TOOL]);
  assert.deepEqual(Object.keys(list.body.result.tools[0]).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title']);
  assert.deepEqual(Object.keys(list.body.result.tools[0].inputSchema.properties), ['kind', 'board', 'qualification']);
  assert.equal(ALL_TOOLS[TOOL].server, AREA);
  assert.equal(ALL_TOOLS[TOOL].freshness, AREA);
  // House rule: plain statements, no imperatives, in the tool description.
  assert.doesNotMatch(ALL_TOOLS[TOOL].description, /\b(use this|you should|always|never|call this|do not)\b/i);
});

test('listing: no kind → kinds, boards, qualifications, usage and a cite permalink', async () => {
  const { isError, data } = await callTool(server, TOOL, {});
  assert.equal(isError, false);
  assert.deepEqual(Object.keys(data.kinds), KINDS);
  assert.deepEqual(Object.keys(data.boards), Object.keys(DATA.boards));
  assert.deepEqual(data.qualifications, ['gcse', 'a-level']);
  assert.equal(data.verifiedDate, DATA.verifiedDate);
  assert.equal(data.cite.url, `https://databutler.dev/r/${REST_PATH}`);
});

test('happy path: a kind answers with its figures, source, note, verifiedDate, freshness and a cite permalink', async () => {
  const { isError, data } = await callTool(server, TOOL, { kind: 'results' });
  assert.equal(isError, false);
  assert.equal(data.covered, undefined);
  assert.equal(data.kind, 'results');
  assert.deepEqual(data.figures, DATA.categories.results.figures);
  assert.equal(data.count, DATA.categories.results.figures.length);
  assert.equal(data.source, DATA.categories.results.source);
  assert.equal(data.freshness.verifiedDate, DATA.verifiedDate);
  assert.equal(data.cite.url, `https://databutler.dev/r/${REST_PATH}?kind=results`);
  assert.match(data.cite.text, new RegExp(`^databutler\\.dev, verified ${DATA.verifiedDate} against `));
});

test('filters: board aliases and qualification narrow the figures; common figures answer either qualification', async () => {
  const pearson = (await callTool(server, TOOL, { kind: 'timetable', board: 'Edexcel' })).data;
  assert.ok(pearson.figures.length > 0);
  assert.ok(pearson.figures.every((f) => f.board === 'pearson'));
  assert.deepEqual(pearson.filters, { board: 'pearson' });
  assert.equal(pearson.cite.url, `https://databutler.dev/r/${REST_PATH}?kind=timetable&board=Edexcel`);
  const gcse = (await callTool(server, TOOL, { kind: 'deadlines', board: 'wjec', qualification: 'GCSE' })).data;
  assert.ok(gcse.figures.length > 0);
  assert.ok(gcse.figures.every((f) => f.board === 'wjec-eduqas' && ['gcse', 'gcse-and-a-level'].includes(f.qualification)));
  const alevel = (await callTool(server, TOOL, { kind: 'results', qualification: 'A level' })).data;
  assert.ok(alevel.figures.some((f) => f.key === 'jcq-a-level-results-day'));
  assert.ok(!alevel.figures.some((f) => f.key === 'jcq-gcse-results-day'));
  const substring = (await callTool(server, TOOL, { kind: 'spec' })).data;
  assert.equal(substring.kind, 'spec-changes');
  const empty = (await callTool(server, TOOL, { kind: 'spec-changes', board: 'sqa' })).data;
  assert.equal(empty.covered, undefined);
  assert.equal(empty.count, 0);
  assert.match(empty.empty, /no spec-changes figure/);
});

test('near-miss: an unknown kind, board or qualification is covered:false with nearest keys, never an error', async () => {
  const kind = (await callTool(server, TOOL, { kind: 'zzz-not-a-kind' })).data;
  assert.equal(kind.covered, false);
  assert.equal(kind.requested, 'zzz-not-a-kind');
  assert.ok(Array.isArray(kind.nearest));
  assert.deepEqual(kind.coverage, KINDS);
  assert.equal(kind.error, undefined);
  const board = (await callTool(server, TOOL, { kind: 'timetable', board: 'cie' })).data;
  assert.equal(board.covered, false);
  assert.equal(board.field, 'board');
  assert.deepEqual(board.coverage, Object.keys(DATA.boards));
  const qual = (await callTool(server, TOOL, { kind: 'results', qualification: 'btec' })).data;
  assert.equal(qual.covered, false);
  assert.deepEqual(qual.coverage, ['gcse', 'a-level']);
});

test('REST mirror: empty query → the listing; otherwise the tool with envelope + cite', async () => {
  const empty = await get(rest, `/api/${REST_PATH}`);
  assert.equal(empty.status, 200);
  assert.deepEqual(Object.keys(empty.body.kinds), KINDS);
  assert.ok(empty.body.freshness && empty.body.cite);
  const hit = await get(rest, `/api/${REST_PATH}?kind=results&board=jcq`);
  assert.equal(hit.status, 200);
  assert.ok(hit.body.figures.every((f) => f.board === 'jcq'));
  const miss = await get(rest, `/api/${REST_PATH}?kind=zzz`);
  assert.equal(miss.status, 200);
  assert.equal(miss.body.covered, false);
  assert.ok(miss.body.freshness && miss.body.cite);
  const viaRouter = await get(router, `/api/router?route=${REST_PATH}&kind=zzz`);
  assert.equal(viaRouter.status, 200);
});

test('changelog: the area is listed; a first commit records 2026 → 2027 where a date moved and null → announcement for spec changes', () => {
  assert.ok(CHANGELOG_AREAS.includes(AREA));
  assert.equal(PREVIOUS, true);
  const first = AREA_MODULE.changelog.diff(null, DATA);
  const arrivals = FIGURES.filter(({ f }) => hasPrevious(f));
  assert.equal(first.length, arrivals.length);
  for (const { cat, f } of arrivals) {
    const e = first.find((x) => x.key === `${cat}/${f.key}`);
    assert.ok(e, `entry for ${cat}/${f.key}`);
    for (const k of ENTRY_FIELDS) assert.ok(k in e, `${e.key} has ${k}`);
    assert.equal(e.area, AREA);
    assert.equal(e.label, f.label);
    assert.deepEqual(e.from, f.previous.value);
    assert.deepEqual(e.to, f.value);
    assert.equal(e.effectiveFrom, f.effectiveFrom, 'effectiveFrom is the 2027 date (or the announcement date)');
    assert.equal(e.board, f.board);
    assert.equal(e.verifiedDate, DATA.verifiedDate);
    assert.equal(e.note, '', 'notes are filled by scripts/changelog.js (changelog.note), never by diff()');
  }
  // Every summer-2027 date differs from its 2026 equivalent (a paper that kept its slot still moved a year); a figure
  // whose board no longer serves the 2026 document, and the November series, record nothing.
  const slot = first.find((e) => e.key === 'timetable/aqa-gcse-maths-paper-1');
  assert.deepEqual([slot.from, slot.to, slot.effectiveFrom], ['2026-05-14', '2027-05-14', '2027-05-14']);
  assert.ok(!first.some((e) => e.key === 'timetable/pearson-gcse-maths-paper-1'));
  assert.ok(!first.some((e) => e.series === 'november-2026'));
  assert.ok(first.some((e) => e.key === 'spec-changes/ocr-a-level-psychology-h569' && e.from === null));
  assert.deepEqual(AREA_MODULE.changelog.diff(DATA, DATA), [], 'nothing moved');
  const moved = first.find((e) => e.key === 'results/jcq-gcse-results-day');
  assert.match(AREA_MODULE.changelog.note(moved, null, DATA), /2026-08-20 → 2027-08-19 \(JCQ, Key dates .*June 2027.*; previous from JCQ, Key dates .*June 2026/);
  const announced = first.find((e) => e.key === 'spec-changes/aqa-a-level-business-7137-7138');
  assert.match(AREA_MODULE.changelog.note(announced, null, DATA), /^AQA AS and A-level Business .*: announced specCodes 7137 \/ 7138, firstTeaching 2026-09, firstAsExams 2027, firstALevelExams 2028, replaces 7131 \/ 7132 \(AQA news/);
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
