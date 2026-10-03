#!/usr/bin/env node
/**
 * Refresh data/sources.json — the "last seen" state of every source page.
 * Run after every data refresh (scripts/changelog.js calls it) so the weekly
 * watcher goes quiet again. Network required.
 *   node scripts/sources.js            # all sources
 * refreshSources(urls) with a subset (scripts/changelog.js --only <area>) re-hashes
 * only those pages and keeps every other area's baseline as it was.
 */
const fs = require('node:fs');
const path = require('node:path');
const { checkSource } = require('../api/_sources');
const { sourceUrls: areaSourceUrls } = require('../api/_areas');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/sources.json');

/** Every watched source page: each area module's sources() (api/_areas/<area>.js), deduped. */
function allSourceUrls() {
  return areaSourceUrls();
}

async function refreshSources(urls = allSourceUrls()) {
  const checkedAt = new Date().toISOString().slice(0, 10);
  const results = await Promise.all(urls.map(async (url) => {
    try {
      return { ...(await checkSource(url)), checkedAt };
    } catch (e) {
      console.error(`  ! ${url}: ${e.message}`);
      return null;
    }
  }));
  const fresh = results.filter(Boolean);
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const byUrl = new Map(existing.map((e) => [e.url, e]));
  for (const e of fresh) byUrl.set(e.url, e);
  const merged = allSourceUrls().map((u) => byUrl.get(u)).filter(Boolean);
  fs.writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n');
  console.log(`sources.json: ${fresh.length}/${urls.length} checked OK, ${merged.length} entries written`);
  return merged;
}

if (require.main === module) refreshSources().catch((e) => { console.error(e); process.exit(1); });

module.exports = { refreshSources, allSourceUrls };
