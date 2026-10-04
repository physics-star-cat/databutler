#!/usr/bin/env node
/**
 * Refresh data/sources.json — the "last seen" state of every source page.
 * Run after every data refresh (scripts/changelog.js calls it) so the weekly
 * watcher goes quiet again. Network required.
 *   node scripts/sources.js            # all sources
 * refreshSources(urls) with a subset (scripts/changelog.js --only <area>) re-hashes
 * only those pages and keeps every other area's baseline as it was.
 *
 * A page that cannot be fetched (403, CAPTCHA, timeout) is recorded, not dropped:
 * `{ url, unreachable: '<reason>', checkedAt }` — the reason the area module declares on
 * its sources() entry, else the fetch error. The Monday cron skips those, and coverage and
 * docs/CURATION.md list them (node scripts/sync-areas.js). Every refresh retries them.
 */
const fs = require('node:fs');
const path = require('node:path');
const { checkSource } = require('../api/_sources');
const { sourceUrls: areaSourceUrls, sourceList } = require('../api/_areas');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/sources.json');

/** Every watched source page: each area module's sources() (api/_areas/<area>.js), deduped. */
function allSourceUrls() {
  return areaSourceUrls();
}

async function refreshSources(urls = allSourceUrls()) {
  const checkedAt = new Date().toISOString().slice(0, 10);
  const declared = new Map(sourceList().map((s) => [s.url, s.unreachable]));
  const results = await Promise.all(urls.map(async (url) => {
    try {
      const ok = { ...(await checkSource(url)), checkedAt };
      if (declared.get(url)) console.log(`  ${url} fetched fine although its module declares it unreachable — drop \`unreachable\` there`);
      return ok;
    } catch (e) {
      const reason = declared.get(url) || e.message;
      console.error(`  ! ${url}: ${e.message} — recorded as unreachable ("${reason}"); the Monday watcher skips it`);
      return { url, unreachable: reason, checkedAt };
    }
  }));
  const fresh = results;
  const reachable = fresh.filter((r) => !r.unreachable).length;
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const byUrl = new Map(existing.map((e) => [e.url, e]));
  for (const e of fresh) byUrl.set(e.url, e);
  const merged = allSourceUrls().map((u) => byUrl.get(u)).filter(Boolean);
  fs.writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n');
  console.log(`sources.json: ${reachable}/${urls.length} checked OK, ${fresh.length - reachable} unreachable, ${merged.length} entries written`);
  return merged;
}

if (require.main === module) refreshSources().catch((e) => { console.error(e); process.exit(1); });

module.exports = { refreshSources, allSourceUrls };
