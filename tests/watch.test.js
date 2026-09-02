const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke } = require('./helpers');
const watch = require('../api/cron/watch-sources');

test('cron rejects missing/wrong secret and refuses to run with no secret configured', async () => {
  const prev = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  assert.equal((await invoke(watch, undefined, { method: 'GET', url: '/api/cron/watch-sources' })).status, 401);
  process.env.CRON_SECRET = 's3cret';
  assert.equal((await invoke(watch, undefined, { method: 'GET', url: '/api/cron/watch-sources', headers: { authorization: 'Bearer wrong' } })).status, 401);
  if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev;
});
