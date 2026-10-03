const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const frontDoor = require('../api/_routes/mcp');
const changes = require('../api/_routes/changes');
const { ALL_TOOLS } = require('../api/_registry');

const ORDER = ['uk_rates_lookup', 'exam_topic_paper', 'domain_provenance', 'package_provenance', 'take_home_pay', 'what_changed_since', 'coverage', 'catalogue', 'call'];

test('front door lists exactly the 9 tools, in order, with clean defs', async () => {
  const r = await rpc(frontDoor, 'tools/list');
  assert.deepEqual(r.body.result.tools.map((t) => t.name), ORDER);
  for (const t of r.body.result.tools) assert.deepEqual(Object.keys(t).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title']);
  const init = await rpc(frontDoor, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.body.result.serverInfo.name, 'databutler');
  assert.match(init.body.result.instructions, /what_changed_since/);
});

test('what_changed_since: valid date returns the shape; bad date is a near-miss', async () => {
  const ok = await callTool(frontDoor, 'what_changed_since', { since: '2026-06-01' });
  assert.equal(ok.isError, false);
  assert.equal(ok.data.since, '2026-06-01');
  assert.ok(Array.isArray(ok.data.entries));
  assert.equal(ok.data.freshness.staleness, 'live');
  assert.equal(ok.data.cite.url, 'https://databutler.dev/r/changes?since=2026-06-01&area=all');
  const bad = await callTool(frontDoor, 'what_changed_since', { since: 'last year' });
  assert.equal(bad.isError, false);
  assert.equal(bad.data.covered, false);
});

test('coverage tool', async () => {
  const { data } = await callTool(frontDoor, 'coverage', { area: 'uk-exams' });
  assert.equal(data.area, 'uk-exams');
  assert.ok(data.boards.aqa);
});

test('catalogue lists every registry tool and filters', async () => {
  const all = await callTool(frontDoor, 'catalogue', {});
  assert.equal(all.data.count, Object.keys(ALL_TOOLS).length);
  assert.ok(all.data.tools.every((t) => t.serverUrl && t.inputSchema && typeof t.listedAtFrontDoor === 'boolean'));
  const stats = await callTool(frontDoor, 'catalogue', { query: 'regression' });
  assert.deepEqual(stats.data.tools.map((t) => t.name), ['linear_regression']);
});

const SAMPLE = {
  uk_rates_lookup: { category: 'vat' },
  policy_rate: { bank: 'ecb' },
  exam_topic_paper: { topic: 'electricity', board: 'aqa', subject: 'physics' },
  exam_spec_lookup: { board: 'aqa', subject: 'physics' },
  exam_paper_index: { board: 'aqa' },
  descriptive_stats: { data: [1, 2, 3, 4] },
  distribution: { dist: 'normal', at: 1.96 },
  hypothesis_test: { test: 'one-sample-t', data: [1, 2, 3, 4, 5], mu0: 3 },
  confidence_interval: { kind: 'proportion', successes: 40, n: 100 },
  bayes_update: { hypotheses: [{ name: 'a', prior: 0.5, likelihood: 0.9 }, { name: 'b', prior: 0.5, likelihood: 0.1 }] },
  linear_regression: { x: [1, 2, 3, 4], y: [2, 4, 6, 8] },
};

test('call reaches every non-network registry tool with the inner envelope', async () => {
  for (const [name, args] of Object.entries(SAMPLE)) {
    const { isError, data } = await callTool(frontDoor, 'call', { tool: name, arguments: args });
    assert.equal(isError, false, name);
    assert.equal(data.covered, undefined, `${name} should be covered`);
    assert.ok(data.cite && data.cite.url.startsWith('https://databutler.dev/r/'), `${name} cite`);
    assert.equal(data.freshness.staleness, ALL_TOOLS[name].freshness === 'live' ? 'live' : data.freshness.staleness);
  }
  // network tools exist in the registry even though we don't call them here
  assert.ok(ALL_TOOLS.domain_provenance && ALL_TOOLS.package_provenance && ALL_TOOLS.take_home_pay);
});

test('call with an unknown tool is a near-miss naming the closest tools, with a cite to the catalogue', async () => {
  const { isError, data } = await callTool(frontDoor, 'call', { tool: 'linear_regresion', arguments: {} });
  assert.equal(isError, false);
  assert.equal(data.covered, false);
  assert.equal(data.nearest[0], 'linear_regression');
  assert.equal(data.cite.url, 'https://databutler.dev/r/catalogue');
});

test('exam_paper_index specs carry a source link back to the official spec page', async () => {
  const { data } = await callTool(frontDoor, 'call', { tool: 'exam_paper_index', arguments: { board: 'aqa' } });
  assert.ok(data.specs.length > 0);
  assert.ok(data.specs[0].source.startsWith('https://www.aqa.org.uk/'), data.specs[0].source);
});

test('GET /api/changes mirrors what_changed_since', async () => {
  const r = await invoke(changes, undefined, { method: 'GET', url: '/api/changes?since=2026-06-01&area=uk-rates' });
  assert.equal(r.status, 200);
  assert.equal(r.body.area, 'uk-rates');
  assert.equal(r.body.attribution, 'databutler.dev');
});
