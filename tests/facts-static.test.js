// tests/facts-static.test.js — the L1 static generator for sister sites (scripts/facts-static.js): output validates,
// hashes are right, signing with an ephemeral key lifts it to L3, a rebuild is byte-identical, a bad source host fails.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildStatic, StaticFactsError } = require('../scripts/facts-static');
const { validate } = require('../api/_schema_check');
const { hashOf, verifyRecord, jwkFromPublicKey } = require('../api/_facts_sign');

const ROOT = path.join(__dirname, '..');
const SRC_PATH = path.join(__dirname, 'fixtures/facts-static/facts-source.json');
const SRC = JSON.parse(fs.readFileSync(SRC_PATH, 'utf8'));
const FACT = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/schema/fact.v0.json'), 'utf8'));
const WKF = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/schema/well-known-facts.v0.json'), 'utf8'));
const sub = (name) => ({ ...FACT.$defs[name], $defs: FACT.$defs });

test('unsigned output: facts.json (L1, client), the index (generated = newest verifiedDate), one record per key', () => {
  const { files, conformance } = buildStatic(SRC);
  assert.equal(conformance, 'L1');
  assert.deepEqual(Object.keys(files).sort(), ['.well-known/facts.json', 'f/index.json', 'f/uk/mot/first-mot-age-car.json', 'f/uk/mot/max-fee-car.json']);
  const wk = JSON.parse(files['.well-known/facts.json']);
  assert.ok(validate(WKF, wk).ok, JSON.stringify(validate(WKF, wk).errors));
  assert.equal(wk.conformance, 'L1');
  assert.equal(wk.facts.filtering, 'client');
  assert.match(wk.facts.get, /\/f\/\{key\}\.json$/);
  assert.equal(wk.facts.count, 2);
  assert.equal(wk.namespaces[0].count, 2);
  const index = JSON.parse(files['f/index.json']);
  assert.ok(validate(sub('index'), index).ok);
  assert.equal(index.generated, '2026-10-04');
  for (const f of SRC.facts) {
    const r = JSON.parse(files[`f/${f.key}.json`]);
    assert.ok(validate(FACT, r).ok, f.key);
    for (const k of ['status', 'ageDays', 'maxAgeDays', 'signature']) assert.equal(r[k], undefined, `${f.key} ${k}: the consumer computes status at L1`);
    assert.equal(r.hash, hashOf(r));
    assert.equal(index.facts.find((e) => e.key === f.key).hash, r.hash);
  }
});

test('signed with an ephemeral key: L3, every record verifies against the emitted key set', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const jwks = { keys: [jwkFromPublicKey(publicKey, 'cs-2026-10', '2026-10-01')] };
  const { files, conformance } = buildStatic(SRC, { privateKey, kid: 'cs-2026-10', jwks });
  assert.equal(conformance, 'L3');
  const wk = JSON.parse(files['.well-known/facts.json']);
  assert.equal(wk.keys, 'https://cars.example.org/.well-known/jwks.json');
  assert.deepEqual(JSON.parse(files['.well-known/jwks.json']), jwks);
  for (const f of SRC.facts) {
    const r = JSON.parse(files[`f/${f.key}.json`]);
    const v = verifyRecord(r, jwks, { now: new Date('2026-10-12T00:00:00Z') });
    assert.ok(v.ok, JSON.stringify(v.checks));
  }
});

test('a rebuild is byte-identical (CLI, twice, into a temp dir)', () => {
  const runs = [1, 2].map(() => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-static-'));
    const r = spawnSync(process.execPath, ['scripts/facts-static.js', SRC_PATH, '--out', out], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Vendor api\/_jcs\.js/);
    const files = {};
    (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files[path.relative(out, p)] = fs.readFileSync(p, 'utf8'); } })(out);
    fs.rmSync(out, { recursive: true, force: true });
    return files;
  });
  assert.deepEqual(runs[0], runs[1]);
});

test('a source host outside the namespace authorities fails with a named error; so does a bad key', () => {
  const bad = { ...SRC, facts: [{ ...SRC.facts[0], source: 'https://www.example.com/mot' }] };
  assert.throws(() => buildStatic(bad), (e) => e instanceof StaticFactsError && /www\.example\.com is not in namespace uk's authorities/.test(e.message));
  assert.throws(() => buildStatic({ ...SRC, facts: [{ ...SRC.facts[0], key: 'UK/Mot' }] }), /key grammar/);
  assert.throws(() => buildStatic({ ...SRC, facts: [SRC.facts[0], SRC.facts[0]] }), /appears twice/);
});
