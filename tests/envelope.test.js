const test = require('node:test');
const assert = require('node:assert/strict');
const { callTool } = require('./helpers');
const { withEnvelope, findSource } = require('../api/_envelope');
const { makeMcpHandler } = require('../api/_mcp');
const { ALL_TOOLS } = require('../api/_registry');

test('withEnvelope adds freshness, cite and attribution for a dataset tool', () => {
  const tool = ALL_TOOLS.uk_rates_lookup;
  const out = withEnvelope(tool, { category: 'vat' }, tool.run({ category: 'vat' }));
  assert.equal(out.freshness.verifiedDate, '2026-08-31');
  assert.ok(['fresh', 'due', 'overdue'].includes(out.freshness.staleness));
  assert.equal(out.cite.url, 'https://databutler.dev/r/uk/rates?category=vat');
  assert.match(out.cite.text, /^databutler\.dev, verified 2026-08-31 against https:\/\/www\.gov\.uk\/vat-rates$/);
  assert.equal(out.attribution, 'databutler.dev');
});

test('withEnvelope: live tool, JSON-encoded non-string query values, empty values dropped', () => {
  const tool = ALL_TOOLS.distribution;
  const args = { dist: 'normal', at: 1.96, p: undefined };
  const out = withEnvelope(tool, args, tool.run(args));
  assert.equal(out.freshness.staleness, 'live');
  assert.equal(out.cite.url, 'https://databutler.dev/r/stats?op=distribution&dist=normal&at=1.96');
  assert.match(out.cite.text, /computed live \d{4}-\d{2}-\d{2}$/);
});

test('withEnvelope never throws: a broken cite falls back to bare result + attribution', () => {
  const tool = { name: 'x', freshness: 'uk-rates', cite: () => { throw new Error('boom'); } };
  const out = withEnvelope(tool, {}, { a: 1 });
  assert.equal(out.a, 1);
  assert.equal(out.attribution, 'databutler.dev');
  assert.equal(out.cite, undefined);
});

test('findSource walks nested results', () => {
  assert.equal(findSource({ results: [{ source: 'https://x' }] }), 'https://x');
  assert.equal(findSource({ specs: [{ specUrl: 'https://y' }] }), 'https://y');
  assert.equal(findSource({ n: 1 }), null);
});

test('_mcp: tools/call carries the envelope, and delegate runs the inner tool', async () => {
  const inner = { name: 'inner', description: 'd', inputSchema: { type: 'object' }, freshness: 'live', cite: (a) => ({ path: 'stats', query: { op: 'x', v: a.v } }), run: (a) => ({ got: a.v }) };
  const outer = { name: 'outer', description: 'd', inputSchema: { type: 'object' }, freshness: 'live', run: () => ({ never: true }) };
  outer.delegate = (a) => ({ tool: inner, args: { v: a.value } });
  const h = makeMcpHandler({ serverName: 't', instructions: '', tools: [outer, inner] });
  const { isError, data } = await callTool(h, 'outer', { value: 7 });
  assert.equal(isError, false);
  assert.equal(data.got, 7);
  assert.equal(data.cite.url, 'https://databutler.dev/r/stats?op=x&v=7');
  assert.equal(data.freshness.staleness, 'live');
});
