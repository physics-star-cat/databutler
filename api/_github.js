/** GitHub issues as the watcher's outbox. Needs GITHUB_TOKEN (issues: read/write on the repo). */
const REPO = 'physics-star-cat/databutler';
const LABEL = 'source-changed';
const ERR_TITLE = 'watcher could not check some sources';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function planIssues(results, openIssues, today = new Date().toISOString().slice(0, 10)) {
  const issues = [];
  const openText = openIssues.map((i) => `${i.title}\n${i.body || ''}`);
  for (const r of results.filter((x) => x.status === 'changed')) {
    const urlPattern = new RegExp(`\\*\\*URL:\\*\\* ${escapeRegex(r.url)}(\\n|$)`);
    if (openText.some((t) => urlPattern.test(t))) continue;
    issues.push({
      title: `source changed: ${new URL(r.url).pathname} (${today})`,
      labels: [LABEL],
      body:
        `**URL:** ${r.url}\n\n**${r.field}:** \`${r.from}\` → \`${r.to}\`\n\n` +
        'A figure may have moved. Open the page, update the data file against it, run ' +
        '`node scripts/changelog.js`, fill in the note, commit data/ (this refreshes sources.json and closes the loop). ' +
        'If nothing material changed, just run `node scripts/sources.js` and commit.',
    });
  }
  const errs = results.filter((x) => x.status === 'error');
  if (errs.length && !openIssues.some((i) => i.title === ERR_TITLE)) {
    issues.push({ title: ERR_TITLE, labels: [LABEL], body: errs.map((e) => `- ${e.url} — ${e.error}`).join('\n') });
  }
  return issues;
}

const FACTS_TITLE = 'Verified Facts conformance check failed';

/**
 * The Monday self-check (scripts/facts-check.js against https://databutler.dev): one issue while it fails, deduped by
 * title; nothing when it passes. A failure is an incident (spec §11 item 18).
 */
function planFactsIssue(report, openIssues) {
  if (!report || report.ok || openIssues.some((i) => i.title === FACTS_TITLE)) return [];
  const failed = report.results.filter((r) => !r.ok);
  return [{
    title: FACTS_TITLE,
    labels: [LABEL],
    body: `Declared ${report.declared || '?'}, reached ${report.reached || 'none'}.\n\n${failed.map((r) => `- item ${r.item} (${r.level}): ${r.detail}`).join('\n')}\n\n` +
      'Reproduce: `node scripts/facts-check.js https://databutler.dev --offline`. Unsigned data? `node scripts/sign-facts.js` (docs/CURATION.md "Signing and key rotation").',
  }];
}

const EXPECTED_TITLE = 'Re-verify: expected change passed';

/**
 * v0.3 (spec §11 item 18): one issue naming every record whose nextExpectedChange has passed unverified. Opened when
 * there is none, its body replaced when the list moved, nothing when the list is empty or unchanged.
 *   passed      — F.expectedChangesPassed(now, { area? })
 *   openIssues  — open issues with the watcher label (number, title, body)
 * → [] or [{ action: 'open', issue }] or [{ action: 'update', number, issue }]
 */
function planExpectedIssue(passed, openIssues, { scope = 'every area' } = {}) {
  if (!passed || !passed.length) return [];
  const byArea = new Map();
  for (const p of passed) byArea.set(p.area, [...(byArea.get(p.area) || []), p]);
  const body = [
    `${passed.length} served record(s) have a \`nextExpectedChange\` that is today or earlier and were last verified before it (checked: ${scope}). `
      + 'Until each is re-verified, Verified Facts serves it as `stale` with `staleReason: "expected-change-passed"` (the value is still returned).',
    '',
    ...[...byArea].flatMap(([area, list]) => [
      `**${area}** (${list.length})`,
      ...list.map((p) => `- \`${p.key}\` — expected change ${p.nextExpectedChange} (${p.changeCadence}), verified ${p.verifiedDate}`),
      '',
    ]),
    'Re-read each source, update the data file (for policy rates: the level, `effectiveFrom`, `verifiedDate` and the next `nextDecision`), '
      + 'run `node scripts/changelog.js` and `node scripts/sign-facts.js`, and commit. The issue updates itself; close it once the list is empty.',
  ].join('\n');
  const issue = { title: EXPECTED_TITLE, labels: [LABEL], body };
  const open = openIssues.find((i) => i.title === EXPECTED_TITLE);
  if (!open) return [{ action: 'open', issue }];
  if (String(open.body || '').trim() === body.trim()) return [];
  return [{ action: 'update', number: open.number, issue }];
}

async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'User-Agent': 'databutler-watcher', 'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} on ${path}`);
  return r.json();
}

const listOpenIssues = () => gh(`/issues?state=open&labels=${LABEL}&per_page=100`);
const openIssue = (issue) => gh('/issues', { method: 'POST', body: JSON.stringify(issue) });
const updateIssue = (number, issue) => gh(`/issues/${number}`, { method: 'PATCH', body: JSON.stringify({ body: issue.body }) });

/** Carry out planExpectedIssue's plan. → the titles touched. */
async function applyExpectedPlan(plan) {
  const done = [];
  for (const p of plan) {
    if (p.action === 'open') await openIssue(p.issue);
    else if (p.action === 'update') await updateIssue(p.number, p.issue);
    done.push(`${p.action}: ${p.issue.title}`);
  }
  return done;
}

module.exports = {
  planFactsIssue, FACTS_TITLE, planIssues, listOpenIssues, openIssue, updateIssue, LABEL, ERR_TITLE, REPO,
  planExpectedIssue, applyExpectedPlan, EXPECTED_TITLE,
};
