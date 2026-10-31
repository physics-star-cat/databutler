/**
 * Verified Facts hashing and signing primitives (docs/FACTS_PROTOCOL.md §8).
 *
 *   claim        = { key, value, unit, period, effectiveFrom, source }
 *   hash         = "sha256:" + hex(SHA-256(JCS(claim)))         — publisher-independent (§8.2)
 *   attestation  = { protocol, publisher, key, hash, value, unit, period, effectiveFrom, effectiveTo, source, verifiedDate }
 *   jws          = b64url(header) + ".." + b64url(Ed25519(b64url(header) + "." + b64url(JCS(attestation))))   (§8.3)
 *
 * The JWS is detached (RFC 7515 Appendix F): the verifier rebuilds the attestation
 * from the record's own fields. Pure apart from node:crypto; requires only
 * ./_jcs, so a sister site can vendor the two files.
 */
const crypto = require('node:crypto');
const { canonicalize } = require('./_jcs');

const CLAIM_FIELDS = ['key', 'value', 'unit', 'period', 'effectiveFrom', 'source'];
const ATTESTATION_FIELDS = ['protocol', 'publisher', 'key', 'hash', 'value', 'unit', 'period', 'effectiveFrom', 'effectiveTo', 'source', 'verifiedDate'];
const DEFAULT_PROTOCOL = 'verified-facts/0.2';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(String(s), 'base64url');
const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
/** A missing field is null in the canonical form (JCS cannot carry undefined). */
const field = (r, k) => (r[k] === undefined ? null : r[k]);

function claimOf(r) {
  return Object.fromEntries(CLAIM_FIELDS.map((k) => [k, field(r, k)]));
}

function hashOf(r) {
  return `sha256:${sha256hex(canonicalize(claimOf(r)))}`;
}

/** The signed statement; `publisher` is the publisher's URL (the record's publisher.url by default). */
function attestationOf(r, publisherUrl) {
  const pub = publisherUrl || (r.publisher && r.publisher.url) || null;
  const att = {};
  for (const k of ATTESTATION_FIELDS) {
    if (k === 'protocol') att[k] = r.protocol || DEFAULT_PROTOCOL;
    else if (k === 'publisher') att[k] = pub;
    else if (k === 'hash') att[k] = hashOf(r);
    else att[k] = field(r, k);
  }
  return att;
}

/** Hex SHA-256 of the canonical attestation: the key of data/facts-signatures.json. */
function attestationHash(att) {
  return sha256hex(canonicalize(att));
}

function headerOf(kid) {
  return b64url(JSON.stringify({ alg: 'EdDSA', kid }));
}

/** Detached compact JWS over the attestation: "<b64url header>..<b64url signature>". */
function signAttestation(att, privateKey, kid) {
  if (!kid) throw new Error('signAttestation: kid is required');
  const header = headerOf(kid);
  const input = `${header}.${b64url(canonicalize(att))}`;
  return `${header}..${b64url(crypto.sign(null, Buffer.from(input, 'utf8'), privateKey))}`;
}

/** Public JWK (RFC 8037 OKP/Ed25519) for a key object, with the publication fields of spec §8.4. */
function jwkFromPublicKey(keyObject, kid, validFrom) {
  const pub = keyObject.type === 'private' ? crypto.createPublicKey(keyObject) : keyObject;
  const { kty, crv, x } = pub.export({ format: 'jwk' });
  return { kty, crv, x, kid, use: 'sig', alg: 'EdDSA', validFrom: validFrom || null, retired: null };
}

function publicKeyFromJwk(jwk) {
  return crypto.createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: 'jwk' });
}

/** Private key object from a private JWK (has `d`) or PEM text. */
function privateKeyFrom(material) {
  if (material && typeof material === 'object') {
    return crypto.createPrivateKey({ key: { kty: material.kty, crv: material.crv, x: material.x, d: material.d }, format: 'jwk' });
  }
  const text = String(material);
  if (text.trim().startsWith('{')) return privateKeyFrom(JSON.parse(text));
  return crypto.createPrivateKey(text);
}

/**
 * Spec §8.5 steps 1–3 plus the date sanity check of step 4:
 *   hash          the record's hash equals SHA-256(JCS(claim))
 *   key           signature.kid is in the JWK Set and not revoked before verifiedDate
 *   signature     the detached JWS verifies over the rebuilt attestation
 *   verifiedDate  is not in the future
 * → { ok, checks: [{ name, ok, detail }] }
 */
function verifyRecord(record, jwks, { now = new Date() } = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
  const expected = hashOf(record);
  add('hash', record.hash === expected, record.hash === expected ? expected : `record says ${record.hash}, claim hashes to ${expected}`);

  const sig = record.signature;
  let jwk = null;
  if (!sig || typeof sig !== 'object' || !sig.jws || !sig.kid) {
    add('key', false, 'record carries no signature');
  } else {
    jwk = ((jwks && jwks.keys) || []).find((k) => k.kid === sig.kid) || null;
    if (!jwk) add('key', false, `kid ${sig.kid} is not in the key set`);
    else if (jwk.revoked && String(jwk.revoked) < String(record.verifiedDate)) {
      add('key', false, `kid ${sig.kid} was revoked ${jwk.revoked}, before verifiedDate ${record.verifiedDate}`);
      jwk = null;
    } else add('key', true, `kid ${sig.kid}${jwk.revoked ? ` (revoked ${jwk.revoked}, after verifiedDate)` : ''}`);
  }

  if (!sig || !sig.jws) add('signature', false, 'no jws');
  else if (!jwk) add('signature', false, 'no usable key');
  else {
    try {
      const [header, payload, signature] = String(sig.jws).split('.');
      const h = JSON.parse(fromB64url(header).toString('utf8'));
      if (payload !== '') throw new Error('jws is not detached (payload segment is not empty)');
      if (h.alg !== 'EdDSA') throw new Error(`alg ${h.alg} is not EdDSA`);
      if (h.kid !== sig.kid) throw new Error(`header kid ${h.kid} differs from signature.kid ${sig.kid}`);
      const input = `${header}.${b64url(canonicalize(attestationOf(record)))}`;
      const ok = crypto.verify(null, Buffer.from(input, 'utf8'), publicKeyFromJwk(jwk), fromB64url(signature));
      add('signature', ok, ok ? 'EdDSA signature over the attestation verifies' : 'EdDSA signature does not verify against the rebuilt attestation');
    } catch (e) {
      add('signature', false, e.message);
    }
  }

  const today = now.toISOString().slice(0, 10);
  const vd = String(record.verifiedDate || '');
  add('verifiedDate', /^\d{4}-\d{2}-\d{2}$/.test(vd) && vd <= today, `${vd || '(none)'}${vd > today ? ` is after today ${today}` : ''}`);
  return { ok: checks.every((c) => c.ok), checks };
}

module.exports = {
  CLAIM_FIELDS, ATTESTATION_FIELDS, claimOf, hashOf, attestationOf, attestationHash, signAttestation, verifyRecord,
  jwkFromPublicKey, publicKeyFromJwk, privateKeyFrom, b64url, fromB64url,
};
