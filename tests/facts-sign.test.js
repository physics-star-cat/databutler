// tests/facts-sign.test.js — Verified Facts hashing and signing (docs/FACTS_PROTOCOL.md §8): claim hash, attestation,
// detached EdDSA JWS, key-set handling and revocation. Keys are generated in-test; no private key is read from disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const S = require('../api/_facts_sign');

const RECORD = {
  protocol: 'verified-facts/0.2',
  key: 'uk/income-tax/personal-allowance',
  label: 'Personal Allowance',
  value: 12570,
  unit: 'GBP/year',
  period: '2026-27',
  effectiveFrom: '2026-04-06',
  effectiveTo: null,
  source: 'https://www.gov.uk/income-tax-rates',
  verifiedDate: '2026-10-04',
  publisher: { name: 'Data Butler', url: 'https://databutler.dev/' },
};
const KID = 'db-2026-10';
const keypair = () => crypto.generateKeyPairSync('ed25519');

function signed(record, { privateKey, publicKey }, kid = KID) {
  const r = { ...record, hash: S.hashOf(record) };
  const jws = S.signAttestation(S.attestationOf(r), privateKey, kid);
  return { record: { ...r, signature: { alg: 'EdDSA', kid, jws, keys: 'https://databutler.dev/.well-known/jwks.json' } }, jwks: { keys: [S.jwkFromPublicKey(publicKey, kid, '2026-10-01')] } };
}
const check = (res, name) => res.checks.find((c) => c.name === name);

test('hashOf: sha256 over the JCS claim; stable under field order; ignores label, verifiedDate and presentation fields', () => {
  const h = S.hashOf(RECORD);
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
  const reordered = Object.fromEntries(Object.entries(RECORD).reverse());
  assert.equal(S.hashOf(reordered), h);
  assert.equal(S.hashOf({ ...RECORD, label: 'PA', verifiedDate: '2027-01-01', status: 'stale', publisher: { name: 'Other', url: 'https://other.example/' } }), h,
    'two publishers reading the same page produce the same hash');
  assert.notEqual(S.hashOf({ ...RECORD, value: 12571 }), h);
  assert.notEqual(S.hashOf({ ...RECORD, period: '2025-26' }), h);
  assert.deepEqual(Object.keys(S.claimOf(RECORD)), S.CLAIM_FIELDS);
  assert.equal(S.claimOf({ key: 'a/b' }).unit, null, 'a missing field canonicalises as null');
});

test('attestation: the eleven fields; attestationHash differs when only verifiedDate differs', () => {
  const a = S.attestationOf(RECORD);
  assert.deepEqual(Object.keys(a), S.ATTESTATION_FIELDS);
  assert.equal(a.publisher, 'https://databutler.dev/');
  assert.equal(a.hash, S.hashOf(RECORD));
  const b = S.attestationOf({ ...RECORD, verifiedDate: '2026-10-05' });
  assert.equal(b.hash, a.hash);
  assert.notEqual(S.attestationHash(a), S.attestationHash(b));
  assert.match(S.attestationHash(a), /^[0-9a-f]{64}$/);
});

test('sign → verify round trip with an ephemeral key; the JWS is detached with header {"alg":"EdDSA","kid"}', () => {
  const { record, jwks } = signed(RECORD, keypair());
  const [h, payload, sig] = record.signature.jws.split('.');
  assert.equal(Buffer.from(h, 'base64url').toString(), `{"alg":"EdDSA","kid":"${KID}"}`);
  assert.equal(payload, '');
  assert.ok(sig.length > 80);
  const res = S.verifyRecord(record, jwks, { now: new Date('2026-10-12T12:00:00Z') });
  assert.equal(res.ok, true, JSON.stringify(res.checks));
  assert.deepEqual(res.checks.map((c) => c.name), ['hash', 'key', 'signature', 'verifiedDate']);
});

test('tampering with value fails the hash check and the signature check', () => {
  const { record, jwks } = signed(RECORD, keypair());
  const res = S.verifyRecord({ ...record, value: 99999 }, jwks);
  assert.equal(res.ok, false);
  assert.equal(check(res, 'hash').ok, false);
  assert.equal(check(res, 'signature').ok, false);
  // tampering with an attested-but-unhashed field (verifiedDate) fails only the signature
  const later = S.verifyRecord({ ...record, verifiedDate: '2026-10-05' }, jwks, { now: new Date('2026-10-12T00:00:00Z') });
  assert.equal(check(later, 'hash').ok, true);
  assert.equal(check(later, 'signature').ok, false);
});

test('unknown kid, wrong key and missing signature fail', () => {
  const { record } = signed(RECORD, keypair());
  const other = { keys: [S.jwkFromPublicKey(keypair().publicKey, KID, '2026-10-01')] };
  assert.equal(check(S.verifyRecord(record, { keys: [] }), 'key').ok, false);
  assert.equal(check(S.verifyRecord(record, other), 'signature').ok, false);
  const { signature, ...unsigned } = record;
  const res = S.verifyRecord(unsigned, other);
  assert.equal(res.ok, false);
  assert.equal(check(res, 'hash').ok, true);
  assert.match(check(res, 'key').detail, /no signature/);
});

test('revocation: a key revoked before verifiedDate fails; revoked after it still verifies', () => {
  const { record, jwks } = signed(RECORD, keypair());
  const revokedBefore = { keys: [{ ...jwks.keys[0], revoked: '2026-10-01' }] };
  assert.equal(check(S.verifyRecord(record, revokedBefore), 'key').ok, false);
  const revokedAfter = { keys: [{ ...jwks.keys[0], revoked: '2026-11-01' }] };
  const res = S.verifyRecord(record, revokedAfter, { now: new Date('2026-12-01T00:00:00Z') });
  assert.equal(res.ok, true, JSON.stringify(res.checks));
});

test('a verifiedDate in the future fails the date check', () => {
  const { record, jwks } = signed(RECORD, keypair());
  assert.equal(check(S.verifyRecord(record, jwks, { now: new Date('2026-10-01T00:00:00Z') }), 'verifiedDate').ok, false);
});

test('JWK round trip: OKP / Ed25519 / x; private JWK and PEM both load', () => {
  const { publicKey, privateKey } = keypair();
  const jwk = S.jwkFromPublicKey(publicKey, KID, '2026-10-12');
  assert.equal(jwk.kty, 'OKP');
  assert.equal(jwk.crv, 'Ed25519');
  assert.match(jwk.x, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual([jwk.kid, jwk.use, jwk.alg, jwk.validFrom, jwk.retired], [KID, 'sig', 'EdDSA', '2026-10-12', null]);
  const back = S.publicKeyFromJwk(jwk);
  assert.ok(back.equals(publicKey));
  assert.deepEqual(S.jwkFromPublicKey(privateKey, KID).x, jwk.x, 'a private key yields its public JWK');
  const fromJwk = S.privateKeyFrom(privateKey.export({ format: 'jwk' }));
  const fromPem = S.privateKeyFrom(privateKey.export({ format: 'pem', type: 'pkcs8' }));
  const msg = Buffer.from('x');
  assert.ok(crypto.verify(null, msg, publicKey, crypto.sign(null, msg, fromJwk)));
  assert.ok(crypto.verify(null, msg, publicKey, crypto.sign(null, msg, fromPem)));
});

/* ---------------- integration: the committed key set and signatures ---------------- */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const F = require('../api/_facts');
const { attestations, compare } = require('../scripts/sign-facts');

const ROOT = path.join(__dirname, '..');
const JWKS_PATH = path.join(ROOT, 'public/.well-known/jwks.json');
const SIGS_PATH = path.join(ROOT, 'data/facts-signatures.json');
const JWKS = JSON.parse(fs.readFileSync(JWKS_PATH, 'utf8'));
const SIGS = JSON.parse(fs.readFileSync(SIGS_PATH, 'utf8'));
const OPTIONAL = process.env.FACTS_SIGNATURES_OPTIONAL === '1'; // the monthly refresh bot cannot sign; a human signs before merge
const node = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', ...opts });

test('public/.well-known/jwks.json: OKP / Ed25519 keys with kid db-YYYY-MM, use sig, alg EdDSA, validFrom; no private part', () => {
  assert.ok(JWKS.keys.length >= 1);
  for (const k of JWKS.keys) {
    assert.equal(k.kty, 'OKP');
    assert.equal(k.crv, 'Ed25519');
    assert.match(k.x, /^[A-Za-z0-9_-]{43}$/);
    assert.match(k.kid, /^db-\d{4}-\d{2}$/);
    assert.equal(k.use, 'sig');
    assert.equal(k.alg, 'EdDSA');
    assert.match(k.validFrom, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(k.d, undefined, 'a JWK Set never carries the private key');
  }
  assert.equal(new Set(JWKS.keys.map((k) => k.kid)).size, JWKS.keys.length);
});

test('every served record (every period) is signed and verifies against the committed key set', () => {
  const { missing, orphans } = compare(SIGS, attestations(F));
  if (OPTIONAL && missing.length) {
    console.log(`facts-sign: ${missing.length} record(s) unsigned (FACTS_SIGNATURES_OPTIONAL=1) — run node scripts/sign-facts.js before merging`);
    return;
  }
  assert.deepEqual(missing, [], `${missing.length} served record(s) unsigned — run \`node scripts/sign-facts.js\``);
  assert.deepEqual(orphans, [], `${orphans.length} orphan signature(s) — run \`node scripts/sign-facts.js\``);
  assert.equal(SIGS.count, attestations(F).size);
  for (const periods of F.PERIODS.values()) {
    for (const r of periods) {
      const served = F.present(r, { maxAgeDays: null, now: new Date(), isCurrent: r === F.INDEX.get(r.key) });
      const res = S.verifyRecord(served, JWKS);
      assert.equal(res.ok, true, `${r.key} ${r.period}: ${JSON.stringify(res.checks.filter((c) => !c.ok))}`);
    }
  }
});

test('data/facts-signatures.json is sorted and byte-stable; sign-facts --check agrees', () => {
  const keys = Object.keys(SIGS.signatures);
  assert.deepEqual(keys, [...keys].sort());
  assert.match(SIGS.kid, /^db-\d{4}-\d{2}$/);
  if (!OPTIONAL) assert.equal(node(['scripts/sign-facts.js', '--check']).status, 0);
});

test('a served record carries signature { alg, kid, jws, keys }', () => {
  if (OPTIONAL && !F.getFact('uk/income-tax/personal-allowance').signature) return;
  const r = F.getFact('uk/income-tax/personal-allowance');
  assert.deepEqual(Object.keys(r.signature), ['alg', 'kid', 'jws', 'keys']);
  assert.equal(r.signature.alg, 'EdDSA');
  assert.equal(r.signature.keys, 'https://databutler.dev/.well-known/jwks.json');
  assert.ok(JWKS.keys.some((k) => k.kid === r.signature.kid));
});

test('scripts/verify-fact.js: a served record verifies (four checks, exit 0); a tampered copy exits 1', () => {
  if (OPTIONAL && !F.getFact('uk/income-tax/personal-allowance').signature) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-verify-'));
  const good = path.join(dir, 'pa.json');
  fs.writeFileSync(good, JSON.stringify(F.getFact('uk/income-tax/personal-allowance')));
  const ok = node(['scripts/verify-fact.js', good, '--jwks', JWKS_PATH]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^VERIFIED uk\/income-tax\/personal-allowance/m);
  for (const c of ['hash', 'key', 'signature', 'verifiedDate']) assert.match(ok.stdout, new RegExp(`ok +${c} `));
  const bad = path.join(dir, 'pa-tampered.json');
  fs.writeFileSync(bad, JSON.stringify({ ...F.getFact('uk/income-tax/personal-allowance'), value: 13000 }));
  const no = node(['scripts/verify-fact.js', bad, '--jwks', JWKS_PATH]);
  assert.equal(no.status, 1);
  assert.match(no.stdout, /FAIL hash/);
  assert.match(no.stdout, /FAIL signature/);
  const batch = path.join(dir, 'batch.json');
  fs.writeFileSync(batch, JSON.stringify(F.getFacts(['uk/bank-rate', 'zz/nope/x'])));
  assert.equal(node(['scripts/verify-fact.js', batch, '--jwks', JWKS_PATH]).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('facts-keygen → sign-facts end to end with an ephemeral key in a temp dir (0600 private JWK, refuses overwrite)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-keys-'));
  const key = path.join(dir, 'keys', 'facts-ed25519.jwk');
  const jwks = path.join(dir, 'jwks.json');
  const out = path.join(dir, 'sigs.json');
  const today = new Date().toISOString().slice(0, 10);
  const gen = node(['scripts/facts-keygen.js', '--kid', 'db-2099-01', '--valid-from', today, '--out', key, '--jwks', jwks]);
  assert.equal(gen.status, 0, gen.stderr);
  assert.doesNotMatch(gen.stdout, /"d"/, 'the private key is never printed');
  assert.equal(fs.statSync(key).mode & 0o777, 0o600);
  assert.ok(JSON.parse(fs.readFileSync(key, 'utf8')).d);
  assert.equal(JSON.parse(fs.readFileSync(jwks, 'utf8')).keys[0].d, undefined);
  assert.equal(node(['scripts/facts-keygen.js', '--kid', 'db-2099-02', '--out', key, '--jwks', jwks]).status, 1, 'refuses to overwrite');
  const sign = node(['scripts/sign-facts.js', '--jwks', jwks, '--out', out], { env: { ...process.env, FACTS_SIGNING_KEY: key } });
  assert.equal(sign.status, 0, sign.stderr);
  const sigs = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(sigs.kid, 'db-2099-01');
  const X = F.makeFacts(undefined, { signatures: sigs });
  const set = JSON.parse(fs.readFileSync(jwks, 'utf8'));
  assert.ok(S.verifyRecord(X.getFact('uk/bank-rate'), set).ok);
  // a second run is byte-identical; a future validFrom is refused
  const before = fs.readFileSync(out, 'utf8');
  assert.equal(node(['scripts/sign-facts.js', '--jwks', jwks, '--out', out], { env: { ...process.env, FACTS_SIGNING_KEY: key } }).status, 0);
  assert.equal(fs.readFileSync(out, 'utf8'), before);
  assert.equal(node(['scripts/facts-keygen.js', '--revoke', 'db-2099-01', '--date', '2000-01-01', '--jwks', jwks]).status, 0);
  assert.equal(S.verifyRecord(X.getFact('uk/bank-rate'), JSON.parse(fs.readFileSync(jwks, 'utf8'))).ok, false, 'revoked before verifiedDate');
  const key2 = path.join(dir, 'keys', 'facts-db-2099-03.jwk');
  assert.equal(node(['scripts/facts-keygen.js', '--kid', 'db-2099-03', '--valid-from', '2099-03-01', '--out', key2, '--jwks', jwks]).status, 0);
  const early = node(['scripts/sign-facts.js', '--jwks', jwks, '--out', out], { env: { ...process.env, FACTS_SIGNING_KEY: key2 } });
  assert.equal(early.status, 1);
  assert.match(early.stderr, /becomes valid on 2099-03-01/);
  fs.rmSync(dir, { recursive: true, force: true });
});
