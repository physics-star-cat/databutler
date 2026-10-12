const test = require('node:test');
const assert = require('node:assert/strict');
const { planIssues, LABEL, ERR_TITLE } = require('../api/_github');

const changed = { url: 'https://www.gov.uk/vat-rates', status: 'changed', field: 'updatedAt', from: '2025-01-01', to: '2026-01-01' };
const same = { url: 'https://www.gov.uk/isa', status: 'same' };
const err = { url: 'https://www.aqa.org.uk/x', status: 'error', error: 'HTTP 403' };

test('planIssues: one issue per changed url, one combined error issue', () => {
  const plan = planIssues([changed, same, err], [], '2026-11-27');
  assert.equal(plan.length, 2);
  assert.equal(plan[0].title, 'source changed: /vat-rates (2026-11-27)');
  assert.match(plan[0].body, /2025-01-01.*2026-01-01/s);
  assert.match(plan[0].body, /scripts\/changelog\.js/);
  assert.deepEqual(plan[0].labels, [LABEL]);
  assert.equal(plan[1].title, ERR_TITLE);
  assert.match(plan[1].body, /HTTP 403/);
});

test('planIssues dedupes against open issues by url and by error title', () => {
  const open = [{ title: 'source changed: /vat-rates (2026-11-20)', body: '**URL:** https://www.gov.uk/vat-rates' }, { title: ERR_TITLE, body: '' }];
  assert.deepEqual(planIssues([changed, err], open, '2026-11-27'), []);
});

test('planIssues does not let a prefix-URL open issue suppress a change on a different URL', () => {
  const open = [{ title: 'source changed: /vat-rates/keeping-records (2026-11-20)', body: '**URL:** https://www.gov.uk/vat-rates/keeping-records' }];
  const plan = planIssues([changed], open, '2026-11-27');
  assert.equal(plan.length, 1);
  assert.equal(plan[0].title, 'source changed: /vat-rates (2026-11-27)');
});

test('planFactsIssue: one deduped issue while the facts self-check fails; none when it passes', () => {
  const { planFactsIssue, FACTS_TITLE } = require('../api/_github');
  const failing = { ok: false, declared: 'L3', reached: 'L2', results: [{ item: 15, level: 'L3', ok: false, detail: '3 unsigned' }] };
  const [issue] = planFactsIssue(failing, []);
  assert.equal(issue.title, FACTS_TITLE);
  assert.match(issue.body, /item 15 \(L3\): 3 unsigned/);
  assert.match(issue.body, /sign-facts\.js/);
  assert.deepEqual(planFactsIssue(failing, [{ title: FACTS_TITLE }]), []);
  assert.deepEqual(planFactsIssue({ ok: true, results: [] }, []), []);
});
