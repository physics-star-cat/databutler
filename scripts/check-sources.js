#!/usr/bin/env node
/**
 * The Monday source check that persists its results (Verified Facts v0.3 `sourceCheckedAt` and the source-changed
 * test, docs/FACTS_PROTOCOL.md §4, §5.3). Run by .github/workflows/watch-sources.yml, which commits the file: a
 * Vercel cron cannot commit, and the serving code only reads committed data.
 *
 *   node scripts/check-sources.js          fetch every watched source page, write data/source-checks.json
 *   node scripts/check-sources.js --dry    fetch and report; write nothing
 *
 * data/source-checks.json is { <url>: { checkedAt, contentHash, updatedAt?, changedAt?, lastFailure? } }, sorted by URL:
 *   checkedAt    the newest day the page was fetched successfully (the record's sourceCheckedAt)
 *   contentHash  the body hash of that fetch (gov.uk: the content API's body; elsewhere the stripped HTML — api/_sources.js)
 *   updatedAt    gov.uk's public_updated_at, when the page has one
 *   changedAt    the first check that saw the page differ from the baseline data/sources.json (written by
 *                scripts/sources.js when the data was last re-verified), or differ from the previous check; absent
 *                while the page matches the baseline. A record whose verifiedDate is before changedAt is served stale.
 *   lastFailure  { at, error } when the newest attempt failed; checkedAt and the rest keep the last success
 * Never a guessed date: a page that has never been fetched has no entry. Pages recorded or declared unreachable
 * (403, CAPTCHA) are skipped, as the Monday cron skips them. This script files no issues — the Vercel cron
 * (api/_routes/cron/watch-sources.js) keeps doing that.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/source-checks.json');
const today = () => new Date().toISOString().slice(0, 10);

const sameContent = (a, b) => Boolean(a && b) && (a.contentHash ?? a.bodyHash) === (b.contentHash ?? b.bodyHash) && (a.updatedAt || null) === (b.updatedAt || null);

/**
 * Pure: the next data/source-checks.json from the previous one, the baseline and this run's results.
 *   prev      { <url>: entry } — the committed file ({} on the first run)
 *   baseline  [{ url, bodyHash, updatedAt, unreachable? }] — data/sources.json
 *   results   [{ url, ok: true, contentHash, updatedAt } | { url, ok: false, error }]
 *   watched   the URLs still watched (entries for any other URL are dropped)
 */
function nextChecks(prev, baseline, results, day, watched = results.map((r) => r.url)) {
  const base = new Map((baseline || []).filter((s) => s && s.url && !s.unreachable).map((s) => [s.url, s]));
  const out = {};
  const keep = new Set(watched);
  for (const [url, e] of Object.entries(prev || {})) if (keep.has(url)) out[url] = e;
  for (const r of results) {
    const was = (prev || {})[r.url];
    if (!r.ok) {
      if (was) out[r.url] = { ...was, lastFailure: { at: day, error: String(r.error || 'failed').slice(0, 200) } };
      continue; // never invent a checkedAt for a page that has not been fetched
    }
    const current = { contentHash: r.contentHash, updatedAt: r.updatedAt || null };
    const b = base.get(r.url);
    let changedAt = null;
    if (b && !sameContent(current, b)) {
      // differs from the baseline: keep the first day we saw it, unless it moved again since the last check
      changedAt = was && was.changedAt && sameContent(current, was) ? was.changedAt : day;
    } else if (!b && was && !sameContent(current, was)) {
      changedAt = day; // no baseline: a change between two checks is still a change
    } else if (!b && was && was.changedAt) {
      changedAt = was.changedAt;
    }
    out[r.url] = { checkedAt: day, contentHash: current.contentHash, ...(current.updatedAt ? { updatedAt: current.updatedAt } : {}), ...(changedAt ? { changedAt } : {}) };
  }
  return Object.fromEntries(Object.keys(out).sort().map((u) => [u, out[u]]));
}

const serialise = (checks) => `${JSON.stringify(checks, null, 2)}\n`;

async function run({ dry = false, checkSource = require('../api/_sources').checkSource, day = today() } = {}) {
  const { sourceList } = require('../api/_areas');
  const { watchPlan } = require('../api/_sources');
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sources.json'), 'utf8'));
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const { check: urls, skipped } = watchPlan(sourceList(), baseline);
  const results = [];
  // a few at a time: the official sites are small and some throttle bursts
  for (let i = 0; i < urls.length; i += 6) {
    results.push(...await Promise.all(urls.slice(i, i + 6).map(async (url) => {
      try {
        const c = await checkSource(url);
        return { url, ok: true, contentHash: c.bodyHash, updatedAt: c.updatedAt };
      } catch (e) {
        return { url, ok: false, error: e.message };
      }
    })));
  }
  const next = nextChecks(prev, baseline, results, day, urls);
  const changed = Object.entries(next).filter(([u, e]) => e.changedAt === day && !(prev[u] && prev[u].changedAt === day)).map(([u]) => u);
  const failed = results.filter((r) => !r.ok);
  const summary = `check-sources: ${results.length - failed.length}/${urls.length} fetched, ${failed.length} failed, ${skipped.length} unreachable skipped, ${changed.length} newly changed since the baseline`;
  if (!dry) fs.writeFileSync(OUT, serialise(next));
  return { next, changed, failed, skipped, summary };
}

if (require.main === module) {
  run({ dry: process.argv.includes('--dry') }).then((r) => {
    console.log(r.summary);
    for (const u of r.changed) console.log(`  changed: ${u}`);
    for (const f of r.failed) console.log(`  failed:  ${f.url} — ${f.error}`);
  }, (e) => { console.error(e); process.exit(1); });
}

module.exports = { nextChecks, run, serialise, OUT };
