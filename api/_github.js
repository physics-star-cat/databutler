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

module.exports = { planIssues, listOpenIssues, openIssue, LABEL, ERR_TITLE, REPO };
