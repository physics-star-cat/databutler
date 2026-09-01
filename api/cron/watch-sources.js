/**
 * Weekly: has any source page changed since data/sources.json was written?
 * Never edits data — files a GitHub issue per changed URL (deduped) and one
 * combined issue for URLs it could not check. ?dry=1 reports without filing.
 * Vercel cron sends Authorization: Bearer $CRON_SECRET.
 */
const { sendJson, RATES } = require('../_lib');
const AQA_GCSE = require('../../data/uk/exams/aqa-gcse.json');
const SEEN = require('../../data/sources.json');
const { checkSource, sourceUrls, compareSource } = require('../_sources');
const { planIssues, listOpenIssues, openIssue } = require('../_github');

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  if (!secret || auth !== `Bearer ${secret}`) return sendJson(res, 401, { error: 'unauthorised' });

  const dry = new URL(req.url, 'https://databutler.dev').searchParams.get('dry') === '1';
  const urls = sourceUrls({ rates: [RATES], exams: [AQA_GCSE] });
  const seenByUrl = Object.fromEntries(SEEN.map((s) => [s.url, s]));

  const results = await Promise.all(urls.map(async (url) => {
    try {
      const current = await checkSource(url);
      return { url, ...compareSource(seenByUrl[url], current) };
    } catch (e) {
      return { url, status: 'error', error: e.message };
    }
  }));

  let issues = [];
  const filed = [];
  let filing = null;
  try {
    const open = dry ? [] : await listOpenIssues();
    issues = planIssues(results, open);
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
    issuesPlanned: issues.map((i) => i.title),
    issuesFiled: filed,
    ...(filing ? { filingError: filing } : {}),
  });
};
