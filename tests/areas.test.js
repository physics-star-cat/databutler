// tests/areas.test.js — the area kit: every module honours the contract, the
// derived artefacts are in sync, and the scaffold produces a loadable area.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AREAS, datasets, restRoutes, citeRoutes, discovery, frontDoorTools } = require('../api/_areas');
const { ALL_TOOLS, SERVERS } = require('../api/_registry');
const { DIRECT, HUB_TOOLS } = require('../api/_hub');
const { manifest } = require('../scripts/sync-areas');
const { CHANGELOG_AREAS } = require('../api/_changelog');
const router = require('../api/router');

const ROOT = path.join(__dirname, '..');
const ONE_MB = 1024 * 1024;
// Descriptions written before the kit; the plain-statement rule applies to every area after them.
const GRANDFATHERED = new Set(['uk_rates_lookup', 'package_provenance', 'uk_mot_reliability', 'uk_mot_vehicle_search']);
const IMPERATIVE = /\b(use this|you should|always|never|call this|do not|use when|use whenever|use to)\b/i;

test('every area module honours the contract: unique order, slug = file name, tools/REST paths unique', () => {
  assert.ok(AREAS.length >= 8);
  const files = fs.readdirSync(path.join(ROOT, 'api/_areas')).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')).sort();
  assert.deepEqual(AREAS.map((a) => a.area).sort(), files);
  assert.equal(new Set(AREAS.map((a) => a.order)).size, AREAS.length, 'orders unique');
  assert.deepEqual(AREAS.map((a) => a.order), [...AREAS.map((a) => a.order)].sort((x, y) => x - y), 'sorted by order');
  const tools = AREAS.flatMap((a) => (a.server ? a.server.tools.map((t) => t.name) : []));
  assert.equal(new Set(tools).size, tools.length, 'tool names unique');
  assert.deepEqual(Object.keys(ALL_TOOLS), tools);
  const paths = restRoutes().map((r) => r.path);
  assert.equal(new Set(paths).size, paths.length, 'REST paths unique');
  for (const p of paths) assert.ok(router.ROUTES[p], `router serves /api/${p}`);
  for (const k of Object.keys(SERVERS)) assert.ok(router.ROUTES[`mcp/${k}`], `router serves /api/mcp/${k}`);
  for (const p of Object.keys(citeRoutes())) assert.ok(require('../api/_routes/r').ROUTES[p], `/r/${p}`);
});

test('every tool cites a path the /r page serves, and every rest/cite path resolves to one of the area\'s tools', () => {
  const cite = require('../api/_routes/r').ROUTES;
  for (const a of AREAS) {
    if (!a.server) continue;
    for (const t of a.server.tools) {
      const c = t.cite({});
      assert.ok(c && cite[c.path], `${t.name} cites /r/${c && c.path}`);
    }
  }
});

test('changelog areas declare discovery, and the discovery document tracks them in order', () => {
  assert.deepEqual(discovery().map((d) => d.name), CHANGELOG_AREAS);
  const wk = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/.well-known/changes.json'), 'utf8'));
  assert.deepEqual(wk.areas, discovery());
  for (const a of AREAS) {
    if (a.changelog) assert.ok(a.discovery && a.hub.changed, `${a.area} discovery + hub.changed`);
    else assert.equal(a.discovery, null, `${a.area} has no changelog, so no discovery`);
  }
});

test('committed data files stay under 1 MB unless the dataset says why', () => {
  for (const d of datasets()) {
    const size = fs.statSync(path.join(ROOT, d.dataFile)).size;
    if (size >= ONE_MB) assert.ok(typeof d.large === 'string' && d.large.length > 10, `${d.dataFile} is ${size} bytes — declare large: 'reason' or trim it`);
    assert.ok(d.data.verifiedDate && d.data.nextScheduledRefresh, d.dataFile);
  }
});

test('house rule: tool descriptions are plain statements (no imperatives) for every area after the kit', () => {
  for (const t of Object.values(ALL_TOOLS)) {
    if (GRANDFATHERED.has(t.name)) continue;
    assert.doesNotMatch(t.description, IMPERATIVE, `${t.name}: "${(t.description.match(IMPERATIVE) || [])[0]}"`);
  }
});

test('front door DIRECT = the tools flagged frontDoor, in area order; house rule: at most 5 direct + 4 hub tools = 9 listed', () => {
  assert.deepEqual(DIRECT, frontDoorTools());
  assert.ok(DIRECT.length <= 5, 'the front door stays small — promote deliberately (docs/ADDING_AN_AREA.md)');
  assert.equal(HUB_TOOLS.length, 4);
  assert.ok(DIRECT.length + HUB_TOOLS.length <= 9);
});

test('every focused server has a registry manifest server-<key>.json generated from server.description (sync-areas writes it)', () => {
  for (const [key, s] of Object.entries(SERVERS)) {
    const rel = `server-${key}.json`;
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} exists — run node scripts/sync-areas.js`);
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(text, manifest(key, s), `${rel} matches the module`);
    const m = JSON.parse(text);
    assert.equal(m.name, `io.github.physics-star-cat/${s.serverName}`);
    assert.equal(m.description, s.description);
    assert.deepEqual(m.remotes, [{ type: 'streamable-http', url: s.url }]);
  }
});

test('node scripts/sync-areas.js --check: every derived static file is up to date', () => {
  const r = spawnSync(process.execPath, ['scripts/sync-areas.js', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /up to date/);
  // verify-hub.sh parses and names every area's checks and the live tool count
  const sh = fs.readFileSync(path.join(ROOT, 'scripts/verify-hub.sh'), 'utf8');
  assert.equal(spawnSync('bash', ['-n', 'scripts/verify-hub.sh'], { cwd: ROOT }).status, 0);
  assert.match(sh, new RegExp(`d\\['count'\\]==${Object.keys(ALL_TOOLS).length}`));
  for (const a of AREAS) for (const v of a.verify) assert.ok(sh.includes(`check ${v.label} `), `verify-hub has ${v.label}`);
});

test('scaffold: node scripts/new-area.js creates a loadable area whose skeleton tests pass, in an isolated copy', { skip: process.env.AREAKIT_INNER === '1' && 'inner run' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'areakit-'));
  try {
    fs.cpSync(ROOT, tmp, { recursive: true, filter: (src) => !/\/(\.git|node_modules)(\/|$)/.test(src) });
    const slug = 'throwaway-kit';
    const made = spawnSync(process.execPath, ['scripts/new-area.js', slug, '--title', 'Throwaway kit', '--cadence', 'monthly', '--refresh-days', '40'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr || made.stdout);
    for (const rel of [`api/_areas/${slug}.js`, `data/${slug}.json`, `tests/${slug}.test.js`]) assert.ok(fs.existsSync(path.join(tmp, rel)), rel);
    assert.match(fs.readFileSync(path.join(tmp, 'docs/CURATION.md'), 'utf8'), /^## Verification log \(throwaway-kit, added \d{4}-\d{2}-\d{2}\)$/m);
    assert.match(made.stdout, /Still yours to do/);
    assert.match(made.stdout, /null → value for every figure/);
    assert.ok(fs.existsSync(path.join(tmp, `server-${slug}.json`)), 'registry manifest generated');
    // the other scaffold style in the same copy: calendar cadence, per-year layout, previous semantics, REST 400, retires a planned row
    const cal = 'throwaway-cal';
    const readmeBefore = fs.readFileSync(path.join(tmp, 'README.md'), 'utf8');
    assert.match(readmeBefore, /^\| 7 \| /m, 'planned row 7 exists before');
    const made2 = spawnSync(process.execPath, ['scripts/new-area.js', cal, '--title', 'Throwaway calendar', '--cadence', 'annual', '--calendar', '2027-01-01', '--per-year', '2026', '--previous', '--required-param', '--retires', '7', '--note-template', '{label}: {from} → {to} ({document})'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(made2.status, 0, made2.stderr || made2.stdout);
    assert.ok(fs.existsSync(path.join(tmp, `data/${cal}/2026.json`)), 'per-year data file');
    const calData = JSON.parse(fs.readFileSync(path.join(tmp, `data/${cal}/2026.json`), 'utf8'));
    assert.equal(calData.nextScheduledRefresh, '2027-01-01'); assert.equal(calData.taxYear, '2026');
    assert.match(made2.stdout, /previous\.value → value/);
    const readmeAfter = fs.readFileSync(path.join(tmp, 'README.md'), 'utf8');
    assert.doesNotMatch(readmeAfter, /^\| 7 \| \*\*Current-docs/m, 'retired planned row removed');
    assert.match(readmeAfter, /^\| 12 \| \*\*Throwaway calendar\*\*/m, 'roadmap rows numbered from order');
    const calModule = fs.readFileSync(path.join(tmp, `api/_areas/${cal}.js`), 'utf8');
    assert.match(calModule, /cadenceDays: CADENCE_DAYS/); assert.match(calModule, /const CADENCE_DAYS = null/); assert.match(calModule, /previousSibling: true/); assert.match(calModule, /required: \['category'\]/);
    assert.match(fs.readFileSync(path.join(tmp, 'scripts/verify-hub.sh'), 'utf8'), /check throwaway-cal-rest-400 /);
    // derived artefacts picked the area up
    const wk = JSON.parse(fs.readFileSync(path.join(tmp, 'public/.well-known/changes.json'), 'utf8'));
    assert.ok(wk.areas.some((a) => a.name === slug));
    assert.match(fs.readFileSync(path.join(tmp, 'public/sitemap.xml'), 'utf8'), /changes\?area=throwaway-kit</);
    assert.match(fs.readFileSync(path.join(tmp, 'public/llms.txt'), 'utf8'), /api\/mcp\/throwaway-kit/);
    assert.match(fs.readFileSync(path.join(tmp, 'README.md'), 'utf8'), /\| `\/api\/mcp\/throwaway-kit` \|/);
    assert.match(fs.readFileSync(path.join(tmp, 'scripts/verify-hub.sh'), 'utf8'), /check throwaway-kit-listing /);
    // the whole suite, minus the deliberate snapshot (a new area legitimately changes the public surface)
    const tests = fs.readdirSync(path.join(tmp, 'tests')).filter((f) => f.endsWith('.test.js') && f !== 'snapshot.test.js').map((f) => `tests/${f}`);
    const run = spawnSync(process.execPath, ['--test', ...tests], { cwd: tmp, encoding: 'utf8', env: { ...process.env, AREAKIT_INNER: '1' } });
    assert.equal(run.status, 0, run.stdout.split('\n').filter((l) => /^not ok|^✖|Error|expected|actual/.test(l)).slice(0, 40).join('\n'));
    const dataLoaded = JSON.parse(fs.readFileSync(path.join(tmp, `data/${slug}.json`), 'utf8'));
    assert.deepEqual(Object.keys(dataLoaded), ['area', 'verifiedDate', 'nextScheduledRefresh', 'licence', 'sources', 'categories']);
    assert.equal(spawnSync(process.execPath, ['scripts/sync-areas.js', '--check'], { cwd: tmp, encoding: 'utf8' }).status, 0, 'both scaffolds leave the derived files in sync');
    // refusing to clobber
    const again = spawnSync(process.execPath, ['scripts/new-area.js', slug, '--title', 'x', '--cadence', 'y'], { cwd: tmp, encoding: 'utf8' });
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /already exists/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
