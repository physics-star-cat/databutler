/**
 * Weekly: has any source page changed since data/sources.json was written?
 * Never edits data — files a GitHub issue per changed URL (deduped) and one
 * combined issue for URLs it could not check. Pages recorded (or declared) as
 * `unreachable` — 403 or CAPTCHA to a non-browser fetch — are skipped and listed
 * under `skipped`, never filed as errors. ?dry=1 reports without filing.
 * Then it runs the Verified Facts conformance checker against the live site (scripts/facts-check.js, offline
 * items skipped, 25 sampled keys) and files one issue while that fails (spec §11 item 18).
 * Vercel cron sends Authorization: Bearer $CRON_SECRET.
 */
const { sendJson } = require('../../_lib');
const SEEN = require('../../../data/sources.json');
const { checkSource, compareSource, watchPlan } = require('../../_sources');
const { sourceList } = require('../../_areas');
const { planIssues, planFactsIssue, listOpenIssues, openIssue } = require('../../_github');
const { checkSite } = require('../../../scripts/facts-check');

const SITE = 'https://databutler.dev';

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  if (!secret || auth !== `Bearer ${secret}`) return sendJson(res, 401, { error: 'unauthorised' });

  const dry = new URL(req.url, 'https://databutler.dev').searchParams.get('dry') === '1';
  // every area module's sources(), deduped, minus the pages recorded/declared unreachable
  const { check: urls, skipped } = watchPlan(sourceList(), SEEN);
  const seenByUrl = Object.fromEntries(SEEN.map((s) => [s.url, s]));

  const results = await Promise.all(urls.map(async (url) => {
    try {
      const current = await checkSource(url);
      return { url, ...compareSource(seenByUrl[url], current) };
    } catch (e) {
      return { url, status: 'error', error: e.message };
    }
  }));

  let facts;
  try {
    const report = await checkSite(SITE, { offline: true, sample: 25 });
    facts = { declared: report.declared, reached: report.reached, ok: report.ok, failed: report.results.filter((r) => !r.ok) };
  } catch (e) {
    facts = { ok: false, declared: null, reached: null, failed: [{ item: 0, level: '-', ok: false, detail: `checker crashed: ${e.message}` }] };
  }

  let issues = [];
  const filed = [];
  let filing = null;
  try {
    const open = dry ? [] : await listOpenIssues();
    issues = [...planIssues(results, open), ...planFactsIssue({ ...facts, results: facts.failed }, open)];
    if (!dry) for (const issue of issues) {
      await openIssue(issue);
      filed.push(issue.title);
    }
  } catch (e) {
    filing = e.message; // GitHub down / token missing / filing failed part-way: still report what we saw
  }

  sendJson(res, 200, {
    dry,
    checked: urls.length,
    changed: results.filter((r) => r.status === 'changed'),
    unseen: results.filter((r) => r.status === 'new').map((r) => r.url),
    errors: results.filter((r) => r.status === 'error'),
    skipped: skipped.map(({ url, area, reason }) => ({ url, area, unreachable: reason })),
    factsCheck: facts,
    issuesPlanned: issues.map((i) => i.title),
    issuesFiled: filed,
    ...(filing ? { filingError: filing } : {}),
  });
};
