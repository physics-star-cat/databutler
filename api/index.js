const { sendJson, handleOptions, ATTRIBUTION, coverageSummary, RATES } = require('./_lib');

module.exports = (req, res) => {
  if (handleOptions(req, res)) return;
  sendJson(res, 200, {
    name: 'Data Butler',
    description:
      'Verified UK public data for AI agents. Every figure carries an official source URL and a ' +
      'verifiedDate — built for the questions agents misquote from memory. No auth, CORS-open. ' +
      'Country-prefixed: /api/uk/*; more countries later.',
    endpoints: {
      'GET /api/uk/rates': {
        description: `UK tax-year rates & thresholds (${RATES.taxYear}), verified against gov.uk.`,
        params: { category: `one of ${Object.keys(RATES.categories).join(', ')} (omit to list)` },
        example: 'https://databutler.dev/api/uk/rates?category=income-tax',
      },
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
      'POST /api/mcp/uk-rates': 'Remote MCP server — tool uk_rates_lookup.',
      'POST /api/mcp/uk-exams': 'Remote MCP server — tools exam_topic_paper, exam_spec_lookup, exam_paper_index.',
    },
    coverage: { exams: coverageSummary(), rates: `tax year ${RATES.taxYear}` },
    ...ATTRIBUTION,
  });
};
