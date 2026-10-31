#!/usr/bin/env node
/**
 * List every served Verified Facts record whose nextExpectedChange is today or earlier and that was not verified since
 * (v0.3, docs/FACTS_PROTOCOL.md §11 item 18) — the refresh list for a scheduled decision or change date that passed.
 *
 *   node scripts/expected-changes.js                      print the list (all areas)
 *   node scripts/expected-changes.js --area policy-rates  one area (the daily run: decisions land mid-week)
 *   node scripts/expected-changes.js --issue              also open, or update, the one GitHub issue
 *                                                         "Re-verify: expected change passed" (needs GITHUB_TOKEN)
 *   --strict                                              exit 1 when the list is not empty
 *
 * Run daily for policy-rates and on Mondays for every area by .github/workflows/watch-sources.yml; the Vercel cron
 * (api/_routes/cron/watch-sources.js) runs the same check on Mondays.
 */
const F = require('../api/_facts');
const { planExpectedIssue, applyExpectedPlan, listOpenIssues } = require('../api/_github');

const arg = (argv, name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };

async function main(argv = process.argv.slice(2), { now = new Date(), facts = F, github = { listOpenIssues, applyExpectedPlan } } = {}) {
  const area = arg(argv, '--area');
  const passed = facts.expectedChangesPassed(now, { area });
  console.log(`expected-changes: ${passed.length} record(s) past their nextExpectedChange and not re-verified${area ? ` (${area})` : ''}`);
  for (const p of passed) console.log(`  ${p.key}  expected ${p.nextExpectedChange}, verified ${p.verifiedDate} (${p.area})`);
  if (argv.includes('--issue')) {
    // the daily single-area run only adds to an existing all-area list, so it reads the full list for the body
    const all = area ? facts.expectedChangesPassed(now) : passed;
    const plan = planExpectedIssue(all, await github.listOpenIssues(), { scope: 'every area' });
    const done = await github.applyExpectedPlan(plan);
    console.log(done.length ? `expected-changes: ${done.join('; ')}` : 'expected-changes: issue up to date (or nothing to report)');
  }
  return argv.includes('--strict') && passed.length ? 1 : 0;
}

if (require.main === module) main().then((c) => process.exit(c), (e) => { console.error(`expected-changes: ${e.message}`); process.exit(1); });

module.exports = { main };
