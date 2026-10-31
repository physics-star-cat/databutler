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
    assert.match(r.stdout, /conformance L1/);
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

/* ---------------- v0.3 ---------------- */

/** The site's own changes.json, as a sister site already serves it (item 5 reads it). */
const CHANGES = (origin = 'https://cars.example.org') => JSON.stringify({
  protocol: 'verified-changes/0.1', publisher: SRC.publisher, areas: [], endpoints: { json: `${origin}/changes.json` },
  schema: 'https://databutler.dev/schema/changes.v0.json', facts: `${origin}/.well-known/facts.json`,
});
const SRC03 = {
  ...SRC,
  facts: SRC.facts.map((f, i) => (i === 1 ? { ...f, changeCadence: 'irregular', nextExpectedChange: null, sourceCheckedAt: '2026-10-26' } : { ...f, changeCadence: 'annual', nextExpectedChange: '2027-04-01' })),
};

test('v0.3 output: protocol 0.3, digest in facts.json, per namespace and in the index; it validates under both protocol strings', () => {
  const { digestOf } = require('../api/_facts_sign');
  const { files } = buildStatic(SRC03);
  const wk = JSON.parse(files['.well-known/facts.json']);
  const index = JSON.parse(files['f/index.json']);
  assert.equal(wk.protocol, 'verified-facts/0.3');
  assert.equal(index.protocol, 'verified-facts/0.3');
  const recs = SRC03.facts.map((f) => JSON.parse(files[`f/${f.key}.json`]));
  const want = digestOf(recs.map((r) => [r.key, r.hash]));
  assert.equal(wk.facts.digest, want);
  assert.equal(index.digest, want);
  assert.equal(wk.namespaces[0].digest, want, 'one namespace: the same set');
  for (const doc of [wk, { ...wk, protocol: 'verified-facts/0.2' }]) assert.ok(validate(WKF, doc).ok, doc.protocol);
  for (const r of recs) for (const p of ['verified-facts/0.3', 'verified-facts/0.2']) assert.ok(validate(FACT, { ...r, protocol: p }).ok, `${r.key} as ${p}`);
  assert.ok(validate(sub('index'), index).ok);
});

test('v0.3 pass-through: changeCadence, nextExpectedChange and sourceCheckedAt as given, on the record and the index; never invented', () => {
  const { files } = buildStatic(SRC03);
  const a = JSON.parse(files['f/uk/mot/first-mot-age-car.json']);
  const b = JSON.parse(files['f/uk/mot/max-fee-car.json']);
  assert.deepEqual([a.changeCadence, a.nextExpectedChange, a.sourceCheckedAt], ['annual', '2027-04-01', undefined]);
  assert.deepEqual([b.changeCadence, b.nextExpectedChange, b.sourceCheckedAt], ['irregular', null, '2026-10-26']);
  const keys = Object.keys(a);
  assert.deepEqual(keys.slice(keys.indexOf('verifiedDate'), keys.indexOf('verifiedDate') + 3), ['verifiedDate', 'changeCadence', 'nextExpectedChange']);
  const e = JSON.parse(files['f/index.json']).facts.find((x) => x.key === 'uk/mot/max-fee-car');
  assert.deepEqual([e.changeCadence, e.nextExpectedChange, e.sourceCheckedAt], ['irregular', null, '2026-10-26']);
  const plain = JSON.parse(buildStatic(SRC).files['f/uk/mot/max-fee-car.json']);
  for (const k of ['changeCadence', 'nextExpectedChange', 'sourceCheckedAt']) assert.equal(k in plain, false, k);
  assert.throws(() => buildStatic({ ...SRC, facts: [{ ...SRC.facts[0], changeCadence: 'sometimes' }] }), /does not validate/);
  // the fields are presentation: the claim hash is the same with or without them
  assert.equal(a.hash, JSON.parse(buildStatic(SRC).files['f/uk/mot/first-mot-age-car.json']).hash);
});

test('v0.3 signed output still verifies (the attestation is the 0.2 shape)', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const jwks = { keys: [jwkFromPublicKey(publicKey, 'cs-2026-10', '2026-10-01')] };
  const { files } = buildStatic(SRC03, { privateKey, kid: 'cs-2026-10', jwks });
  for (const f of SRC03.facts) {
    const r = JSON.parse(files[`f/${f.key}.json`]);
    assert.equal(r.protocol, 'verified-facts/0.3');
    assert.ok(verifyRecord(r, jwks, { now: new Date('2026-10-31T00:00:00Z') }).ok, f.key);
  }
});

/** Write the generator's output plus the site's changes.json into a temp public/ dir. */
function site(files) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-site-'));
  for (const [rel, content] of Object.entries({ ...files, '.well-known/changes.json': CHANGES() })) {
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), content);
  }
  return out;
}

test('v0.3 --check: the conformance checker over the written directory passes L1; a broken digest fails item 2', async () => {
  const { checkOutput } = require('../scripts/facts-static');
  const out = site(buildStatic(SRC03).files);
  try {
    const { report, text } = await checkOutput(out, SRC.publisher.url, 'L1');
    assert.equal(report.ok, true, text);
    assert.equal(report.reached, 'L1');
    assert.match(report.results.find((r) => r.item === 2).detail, /digest .* matches/);
    const p = path.join(out, 'f/index.json');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/"digest": "sha256:[0-9a-f]+"/, `"digest": "sha256:${'0'.repeat(64)}"`));
    const bad = await checkOutput(out, SRC.publisher.url, 'L1');
    assert.equal(bad.report.ok, false);
    assert.match(bad.report.results.find((r) => r.item === 2).detail, /index digest/);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('v0.3 vendored: the eight documented files copied into one directory of another repo build and --check with no other file', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sister-repo-'));
  try {
    const dir = path.join(repo, 'scripts/verified-facts');
    fs.mkdirSync(path.join(dir, 'schema'), { recursive: true });
    for (const f of ['scripts/facts-static.js', 'scripts/facts-check.js', 'api/_jcs.js', 'api/_facts_sign.js', 'api/_schema_check.js']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, path.basename(f)));
    for (const f of ['fact.v0.json', 'well-known-facts.v0.json', 'well-known-changes.v0.json']) fs.copyFileSync(path.join(ROOT, 'public/schema', f), path.join(dir, 'schema', f));
    fs.mkdirSync(path.join(repo, 'public/.well-known'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'public/.well-known/changes.json'), CHANGES());
    fs.writeFileSync(path.join(repo, 'facts-source.json'), JSON.stringify(SRC03));
    const r = spawnSync(process.execPath, ['scripts/verified-facts/facts-static.js', 'facts-source.json', '--out', 'public', '--check'], { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /reached L1 — PASS at L1/);
    assert.ok(fs.existsSync(path.join(repo, 'public/f/uk/mot/max-fee-car.json')));
    // the vendored scripts never reach back into this repo
    const vendored = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    for (const m of vendored.matchAll(/require\('([^']+)'\)/g)) assert.ok(m[1].startsWith('node:') || m[1].startsWith('./'), `bare require ${m[1]}`);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
