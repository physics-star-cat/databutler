// Fixture for tests/facts-get.test.js: a minimal area with a facts block — one current figure with a dated previous
// value, and one withdrawn figure (value null + withdrawn + supersededBy, spec §3.4). Not real data; never loaded by the API.
const { categorySources } = require('../../../api/_area_kit');

const DATA = {
  area: 'facts-fixture', taxYear: '2026', verifiedDate: '2026-10-01', nextScheduledRefresh: '2026-12-01',
  categories: {
    widgets: {
      title: 'Widget thresholds', source: 'https://example.gov/widgets',
      figures: [
        { key: 'limit', label: 'Widget limit', value: 100, unit: 'widgets', effectiveFrom: '2026-01-01', quote: 'The widget limit is 100.',
          previous: { value: 90, taxYear: '2025', source: 'https://example.gov/widgets/2025' } },
        { key: 'old-allowance', label: 'Old widget allowance', value: 5, unit: 'widgets', effectiveFrom: '2026-01-01',
          withdrawn: '2026-06-30', supersededBy: 'xx/widgets/limit' },
      ],
    },
  },
};

module.exports = {
  area: 'facts-fixture', order: 10, title: 'Facts fixture', short: 'fixture facts',
  server: null,
  coverage: () => ({ notCovered: [] }),
  freshness: { dataFile: 'tests/fixtures/areas-facts/facts-fixture.js', cadenceDays: null, data: DATA },
  changelog: null,
  sources: () => categorySources(DATA),
  rest: [],
  hub: { coverage: 'fixture', catalogue: 'fixture' },
  docs: { readme: { roadmapRow: '| fixture | — | — |', catalogueRow: '| fixture | — | — |' }, llms: { rest: [] }, curation: [], api: () => ({ endpoints: {} }) },
  facts: { namespace: 'xx', periodStart: (y) => `${y}-01-01`, aliases: { 'xx/widgets/max': 'xx/widgets/limit' } },
  verify: [],
};
