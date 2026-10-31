// Owner marker (api/_track.js): separates the owner's own calls from everyone else's in GA4.
const test = require('node:test');
const assert = require('node:assert/strict');
const { callerParams, trackEvent } = require('../api/_track');

const UA = { 'user-agent': 'claude-code/2.0' };

test('a call with the marker is labelled owner and keeps its client class', () => {
  const p = callerParams({ headers: { ...UA, 'x-databutler-owner': '1' } });
  assert.equal(p.agent_owner, 'owner');
  assert.equal(p.agent_client, 'claude');
});

test('a call without the marker is labelled unmarked', () => {
  assert.equal(callerParams({ headers: UA }).agent_owner, 'unmarked');
  assert.equal(callerParams(undefined).agent_owner, 'unmarked');
});

test('any other marker value is not treated as the owner', () => {
  assert.equal(callerParams({ headers: { 'x-databutler-owner': 'yes' } }).agent_owner, 'unmarked');
});

test('the label reaches the GA4 payload', async (t) => {
  process.env.GA4_MEASUREMENT_ID = 'G-TEST';
  process.env.GA4_MP_API_SECRET = 'test';
  t.after(() => {
    delete process.env.GA4_MEASUREMENT_ID;
    delete process.env.GA4_MP_API_SECRET;
  });
  let body;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true };
  });
  await trackEvent('agent_api_test', { headers: { ...UA, 'x-databutler-owner': '1' } });
  assert.equal(body.events[0].name, 'agent_api_test');
  assert.equal(body.events[0].params.agent_owner, 'owner');
});
