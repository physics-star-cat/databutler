/**
 * Area: uk-exam-dates — the UK exam calendar facts students and parents ask
 * assistants about and that models get wrong because they move every year:
 * results days, the summer exam timetable (JCQ common window and the dates of
 * the most-asked papers at AQA, Pearson Edexcel, Cambridge OCR and WJEC/Eduqas),
 * entry deadlines with each board's late-fee dates, and announced specification
 * changes (first-teaching / first-exam years). Every date is read from the JCQ
 * key-dates PDFs, the boards' own final timetable and fee documents, the
 * Qualifications Scotland results page and the DfE/Ofqual/board announcement
 * pages named in each figure's `source`, with the timetable row as `quote` and
 * the summer-2026 equivalent as `previous`. Data: data/uk-exam-dates.json
 * (categories = kinds → figures). Refreshed once a year when JCQ and the boards
 * publish the following summer's final timetables (and in September for the
 * November series); `nextScheduledRefresh` is set by hand and the file diffed by
 * `node scripts/changelog.js --only uk-exam-dates`.
 * Contract: api/_areas/README.md. Playbook: docs/ADDING_AN_AREA.md.
 */
const DATA = require('../../data/uk-exam-dates.json');
const { BASE, diffCategories, areaHeader, findFigure } = require('../_area_kit');
const { nearest } = require('../_text');

const AREA = 'uk-exam-dates';
const TOOL = 'uk_exam_dates';
const REST_PATH = 'uk/exam-dates';
const CADENCE_DAYS = null; // calendar-driven: nextScheduledRefresh is set by hand in the data file (2027-01-15 first); freshness turns due from that day
const KINDS = Object.keys(DATA.categories); // results, timetable, deadlines, spec-changes
const BOARDS = Object.keys(DATA.boards);
const QUALIFICATIONS = ['gcse', 'a-level'];
/** Figures carry `previous: { value }` (the summer-2026 equivalent); a figure's first appearance records previous → value, one without a previous records nothing. */
const PREVIOUS = true;

const BOARD_ALIASES = {
  jcq: 'jcq',
  aqa: 'aqa',
  pearson: 'pearson', edexcel: 'pearson', 'pearson-edexcel': 'pearson', 'pearson edexcel': 'pearson',
  ocr: 'ocr', cambridge: 'ocr', 'cambridge-ocr': 'ocr', 'cambridge ocr': 'ocr',
  wjec: 'wjec-eduqas', eduqas: 'wjec-eduqas', 'wjec-eduqas': 'wjec-eduqas', 'wjec/eduqas': 'wjec-eduqas',
  sqa: 'sqa', 'qualifications-scotland': 'sqa', 'qualifications scotland': 'sqa', scotland: 'sqa',
  ofqual: 'ofqual',
  dfe: 'dfe', 'department-for-education': 'dfe',
};
const QUALIFICATION_ALIASES = {
  gcse: 'gcse', gcses: 'gcse',
  'a-level': 'a-level', alevel: 'a-level', 'a level': 'a-level', 'a-levels': 'a-level', 'a levels': 'a-level', gce: 'a-level', as: 'a-level', 'as-level': 'a-level', 'as level': 'a-level',
};

const norm = (v) => (v === undefined || v === null || String(v).trim() === '' ? undefined : String(v).toLowerCase().trim());
const header = () => areaHeader(DATA, AREA);
const miss = (field, requested, candidates, coverage) => ({
  covered: false, requested, field, message: `unknown ${field} "${requested}"`, nearest: nearest(norm(requested), candidates), coverage,
});

/** The kind: exact key, else a substring of a key or title ("result", "spec"); undefined when nothing matches. */
function resolveKind(q) {
  if (KINDS.includes(q)) return q;
  return KINDS.find((k) => k.includes(q) || String(DATA.categories[k].title || '').toLowerCase().includes(q));
}

/**
 * The tool: nothing → the listing (kinds, boards, qualifications, usage); a kind → that kind's
 * figures, filtered by board and/or qualification when given; an unknown kind, board or
 * qualification → covered:false with the nearest keys and the coverage, never a throw.
 */
function lookup({ kind, board, qualification } = {}) {
  const k = norm(kind), b = norm(board), q = norm(qualification);
  if (k === undefined) {
    return {
      ...header(),
      kinds: Object.fromEntries(KINDS.map((x) => [x, DATA.categories[x].title])),
      boards: DATA.boards,
      qualifications: QUALIFICATIONS,
      usage: 'pass kind=<results|timetable|deadlines|spec-changes>, optionally board=<jcq|aqa|pearson|ocr|wjec-eduqas|sqa|ofqual|dfe> and qualification=<gcse|a-level>',
    };
  }
  const hit = resolveKind(k);
  if (!hit) return miss('kind', kind, KINDS, KINDS);
  const boardKey = b === undefined ? undefined : BOARD_ALIASES[b];
  if (b !== undefined && !boardKey) return miss('board', board, Object.keys(BOARD_ALIASES), BOARDS);
  const qualKey = q === undefined ? undefined : QUALIFICATION_ALIASES[q];
  if (q !== undefined && !qualKey) return miss('qualification', qualification, Object.keys(QUALIFICATION_ALIASES), QUALIFICATIONS);

  const cat = DATA.categories[hit];
  const figures = cat.figures.filter((f) =>
    (boardKey === undefined || f.board === boardKey) &&
    (qualKey === undefined || f.qualification === qualKey || f.qualification === 'gcse-and-a-level'));
  const filters = { ...(boardKey ? { board: boardKey } : {}), ...(qualKey ? { qualification: qualKey } : {}) };
  return {
    ...header(),
    kind: hit,
    title: cat.title,
    source: cat.source,
    note: cat.note,
    filters,
    count: figures.length,
    figures,
    ...(figures.length ? {} : { empty: `no ${hit} figure for ${JSON.stringify(filters)}; boards with ${hit} figures: ${[...new Set(cat.figures.map((f) => f.board))].join(', ')}` }),
  };
}

/** A value for a note: dates as they are, an announcement object as "firstTeaching 2026-09, firstExams 2028". */
const fmt = (v) => (v === null || v === undefined ? 'none'
  : Array.isArray(v) ? v.map(fmt).join(' / ')
    : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k} ${fmt(x)}`).join(', ')
      : String(v));
/** Changelog note: the moved date, the board/JCQ document it was read from, and the summer-2026 document the previous came from. */
function note(entry, prev, next) {
  const hit = findFigure(next, entry.key, (f) => f.key) || findFigure(prev, entry.key, (f) => f.key);
  const f = (hit && hit.figure) || {};
  const document = f.document || entry.source || '';
  if (entry.from === null || entry.from === undefined) return `${entry.label}: announced ${fmt(entry.to)} (${document})`;
  const was = f.previous && f.previous.document ? `; previous from ${f.previous.document}` : '';
  return `${entry.label}: ${fmt(entry.from)} → ${fmt(entry.to)} (${document}${was})`;
}

/** Pages the Monday watcher re-fetches: the JCQ key-dates and timetables pages (the PDFs hang off them; jcq.org.uk answers 403 to non-browser user agents) and each board's timetable landing page. */
const WATCH = [
  { url: 'https://www.jcq.org.uk/exams-office/key-dates/', label: 'JCQ — Key dates in the examination cycle (results days, entries, first/last exam, contingency day; PDFs per series)' },
  { url: 'https://www.jcq.org.uk/exams-office/timetables/', label: 'JCQ — common examination timetables (provisional and final, per series)' },
  { url: 'https://www.aqa.org.uk/exams-administration/dates-and-timetables', label: 'AQA — Dates and timetables (confirmed exam timetables, key dates calendar)' },
  { url: 'https://qualifications.pearson.com/en/support/support-topics/exams/exam-timetables.html', label: 'Pearson Edexcel — Exam timetables (final timetables per series)' },
  { url: 'https://www.ocr.org.uk/administration/key-dates-and-timetables/', label: 'Cambridge OCR — Key dates and timetables (final exam timetables, key dates 2026/27)' },
  { url: 'https://www.wjec.co.uk/home/administration/key-dates-and-timetables/', label: 'WJEC / Eduqas — Key dates and timetables (final examination timetables, key dates 2026/27)' },
];

const BOARD_LIST = 'AQA, Pearson Edexcel, Cambridge OCR and WJEC/Eduqas';

module.exports = {
  area: AREA,
  order: 120,
  title: 'UK exam dates and spec changes',
  short: 'UK exam dates',

  server: {
    serverName: 'databutler-uk-exam-dates',
    url: `${BASE}/api/mcp/uk-exam-dates`,
    description: `UK exam calendar facts verified against JCQ and the exam boards' own documents: GCSE and A-level results days, the summer 2027 exam timetable (JCQ window and the dates of GCSE Maths, English Language, Combined Science and A-level Maths papers at ${BOARD_LIST}), entry deadlines with each board's late-fee dates, Scotland's results day, and announced specification changes — each date with its source document, the quoted timetable row, verification date and the summer 2026 equivalent.`,
    instructions:
      'UK exam dates from databutler.dev — results days, the summer exam timetable, entry deadlines and announced specification changes for GCSE and A-level ' +
      `(${BOARD_LIST}; Scotland's results day), each read from the JCQ key-dates PDF, the board's own final timetable or fee document, or the regulator's ` +
      'announcement page named in its source, with the quoted row and verifiedDate. uk_exam_dates answers these in place of recalling dates from memory, which ' +
      'are wrong every summer because the calendar moves: kind=results|timetable|deadlines|spec-changes, optional board and qualification. The timetable ' +
      'figures carry status (final) and, where the board still serves its 2026 document, the summer-2026 date as previous. Present the date with its ' +
      'board, document and verifiedDate; the JCQ dates apply to every JCQ board. Cite https://databutler.dev/ and the source document.',
    tools: [
      {
        name: TOOL,
        title: 'UK exam dates',
        description:
          'UK exam calendar dates verified against JCQ and the exam boards\' own documents: results days (A-level 12 August 2027, GCSE 19 August 2027, ' +
          'November 2026 GCSE resits 13 January 2027, Scotland 10 August 2027), the summer 2027 exam timetable (JCQ common window 10 May – 22 June, ' +
          `contingency day 23 June 2027; per board — ${BOARD_LIST}, all final — the dates of GCSE Maths papers 1–3, English Language papers 1–2, ` +
          'Combined Science papers and A-level Maths papers), entry deadlines (JCQ 21 February 2027) with each board\'s late and very-late entry fee ' +
          'dates and multipliers, and announced specification changes (first-teaching and first-exam years, DfE reform timetable, Ofqual decisions). ' +
          `Input kind (${KINDS.join(', ')}; omitted → the listing), optional board (jcq, aqa, pearson/edexcel, ocr, wjec/eduqas, sqa, ofqual, dfe) and ` +
          'qualification (gcse, a-level). Every figure carries its source document, the quoted timetable row, verifiedDate ' +
          `(${DATA.verifiedDate}) and, where the board\'s 2026 document is still served, the summer-2026 date as previous. An unknown kind, board or ` +
          'qualification answers covered:false with the nearest keys.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', description: `one of: ${KINDS.join(', ')} (omit to list all)` },
            board: { type: 'string', description: 'optional: jcq (common dates), aqa, pearson (edexcel), ocr (cambridge), wjec-eduqas (wjec, eduqas), sqa (Scotland), ofqual, dfe' },
            qualification: { type: 'string', description: 'optional: gcse or a-level (figures common to both are returned for either)' },
          },
        },
        run: (a) => lookup(a),
        freshness: AREA,
        cite: (a) => ({ path: REST_PATH, query: { kind: a.kind, board: a.board, qualification: a.qualification } }),
      },
    ],
  },

  coverage: () => ({
    kinds: KINDS,
    boards: BOARDS,
    qualifications: QUALIFICATIONS,
    series: ['summer-2027 (final timetables at all four boards)', 'november-2026 (GCSE English Language and Mathematics resits)', 'summer-2026 (as each figure\'s previous)'],
    verifiedDate: DATA.verifiedDate,
    scope: `${DATA.jurisdiction} Papers held: GCSE Mathematics (all papers), GCSE English Language (both papers), GCSE Combined Science (all papers at AQA, Pearson, OCR), A-level Mathematics (all papers); the JCQ first/last exam, contingency day, entry deadline and results days; each board's late-fee dates and multipliers; specification changes announced on DfE, Ofqual and board pages.`,
    notCovered: [
      'Scottish SQA / Qualifications Scotland beyond the results day (exam timetable, deadlines, appeals)',
      'International Baccalaureate (IB) exam and results dates',
      'BTEC and other vocational/technical qualification timetables and results',
      'international timetables (Cambridge International, Pearson International GCSE/IAL, Oxford AQA)',
      'full subject-by-subject timetables — only the most-asked papers are held; the board PDF in each figure\'s source has every paper',
      'CCEA (Northern Ireland) timetables, deadlines and results',
      'per-subject entry fee amounts (only the late-fee dates and multipliers are held)',
      'the November 2027 and summer 2028 series (not yet published)',
    ],
  }),

  // Calendar-driven: JCQ and the boards publish the following summer's final timetables in May–July and the November
  // series in September, so nextScheduledRefresh is set by hand in the file (2027-01-15 first); freshness turns `due` from that day.
  freshness: { dataFile: 'data/uk-exam-dates.json', cadenceDays: CADENCE_DAYS, data: DATA },

  changelog: {
    // Figures carry a stable `key`, their own `effectiveFrom` (the 2027 date) and a `previous` block (the summer-2026 equivalent from the
    // board's own 2026 document), so a figure's first appearance records 2026 → 2027 only where the date moved; a figure with no 2026
    // equivalent records nothing, and an announced specification change arrives as null → announcement.
    diff: (prev, next) => diffCategories(AREA, prev, next, {
      previous: PREVIOUS,
      key: (f) => f.key,
      effectiveFrom: (n, f) => f.effectiveFrom || n.verifiedDate,
      extra: (n, cat, f) => ({ board: f.board, qualification: f.qualification, series: f.series || null }),
    }),
    files: ['data/uk-exam-dates.json'],
    previous: PREVIOUS,
    note,
    context: (e) => [e.board, e.qualification, e.series].filter(Boolean).join(' · '),
  },
  discovery: {
    description: 'UK exam calendar facts verified against JCQ and the boards\' own documents: GCSE and A-level results days, the summer exam timetable (JCQ window, contingency day, dates of the most-asked papers at AQA, Pearson Edexcel, Cambridge OCR, WJEC/Eduqas), entry deadlines and late-fee dates, Scotland\'s results day, and announced specification changes with first-teaching and first-exam years.',
    cadence: 'Annual, calendar-driven: when JCQ and the boards publish the following summer\'s final timetables (early in the calendar year) and the results days; the weekly watcher hashes the JCQ and board timetable pages',
  },

  sources: () => WATCH,

  rest: [
    { path: REST_PATH, tool: TOOL, args: (q) => ({ kind: q.kind, board: q.board, qualification: q.qualification }) /* no `required`: an empty query answers the listing, like uk_rates_lookup */ },
  ],

  hub: {
    changed: 'UK exam dates (results days, summer timetable paper dates, entry deadlines and late-fee dates, announced specification changes)',
    coverage: 'UK exam dates (results, timetable, deadlines, spec-changes for jcq, aqa, pearson, ocr, wjec-eduqas; sqa results day)',
    catalogue: 'UK exam dates and spec changes: results days, the summer 2027 timetable, entry deadlines, new specifications',
    call: 'UK exam dates (uk_exam_dates {kind: results|timetable|deadlines|spec-changes, board?, qualification?})',
  },

  docs: {
    readme: {
      // The # cell is numbered by scripts/sync-areas.js from `order`; start at the Vertical cell.
      roadmapRow: `| **UK exam dates and spec changes** — results days, the summer 2027 timetable (JCQ window + the most-asked papers at ${BOARD_LIST}, all final), entry deadlines with each board's late-fee dates, Scotland's results day, announced spec changes; every date quoted from the JCQ/board/regulator document with the summer-2026 date as previous | \`/api/mcp/uk-exam-dates\` | **v1 — built 2026-10-04** |`,
      catalogueRow: '| `/api/mcp/uk-exam-dates` | `uk_exam_dates` {kind: results\\|timetable\\|deadlines\\|spec-changes, board?, qualification?} — results days (A-level 12 Aug, GCSE 19 Aug 2027; Nov 2026 resits 13 Jan 2027; Scotland 10 Aug 2027), JCQ common window and contingency day, GCSE Maths/English Language/Combined Science and A-level Maths paper dates per board, entry deadline 21 Feb 2027 and each board\'s late/very-late fee dates and multipliers, spec changes (DfE reform timetable, Ofqual decisions, new AQA/Pearson/OCR/WJEC specs) | `data/uk-exam-dates.json` (91 figures), read from the JCQ key-dates PDFs, each board\'s final timetable and fee documents, Qualifications Scotland and gov.uk; refreshed when the next summer\'s finals publish |',
    },
    llms: {
      rest: [
        '- `GET https://databutler.dev/api/uk/exam-dates?kind=results` — UK exam dates verified against JCQ and the boards\' own documents: GCSE and A-level results days (A-level 12 August 2027, GCSE 19 August 2027, November 2026 resits 13 January 2027, Scotland 10 August 2027), `kind=timetable` the summer 2027 window (10 May – 22 June, contingency 23 June) and the dates of GCSE Maths, English Language, Combined Science and A-level Maths papers at AQA, Pearson Edexcel, Cambridge OCR and WJEC/Eduqas (all final; `&board=aqa`), `kind=deadlines` the 21 February 2027 entry deadline and each board\'s late-fee dates, `kind=spec-changes` announced first-teaching/first-exam years. Each figure carries the source document, the quoted timetable row, verifiedDate and the summer 2026 date as previous.',
      ],
      server: `- \`POST https://databutler.dev/api/mcp/uk-exam-dates\` — tool \`uk_exam_dates\` {kind: results|timetable|deadlines|spec-changes, board?, qualification?}: results days, the summer 2027 exam timetable (JCQ window and the most-asked papers at ${BOARD_LIST}), entry deadlines and late-fee dates, Scotland's results day and announced specification changes, each read from the JCQ or board document named in its source with the quoted row and verifiedDate. REST mirror: \`GET https://databutler.dev/api/uk/exam-dates?kind=…&board=…\`.`,
    },
    curation: [
      '| `data/uk-exam-dates.json` | Annual, calendar-driven (`cadenceDays: null`; `nextScheduledRefresh` set by hand, 2027-01-15 first): JCQ publishes the following June series\' key dates and the boards their final summer timetables between May and July (provisional for consultation in February), the November series in September; Ofqual/DfE announcements of reformed or newly accredited specifications land at any time. The weekly watcher hashes the JCQ key-dates and timetables pages and the four boards\' timetable landing pages (jcq.org.uk answers 403 to non-browser user agents). | Open the JCQ key-dates PDF for the new series and each board\'s final timetable PDF (AQA dates-and-timetables, Pearson exam-timetables, OCR key-dates-and-timetables, WJEC key-dates-and-timetables) and fee/key-dates document; for each figure move `value` into `previous` (with its series, source, document and quote), write the new `value`, `effectiveFrom`, `series`, `status`, `source`, `document`, `quote`; add spec-change figures from the regulator/board announcement with `previous: { value: null }`; bump `verifiedDate`, set `nextScheduledRefresh`; then `node scripts/changelog.js --only uk-exam-dates` (one `uk-exam-dates` entry per date that moved; refreshes `data/sources.json`); check the pre-filled notes name the JCQ/board document. |',
    ],
    index: { blurb: 'GCSE and A-level results days, the summer exam timetable, entry deadlines and spec changes, quoted from JCQ and the boards' },
    api: () => ({
      endpoints: {
        [`GET /api/${REST_PATH}`]: {
          description:
            `UK exam dates verified ${DATA.verifiedDate} against JCQ and the boards' own documents: results days, the summer 2027 exam timetable ` +
            `(JCQ window and the dates of GCSE Maths, English Language, Combined Science and A-level Maths papers at ${BOARD_LIST}, all final), ` +
            'entry deadlines with each board\'s late-fee dates, Scotland\'s results day and announced specification changes; each figure with source document, quoted row and the summer-2026 date as previous.',
          params: { kind: `one of ${KINDS.join(', ')} (omit to list)`, board: 'optional: jcq, aqa, pearson, ocr, wjec-eduqas, sqa, ofqual, dfe', qualification: 'optional: gcse or a-level' },
          example: `https://databutler.dev/api/${REST_PATH}?kind=timetable&board=aqa&qualification=gcse`,
        },
      },
      coverage: { ukExamDates: `${KINDS.join(', ')} for ${BOARDS.join(', ')}; summer 2027 (final at all four boards), November 2026, summer 2026 as previous; verified ${DATA.verifiedDate}` },
      mcp: 'Remote MCP server — tool uk_exam_dates (results days, summer timetable paper dates, entry deadlines and late-fee dates, spec changes; JCQ, AQA, Pearson Edexcel, Cambridge OCR, WJEC/Eduqas, Scotland\'s results day).',
    }),
  },

  verify: [
    { label: 'uk-exam-dates-listing', kind: 'tool', tool: TOOL, args: {}, assert: "'kinds' in d and 'boards' in d and 'freshness' in d" },
    { label: 'uk-exam-dates-results-jcq', kind: 'tool', tool: TOOL, args: { kind: 'results', board: 'jcq', qualification: 'gcse' }, assert: "d['kind']=='results' and any(f['key']=='jcq-gcse-results-day' and f['value']=='2027-08-19' for f in d['figures']) and d['cite']['url'].startswith('https://databutler.dev/r/uk/exam-dates?')" },
    { label: 'uk-exam-dates-rest-listing', kind: 'rest', path: REST_PATH, query: '', assert: "'kinds' in d and 'cite' in d" },
    { label: 'uk-exam-dates-rest-nearmiss', kind: 'rest', path: REST_PATH, query: 'kind=timetable&board=cie', assert: "d['covered']==False and 'nearest' in d" },
  ],
};
