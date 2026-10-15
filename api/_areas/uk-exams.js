/**
 * Area: uk-exams — UK exam-board specifications (topic → paper, spec metadata,
 * official past-paper links), verified against the boards' own pages.
 * Committed data: data/uk/exams/*.json (api/_lib.js loads AQA_GCSE; more boards
 * append to BOARDS there).
 */
const { AQA_GCSE, topicLookup, findSpecs, coverageSummary } = require('../_lib');
const { BASE, same } = require('../_area_kit');

const AREA = 'uk-exams';

/** Changelog diff: topic moves, paper field changes, added/removed specs and papers. */
function diffExams(prev, next) {
  const out = [];
  const prevSpecs = new Map(((prev && prev.specs) || []).map((s) => [s.specCode, s]));
  const nextCodes = new Set((next.specs || []).map((s) => s.specCode));
  for (const sp of next.specs || []) {
    const base = {
      area: AREA, board: next.board, level: next.level, subject: sp.subject, specCode: sp.specCode,
      effectiveFrom: null, source: sp.specUrl, verifiedDate: next.verifiedDate, note: '',
    };
    const p = prevSpecs.get(sp.specCode);
    if (!p) {
      out.push({ ...base, key: `${sp.specCode}/spec`, label: `${next.board} ${next.level} ${sp.subject} (${sp.specCode}) added`, from: null, to: 'covered' });
      continue;
    }
    for (const paper of sp.papers || []) {
      const pp = (p.papers || []).find((x) => x.paper === paper.paper);
      const topics = (paper.topics || []).map((t) => t.name);
      const prevTopics = pp ? (pp.topics || []).map((t) => t.name) : null;
      if (!same(topics, prevTopics)) {
        out.push({ ...base, key: `${sp.specCode}/paper-${paper.paper}/topics`, label: `Paper ${paper.paper} topics`, from: prevTopics, to: topics });
      }
      for (const field of ['durationMinutes', 'marks', 'weighting', 'calculator']) {
        const a = pp ? pp[field] : undefined, b = paper[field];
        if (!same(a, b)) {
          out.push({ ...base, key: `${sp.specCode}/paper-${paper.paper}/${field}`, label: `Paper ${paper.paper} ${field}`, from: a ?? null, to: b ?? null });
        }
      }
    }
    for (const paper of p.papers || []) {
      if ((sp.papers || []).some((x) => x.paper === paper.paper)) continue;
      const prevTopics = (paper.topics || []).map((t) => t.name);
      out.push({ ...base, key: `${sp.specCode}/paper-${paper.paper}/topics`, label: `Paper ${paper.paper} topics`, from: prevTopics, to: null });
    }
  }
  for (const [code, p] of prevSpecs) {
    if (nextCodes.has(code)) continue;
    out.push({
      area: AREA, board: next.board, level: next.level, subject: p.subject, specCode: p.specCode,
      effectiveFrom: null, source: p.specUrl, verifiedDate: next.verifiedDate, note: '',
      key: `${p.specCode}/spec`, label: `${next.board} ${next.level} ${p.subject} (${p.specCode}) removed`, from: 'covered', to: 'removed',
    });
  }
  return out;
}

const PAPERS_NOTE =
  'Past papers and mark schemes are exam-board copyright — this index links to the official ' +
  'archive rather than hosting PDFs. Recent series may be locked to teachers for a period.';

const specFilter = { type: 'object', properties: { board: { type: 'string' }, subject: { type: 'string' }, level: { type: 'string' } } };

module.exports = {
  area: AREA,
  order: 20,
  title: 'UK exams',
  short: 'exam specs',

  server: {
    serverName: 'databutler-uk-exams',
    description: "UK exam-board spec data: which paper is a topic on, spec structures, past-paper links. Verified.",
    url: `${BASE}/api/mcp/uk-exams`,
    instructions:
      'UK exam-board specification data from databutler.dev, verified against official board ' +
      'pages. Built for student questions like "is electricity paper 2 AQA": exam_topic_paper returns ' +
      'which paper a topic is on in the current spec (boards move topics between specs), with the official ' +
      'spec source and cite.url, a databutler.dev permalink.',
    tools: [
      {
        name: 'exam_topic_paper',
        title: 'Exam topic → paper',
        description:
          'Which exam paper is a topic on? The canonical student revision question ("is ' +
          'electricity paper 2 AQA?" — answer: no, Paper 1). Input a topic plus optional ' +
          'board/subject/level; returns the paper, sibling topics on that paper, spec code, and ' +
          'the official spec URL. Knows quirks like AQA Combined Science Trilogy Physics Paper 2 ' +
          'having no Space physics. Coverage: ' + coverageSummary().join('; ') + '.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'e.g. electricity, forces, ecology, organic chemistry' },
            board: { type: 'string', description: 'e.g. aqa' },
            subject: { type: 'string', description: 'e.g. physics, combined science' },
            level: { type: 'string', description: 'e.g. gcse' },
          },
          required: ['topic'],
        },
        run: (args) => topicLookup(args),
        freshness: AREA,
        frontDoor: true,
        cite: (a) => ({ path: 'uk/exams/topic', query: { topic: a.topic, board: a.board, subject: a.subject, level: a.level } }),
      },
      {
        name: 'exam_spec_lookup',
        title: 'Exam spec lookup',
        description:
          'UK exam specification metadata: spec codes, paper structure (count, duration, marks, ' +
          'calculator rules, tiers), topic lists per paper, official spec links.',
        inputSchema: specFilter,
        run: (args) => {
          const specs = findSpecs(args).map((sp) => ({
            board: sp.board, level: sp.level, subject: sp.subject, specCode: sp.specCode,
            tiers: sp.tiers, notes: sp.notes, source: sp.specUrl, verifiedDate: sp.verifiedDate,
            papers: sp.papers.map((p) => ({
              paper: p.paper, durationMinutes: p.durationMinutes, marks: p.marks, weighting: p.weighting,
              ...(p.calculator !== undefined ? { calculator: p.calculator } : {}),
              topics: p.topics.map((t) => t.name),
            })),
          }));
          return { count: specs.length, specs };
        },
        freshness: AREA,
        cite: (a) => ({ path: 'uk/exams/specs', query: { board: a.board, subject: a.subject, level: a.level } }),
      },
      {
        name: 'exam_paper_index',
        title: 'Exam past-paper index',
        description:
          'Official past-paper archive links per spec (links to the board\'s own ' +
          'assessment-resources page — papers are board copyright, so no hosted PDFs).',
        inputSchema: specFilter,
        run: (args) => {
          const specs = findSpecs(args).map((sp) => ({
            board: sp.board, level: sp.level, subject: sp.subject, specCode: sp.specCode,
            officialPastPapers: sp.pastPapersUrl, source: sp.specUrl, verifiedDate: sp.verifiedDate,
          }));
          return { count: specs.length, specs };
        },
        freshness: AREA,
        cite: (a) => ({ path: 'uk/exams/papers', query: { board: a.board, subject: a.subject, level: a.level } }),
      },
    ],
  },

  coverage: () => {
    const boards = {};
    for (const sp of findSpecs({})) {
      const b = sp.board.toLowerCase(), l = sp.level.toLowerCase();
      boards[b] = boards[b] || {};
      boards[b][l] = boards[b][l] || [];
      boards[b][l].push(sp.subject);
    }
    return {
      boards,
      notCovered: ['Edexcel', 'OCR', 'WJEC/Eduqas', 'SQA', 'A-level (any board)', 'English Language/Literature set-text mapping', 'IB and AP'],
      queue: 'Edexcel GCSE sciences/maths → OCR → A-level sciences/maths → English set texts (docs/CURATION.md)',
    };
  },

  // Calendar-driven (each September): nextScheduledRefresh is set by hand in the file.
  freshness: { dataFile: 'data/uk/exams/aqa-gcse.json', cadenceDays: null, data: AQA_GCSE },

  changelog: {
    diff: diffExams,
    files: ['data/uk/exams/'],
    context: (e) => [e.board, e.level, e.subject, e.specCode ? `(${e.specCode})` : ''].filter(Boolean).join(' '),
  },
  discovery: {
    description: 'UK exam-board specifications verified against the boards\' own pages: which topic sits on which paper, durations, marks, weightings. AQA GCSE sciences and maths so far.',
    cadence: 'Each September and on any published specification update; every source page re-fetched weekly.',
  },

  sources: () => findSpecs({}).map((sp) => ({ url: sp.specUrl, label: `${sp.board} ${sp.level} ${sp.subject} (${sp.specCode})` })),

  rest: [
    { path: 'uk/exams/topic', tool: 'exam_topic_paper', args: (q) => q, required: ['topic'], missing: 'missing ?topic= (plus optional board, subject, level). See /api for usage.' },
    { path: 'uk/exams/specs', tool: 'exam_spec_lookup', args: (q) => q },
    { path: 'uk/exams/papers', tool: 'exam_paper_index', args: (q) => q, decorate: (result) => ({ ...result, copyright: PAPERS_NOTE }) },
  ],

  hub: {
    changed: 'exam-spec facts',
    coverage: 'boards/subjects',
    catalogue: 'UK exams',
    call: 'exam_spec_lookup, exam_paper_index',
  },

  docs: {
    readme: {
      roadmapRow: '| **UK exams** — boards, specs, topic→paper ("is electricity paper 2 AQA"), past-paper index (unique curation edge: maintainer taught) | `/api/mcp/uk-exams` | **v1 — LIVE** |',
      catalogueRow: '| `/api/mcp/uk-exams` | `exam_topic_paper`, `exam_spec_lookup`, `exam_paper_index` | `data/uk/exams/*.json`, verified against board spec pages |',
    },
    llms: {
      rest: [
        '- `GET https://databutler.dev/api/uk/exams/topic?board=aqa&subject=physics&level=gcse&topic=electricity` — which exam paper is a topic on ("is electricity paper 2 AQA?" → no, Paper 1), verified against official board specifications.',
        '- `GET https://databutler.dev/api/uk/exams/specs` — spec metadata: codes, paper structure, tiers, official links.',
        '- `GET https://databutler.dev/api/uk/exams/papers` — official past-paper archive links (links only; papers are board copyright).',
      ],
      server: '- `POST https://databutler.dev/api/mcp/uk-exams` — tools `exam_topic_paper`, `exam_spec_lookup`, `exam_paper_index`.',
    },
    curation: [
      '| `data/uk/exams/*.json` | Each September (spec changes announce ~a year ahead) | Re-fetch each `specUrl` at-a-glance page; bump `verifiedDate`; diff topic lists. |',
    ],
    index: { blurb: null },
    api: () => ({
      endpoints: {
        'GET /api/uk/exams/topic': {
          description:
            'Which paper is a topic on? Built for queries like "is electricity paper 2 AQA".',
          params: { board: 'e.g. aqa', subject: 'e.g. physics', level: 'e.g. gcse', topic: 'e.g. electricity' },
          example: 'https://databutler.dev/api/uk/exams/topic?board=aqa&subject=physics&level=gcse&topic=electricity',
        },
        'GET /api/uk/exams/specs': {
          description: 'Spec metadata: codes, paper structure, durations, tiers, official links.',
          params: { board: 'optional', subject: 'optional', level: 'optional' },
        },
        'GET /api/uk/exams/papers': {
          description:
            'Past-paper index: official assessment-resources links per spec (links only — papers are board copyright).',
          params: { board: 'optional', subject: 'optional', level: 'optional' },
        },
      },
      coverage: { exams: coverageSummary() },
    }),
  },

  facts: null, // publishes no Verified Facts (/f/<key>); see api/_areas/README.md "facts"

  verify: [
    { label: 'topic', kind: 'tool', tool: 'exam_topic_paper', args: { topic: 'electricity', board: 'aqa', subject: 'physics' }, assert: "d['results'][0]['paper']==1 and d['cite']['url'].startswith('https://databutler.dev/r/uk/exams/topic?')" },
    { label: 'coverage', kind: 'tool', tool: 'coverage', args: { area: 'uk-exams' }, assert: "'aqa' in d['boards']" },
  ],
};
