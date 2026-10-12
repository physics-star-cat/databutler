#!/usr/bin/env node
/**
 * Verified Facts at L1 for a site with no server (docs/FACTS_PROTOCOL.md §11 L1; FACTS_ADOPTION_PLAN.md #5):
 * one input file → the static files a sister site commits under public/.
 *
 *   node scripts/facts-static.js facts-source.json --out public [--key <private JWK or PEM> --kid db-2026-10 --jwks <jwks.json>]
 *
 * Input (facts-source.json): { publisher: { name, url }, namespaces: [{ name, description, cadence, authorities }],
 *   licence, contact, changes: '<changes.json URL>', facts: [{ key, label, value, unit, period, effectiveFrom,
 *   effectiveTo, source, sourceType?, quote?, verifiedDate, nextScheduledRefresh?, previous?, aliases?, scope? }] }
 * Output: .well-known/facts.json (conformance L1, filtering client; L3 when signed), f/index.json and one
 * f/<key>.json per fact (+ .well-known/jwks.json when --jwks is given). Records carry hash (and signature with
 * --key); status/ageDays/maxAgeDays are absent — the consumer computes them from verifiedDate. Deterministic:
 * a rebuild of the same input is byte-identical. Every source must sit on a host its namespace declares.
 *
 * Vendor into the sister repo: api/_jcs.js, api/_facts_sign.js, api/_schema_check.js, public/schema/fact.v0.json,
 * public/schema/well-known-facts.v0.json and this script; check the output with scripts/facts-check.js.
 */
const fs = require('node:fs');
const path = require('node:path');
const { hashOf, attestationOf, signAttestation, privateKeyFrom } = require('../api/_facts_sign');
const { validate } = require('../api/_schema_check');

const ROOT = path.resolve(__dirname, '..');
const FACT_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/schema/fact.v0.json'), 'utf8'));
const WK_SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/schema/well-known-facts.v0.json'), 'utf8'));
const PROTOCOL = 'verified-facts/0.2';
const KEY = /^[a-z][a-z0-9-]*(\/[a-z0-9][a-z0-9.-]*){1,5}$/;
const ORDER = ['label', 'value', 'unit', 'period', 'effectiveFrom', 'effectiveTo', 'source', 'sourceType', 'quote', 'verifiedDate', 'nextScheduledRefresh', 'previous', 'scope', 'withdrawn', 'supersededBy'];
const arg = (argv, name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

class StaticFactsError extends Error {}

/** Pure core: source object → { files: { '<relative path>': '<content>' }, conformance }. */
function buildStatic(src, { privateKey = null, kid = null, jwks = null } = {}) {
  const fail = (msg) => { throw new StaticFactsError(msg); };
  if (!src || !src.publisher || !src.publisher.url || !src.publisher.name) fail('publisher { name, url } is required');
  const base = src.publisher.url.endsWith('/') ? src.publisher.url : `${src.publisher.url}/`;
  const keysUrl = `${base}.well-known/jwks.json`;
  const nsByName = new Map((src.namespaces || []).map((n) => [n.name, n]));
  const seen = new Set();
  const records = [];
  for (const f of src.facts || []) {
    if (!KEY.test(String(f.key))) fail(`key "${f.key}" does not match the key grammar ${KEY}`);
    if (seen.has(f.key)) fail(`key "${f.key}" appears twice`);
    seen.add(f.key);
    const ns = nsByName.get(f.key.split('/')[0]);
    if (!ns) fail(`${f.key}: namespace "${f.key.split('/')[0]}" is not declared in namespaces[]`);
    let host;
    try { host = new URL(f.source).hostname; } catch { fail(`${f.key}: source "${f.source}" is not a URL`); }
    if (!/^https:/.test(f.source)) fail(`${f.key}: source must be https:`);
    if (!(ns.authorities || []).includes(host)) fail(`${f.key}: source host ${host} is not in namespace ${ns.name}'s authorities [${(ns.authorities || []).join(', ')}]`);
    const r = { protocol: PROTOCOL, key: f.key };
    if (f.aliases && f.aliases.length) r.aliases = f.aliases;
    for (const k of ORDER) if (f[k] !== undefined) r[k] = f[k];
    for (const k of ['unit', 'period', 'effectiveFrom', 'effectiveTo']) if (r[k] === undefined) r[k] = null;
    r.hash = hashOf(r);
    if (privateKey) r.signature = { alg: 'EdDSA', kid, jws: signAttestation(attestationOf({ ...r, publisher: { url: base } }, base), privateKey, kid), keys: keysUrl };
    r.publisher = { name: src.publisher.name, url: base };
    const v = validate(FACT_SCHEMA, r);
    if (!v.ok) fail(`${f.key} does not validate against fact.v0.json: ${v.errors.join('; ')}`);
    records.push(r);
  }
  const keys = new Set(records.map((r) => r.key));
  for (const r of records) for (const a of r.aliases || []) {
    if (keys.has(a)) fail(`alias ${a} of ${r.key} is itself a key`);
  }
  const generated = records.reduce((m, r) => (r.verifiedDate > m ? r.verifiedDate : m), '');
  const signed = Boolean(privateKey);
  const discovery = {
    protocol: PROTOCOL,
    publisher: { name: src.publisher.name, url: base },
    conformance: signed ? 'L3' : 'L1',
    updated: generated,
    facts: { count: records.length, get: `${base}f/{key}.json`, index: `${base}f/index.json`, filtering: 'client', examples: records.slice(0, 3).map((r) => r.key) },
    namespaces: (src.namespaces || []).map((n) => ({ name: n.name, description: n.description, count: records.filter((r) => r.key.split('/')[0] === n.name).length, ...(n.cadence ? { cadence: n.cadence } : {}), authorities: n.authorities })),
    hash: 'sha256/jcs',
    ...(signed ? { signature: 'EdDSA/jws-detached', keys: keysUrl } : {}),
    ...(src.changes ? { changes: src.changes } : {}),
    schema: 'https://databutler.dev/schema/fact.v0.json',
    specification: 'https://databutler.dev/protocol/facts',
    ...(src.licence ? { licence: src.licence } : {}),
    ...(src.contact ? { contact: src.contact } : {}),
  };
  const v = validate(WK_SCHEMA, discovery);
  if (!v.ok) fail(`facts.json does not validate: ${v.errors.join('; ')}`);
  const index = {
    protocol: PROTOCOL, publisher: discovery.publisher, count: records.length, generated,
    facts: records.map((r) => ({ key: r.key, label: r.label, unit: r.unit, period: r.period, verifiedDate: r.verifiedDate, hash: r.hash, ...(r.aliases ? { aliases: r.aliases } : {}) })),
  };
  const files = { '.well-known/facts.json': json(discovery), 'f/index.json': json(index) };
  for (const r of records) files[`f/${r.key}.json`] = json(r);
  if (jwks) files['.well-known/jwks.json'] = json(jwks);
  return { files, conformance: discovery.conformance };
}

function main(argv = process.argv.slice(2)) {
  const input = argv.find((a, i) => !a.startsWith('--') && !['--out', '--key', '--kid', '--jwks'].includes(argv[i - 1]));
  if (!input) { console.error('usage: node scripts/facts-static.js facts-source.json --out <dir> [--key <path> --kid <kid> --jwks <path>]'); return 2; }
  const out = path.resolve(arg(argv, '--out') || 'public');
  const keyPath = arg(argv, '--key');
  const kid = arg(argv, '--kid');
  if (keyPath && !kid) { console.error('facts-static: --key needs --kid'); return 2; }
  const opts = {
    privateKey: keyPath ? privateKeyFrom(fs.readFileSync(keyPath, 'utf8')) : null,
    kid,
    jwks: arg(argv, '--jwks') ? JSON.parse(fs.readFileSync(arg(argv, '--jwks'), 'utf8')) : null,
  };
  try {
    const { files, conformance } = buildStatic(JSON.parse(fs.readFileSync(input, 'utf8')), opts);
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(out, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
    console.log(`facts-static: ${Object.keys(files).length} files written to ${out} (conformance ${conformance})`);
    console.log('Vendor api/_jcs.js, api/_facts_sign.js, api/_schema_check.js and the two schemas into this repo; check with node scripts/facts-check.js https://<site> --level ' + conformance);
    return 0;
  } catch (e) {
    if (e instanceof StaticFactsError) { console.error(`facts-static: ${e.message}`); return 1; }
    throw e;
  }
}

if (require.main === module) process.exit(main());

module.exports = { buildStatic, main, StaticFactsError };
