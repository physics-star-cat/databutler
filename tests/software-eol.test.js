// tests/software-eol.test.js — software end-of-life: dataset shape + provenance, version → cycle
// resolution, supported/unsupported at injected dates, near-misses, timeline, MCP + REST, cite, builder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const E = require('../api/_software_eol');
const { ALL_TOOLS, SERVERS } = require('../api/_registry');
const { freshnessFor } = require('../api/_freshness');
const { coverageFor } = require('../api/_coverage');
const { CHANGELOG_AREAS } = require('../api/_changelog');
const S = require('../scripts/software-eol');
const server = require('../api/router').ROUTES['mcp/software-eol'];
const frontDoor = require('../api/_routes/mcp');
const statusRest = require('../api/router').ROUTES['software-eol/status'];
const timelineRest = require('../api/router').ROUTES['software-eol/timeline'];
const cite = require('../api/_routes/r');

const D = E.DATA;
const PRODUCTS = ['nodejs', 'python', 'ubuntu', 'debian', 'android', 'ios', 'macos', 'windows', 'oracle-jdk', 'go', 'ruby', 'php', 'postgresql', 'react'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const NOW = new Date('2026-10-03T12:00:00Z'); // the snapshot day
const get = (handler, url) => invoke(handler, undefined, { method: 'GET', url });

test('dataset: 14 products, provenance header, licence, 35-day refresh, every cycle well-formed', () => {
  assert.deepEqual(Object.keys(D.products), PRODUCTS);
  assert.equal(D.productCount, 14);
  assert.equal(D.cycleCount, Object.values(D.products).reduce((n, p) => n + p.cycles.length, 0));
  assert.ok(D.cycleCount >= 300, `cycles ${D.cycleCount}`);
  assert.equal(D.source, 'https://endoflife.date/');
  assert.equal(D.api, 'https://endoflife.date/api/');
  assert.equal(D.repository, 'https://github.com/endoflife-date/endoflife.date');
  assert.match(D.licence, /^MIT License/);
  assert.match(D.attribution, /endoflife\.date/);
  assert.match(D.verifiedDate, ISO);
  assert.equal(D.verifiedDate, D.fetched.slice(0, 10));
  assert.equal(D.nextScheduledRefresh, S.plusDays(D.verifiedDate, 35));
  assert.ok(D.cycleFields.eol && D.cycleFields.support && D.cycleFields.lts);
  for (const [id, p] of Object.entries(D.products)) {
    assert.equal(p.id, id);
    assert.equal(p.page, `https://endoflife.date/${id}`);
    assert.equal(p.api, `https://endoflife.date/api/${id}.json`);
    assert.equal(p.cycleCount, p.cycles.length);
    assert.ok(p.name && p.kind, id);
    const ids = new Set();
    for (const c of p.cycles) {
      assert.ok(typeof c.cycle === 'string' && c.cycle, `${id} cycle id`);
      assert.ok(!ids.has(c.cycle), `${id} duplicate ${c.cycle}`); ids.add(c.cycle);
      assert.ok(c.releaseDate === null || ISO.test(c.releaseDate), `${id} ${c.cycle} releaseDate`);
      assert.ok(c.eol === false || c.eol === true || ISO.test(c.eol), `${id} ${c.cycle} eol ${c.eol}`);
      assert.ok(typeof c.lts === 'boolean' || ISO.test(c.lts), `${id} ${c.cycle} lts`);
      assert.ok(c.latest === null || typeof c.latest === 'string', `${id} ${c.cycle} latest`);
      if (c.support !== undefined) assert.ok(c.support === true || ISO.test(c.support), `${id} ${c.cycle} support`);
      if (c.extendedSupport !== undefined) assert.ok(c.extendedSupport === true || ISO.test(c.extendedSupport), `${id} ${c.cycle} extendedSupport`);
      if (c.link !== undefined) assert.ok(c.link.startsWith('http') && !c.link.includes('__LATEST__'), `${id} ${c.cycle} link`);
    }
  }
  // the brief's product list, by the site's own ids: Java is oracle-jdk
  assert.equal(D.products['oracle-jdk'].name, 'Oracle JDK (Java SE)');
  assert.equal(D.products.nodejs.cycles.find((c) => c.cycle === '18').eol, '2025-04-30');
  const fresh = freshnessFor('software-eol', new Date(`${D.verifiedDate}T12:00:00Z`));
  assert.equal(fresh.verifiedDate, D.verifiedDate);
  assert.equal(fresh.staleness, 'fresh');
  assert.equal(freshnessFor('software-eol', new Date(`${S.plusDays(D.verifiedDate, 34)}T12:00:00Z`)).staleness, 'fresh');
  assert.equal(freshnessFor('software-eol', new Date(`${S.plusDays(D.verifiedDate, 36)}T12:00:00Z`)).staleness, 'due');
  assert.equal(freshnessFor('software-eol', new Date(`${S.plusDays(D.verifiedDate, 60)}T12:00:00Z`)).staleness, 'overdue');
});

test('version resolution: cycle ids, full releases, v-prefix, product name repeated, codenames, legacy Java, Windows editions', () => {
  const r = (product, version) => { const p = E.findProduct(product).p; const x = E.resolveCycle(p, version); return x && (x.candidates ? { candidates: x.candidates.map((c) => c.cycle) } : [x.cycle.cycle, x.matchedBy]); };
  assert.deepEqual(r('nodejs', '18'), ['18', 'exact']);
  assert.deepEqual(r('nodejs', '18.19.0'), ['18', 'prefix']);
  assert.deepEqual(r('node', 'v18.19.0'), ['18', 'prefix']);
  assert.deepEqual(r('nodejs', 'Node.js 20'), ['20', 'exact']);
  assert.deepEqual(r('python', '3.11'), ['3.11', 'exact']);
  assert.deepEqual(r('python', '3.11.4'), ['3.11', 'prefix']);
  assert.deepEqual(r('python', '3.1'), ['3.1', 'exact'], '3.1 is its own cycle, not a prefix of 3.11');
  assert.deepEqual(r('python', 'Python 2.7.18'), ['2.7', 'prefix']);
  assert.deepEqual(r('ubuntu', '22.04'), ['22.04', 'exact']);
  assert.deepEqual(r('ubuntu', '22.04.3 LTS'), ['22.04', 'prefix']);
  assert.deepEqual(r('ubuntu', 'jammy'), ['22.04', 'codename']);
  assert.deepEqual(r('debian', 'bookworm'), ['12', 'codename']);
  assert.deepEqual(r('debian', 'Debian 12.5'), ['12', 'prefix']);
  assert.deepEqual(r('macos', 'Sonoma'), ['14', 'codename']);
  assert.deepEqual(r('macos', '10.15.7'), ['10.15', 'prefix']);
  assert.deepEqual(r('postgres', '9.6.24'), ['9.6', 'prefix']);
  assert.deepEqual(r('postgresql', '14.10'), ['14', 'prefix']);
  assert.deepEqual(r('ruby', '3.2.2'), ['3.2', 'prefix']);
  assert.deepEqual(r('ruby', '2.0.0'), ['2.0.0', 'exact']);
  assert.deepEqual(r('go', '1.21.5'), ['1.21', 'prefix']);
  assert.deepEqual(r('golang', 'go1.22'), ['1.22', 'exact']);
  assert.deepEqual(r('php', '8.2.1'), ['8.2', 'prefix']);
  assert.deepEqual(r('react', '18.2.0'), ['18', 'prefix']);
  assert.deepEqual(r('android', '14'), ['14', 'exact']);
  assert.deepEqual(r('ios', '17.5'), ['17', 'prefix']);
  assert.deepEqual(r('java', '17.0.9'), ['17', 'prefix']);
  assert.deepEqual(r('jdk', '1.8.0_392'), ['8', 'prefix']);
  assert.deepEqual(r('java', '1.8'), ['8', 'exact']);
  assert.deepEqual(r('java', '1.4'), ['1.4', 'exact'], '1.4 keeps its own id');
  assert.deepEqual(r('windows', '11-24h2-w'), ['11-24h2-w', 'exact']);
  assert.deepEqual(r('windows', 'Windows 11 24H2 (W)'.replace(/[()]/g, '')), ['11-24h2-w', 'exact']);
  assert.deepEqual(r('windows', '11 24H2').candidates.sort(), ['11-24h2-e', '11-24h2-e-lts', '11-24h2-iot-lts', '11-24h2-w']);
  assert.deepEqual(r('windows', '10-22h2'), ['10-22h2', 'exact']);
  assert.ok(r('windows', '11').candidates.length > 5);
  assert.equal(r('nodejs', '99'), null);
  assert.equal(r('nodejs', ''), null);
  assert.equal(r('ubuntu', '22'), null, 'a bare year is not a cycle');
});

test('support_status: unsupported cycle — supported:false, days since eol, newest supported LTS, plain-statement recommendation, provenance', () => {
  const out = E.supportStatus({ product: 'nodejs', version: '18.19.0' }, NOW);
  assert.equal(out.covered, undefined);
  assert.equal(out.product, 'nodejs'); assert.equal(out.productName, 'Node.js'); assert.equal(out.kind, 'runtime');
  assert.deepEqual(out.requested, { product: 'nodejs', version: '18.19.0' });
  assert.equal(out.cycle, '18'); assert.equal(out.matchedBy, 'prefix');
  assert.equal(out.releaseDate, '2022-04-19');
  assert.equal(out.supported, false);
  assert.equal(out.eol, '2025-04-30');
  assert.equal(out.daysSinceEol, 521); assert.equal(out.daysRemaining, undefined);
  assert.equal(out.activeSupportEnds, '2023-10-18'); assert.equal(out.inActiveSupport, false);
  assert.equal(out.lts, true); assert.equal(out.ltsFrom, '2022-10-25');
  assert.equal(out.latest, '18.20.8');
  assert.equal(out.isNewestCycle, false);
  assert.equal(out.newestCycle.cycle, D.products.nodejs.cycles[0].cycle);
  assert.equal(out.newestSupportedLts.cycle, '24'); assert.equal(out.newestSupportedLts.lts, true);
  assert.match(out.recommendation, /^Node\.js 18 reached end of life on 2025-04-30, 521 days before 2026-10-03; no further security fixes are published for it\./);
  assert.match(out.recommendation, /newest supported LTS cycle is Node\.js 24 \(latest 24\.21\.0, supported until 2028-04-30\)/);
  assert.doesNotMatch(out.recommendation, /\b(upgrade|you should|must|please|do not)\b/i, 'plain statements, not imperatives');
  assert.equal(out.asOf, '2026-10-03');
  assert.equal(out.source, 'https://endoflife.date/nodejs');
  assert.equal(out.verifiedDate, D.verifiedDate);
  assert.match(out.licence, /MIT/);
  assert.deepEqual(out.upstreamProvenance, {
    attribution: 'endoflife.date', link: 'https://endoflife.date/nodejs', api: 'https://endoflife.date/api/nodejs.json',
    repository: 'https://github.com/endoflife-date/endoflife.date', licence: 'MIT License', fetched: D.fetched, verifiedDate: D.verifiedDate,
  });
  assert.ok(out.definitions.eol && out.definitions.supported);
  assert.equal(out.note, undefined, 'no note key: the envelope attribution note must survive');
});

test('support_status: supported cycle — days remaining, security-only phase, LTS as of date, latest patch, newest cycle', () => {
  const py = E.supportStatus({ product: 'python', version: '3.11.4' }, NOW);
  assert.equal(py.supported, true); assert.equal(py.eol, '2027-10-31'); assert.equal(py.daysRemaining, 393); assert.equal(py.daysSinceEol, undefined);
  assert.equal(py.inActiveSupport, false); assert.equal(py.activeSupportEnds, '2024-04-01');
  assert.match(py.recommendation, /^Python 3\.11 is supported until 2027-10-31, 393 days from 2026-10-03\. Active support ended 2024-04-01; the cycle receives security fixes only\. The latest Python 3\.11 release at the snapshot is 3\.11\.\d+\. The newest supported cycle is Python 3\.14/);
  assert.equal(py.newestSupportedLts, undefined, 'Python has no LTS cycles');
  const ub = E.supportStatus({ product: 'ubuntu', version: '22.04' }, NOW);
  assert.equal(ub.supported, true); assert.equal(ub.lts, true); assert.equal(ub.codename, 'Jammy Jellyfish');
  assert.equal(ub.extendedSupportEnds, '2032-04-21');
  // Node 26 becomes LTS on 2026-10-28: not LTS on the snapshot day, LTS a month later
  const n26 = E.supportStatus({ product: 'nodejs', version: '26' }, NOW);
  assert.equal(n26.lts, false); assert.equal(n26.ltsFrom, '2026-10-28'); assert.equal(n26.isNewestCycle, true);
  assert.equal(E.supportStatus({ product: 'nodejs', version: '26' }, new Date('2026-11-15T00:00:00Z')).lts, true);
  // no eol date set → supported, no day counts, recommendation says so
  const go = E.supportStatus({ product: 'go', version: '1.27.1' }, NOW);
  assert.equal(go.supported, true); assert.equal(go.eol, null); assert.equal(go.daysRemaining, undefined);
  assert.match(go.recommendation, /records no end-of-life date/);
});

test('support_status: the clock decides — the same cycle flips at its eol date', () => {
  const before = E.supportStatus({ product: 'python', version: '3.9' }, new Date('2025-10-30T00:00:00Z'));
  const after = E.supportStatus({ product: 'python', version: '3.9' }, new Date('2025-11-01T00:00:00Z'));
  assert.equal(before.eol, '2025-10-31'); assert.equal(before.supported, true); assert.equal(before.daysRemaining, 1);
  assert.equal(after.supported, false); assert.equal(after.daysSinceEol, 1);
  assert.equal(E.supportStatus({ product: 'python', version: '3.9' }, new Date('2025-10-31T09:00:00Z')).supported, false, 'eol day itself is end of life');
  const java17 = E.supportStatus({ product: 'java', version: '17.0.9' }, NOW);
  assert.equal(java17.product, 'oracle-jdk'); assert.equal(java17.cycle, '17'); assert.equal(java17.supported, false); assert.equal(java17.eol, '2026-09-30');
  assert.equal(java17.extendedSupportEnds, '2029-09-30');
  assert.match(java17.recommendation, /Extended support from the vendor runs to 2029-09-30/);
});

test('support_status near-misses: unknown product → covered:false + nearest; unknown version → nearest cycles; missing version; Windows ambiguity → candidates', () => {
  const rust = E.supportStatus({ product: 'rust', version: '1.70' }, NOW);
  assert.equal(rust.covered, false); assert.deepEqual(rust.requested, { product: 'rust' });
  assert.equal(rust.nearest[0], 'ruby'); assert.equal(Object.keys(rust.coverage.products).length, 14);
  const openjdk = E.supportStatus({ product: 'openjdk', version: '21' }, NOW);
  assert.equal(openjdk.covered, false); assert.equal(openjdk.nearest[0], 'oracle-jdk', 'OpenJDK is a different distribution, surfaced as nearest not aliased');
  assert.equal(E.supportStatus({}, NOW).covered, false);
  const v99 = E.supportStatus({ product: 'nodejs', version: '99' }, NOW);
  assert.equal(v99.covered, false); assert.equal(v99.product, 'nodejs'); assert.match(v99.message, /no Node\.js release cycle matches "99"/);
  assert.ok(Array.isArray(v99.nearest) && v99.nearest.length > 0 && v99.cycles.includes('18'));
  const y22 = E.supportStatus({ product: 'ubuntu', version: '22' }, NOW);
  assert.equal(y22.covered, false); assert.ok(y22.nearest.includes('22.04'), y22.nearest.join());
  const noV = E.supportStatus({ product: 'ubuntu' }, NOW);
  assert.equal(noV.covered, false); assert.match(noV.message, /pass a version/); assert.match(noV.hint, /support_timeline/);
  const win = E.supportStatus({ product: 'windows', version: '11 24H2' }, NOW);
  assert.equal(win.covered, undefined); assert.equal(win.resolved, false);
  assert.equal(win.candidates.length, 4);
  assert.ok(win.candidates.every((c) => typeof c.supported === 'boolean' && c.cycle.startsWith('11-24h2')));
  assert.match(win.hint, /pass one cycle id/);
  const w = E.supportStatus({ product: 'win', version: '11-24h2-w' }, NOW);
  assert.equal(w.cycle, '11-24h2-w'); assert.equal(w.releaseLabel, '11 24H2 (W)'); assert.equal(w.matchedBy, 'exact');
});

test('support_timeline: every cycle newest first with supported flags, supported list, newest LTS, summary; near-miss for unknown product', () => {
  const out = E.supportTimeline({ product: 'php' }, NOW);
  assert.equal(out.product, 'php'); assert.equal(out.cycleCount, D.products.php.cycles.length);
  assert.deepEqual(out.cycles.map((c) => c.cycle), D.products.php.cycles.map((c) => c.cycle));
  assert.deepEqual(out.supportedCycles, ['8.5', '8.4', '8.3', '8.2']);
  for (const c of out.cycles) {
    assert.equal(typeof c.supported, 'boolean');
    assert.ok(c.eol === null || ISO.test(c.eol));
    assert.equal(c.supported, c.eol === null ? true : c.eol > '2026-10-03', c.cycle);
    assert.equal(typeof c.lts, 'boolean');
    assert.ok('activeSupportEnds' in c);
  }
  assert.match(out.summary, /^PHP: \d+ release cycles on record, 4 supported as of 2026-10-03 \(8\.5, 8\.4, 8\.3, 8\.2\); newest cycle 8\.5, latest release 8\.5\.\d+\.$/);
  assert.equal(out.source, 'https://endoflife.date/php');
  assert.equal(out.upstreamProvenance.attribution, 'endoflife.date');
  const node = E.supportTimeline({ product: 'node' }, NOW);
  assert.equal(node.newestSupportedLts, '24');
  assert.equal(node.cycles.find((c) => c.cycle === '26').lts, false);
  const win = E.supportTimeline({ product: 'windows' }, NOW);
  assert.ok(win.cycles.every((c) => c.releaseLabel));
  const miss = E.supportTimeline({ product: 'centos' }, NOW);
  assert.equal(miss.covered, false); assert.ok(miss.nearest.length);
});

test('registry: software-eol server lists both tools, read-only, not open-world, descriptions are statements', async () => {
  for (const name of ['support_status', 'support_timeline']) {
    const t = ALL_TOOLS[name];
    assert.equal(t.server, 'software-eol'); assert.equal(t.serverUrl, 'https://databutler.dev/api/mcp/software-eol'); assert.equal(t.freshness, 'software-eol');
    assert.equal(t.annotations.openWorldHint, false); assert.equal(t.annotations.readOnlyHint, true);
    assert.doesNotMatch(t.description, /\b(use this|you should|always|never|call this|do not)\b/i);
    assert.match(t.description, /endoflife\.date/);
  }
  assert.deepEqual(ALL_TOOLS.support_status.inputSchema.required, ['product', 'version']);
  assert.deepEqual(ALL_TOOLS.support_timeline.inputSchema.required, ['product']);
  assert.match(SERVERS['software-eol'].instructions, /support_status/);
  const list = await rpc(server, 'tools/list');
  assert.deepEqual(list.body.result.tools.map((x) => x.name), ['support_status', 'support_timeline']);
  const init = await rpc(server, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.body.result.serverInfo.name, 'databutler-software-eol');
});

test('MCP: tools/call on the server and via the front door call carry the dataset freshness and a cite permalink', async () => {
  const direct = await callTool(server, 'support_status', { product: 'nodejs', version: '18.19.0' });
  assert.equal(direct.isError, false);
  assert.equal(direct.data.cycle, '18'); assert.equal(direct.data.supported, false);
  assert.equal(direct.data.freshness.verifiedDate, D.verifiedDate);
  assert.ok(['fresh', 'due', 'overdue'].includes(direct.data.freshness.staleness));
  assert.equal(direct.data.cite.url, 'https://databutler.dev/r/software-eol/status?product=nodejs&version=18.19.0');
  assert.match(direct.data.cite.text, /^databutler\.dev, verified \d{4}-\d{2}-\d{2} against https:\/\/endoflife\.date\/nodejs$/);
  assert.equal(direct.data.attribution, 'databutler.dev'); assert.equal(direct.data.upstreamProvenance.attribution, 'endoflife.date');
  assert.match(direct.data.note, /Verified reference data/, 'envelope attribution note intact');
  const viaCall = await callTool(frontDoor, 'call', { tool: 'support_timeline', arguments: { product: 'postgres' } });
  assert.equal(viaCall.isError, false);
  assert.equal(viaCall.data.product, 'postgresql');
  assert.equal(viaCall.data.cite.url, 'https://databutler.dev/r/software-eol/timeline?product=postgres');
  const fd = await rpc(frontDoor, 'tools/list');
  assert.ok(!fd.body.result.tools.some((t) => t.name === 'support_status'), 'behind call, not listed at the front door');
  const cat = await callTool(frontDoor, 'catalogue', { query: 'support' });
  assert.deepEqual(cat.data.tools.map((t) => t.name).sort(), ['support_status', 'support_timeline']);
});

test('REST: GET /api/software-eol/status and /timeline mirror the tools; 400 without required params; envelope + cite', async () => {
  assert.equal((await get(statusRest, '/api/software-eol/status')).status, 400);
  assert.equal((await get(statusRest, '/api/software-eol/status?product=nodejs')).status, 400);
  assert.equal((await get(statusRest, '/api/software-eol/status?version=18')).status, 400);
  assert.match((await get(statusRest, '/api/software-eol/status?product=nodejs')).body.error, /missing \?version=/);
  assert.equal((await get(timelineRest, '/api/software-eol/timeline')).status, 400);
  const ok = await get(statusRest, '/api/software-eol/status?product=ubuntu&version=22.04.3');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.cycle, '22.04'); assert.equal(typeof ok.body.supported, 'boolean');
  assert.equal(ok.body.freshness.verifiedDate, D.verifiedDate);
  assert.equal(ok.body.cite.url, 'https://databutler.dev/r/software-eol/status?product=ubuntu&version=22.04.3');
  const tl = await get(timelineRest, '/api/software-eol/timeline?product=react');
  assert.equal(tl.status, 200); assert.equal(tl.body.cycleCount, D.products.react.cycles.length);
  assert.equal(tl.body.cite.url, 'https://databutler.dev/r/software-eol/timeline?product=react');
  const miss = await get(statusRest, '/api/software-eol/status?product=rust&version=1');
  assert.equal(miss.status, 200); assert.equal(miss.body.covered, false);
});

test('/r/software-eol citation pages render the answer with the endoflife.date source link', async () => {
  const r = await get(cite, '/api/r?path=software-eol/status&product=nodejs&version=18.19.0');
  assert.equal(r.status, 200);
  assert.match(r.headers['X-Robots-Tag'], /noindex/);
  assert.match(String(r.raw), /"cycle": "18"/);
  assert.match(String(r.raw), /href="https:\/\/endoflife\.date\/nodejs"/);
  assert.match(String(r.raw), /\/api\/software-eol\/status\?product=nodejs&amp;version=18\.19\.0/);
  const t = await get(cite, '/api/r?path=software-eol/timeline&product=debian');
  assert.equal(t.status, 200);
  assert.match(String(t.raw), /Bookworm/);
});

test('coverage area software-eol: 14 products with names and cycle counts, aliases, notCovered names the other Java distributions', () => {
  const cov = coverageFor('software-eol');
  assert.equal(cov.area, 'software-eol');
  assert.deepEqual(Object.keys(cov.products), PRODUCTS);
  assert.equal(cov.products['oracle-jdk'].name, 'Oracle JDK (Java SE)');
  assert.equal(cov.aliases.java, 'oracle-jdk'); assert.equal(cov.aliases.postgres, 'postgresql');
  assert.equal(cov.cycles, D.cycleCount); assert.equal(cov.verifiedDate, D.verifiedDate);
  assert.ok(cov.notCovered.some((x) => /openjdk-builds-from-oracle/.test(x)));
  assert.ok(cov.notCovered.some((x) => /RHEL/.test(x)));
  assert.ok(CHANGELOG_AREAS.includes('software-eol'));
});

/* ---------------- builder + changelog entries (scripts/software-eol.js) ---------------- */

const rawOf = (overrides = {}) => {
  const raw = {};
  for (const id of S.PRODUCT_IDS) raw[id] = [{ cycle: '1', releaseDate: '2020-01-01', eol: false, lts: false, latest: '1.0.0' }];
  raw.nodejs = [
    { cycle: '26', releaseDate: '2026-05-05', lts: '2026-10-28', eol: '2029-04-30', latest: '26.10.0', latestReleaseDate: '2026-09-22', support: '2027-10-27', extendedSupport: false },
    { cycle: '24', releaseDate: '2025-05-06', lts: '2025-10-28', eol: '2028-04-30', latest: '24.21.0', support: '2026-10-20' },
    { cycle: '22', releaseDate: '2024-04-24', lts: true, eol: '2027-04-30', latest: '22.22.0', support: '2025-10-21' },
  ];
  raw.ruby = [{ cycle: '4.0', releaseDate: '2025-12-25', eol: '2029-03-31', latest: '4.0.7', link: 'https://github.com/ruby/ruby/releases/tag/v__LATEST__', lts: false }];
  raw.windows = [{ cycle: '11-24h2-w', releaseLabel: '11 24H2 (W)', releaseDate: '2024-10-01', eol: '2026-10-14', latest: '10.0.26100', link: 'https://learn.microsoft.com/x', lts: false, support: '2026-10-14', extendedSupport: false }];
  raw.android = [{ cycle: '17', apiVersion: '37', codename: 'Cinnamon Bun', releaseDate: '2026-06-16', eol: false, lts: false }];
  return { ...raw, ...overrides };
};

test('builder: normalises cycles as published (eol false/true/date, lts date, Ruby link template), header provenance, 35-day refresh, refuses partial snapshots', () => {
  const d = S.buildFrom(rawOf(), { fetched: '2026-10-03T09:00:00.000Z', via: 'test' });
  assert.equal(d.verifiedDate, '2026-10-03'); assert.equal(d.nextScheduledRefresh, '2026-11-07');
  assert.equal(d.productCount, 14); assert.equal(d.cycleCount, 10 + 3 + 1 + 1 + 1);
  assert.match(d.licence, /^MIT License — https:\/\/github\.com\/endoflife-date\/endoflife\.date\/blob\/master\/LICENSE/);
  assert.equal(d.source, 'https://endoflife.date/'); assert.equal(d.fetchedVia, 'test');
  const n26 = d.products.nodejs.cycles[0];
  assert.deepEqual(n26, { cycle: '26', releaseDate: '2026-05-05', eol: '2029-04-30', lts: '2026-10-28', latest: '26.10.0', latestReleaseDate: '2026-09-22', support: '2027-10-27' }, 'extendedSupport:false dropped, lts date kept');
  assert.equal(d.products.nodejs.cycles[2].lts, true);
  assert.equal(d.products.ruby.cycles[0].link, 'https://github.com/ruby/ruby/releases/tag/v4.0.7');
  assert.deepEqual(d.products.android.cycles[0], { cycle: '17', releaseDate: '2026-06-16', eol: false, lts: false, latest: null, codename: 'Cinnamon Bun', apiVersion: '37' });
  assert.equal(d.products.windows.cycles[0].releaseLabel, '11 24H2 (W)');
  assert.equal(d.products['oracle-jdk'].name, 'Oracle JDK (Java SE)'); assert.equal(d.products['oracle-jdk'].page, 'https://endoflife.date/oracle-jdk');
  assert.equal(S.normaliseCycle({ cycle: 7, eol: true }, 'x').eol, true);
  assert.throws(() => S.normaliseCycle({ cycle: '1', eol: 'soon' }, 'x'), /eol must be a date or boolean/);
  const partial = rawOf(); delete partial.react;
  assert.throws(() => S.buildFrom(partial, { fetched: '2026-10-03T09:00:00.000Z' }), /missing product data for react/);
});

test('datasetEntries: first derivation → <product>/dataset per product; later runs → eol moved, newly end of life, new cycle; nothing when unchanged', () => {
  const prev = S.buildFrom(rawOf(), { fetched: '2026-10-03T09:00:00.000Z', via: 'test' });
  const first = S.datasetEntries(null, prev, { today: '2026-10-04' });
  assert.equal(first.length, 14);
  assert.deepEqual(Object.keys(first[0]), ['area', 'key', 'label', 'from', 'to', 'effectiveFrom', 'source', 'verifiedDate', 'note']);
  const n = first.find((e) => e.key === 'nodejs/dataset');
  assert.equal(n.area, 'software-eol'); assert.equal(n.from, null); assert.equal(n.to, 'covered');
  assert.equal(n.effectiveFrom, '2026-10-03'); assert.equal(n.verifiedDate, '2026-10-04'); assert.equal(n.source, 'https://endoflife.date/nodejs');
  assert.match(n.note, /3 release cycles \(2024-04-24 → 2026-05-05\), 3 not yet at end of life/); assert.match(n.note, /MIT/);
  assert.deepEqual(S.datasetEntries(prev, prev), [], 'same snapshot, no entries');

  const raw2 = rawOf();
  raw2.nodejs = [
    { cycle: '27', releaseDate: '2026-10-20', eol: '2027-06-01', lts: false, latest: '27.0.0' },             // new cycle
    { ...raw2.nodejs[0], eol: '2029-05-31' },                                                                 // eol moved
    raw2.nodejs[1],
    raw2.nodejs[2],
  ];
  raw2.windows[0] = { ...raw2.windows[0] };                                                                   // eol 2026-10-14: reached between snapshots
  const next = S.buildFrom(raw2, { fetched: '2026-11-05T09:00:00.000Z', via: 'test' });
  const later = S.datasetEntries(prev, next, { today: '2026-11-05' });
  assert.deepEqual(later.map((e) => [e.key, e.from, e.to, e.effectiveFrom, e.verifiedDate]), [
    ['nodejs/27', null, 'released', '2026-10-20', '2026-11-05'],
    ['nodejs/26', '2029-04-30', '2029-05-31', '2029-05-31', '2026-11-05'],
    ['windows/11-24h2-w', 'supported', 'end of life', '2026-10-14', '2026-11-05'],
  ]);
  assert.equal(later[1].label, 'Node.js 26 end of life'); assert.equal(later[2].label, 'Windows 11 24H2 (W) support status');
  assert.ok(later.every((e) => e.area === 'software-eol' && e.note === '' && e.source.startsWith('https://endoflife.date/')));
  // eol withdrawn (date → false) records the old date → null, effective from the snapshot day
  const raw3 = rawOf(); raw3.nodejs = [{ ...rawOf().nodejs[0], eol: false }, ...rawOf().nodejs.slice(1)];
  const next3 = S.buildFrom(raw3, { fetched: '2026-11-05T09:00:00.000Z', via: 'test' });
  const e3 = S.datasetEntries(prev, next3).find((e) => e.key === 'nodejs/26');
  assert.deepEqual([e3.from, e3.to, e3.effectiveFrom], ['2029-04-30', null, '2026-11-05']);
  // a product absent from the previous file gets its dataset entry
  const prevMinus = JSON.parse(JSON.stringify(prev)); delete prevMinus.products.react;
  assert.deepEqual(S.datasetEntries(prevMinus, prev, { today: '2026-10-04' }).map((e) => e.key), ['react/dataset']);
});
