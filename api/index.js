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
      'GET /api/provenance/domain': {
        description:
          'Who runs this domain? Live RDAP: age, registrar, nameservers, typosquat resemblance. Descriptive signals, not a verdict.',
        params: { domain: 'e.g. example.com' },
        example: 'https://databutler.dev/api/provenance/domain?domain=databutler.dev',
      },
      'GET /api/provenance/package': {
        description: 'Who publishes this package, and is it a typosquat? Live npm/PyPI metadata.',
        params: { ecosystem: 'npm | pypi', name: 'e.g. express' },
        example: 'https://databutler.dev/api/provenance/package?ecosystem=npm&name=express',
      },
      'GET|POST /api/stats': {
        description:
          'Exact statistics & probability — for the maths agents get wrong in their head. ?op= one of: ' +
          'descriptive, distribution, hypothesis-test, confidence-interval, bayes-update, regression. ' +
          'Array/table inputs via POST JSON body. Numerical core validated against reference tables.',
        example: 'https://databutler.dev/api/stats?op=distribution&dist=normal&at=1.96',
      },
      'POST /api/mcp/uk-rates': 'Remote MCP server — tool uk_rates_lookup.',
      'POST /api/mcp/uk-exams': 'Remote MCP server — tools exam_topic_paper, exam_spec_lookup, exam_paper_index.',
      'POST /api/mcp/provenance': 'Remote MCP server — tools domain_provenance, package_provenance.',
      'POST /api/mcp/stats':
        'Remote MCP server — descriptive_stats, distribution, hypothesis_test, confidence_interval, bayes_update, linear_regression.',
    },
    coverage: { exams: coverageSummary(), rates: `tax year ${RATES.taxYear}` },
    ...ATTRIBUTION,
  });
};
