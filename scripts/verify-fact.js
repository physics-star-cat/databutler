#!/usr/bin/env node
/**
 * The reference Verified Facts verifier (docs/FACTS_PROTOCOL.md §8.5). Zero dependencies.
 *
 *   node scripts/verify-fact.js https://databutler.dev/f/uk/income-tax/personal-allowance
 *   node scripts/verify-fact.js record.json --jwks public/.well-known/jwks.json
 *
 * For a record: recompute the claim hash, find signature.kid in the JWK Set at signature.keys (or --jwks),
 * check it is not revoked before verifiedDate, verify the detached EdDSA JWS over the rebuilt attestation, and
 * check verifiedDate is not in the future — one line per check, exit 0 when all pass, 1 otherwise.
 * A batch document (results[]) verifies every record in it (misses are listed, not failed). An index (facts[])
 * carries no claim fields, so from a URL each entry's record is fetched from the publisher and verified;
 * from a file only the shape is reported.
 */
const fs = require('node:fs');
const path = require('node:path');
const { verifyRecord } = require('../api/_facts_sign');

const arg = (argv, name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const isUrl = (s) => /^https?:\/\//.test(String(s));

async function load(src) {
  if (isUrl(src)) {
    const r = await fetch(src, { headers: { accept: 'application/json', 'user-agent': 'verified-facts-verify/0.2' } });
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw new Error(`${src}: HTTP ${r.status}, not JSON`); }
  }
  return JSON.parse(fs.readFileSync(src, 'utf8'));
}

/** verify one record → { ok, lines } with a key cache shared across records. */
async function checkRecord(record, { jwks, jwksCache, now }) {
  let set = jwks;
  if (!set && record.signature && record.signature.keys) {
    const url = record.signature.keys;
    if (!jwksCache.has(url)) jwksCache.set(url, await load(url));
    set = jwksCache.get(url);
  }
  const res = verifyRecord(record, set || { keys: [] }, { now });
  return { ok: res.ok, lines: res.checks.map((c) => `  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(12)} ${c.detail}`) };
}

async function main(argv = process.argv.slice(2), { log = console.log, now = new Date() } = {}) {
  const src = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--jwks');
  if (!src) { log('usage: node scripts/verify-fact.js <url|file> [--jwks <path|url>]'); return 2; }
  const jwksSrc = arg(argv, '--jwks');
  const jwks = jwksSrc ? await load(isUrl(jwksSrc) ? jwksSrc : path.resolve(jwksSrc)) : null;
  const doc = await load(isUrl(src) ? src : path.resolve(src));
  const ctx = { jwks, jwksCache: new Map(), now };
  let records;
  if (Array.isArray(doc.results)) records = doc.results;
  else if (Array.isArray(doc.facts)) {
    if (!isUrl(src)) { log(`index with ${doc.facts.length} entries (no claim fields in an index — verify the records themselves)`); return 0; }
    const base = new URL(src);
    records = [];
    for (const e of doc.facts) records.push(await load(`${base.origin}/f/${e.key}`));
    const drift = records.filter((r, i) => r.hash !== doc.facts[i].hash).map((r) => r.key);
    if (drift.length) log(`index hash differs from the record for: ${drift.join(', ')}`);
  } else records = [doc];
  let ok = true;
  for (const r of records) {
    if (r.covered === false) { log(`${r.requestedKey || r.key}: miss (${r.error || r.message || 'not covered'}) — skipped`); continue; }
    const res = await checkRecord(r, ctx);
    ok = ok && res.ok;
    log(`${res.ok ? 'VERIFIED' : 'FAILED  '} ${r.key}${r.period ? ` (${r.period})` : ''} = ${JSON.stringify(r.value)}${r.unit ? ` ${r.unit}` : ''}`);
    for (const l of res.lines) log(l);
  }
  return ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (e) => { console.error(`verify-fact: ${e.message}`); process.exit(1); });
}

module.exports = { main };
