// tests/router.test.js — the single /api/* function dispatches to every handler
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { invoke, rpc } = require('./helpers');
const router = require('../api/router');

const get = (url) => invoke(router, undefined, { method: 'GET', url });

test('router: every file under api/_routes is reachable and nothing else is a function', () => {
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) files.push(p);
    }
  })(path.join(__dirname, '../api/_routes'));
  const routes = files.map((f) => path.relative(path.join(__dirname, '../api/_routes'), f).replace(/\.js$/, '')).sort();
  assert.deepEqual(routes, Object.keys(router.ROUTES).sort());
  // Hobby plan: at most 12 functions. Only index.js and router.js may be functions.
  const fns = fs.readdirSync(path.join(__dirname, '../api')).filter((f) => f.endsWith('.js') && !f.startsWith('_'));
  assert.deepEqual(fns.sort(), ['index.js', 'router.js']);
});

test('router: ?route= from the rewrite reaches the handler with a clean URL', async () => {
  const r = await get('/api/router?route=uk/rates&category=vat');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.figures));
});

test('router: path-based fallback and trailing slash both resolve', async () => {
  assert.equal((await get('/api/uk/rates?category=vat')).status, 200);
  assert.equal((await get('/api/router?route=uk/rates/&category=vat')).status, 200);
});

test('router: /r/ permalink rewrite keeps ?path= for the citation handler', async () => {
  const r = await get('/api/router?route=r&path=uk/rates&category=income-tax');
  assert.equal(r.status, 200);
  assert.match(String(r.raw), /income-tax|Income tax/i);
});

test('router: MCP front door and a vertical answer JSON-RPC through the router', async () => {
  const a = await invoke(router, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { url: '/api/router?route=mcp' });
  assert.equal(a.status, 200);
  assert.ok(a.body.result.tools.some((t) => t.name === 'uk_rates_lookup'));
  const b = await invoke(router, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { url: '/api/router?route=mcp/vehicles' });
  assert.ok(b.body.result.tools.some((t) => t.name === 'uk_mot_reliability'));
});

test('router: unknown route is a JSON 404 pointing at /api', async () => {
  const r = await get('/api/router?route=nope');
  assert.equal(r.status, 404);
  assert.match(r.body.error, /unknown route/);
});

test('router: cron handler still refuses without the secret', async () => {
  const r = await get('/api/router?route=cron/watch-sources');
  assert.equal(r.status, 401);
});
