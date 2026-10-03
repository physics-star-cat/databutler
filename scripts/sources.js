#!/usr/bin/env node
/**
 * Refresh data/sources.json — the "last seen" state of every source page.
 * Run after every data refresh (scripts/changelog.js calls it) so the weekly
 * watcher goes quiet again. Network required.
 *   node scripts/sources.js            # all sources
 */
const fs = require('node:fs');
const path = require('node:path');
const { checkSource, sourceUrls } = require('../api/_sources');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/sources.json');

function allSourceUrls() {
  const dir = (d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, d, f), 'utf8')));
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/policy-rates.json'), 'utf8'));
  return sourceUrls({ rates: dir('data/uk/rates'), exams: dir('data/uk/exams'), policy: [policy] });
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
  const merged = urls.map((u) => byUrl.get(u)).filter(Boolean);
  fs.writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n');
  console.log(`sources.json: ${fresh.length}/${urls.length} checked OK, ${merged.length} entries written`);
  return merged;
}

if (require.main === module) refreshSources().catch((e) => { console.error(e); process.exit(1); });

module.exports = { refreshSources, allSourceUrls };
