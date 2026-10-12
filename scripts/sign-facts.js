#!/usr/bin/env node
/**
 * Sign every served Verified Facts record at build time (docs/FACTS_PROTOCOL.md §8.3–8.4).
 *
 *   node scripts/sign-facts.js           sign every record of every period held with the newest usable key in
 *                                        public/.well-known/jwks.json → data/facts-signatures.json (sorted, byte-stable)
 *   node scripts/sign-facts.js --check   exit 1 when a served record has no signature or an entry is an orphan
 *                                        (tests/facts-sign.test.js runs the same check offline)
 *
 * The private key is read from FACTS_SIGNING_KEY (a path), else --key, else ~/.config/databutler/facts-ed25519.jwk,
 * else ~/.config/databutler/facts-<kid>.jwk; it must match the chosen public key. The key never reaches Vercel: the
 * function only serves the signatures committed here. Run it after every data change, before committing.
 * Options for tests and rotations: --jwks <path>, --out <path>.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { attestationOf, attestationHash, signAttestation, privateKeyFrom, jwkFromPublicKey } = require('../api/_facts_sign');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'data/facts-signatures.json');
const DEFAULT_JWKS = path.join(ROOT, 'public/.well-known/jwks.json');
const KEY_DIR = path.join(os.homedir(), '.config/databutler');
const today = () => new Date().toISOString().slice(0, 10);
const arg = (argv, name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };

/** Every record served, every period: { hash → attestation }. */
function attestations(F = require('../api/_facts')) {
  const out = new Map();
  for (const periods of F.PERIODS.values()) for (const r of periods) {
    const att = attestationOf(r);
    out.set(attestationHash(att), att);
  }
  return out;
}

/** Compare a signatures file with what is served → { missing: [hash], orphans: [hash] }. */
function compare(file, atts) {
  const have = (file && file.signatures) || {};
  return { missing: [...atts.keys()].filter((h) => !have[h]), orphans: Object.keys(have).filter((h) => !atts.has(h)) };
}

/** The newest key that is valid today and neither retired nor revoked. */
function signingKey(jwks, day = today()) {
  const usable = (jwks.keys || []).filter((k) => !k.retired && !k.revoked).sort((a, b) => String(b.validFrom).localeCompare(String(a.validFrom)));
  if (!usable.length) throw new Error('no usable key in the JWK Set — run node scripts/facts-keygen.js');
  const k = usable[0];
  if (!k.validFrom || k.validFrom > day) throw new Error(`key ${k.kid} becomes valid on ${k.validFrom}; sign from that day (spec §8.4: publish a key before it signs)`);
  return k;
}

function loadPrivate(jwk, argv) {
  const candidates = [process.env.FACTS_SIGNING_KEY, arg(argv, '--key'), path.join(KEY_DIR, 'facts-ed25519.jwk'), path.join(KEY_DIR, `facts-${jwk.kid}.jwk`), path.join(KEY_DIR, `facts-${jwk.kid}.pem`)].filter(Boolean);
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const key = privateKeyFrom(fs.readFileSync(p, 'utf8'));
    if (jwkFromPublicKey(key, jwk.kid).x === jwk.x) return key;
  }
  throw new Error(`no private key matching ${jwk.kid} in ${candidates.join(', ')}`);
}

function main(argv = process.argv.slice(2)) {
  const out = path.resolve(arg(argv, '--out') || DEFAULT_OUT);
  const jwksPath = path.resolve(arg(argv, '--jwks') || DEFAULT_JWKS);
  const current = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  const atts = attestations();
  if (argv.includes('--check')) {
    const { missing, orphans } = compare(current, atts);
    if (missing.length || orphans.length) {
      console.error(`sign-facts: ${missing.length} served record(s) unsigned, ${orphans.length} orphan signature(s) — run \`node scripts/sign-facts.js\``);
      return 1;
    }
    console.log(`sign-facts: all ${atts.size} served records are signed`);
    return 0;
  }
  const jwks = JSON.parse(fs.readFileSync(jwksPath, 'utf8'));
  const jwk = signingKey(jwks);
  const key = loadPrivate(jwk, argv);
  const signatures = {};
  for (const h of [...atts.keys()].sort()) signatures[h] = signAttestation(atts.get(h), key, jwk.kid);
  const same = current && current.kid === jwk.kid && JSON.stringify(current.signatures) === JSON.stringify(signatures);
  const doc = { kid: jwk.kid, signedAt: same ? current.signedAt : today(), count: atts.size, signatures };
  const text = `${JSON.stringify(doc, null, 1)}\n`;
  if (same && fs.readFileSync(out, 'utf8') === text) {
    console.log(`sign-facts: ${atts.size} records already signed with ${jwk.kid} — nothing to do`);
    return 0;
  }
  fs.writeFileSync(out, text);
  const { missing, orphans } = compare(current, atts);
  console.log(`sign-facts: signed ${atts.size} records with ${jwk.kid} → ${path.relative(ROOT, out)} (${missing.length} new, ${orphans.length} dropped)`);
  return 0;
}

if (require.main === module) {
  try { process.exit(main()); } catch (e) { console.error(`sign-facts: ${e.message}`); process.exit(1); }
}

module.exports = { main, attestations, compare, signingKey };
