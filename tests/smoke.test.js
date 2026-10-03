// tests/smoke.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool } = require('./helpers');
const ukRates = require('../api/router').ROUTES['mcp/uk-rates'];

test('uk-rates: tools/list names one tool', async () => {
  const r = await rpc(ukRates, 'tools/list');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.result.tools.map((t) => t.name), ['uk_rates_lookup']);
});

test('uk-rates: vat lookup returns figures with source', async () => {
  const { isError, data } = await callTool(ukRates, 'uk_rates_lookup', { category: 'vat' });
  assert.equal(isError, false);
  assert.ok(Array.isArray(data.figures));
  assert.match(data.source, /^https:\/\/www\.gov\.uk\//);
});
