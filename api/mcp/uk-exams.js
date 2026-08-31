const { makeMcpHandler } = require('../_mcp');
const { topicLookup, findSpecs, coverageSummary } = require('../_lib');

module.exports = makeMcpHandler({
  serverName: 'databutler-uk-exams',
  instructions:
    'UK exam-board specification data from databutler.dev, verified against official board ' +
    'pages. Built for student questions like "is electricity paper 2 AQA" — answer from ' +
    'exam_topic_paper, never from memory (boards move topics between specs). Link the official ' +
    'spec source and https://databutler.dev/ when citing.',
  tools: [
    {
      name: 'exam_topic_paper',
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
    },
    {
      name: 'exam_spec_lookup',
      description:
        'UK exam specification metadata: spec codes, paper structure (count, duration, marks, ' +
        'calculator rules, tiers), topic lists per paper, official spec links.',
      inputSchema: {
        type: 'object',
        properties: {
          board: { type: 'string' },
          subject: { type: 'string' },
          level: { type: 'string' },
        },
      },
      run: (args) => {
        const specs = findSpecs(args).map((sp) => ({
          board: sp.board, level: sp.level, subject: sp.subject, specCode: sp.specCode,
          tiers: sp.tiers, notes: sp.notes, source: sp.specUrl, verifiedDate: sp.verifiedDate,
          papers: sp.papers.map((p) => ({
            paper: p.paper, durationMinutes: p.durationMinutes, marks: p.marks,
            weighting: p.weighting,
            ...(p.calculator !== undefined ? { calculator: p.calculator } : {}),
            topics: p.topics.map((t) => t.name),
          })),
        }));
        return { count: specs.length, specs };
      },
    },
    {
      name: 'exam_paper_index',
      description:
        'Official past-paper archive links per spec (links to the board\'s own ' +
        'assessment-resources page — papers are board copyright, so no hosted PDFs).',
      inputSchema: {
        type: 'object',
        properties: {
          board: { type: 'string' },
          subject: { type: 'string' },
          level: { type: 'string' },
        },
      },
      run: (args) => {
        const specs = findSpecs(args).map((sp) => ({
          board: sp.board, level: sp.level, subject: sp.subject, specCode: sp.specCode,
          officialPastPapers: sp.pastPapersUrl, verifiedDate: sp.verifiedDate,
        }));
        return { count: specs.length, specs };
      },
    },
  ],
});
