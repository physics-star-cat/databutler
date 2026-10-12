#!/usr/bin/env node
/**
 * Verified Facts signing keys (docs/FACTS_PROTOCOL.md §8.4; docs/CURATION.md "Signing and key rotation").
 *
 *   node scripts/facts-keygen.js [--kid db-2026-10] [--valid-from 2026-10-19] [--out <private key path>] [--jwks <path>]
 *       Generates an Ed25519 keypair. The PRIVATE key is written as a JWK (with its kid) to
 *       ~/.config/databutler/facts-ed25519.jwk (directory 0700, file 0600; --out for a rotation key, e.g.
 *       ~/.config/databutler/facts-db-2027-04.jwk) and is never printed. It refuses to overwrite. The PUBLIC
 *       JWK is merged into public/.well-known/jwks.json with validFrom (default today + 7 days — publish a key
 *       a week before it signs anything) and retired: null.
 *   node scripts/facts-keygen.js --retire <kid> [--date YYYY-MM-DD]    sets retired (default today)
 *   node scripts/facts-keygen.js --revoke <kid> [--date YYYY-MM-DD]    sets revoked: signatures whose verifiedDate
 *                                                                       is after that day stop verifying
 * Retired and revoked keys stay in the set (at least two years) so old citations still verify.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { jwkFromPublicKey } = require('../api/_facts_sign');
const { plusDays } = require('../api/_area_kit');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_JWKS = path.join(ROOT, 'public/.well-known/jwks.json');
const DEFAULT_KEY = path.join(os.homedir(), '.config/databutler/facts-ed25519.jwk');
const KID = /^db-\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}
const today = () => new Date().toISOString().slice(0, 10);
const readJwks = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { keys: [] });
const writeJwks = (p, set) => fs.writeFileSync(p, `${JSON.stringify(set, null, 2)}\n`);

function main(argv = process.argv.slice(2)) {
  const jwksPath = path.resolve(arg(argv, '--jwks') || DEFAULT_JWKS);
  const set = readJwks(jwksPath);
  for (const op of ['--retire', '--revoke']) {
    const kid = arg(argv, op);
    if (kid === undefined) continue;
    const date = arg(argv, '--date') || today();
    if (!DAY.test(date)) throw new Error(`--date must be YYYY-MM-DD, got ${date}`);
    const k = set.keys.find((x) => x.kid === kid);
    if (!k) throw new Error(`${kid} is not in ${path.relative(ROOT, jwksPath)}`);
    k[op === '--retire' ? 'retired' : 'revoked'] = date;
    writeJwks(jwksPath, set);
    console.log(`facts-keygen: ${kid} ${op === '--retire' ? 'retired' : 'revoked'} ${date} in ${path.relative(ROOT, jwksPath)}`);
    return 0;
  }

  const kid = arg(argv, '--kid') || `db-${today().slice(0, 7)}`;
  if (!KID.test(kid)) throw new Error(`--kid must look like db-YYYY-MM (spec §8.4), got ${kid}`);
  if (set.keys.some((k) => k.kid === kid)) throw new Error(`${kid} is already in the key set — pick the next month's kid`);
  const validFrom = arg(argv, '--valid-from') || plusDays(today(), 7);
  if (!DAY.test(validFrom)) throw new Error(`--valid-from must be YYYY-MM-DD, got ${validFrom}`);
  const out = path.resolve(arg(argv, '--out') || DEFAULT_KEY);
  if (fs.existsSync(out)) throw new Error(`${out} exists — refusing to overwrite a private key (use --out for a rotation key)`);

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
  const priv = { ...privateKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'EdDSA' };
  fs.writeFileSync(out, `${JSON.stringify(priv)}\n`, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(out, 0o600);
  set.keys.push(jwkFromPublicKey(publicKey, kid, validFrom));
  writeJwks(jwksPath, set);
  console.log(`facts-keygen: ${kid} — private key written to ${out} (0600; never commit it), public key added to ${path.relative(ROOT, jwksPath)} valid from ${validFrom}`);
  return 0;
}

if (require.main === module) {
  try { process.exit(main()); } catch (e) { console.error(`facts-keygen: ${e.message}`); process.exit(1); }
}

module.exports = { main, DEFAULT_KEY, DEFAULT_JWKS };
