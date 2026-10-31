#!/usr/bin/env node
/**
 * Re-check every listed Verified Facts publisher (data/publishers.json) with the public conformance checker and write
 * data/publisher-checks.json, which /facts/publishers renders with level badges (api/_routes/publishers.js). Run on
 * Mondays by .github/workflows/watch-sources.yml, which commits the file.
 *
 *   node scripts/check-publishers.js          check every publisher, write the file
 *   node scripts/check-publishers.js --dry    check and print; write nothing
 *
 * Each check is offline (the official source pages are not fetched — item 4 is the publisher's own business) and
 * samples 25 keys. data/publisher-checks.json is { <facts.json URL>: { checkedAt, protocol, declared, reached, ok,
 * count, failed: [{ item, level, detail }] } or { checkedAt, error } when the check could not run }. Requests to
 * databutler.dev carry the owner marker, so the weekly self-check never counts as agent usage (api/_track.js).
 */
const fs = require('node:fs');
const path = require('node:path');
const { checkSite } = require('./facts-check');

const ROOT = path.resolve(__dirname, '..');
const LIST = path.join(ROOT, 'data/publishers.json');
const OUT = path.join(ROOT, 'data/publisher-checks.json');
const OWN = 'databutler.dev';

/** The site a facts.json URL belongs to: everything before /.well-known/facts.json. */
const siteOf = (factsUrl) => String(factsUrl).replace(/\/\.well-known\/facts\.json$/, '');

/** fetch with the owner marker on Data Butler's own host (analytics only; grants nothing). */
const markedFetch = (fetchFn) => (url, init = {}) => (new URL(url).hostname === OWN
  ? fetchFn(url, { ...init, headers: { ...(init.headers || {}), 'x-databutler-owner': '1' } })
  : fetchFn(url, init));

async function checkOne(entry, { fetchFn = fetch, now = new Date() } = {}) {
  const day = now.toISOString().slice(0, 10);
  const f = markedFetch(fetchFn);
  try {
    const wk = await f(entry.facts, { headers: { accept: 'application/json' } });
    let doc = null;
    try { doc = JSON.parse(await wk.text()); } catch { /* reported by the checker */ }
    const report = await checkSite(siteOf(entry.facts), { fetchFn: f, offline: true, sample: 25, now });
    return {
      checkedAt: day,
      protocol: (doc && doc.protocol) || null,
      declared: report.declared,
      reached: report.reached,
      ok: report.ok,
      count: doc && doc.facts && Number.isInteger(doc.facts.count) ? doc.facts.count : null,
      failed: report.results.filter((r) => !r.ok).map((r) => ({ item: r.item, level: r.level, detail: String(r.detail).slice(0, 300) })),
    };
  } catch (e) {
    return { checkedAt: day, error: String(e.message || e).slice(0, 300) };
  }
}

async function run({ dry = false, fetchFn = fetch, now = new Date(), list = JSON.parse(fs.readFileSync(LIST, 'utf8')) } = {}) {
  const out = {};
  for (const p of list.publishers) out[p.facts] = await checkOne(p, { fetchFn, now });
  const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
  if (!dry) fs.writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`);
  return sorted;
}

if (require.main === module) {
  run({ dry: process.argv.includes('--dry') }).then((r) => {
    for (const [url, c] of Object.entries(r)) console.log(`${url}: ${c.error ? `error ${c.error}` : `${c.protocol}, declared ${c.declared}, reached ${c.reached || 'none'}${c.failed.length ? ` (${c.failed.length} failing)` : ''}`}`);
  }, (e) => { console.error(e); process.exit(1); });
}

module.exports = { run, checkOne, siteOf, OUT, LIST };
