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
