const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke } = require('./helpers');

const get = (handler, url) => invoke(handler, undefined, { method: 'GET', url });

test('REST rates/topic/specs/papers/stats carry freshness + cite', async () => {
  const cases = [
    [require('../api/router').ROUTES['uk/rates'], '/api/uk/rates?category=vat', 'https://databutler.dev/r/uk/rates?category=vat'],
    [require('../api/router').ROUTES['uk/exams/topic'], '/api/uk/exams/topic?topic=electricity&board=aqa&subject=physics', 'https://databutler.dev/r/uk/exams/topic?topic=electricity&board=aqa&subject=physics'],
    [require('../api/router').ROUTES['uk/exams/specs'], '/api/uk/exams/specs?board=aqa', 'https://databutler.dev/r/uk/exams/specs?board=aqa'],
    [require('../api/router').ROUTES['uk/exams/papers'], '/api/uk/exams/papers?board=aqa', 'https://databutler.dev/r/uk/exams/papers?board=aqa'],
    [require('../api/_routes/stats'), '/api/stats?op=distribution&dist=normal&at=1.96', 'https://databutler.dev/r/stats?op=distribution&dist=normal&at=1.96'],
  ];
  for (const [h, url, cite] of cases) {
    const r = await get(h, url);
    assert.equal(r.status, 200, url);
    assert.ok(r.body.freshness, `${url} freshness`);
    assert.equal(r.body.cite.url, cite);
    assert.equal(r.body.attribution, 'databutler.dev');
  }
});

test('REST topic still 400s without ?topic=', async () => {
  const r = await get(require('../api/router').ROUTES['uk/exams/topic'], '/api/uk/exams/topic');
  assert.equal(r.status, 400);
});
