// tests/policy-rates.test.js — central-bank policy rates (BoE, Fed, ECB): committed data, tool, server,
// front door, REST mirror, citation page, coverage, freshness, changelog entries, watched sources, docs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rpc, callTool, invoke } = require('./helpers');
const P = require('../api/_policy_rates');
const POLICY = require('../data/policy-rates.json');
const CHANGELOG = require('../data/changelog.json');
const SEEN = require('../data/sources.json');
const { ALL_TOOLS, SERVERS } = require('../api/_registry');
const server = require('../api/router').ROUTES['mcp/policy-rates'];
const frontDoor = require('../api/_routes/mcp');
const rest = require('../api/router').ROUTES['policy-rates'];
const r = require('../api/_routes/r');
const router = require('../api/router');
const { coverageFor } = require('../api/_coverage');
const { freshnessFor, DUE_WINDOW_DAYS } = require('../api/_freshness');
const { changesSince, listEntries, entryId, CHANGELOG_AREAS } = require('../api/_changelog');
const AREA_MODULE = require('../api/_areas/policy-rates');
const diffPolicyRates = AREA_MODULE.changelog.diff;
const { whatChangedSince, coverage, catalogue, HUB_TOOLS } = require('../api/_hub');
const call = HUB_TOOLS.find((t) => t.name === 'call');
const { sourceUrls } = require('../api/_sources');
const POLICY_REFRESH_DAYS = AREA_MODULE.freshness.cadenceDays;

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const get = (h, url) => invoke(h, undefined, { method: 'GET', url });
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const BANKS = ['boe', 'fed', 'ecb'];
const day = (iso) => new Date(`${iso}T12:00:00Z`);
const plusDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const figure = (bank, key) => POLICY.banks[bank].figures.find((f) => f.key === key).value;

/* ---------------- data ---------------- */

test('data: three banks, every figure with an official source, decision page and verifiedDate; 45-day refresh', () => {
  assert.deepEqual(Object.keys(POLICY.banks), BANKS);
  assert.match(POLICY.verifiedDate, ISO);
  assert.equal(POLICY_REFRESH_DAYS, 45);
  assert.equal(POLICY.nextScheduledRefresh, plusDays(POLICY.verifiedDate, 45));
  assert.match(POLICY.verificationMethod, /never written from memory/);
  const HOSTS = { boe: 'https://www.bankofengland.co.uk/', fed: 'https://www.federalreserve.gov/', ecb: 'https://www.ecb.europa.eu/' };
  for (const [k, b] of Object.entries(POLICY.banks)) {
    assert.ok(b.name && b.committee && b.jurisdiction && b.rateName, k);
    assert.match(b.currency, /^[A-Z]{3}$/);
    assert.ok(b.source.startsWith(HOSTS[k]), `${k} source is the bank's own page`);
    assert.ok(b.decisionSource.startsWith(HOSTS[k]), `${k} decision page is the bank's own`);
    assert.ok(b.latestDecision.source.startsWith(HOSTS[k]), k);
    assert.match(b.verifiedDate, ISO); assert.ok(b.verifiedDate <= POLICY.verifiedDate, k);
    assert.match(b.effectiveFrom, ISO); assert.match(b.decisionDate, ISO);
    assert.ok(b.decisionDate <= b.effectiveFrom, `${k}: decision on or before effect`);
    assert.ok(b.effectiveFrom <= b.verifiedDate, `${k}: in effect when verified`);
    assert.match(b.latestDecision.date, ISO); assert.ok(b.latestDecision.date >= b.decisionDate, k);
    assert.match(b.nextDecision, ISO); assert.ok(b.nextDecision > b.latestDecision.date, `${k}: next decision after the latest one`);
    assert.equal(b.decisionsPerYear, 8);
    assert.ok(b.decisionMeeting.length > 40 && b.notes.length > 40, k);
    assert.ok(Array.isArray(b.figures) && b.figures.length >= 1, k);
    for (const f of b.figures) {
      assert.match(f.key, /^[a-z-]+$/); assert.ok(f.label);
      assert.equal(typeof f.value, 'number'); assert.equal(f.unit, '%');
    }
    assert.deepEqual(b.previous.figures.map((f) => f.key), b.figures.map((f) => f.key), `${k}: previous mirrors the figure keys`);
    assert.match(b.previous.effectiveFrom, ISO); assert.ok(b.previous.effectiveFrom < b.effectiveFrom, k);
    assert.ok(b.figures.some((f, i) => f.value !== b.previous.figures[i].value), `${k}: previous is a different level`);
  }
  assert.ok(figure('fed', 'target-range-lower') < figure('fed', 'target-range-upper'));
  assert.ok(figure('ecb', 'deposit-facility') < figure('ecb', 'main-refinancing') && figure('ecb', 'main-refinancing') < figure('ecb', 'marginal-lending'), 'ECB corridor');
  // The levels read from the banks' pages on 2026-10-03 (docs/CURATION.md verification log) — update with the data file.
  assert.equal(figure('boe', 'bank-rate'), 3.75);
  assert.deepEqual([figure('fed', 'target-range-lower'), figure('fed', 'target-range-upper')], [3.75, 4.0]);
  assert.deepEqual(['deposit-facility', 'main-refinancing', 'marginal-lending'].map((k) => figure('ecb', k)), [2.5, 2.65, 2.9]);
  assert.equal(POLICY.banks.boe.effectiveFrom, '2025-12-18'); assert.equal(POLICY.banks.boe.nextDecision, '2026-11-05');
  assert.equal(POLICY.banks.fed.effectiveFrom, '2026-09-17'); assert.equal(POLICY.banks.fed.decisionDate, '2026-09-16');
  assert.equal(POLICY.banks.ecb.effectiveFrom, '2026-09-16'); assert.equal(POLICY.banks.ecb.decisionDate, '2026-09-10');
});

/* ---------------- registry, server, annotations ---------------- */

test('policy_rate: registered on its own server, read-only, closed-world, plain-statement description', async () => {
  const t = ALL_TOOLS.policy_rate;
  assert.equal(t.server, 'policy-rates');
  assert.equal(t.serverUrl, 'https://databutler.dev/api/mcp/policy-rates');
  assert.equal(t.freshness, 'policy-rates');
  assert.deepEqual(t.inputSchema.properties.bank.enum, BANKS);
  assert.equal(t.inputSchema.properties.all.type, 'boolean');
  assert.equal(t.inputSchema.required, undefined, 'bank is optional because all: true exists');
  assert.deepEqual(t.annotations, { title: 'Central-bank policy rate', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.doesNotMatch(t.description, /\b(use this|you should|always|never|call this|do not)\b/i);
  assert.match(t.description, /Bank of England/); assert.match(t.description, /Federal Reserve/); assert.match(t.description, /European Central Bank/);
  assert.match(SERVERS['policy-rates'].instructions, /policy_rate/);
  assert.match(SERVERS['policy-rates'].instructions, /nextDecision/);
  const list = await rpc(server, 'tools/list');
  assert.deepEqual(list.body.result.tools.map((x) => x.name), ['policy_rate']);
  assert.deepEqual(Object.keys(list.body.result.tools[0]).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title']);
  const init = await rpc(server, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.body.result.serverInfo.name, 'databutler-policy-rates');
});

/* ---------------- tool: happy paths ---------------- */

test('each bank: figures, dates, previous, next decision, source and the dataset envelope with a cite permalink', async () => {
  for (const k of BANKS) {
    const { isError, data } = await callTool(server, 'policy_rate', { bank: k });
    assert.equal(isError, false, k);
    assert.equal(data.covered, undefined, k);
    assert.equal(data.bank, k);
    assert.equal(data.name, POLICY.banks[k].name);
    assert.deepEqual(data.figures, POLICY.banks[k].figures);
    assert.equal(data.effectiveFrom, POLICY.banks[k].effectiveFrom);
    assert.equal(data.decisionDate, POLICY.banks[k].decisionDate);
    assert.deepEqual(data.previous, POLICY.banks[k].previous);
    assert.equal(data.nextDecision, POLICY.banks[k].nextDecision);
    assert.equal(data.latestDecision.date, POLICY.banks[k].latestDecision.date);
    assert.equal(data.source, POLICY.banks[k].source);
    assert.equal(data.decisionSource, POLICY.banks[k].decisionSource);
    assert.equal(data.unit, '% per annum');
    assert.equal(data.verifiedDate, POLICY.banks[k].verifiedDate);
    assert.equal(data.freshness.verifiedDate, POLICY.verifiedDate);
    assert.equal(data.freshness.nextScheduledRefresh, POLICY.nextScheduledRefresh);
    assert.ok(['fresh', 'due', 'overdue'].includes(data.freshness.staleness), k);
    assert.equal(data.cite.url, `https://databutler.dev/r/policy-rates?bank=${k}`);
    assert.match(data.cite.text, new RegExp(`^databutler\\.dev, verified ${POLICY.verifiedDate} against ${POLICY.banks[k].source.replace(/[.?+]/g, '\\$&')}$`));
    assert.equal(data.attribution, 'databutler.dev');
  }
});

test('common names resolve to the bank key; case and whitespace are ignored', () => {
  assert.equal(P.policyRate({ bank: 'Bank of England' }).bank, 'boe');
  assert.equal(P.policyRate({ bank: ' FOMC ' }).bank, 'fed');
  assert.equal(P.policyRate({ bank: 'Federal Reserve' }).bank, 'fed');
  assert.equal(P.policyRate({ bank: 'eurozone' }).bank, 'ecb');
  assert.equal(P.policyRate({ bank: 'ECB' }).bank, 'ecb');
  assert.equal(P.resolveBank('uk'), 'boe'); assert.equal(P.resolveBank('us'), 'fed'); assert.equal(P.resolveBank('eu'), 'ecb');
  assert.equal(P.resolveBank('boj'), null); assert.equal(P.resolveBank(''), null); assert.equal(P.resolveBank(undefined), null);
});

test('all: true (or bank "all") returns every bank; no arguments returns the listing', async () => {
  const all = await callTool(server, 'policy_rate', { all: true });
  assert.equal(all.isError, false);
  assert.equal(all.data.count, 3);
  assert.deepEqual(all.data.banks.map((b) => b.bank), BANKS);
  assert.ok(all.data.banks.every((b) => b.source && b.figures.length && b.effectiveFrom && b.nextDecision));
  assert.equal(all.data.verifiedDate, POLICY.verifiedDate);
  assert.equal(all.data.cite.url, 'https://databutler.dev/r/policy-rates?all=true');
  assert.match(all.data.cite.text, /against https:\/\/www\.bankofengland\.co\.uk\//, 'first bank\'s source anchors the cite text');
  assert.deepEqual(P.policyRate({ bank: 'all' }).banks.map((b) => b.bank), BANKS);
  assert.deepEqual(P.policyRate({ bank: 'ecb', all: true }).banks.map((b) => b.bank), BANKS, 'all wins over bank');
  const listing = await callTool(server, 'policy_rate', {});
  assert.equal(listing.data.covered, undefined);
  assert.deepEqual(Object.keys(listing.data.banks), BANKS);
  assert.match(listing.data.banks.boe, /Bank of England — Bank Rate/);
  assert.match(listing.data.usage, /all: true/);
  assert.equal(listing.data.cite.url, 'https://databutler.dev/r/policy-rates');
});

/* ---------------- tool: near-misses ---------------- */

test('unknown bank → covered:false with nearest keys, coverage and notCovered (never an error)', async () => {
  const { isError, data } = await callTool(server, 'policy_rate', { bank: 'Bank of Japan' });
  assert.equal(isError, false);
  assert.equal(data.covered, false);
  assert.equal(data.requested, 'Bank of Japan');
  assert.match(data.message, /unknown bank/);
  assert.ok(Array.isArray(data.nearest) && data.nearest.length >= 1 && data.nearest.every((k) => BANKS.includes(k)));
  assert.deepEqual(data.coverage, BANKS);
  assert.ok(data.notCovered.some((x) => /Bank of Japan/.test(x)));
  assert.equal(data.error, undefined);
  assert.equal(P.policyRate({ bank: 'fedd' }).nearest[0], 'fed');
  assert.equal(P.policyRate({ bank: 'federal reserv' }).nearest[0], 'fed');
  assert.equal(P.policyRate({ bank: 'bank of englnd' }).nearest[0], 'boe');
  assert.deepEqual(P.nearestBanks('xyzxyz').length, 3, 'always offers the keys');
});

/* ---------------- front door ---------------- */

test('front door: policy_rate stays behind call (the 11 listed tools are unchanged), is catalogued, and the descriptions name it', async () => {
  const list = await rpc(frontDoor, 'tools/list');
  assert.equal(list.body.result.tools.length, 11);
  assert.ok(!list.body.result.tools.some((t) => t.name === 'policy_rate'));
  const via = await callTool(frontDoor, 'call', { tool: 'policy_rate', arguments: { bank: 'fed' } });
  assert.equal(via.isError, false);
  assert.equal(via.data.bank, 'fed');
  assert.equal(via.data.cite.url, 'https://databutler.dev/r/policy-rates?bank=fed');
  assert.equal(via.data.freshness.verifiedDate, POLICY.verifiedDate);
  const cat = await callTool(frontDoor, 'catalogue', { query: 'policy' });
  assert.ok(cat.data.tools.some((t) => t.name === 'policy_rate' && t.server === 'policy-rates' && t.serverUrl === 'https://databutler.dev/api/mcp/policy-rates' && t.listedAtFrontDoor === false));
  assert.match(call.description, /policy_rate/);
  assert.match(catalogue.description, /policy rates/);
  assert.match(whatChangedSince.description, /policy rates/);
  assert.match(coverage.description, /policy rates/);
  const init = await rpc(frontDoor, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.match(init.body.result.instructions, /policy_rate/);
});

/* ---------------- REST, router, citation page ---------------- */

test('REST GET /api/policy-rates: 400 without bank; bank=boe|all mirror the tool with envelope + cite', async () => {
  const bad = await get(rest, '/api/policy-rates');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /missing \?bank=/);
  assert.equal(bad.body.attribution, 'databutler.dev');
  const boe = await get(rest, '/api/policy-rates?bank=boe');
  assert.equal(boe.status, 200);
  assert.equal(boe.body.bank, 'boe');
  assert.equal(boe.body.figures[0].value, figure('boe', 'bank-rate'));
  assert.equal(boe.body.freshness.verifiedDate, POLICY.verifiedDate);
  assert.equal(boe.body.cite.url, 'https://databutler.dev/r/policy-rates?bank=boe');
  assert.equal(boe.body.attribution, 'databutler.dev');
  const all = await get(rest, '/api/policy-rates?bank=all');
  assert.equal(all.body.count, 3);
  const miss = await get(rest, '/api/policy-rates?bank=snb');
  assert.equal(miss.status, 200); assert.equal(miss.body.covered, false);
  // through the single router function, both the REST mirror and the MCP server
  const viaRouter = await get(router, '/api/router?route=policy-rates&bank=ecb');
  assert.equal(viaRouter.status, 200); assert.equal(viaRouter.body.bank, 'ecb');
  const mcp = await invoke(router, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { url: '/api/router?route=mcp/policy-rates' });
  assert.deepEqual(mcp.body.result.tools.map((t) => t.name), ['policy_rate']);
});

test('/r/policy-rates citation page renders the figures with the bank\'s source link and the REST link', async () => {
  const res = await get(r, '/api/r?path=policy-rates&bank=fed');
  assert.equal(res.status, 200);
  assert.equal(res.headers['X-Robots-Tag'], 'noindex');
  const html = String(res.raw);
  assert.match(html, /https:\/\/www\.federalreserve\.gov\/monetarypolicy\/openmarket\.htm/);
  assert.match(html, /monetary20260916a\.htm/);
  assert.match(html, /target-range-upper/);
  assert.match(html, new RegExp(`verified ${POLICY.verifiedDate}`));
  assert.match(html, /href="\/api\/policy-rates\?bank=fed"/);
  const all = await get(r, '/api/r?path=policy-rates&all=true');
  assert.equal(all.status, 200);
  assert.match(String(all.raw), /ecb\.europa\.eu/);
  const miss = await get(r, '/api/r?path=policy-rates&bank=boj');
  assert.equal(miss.headers['Cache-Control'], 'no-store');
});

/* ---------------- coverage, freshness ---------------- */

test('coverage area policy-rates: banks with figure keys and next decisions, explicit notCovered', () => {
  const cov = coverageFor('policy-rates');
  assert.equal(cov.area, 'policy-rates');
  assert.equal(cov.tool, 'policy_rate');
  assert.deepEqual(Object.keys(cov.banks), BANKS);
  assert.deepEqual(cov.banks.fed.figures, ['target-range-lower', 'target-range-upper']);
  assert.deepEqual(cov.banks.ecb.figures, ['deposit-facility', 'main-refinancing', 'marginal-lending']);
  assert.equal(cov.banks.boe.nextDecision, POLICY.banks.boe.nextDecision);
  assert.equal(cov.nextScheduledRefresh, POLICY.nextScheduledRefresh);
  assert.ok(cov.notCovered.some((x) => /Bank of Japan/.test(x)) && cov.notCovered.some((x) => /mortgage/.test(x)));
  assert.ok(coverageFor().areas.includes('policy-rates'));
  assert.equal(coverageFor('policy').covered, false);
  assert.equal(coverageFor('policy').nearest[0], 'policy-rates');
});

test('freshness: fresh until verifiedDate + 45 days, due for the 14-day window, then overdue', () => {
  const f = freshnessFor('policy-rates', day(POLICY.verifiedDate));
  assert.deepEqual(f, { verifiedDate: POLICY.verifiedDate, nextScheduledRefresh: POLICY.nextScheduledRefresh, staleness: 'fresh' });
  assert.equal(freshnessFor('policy-rates', day(plusDays(POLICY.verifiedDate, 44))).staleness, 'fresh');
  assert.equal(freshnessFor('policy-rates', day(plusDays(POLICY.verifiedDate, 45))).staleness, 'due');
  assert.equal(freshnessFor('policy-rates', day(plusDays(POLICY.verifiedDate, 45 + DUE_WINDOW_DAYS))).staleness, 'due');
  assert.equal(freshnessFor('policy-rates', day(plusDays(POLICY.verifiedDate, 46 + DUE_WINDOW_DAYS))).staleness, 'overdue');
});

/* ---------------- changelog ---------------- */

const POLICY_ENTRY_KEYS = ['area', 'key', 'label', 'from', 'to', 'unit', 'bank', 'bankName', 'decisionDate', 'effectiveFrom', 'source', 'verifiedDate', 'note'];

test('changelog: policy-rates is an area; six initial entries record each bank\'s last change, previous → current, from the decision page', () => {
  assert.ok(CHANGELOG_AREAS.includes('policy-rates'));
  const entries = CHANGELOG.filter((e) => e.area === 'policy-rates');
  assert.deepEqual(entries.map((e) => e.key).sort(), ['boe/bank-rate', 'ecb/deposit-facility', 'ecb/main-refinancing', 'ecb/marginal-lending', 'fed/target-range-lower', 'fed/target-range-upper']);
  for (const e of entries) {
    assert.deepEqual(Object.keys(e), POLICY_ENTRY_KEYS, e.key);
    const [bank, fig] = e.key.split('/');
    const b = POLICY.banks[bank];
    assert.equal(e.bankName, b.name); assert.equal(e.bank, bank);
    assert.equal(e.to, b.figures.find((f) => f.key === fig).value, `${e.key} to = current`);
    assert.equal(e.from, b.previous.figures.find((f) => f.key === fig).value, `${e.key} from = previous`);
    assert.notEqual(e.from, e.to);
    assert.equal(e.unit, '%');
    assert.equal(e.effectiveFrom, b.effectiveFrom); assert.equal(e.decisionDate, b.decisionDate);
    assert.equal(e.source, b.decisionSource, `${e.key} source is the decision page`);
    assert.equal(e.verifiedDate, b.verifiedDate);
    assert.match(e.label, new RegExp(`^${b.name}: `));
    assert.ok(e.note.length > 40, `${e.key} note names the meeting`);
    assert.match(e.note, /(MPC|FOMC|Governing Council)/, e.key);
    assert.match(e.note, /\b20\d\d\b/, e.key);
  }
  assert.equal(new Set(entries.map(entryId)).size, 6);
  assert.equal(changesSince({ since: '2026-09-01', area: 'policy-rates' }).count, 6);
  assert.equal(changesSince({ since: '2026-10-03', area: 'policy-rates' }).count, 0, 'verified on 2026-10-03, so not "after" it');
  assert.deepEqual(listEntries({ area: 'policy-rates' }).map((e) => e.key), entries.map((e) => e.key).sort(), 'same day: sorted by key');
  assert.match(changesSince({ since: '2026-01-01', area: 'policy rates' }).nearest[0], /policy-rates/);
});

test('diffPolicyRates: first run uses each bank\'s previous block; later runs record only moves, removals and new banks', () => {
  const first = diffPolicyRates(null, POLICY);
  assert.equal(first.length, 6);
  for (const e of first) { assert.deepEqual(Object.keys(e), POLICY_ENTRY_KEYS); assert.equal(e.note, ''); }
  assert.deepEqual(first.find((e) => e.key === 'boe/bank-rate'), {
    area: 'policy-rates', key: 'boe/bank-rate', label: 'Bank of England: Bank Rate', from: 4, to: 3.75, unit: '%', bank: 'boe', bankName: 'Bank of England',
    decisionDate: '2025-12-18', effectiveFrom: '2025-12-18', source: POLICY.banks.boe.decisionSource, verifiedDate: POLICY.banks.boe.verifiedDate, note: '',
  });
  assert.deepEqual(diffPolicyRates(POLICY, POLICY), [], 'nothing moved');
  // a BoE cut: only the Bank Rate entry, from the committed value
  const next = JSON.parse(JSON.stringify(POLICY));
  next.banks.boe.figures[0].value = 3.5; next.banks.boe.previous = { figures: [{ key: 'bank-rate', label: 'Bank Rate', value: 3.75, unit: '%' }], effectiveFrom: '2025-12-18' };
  next.banks.boe.effectiveFrom = '2026-11-05'; next.banks.boe.decisionDate = '2026-11-05'; next.banks.boe.decisionSource = 'https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/november-2026';
  next.banks.boe.verifiedDate = '2026-11-05'; next.verifiedDate = '2026-11-05';
  const cut = diffPolicyRates(POLICY, next);
  assert.deepEqual(cut.map((e) => [e.key, e.from, e.to, e.effectiveFrom, e.source, e.verifiedDate]), [['boe/bank-rate', 3.75, 3.5, '2026-11-05', next.banks.boe.decisionSource, '2026-11-05']]);
  // a removed figure and a removed bank are recorded as to: null; a new bank uses its previous block
  const smaller = JSON.parse(JSON.stringify(POLICY));
  smaller.banks.ecb.figures = smaller.banks.ecb.figures.slice(0, 1);
  delete smaller.banks.fed;
  smaller.banks.boj = { name: 'Bank of Japan', figures: [{ key: 'policy-rate', label: 'Policy rate', value: 1, unit: '%' }], previous: { figures: [{ key: 'policy-rate', label: 'Policy rate', value: 0.75, unit: '%' }], effectiveFrom: '2026-01-01' }, effectiveFrom: '2026-07-01', decisionDate: '2026-06-30', source: 'https://www.boj.or.jp/', verifiedDate: '2026-10-03' };
  const d = diffPolicyRates(POLICY, smaller);
  assert.deepEqual(d.map((e) => [e.key, e.from, e.to]).sort(), [['boj/policy-rate', 0.75, 1], ['ecb/main-refinancing', 2.65, null], ['ecb/marginal-lending', 2.9, null], ['fed/target-range-lower', 3.75, null], ['fed/target-range-upper', 4, null]]);
  assert.equal(d.find((e) => e.key === 'boj/policy-rate').source, 'https://www.boj.or.jp/', 'decisionSource falls back to source');
});

/* ---------------- watched sources ---------------- */

test('watcher: the three bank pages are source URLs and have recorded hashes in data/sources.json', () => {
  const urls = sourceUrls({ policy: [POLICY] });
  assert.deepEqual(urls, BANKS.map((k) => POLICY.banks[k].source));
  for (const u of urls) {
    const seen = SEEN.find((s) => s.url === u);
    assert.ok(seen, `${u} recorded`);
    assert.equal(seen.via, 'html');
    assert.match(seen.bodyHash, /^[0-9a-f]{16}$/);
    assert.match(seen.checkedAt, ISO);
    assert.ok(seen.checkedAt >= POLICY.verifiedDate);
  }
  // still collected alongside the UK sources
  assert.ok(sourceUrls({ rates: [{ categories: { a: { source: 'https://g/1' } } }], policy: [POLICY] }).length === 4);
});

/* ---------------- docs ---------------- */

test('discoverability: /api index, llms.txt, README, CURATION, sitemap and index.html all name the area', async () => {
  const api = await invoke(require('../api/index'), undefined, { method: 'GET', url: '/api' });
  assert.ok(api.body.endpoints['GET /api/policy-rates']);
  assert.match(api.body.endpoints['GET /api/policy-rates'].params.bank, /boe \| fed \| ecb \| all/);
  assert.ok(api.body.endpoints['POST /api/mcp/policy-rates']);
  assert.match(api.body.endpoints['GET /api/changes'].params.area, /policy-rates/);
  assert.deepEqual(Object.keys(api.body.coverage.policyRates), BANKS);
  assert.match(api.body.coverage.policyRates.boe, /3\.75% from 2025-12-18/);
  const llms = read('public/llms.txt');
  assert.match(llms, /https:\/\/databutler\.dev\/api\/policy-rates\?bank=boe/);
  assert.match(llms, /POST https:\/\/databutler\.dev\/api\/mcp\/policy-rates/);
  assert.match(llms, /area=uk-rates\|uk-exams\|vehicles\|software-eol\|policy-rates/);
  const readme = read('README.md');
  assert.match(readme, new RegExp(`^## Tool catalogue \\(${Object.keys(ALL_TOOLS).length} tools, ${Object.keys(SERVERS).length} focused servers \\+ front door\\)$`, 'm'));
  assert.match(readme, /\| `\/api\/mcp\/policy-rates` \| `policy_rate`/);
  assert.match(readme, /\*\*Policy rates\*\*/);
  const curation = read('docs/CURATION.md');
  assert.match(curation, /\| `data\/policy-rates\.json` \| Within 45 days/);
  assert.match(curation, /^## Verification log \(policy rates, added 2026-10-03\)$/m);
  for (const u of BANKS.map((k) => POLICY.banks[k].source)) assert.ok(curation.includes(u), `CURATION log cites ${u}`);
  assert.match(curation, /^- \*\*Policy rates\*\* \(`data\/policy-rates\.json`\)/m);
  assert.match(read('public/sitemap.xml'), /changes\?area=policy-rates</);
  assert.match(read('public/index.html'), /\/api\/mcp\/policy-rates/);
  assert.match(read('scripts/verify-hub.sh'), new RegExp(`d\\['count'\\]==${Object.keys(ALL_TOOLS).length}`));
  assert.match(read('scripts/verify-hub.sh'), /policy_rate/);
});
