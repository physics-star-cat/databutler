const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc } = require('./helpers');

test('registry: 12 tools across 4 servers, each with freshness + server url', () => {
  const { SERVERS, ALL_TOOLS } = require('../api/_registry');
  assert.deepEqual(Object.keys(SERVERS), ['uk-rates', 'uk-exams', 'provenance', 'stats']);
  assert.equal(Object.keys(ALL_TOOLS).length, 12);
  for (const t of Object.values(ALL_TOOLS)) {
    assert.ok(['uk-rates', 'uk-exams', 'live'].includes(t.freshness), `${t.name} freshness`);
    assert.match(t.serverUrl, /^https:\/\/databutler\.dev\/api\/mcp\//);
    assert.equal(typeof t.run, 'function');
  }
});

test('registry: per-vertical servers list the same tool names as before, no extra keys', async () => {
  const expected = {
    'uk-rates': ['uk_rates_lookup'],
    'uk-exams': ['exam_topic_paper', 'exam_spec_lookup', 'exam_paper_index'],
    provenance: ['domain_provenance', 'package_provenance'],
    stats: ['descriptive_stats', 'distribution', 'hypothesis_test', 'confidence_interval', 'bayes_update', 'linear_regression'],
  };
  for (const [key, names] of Object.entries(expected)) {
    const handler = require(`../api/mcp/${key}`);
    const r = await rpc(handler, 'tools/list');
    assert.deepEqual(r.body.result.tools.map((t) => t.name), names, key);
    for (const t of r.body.result.tools) {
      assert.deepEqual(Object.keys(t).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title'], `${t.name} leaks keys`);
    }
  }
});
