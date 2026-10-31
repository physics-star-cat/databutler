// tests/verified-facts-package.test.js — the npm package packages/verified-facts (`npx verified-facts check <url>`):
// self-contained (lib/ is a verbatim copy of the repo files, no dependency), and its CLI run in-process against the
// router reaches L3 on Data Butler, verifies a record, and builds + checks an L1 site.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { routerFetch } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const PKG_DIR = path.join(ROOT, 'packages/verified-facts');
const PKG = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
const { run, VERSION } = require('../packages/verified-facts/bin/verified-facts');
const quiet = () => { const lines = []; return { log: (s) => lines.push(String(s)), lines }; };

test('package.json: name verified-facts, a bin, zero dependencies, only bin/ lib/ README.md published', () => {
  assert.equal(PKG.name, 'verified-facts');
  assert.deepEqual(PKG.bin, { 'verified-facts': 'bin/verified-facts.js' });
  for (const k of ['dependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies']) assert.equal(PKG[k], undefined, k);
  assert.deepEqual(PKG.files, ['bin/', 'lib/', 'README.md']);
  assert.equal(PKG.scripts.prepublishOnly, 'node build.js --check');
  assert.equal(VERSION, PKG.version);
  assert.equal(PKG.private, undefined, 'publishable (by the owner; nothing here publishes)');
});

test('lib/ is the verbatim copy of the repo files (build.js --check), and requires only node: and ./ modules', () => {
  const { stale, FILES } = require('../packages/verified-facts/build');
  assert.deepEqual(stale(), [], 'run node packages/verified-facts/build.js');
  const code = [path.join(PKG_DIR, 'bin/verified-facts.js'), ...Object.keys(FILES).filter((f) => f.endsWith('.js')).map((f) => path.join(PKG_DIR, 'lib', f))]
    .map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  // `../` only as the literal repo fallback of a sibling-first require, and the sibling must be in lib/
  for (const m of code.matchAll(/require\('([^']+)'\)/g)) {
    if (m[1].startsWith('node:') || m[1].startsWith('./')) continue;
    const sib = path.basename(m[1]);
    assert.ok(m[1].startsWith('../') && code.includes(`require('./${sib}')`) && fs.existsSync(path.join(PKG_DIR, 'lib', sib)), `bare require ${m[1]}`);
  }
});

test('npx verified-facts check https://databutler.dev — in-process against the router — reaches L3', async () => {
  const q = quiet();
  const code = await run(['check', 'https://databutler.dev', '--offline', '--sample', '20'], { fetchFn: routerFetch(), log: q.log });
  assert.equal(code, 0, q.lines.join('\n'));
  assert.match(q.lines.join('\n'), /declared L3, reached L3 — PASS at L3/);
  // a bare URL is check too; a level above what is met exits 1
  assert.equal(await run(['https://databutler.dev', '--offline', '--sample', '3'], { fetchFn: routerFetch(), log: quiet().log }), 0);
});

test('verified-facts verify <url>: the record and a batch verify against the published key set', async () => {
  const q = quiet();
  assert.equal(await run(['verify', 'https://databutler.dev/f/uk/income-tax/personal-allowance'], { fetchFn: routerFetch(), log: q.log }), 0, q.lines.join('\n'));
  assert.match(q.lines.join('\n'), /^VERIFIED uk\/income-tax\/personal-allowance/m);
  const b = quiet();
  assert.equal(await run(['verify', 'https://databutler.dev/f?keys=uk/bank-rate,us/social-security/wage-base'], { fetchFn: routerFetch(), log: b.log }), 0, b.lines.join('\n'));
  assert.equal(b.lines.filter((l) => l.startsWith('VERIFIED')).length, 2);
});

test('usage, --version and an unknown command', async () => {
  assert.equal(await run([], { log: quiet().log }), 2);
  const v = quiet();
  assert.equal(await run(['--version'], { log: v.log }), 0);
  assert.deepEqual(v.lines, [PKG.version]);
  assert.equal(await run(['frobnicate'], { log: quiet().log }), 2);
});

test('the packed package alone (bin/ lib/ package.json copied out of the repo) builds and checks an L1 site', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verified-facts-pkg-'));
  try {
    const pkg = path.join(tmp, 'node_modules/verified-facts');
    fs.cpSync(path.join(PKG_DIR, 'bin'), path.join(pkg, 'bin'), { recursive: true });
    fs.cpSync(path.join(PKG_DIR, 'lib'), path.join(pkg, 'lib'), { recursive: true });
    fs.copyFileSync(path.join(PKG_DIR, 'package.json'), path.join(pkg, 'package.json'));
    const site = path.join(tmp, 'site');
    const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/facts-static/facts-source.json'), 'utf8'));
    fs.mkdirSync(path.join(site, 'public/.well-known'), { recursive: true });
    fs.writeFileSync(path.join(site, 'facts-source.json'), JSON.stringify(src));
    fs.writeFileSync(path.join(site, 'public/.well-known/changes.json'), JSON.stringify({
      protocol: 'verified-changes/0.1', publisher: src.publisher, areas: [], endpoints: { json: 'https://cars.example.org/changes.json' },
      schema: 'https://databutler.dev/schema/changes.v0.json', facts: 'https://cars.example.org/.well-known/facts.json',
    }));
    const r = spawnSync(process.execPath, [path.join(pkg, 'bin/verified-facts.js'), 'static', 'facts-source.json', '--out', 'public', '--check'], { cwd: site, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /reached L1 — PASS at L1/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(site, 'public/.well-known/facts.json'), 'utf8')).protocol, 'verified-facts/0.3');
    const v = spawnSync(process.execPath, [path.join(pkg, 'bin/verified-facts.js'), '--version'], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
    assert.equal(v.stdout.trim(), PKG.version);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
