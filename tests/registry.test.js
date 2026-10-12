const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc } = require('./helpers');

test('registry: one server per area module with a server, every tool with a known freshness key + server url', () => {
  const { SERVERS, ALL_TOOLS } = require('../api/_registry');
  const { AREAS } = require('../api/_areas');
  const { DATASETS } = require('../api/_freshness');
  assert.deepEqual(Object.keys(SERVERS), AREAS.filter((a) => a.server).map((a) => a.area));
  assert.ok(Object.keys(SERVERS).length >= 8, 'the eight original servers are still there');
  assert.equal(Object.keys(ALL_TOOLS).length, AREAS.reduce((n, a) => n + (a.server ? a.server.tools.length : 0), 0));
  assert.ok(Object.keys(ALL_TOOLS).length >= 25);
  for (const t of Object.values(ALL_TOOLS)) {
    assert.ok(t.freshness === 'live' || DATASETS[t.freshness], `${t.name} freshness "${t.freshness}" is a dataset key`);
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
    vehicles: ['uk_mot_reliability', 'uk_mot_vehicle_search', 'uk_recalls_for_model', 'uk_recalls_search', 'fr_recalls_for_model', 'fr_recalls_search', 'jp_recalls_for_model', 'jp_complaints_summary', 'eu_safety_gate_recalls'],
    tax: ['take_home_pay'],
    'software-eol': ['support_status', 'support_timeline'],
    'policy-rates': ['policy_rate'],
  };
  for (const [key, names] of Object.entries(expected)) {
    const handler = require('../api/router').ROUTES[`mcp/${key}`];
    const r = await rpc(handler, 'tools/list');
    assert.deepEqual(r.body.result.tools.map((t) => t.name), names, key);
    for (const t of r.body.result.tools) {
      assert.deepEqual(Object.keys(t).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title'], `${t.name} leaks keys`);
    }
  }
});

test('registry: the Verified Facts server (outside SERVERS) lists exactly its three tools, with clean defs', async () => {
  const { FACTS_SERVER } = require('../api/_hub');
  const r = await rpc(require('../api/router').ROUTES['mcp/facts'], 'tools/list');
  assert.deepEqual(r.body.result.tools.map((t) => t.name), FACTS_SERVER.tools.map((t) => t.name));
  for (const t of r.body.result.tools) assert.deepEqual(Object.keys(t).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title'], `${t.name} leaks keys`);
  assert.ok(!require('../api/_registry').SERVERS.facts, 'facts is not an area server');
});
