// tests/tax.test.js — take_home_pay: live proxy to the LifeByNumbers salary calculators (fetch mocked, offline)
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const T = require('../api/_tax');
const { ALL_TOOLS, SERVERS } = require('../api/_registry');
const taxServer = require('../api/router').ROUTES['mcp/tax'];
const frontDoor = require('../api/_routes/mcp');
const takeHomeRest = require('../api/router').ROUTES['tax/take-home'];
const r = require('../api/_routes/r');
const { coverageFor } = require('../api/_coverage');

const get = (handler, url) => invoke(handler, undefined, { method: 'GET', url });

function mockFetch(impl) {
  const calls = [];
  const original = T.deps.fetch;
  T.deps.fetch = async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return impl(url, opts); };
  return { calls, restore: () => { T.deps.fetch = original; } };
}
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// Real Lambda responses captured 2026-10-03 (see api/_tax.js header for the contract).
const UK_50K = { _cached: false, annualTakeHome: 39519.6, effectiveRate: 21.0, employerPensionContribution: 1500.0, incomeTax: 7486.0, marginalRate: 20, monthlyTakeHome: 3293.3, nationalInsurance: 2994.4, pensionContribution: 0.0, pro_rata_info: { multiplier: 1, unit: 'annual', value: 0 }, studentLoanRepayment: 0, weeklyTakeHome: 759.99 };
const US_100K_TX_MJ = { _cached: false, contribution401k: 0.0, effectiveTaxRate: 15.3, federalTax: 7640.0, fica: 7650.0, grossAnnual: 100000, healthInsurance: 0, medicare: 1450.0, netAnnual: 84710.0, netBiweekly: 3258.08, netMonthly: 7059.17, socialSecurity: 6200.0, stateTax: 0.0, totalDeductions: 15290.0 };
const DE_4000 = { _cached: false, arbeitgeberSozialversicherung: 942.0, arbeitgeberkosten: 4942.0, arbeitgeberkostenJaehrlich: 59304.0, arbeitslosenversicherung: 52.0, beitragsbemessungsgrenzeKV: 5812.5, beitragsbemessungsgrenzeRV: 8450, bruttogehalt: 4000.0, bruttogehaltJaehrlich: 48000.0, effektiverSteuersatz: 27.8, grundfreibetrag: 12348, kirchensteuer: 0, krankenversicherung: 350.0, lohnsteuer: 242.17, nettolohn: 2887.83, nettolohnJaehrlich: 34654.0, pflegeversicherung: 96.0, rentenversicherung: 372.0, solidaritaetszuschlag: 0, sozialversicherung: 870.0, steuerklasse: 1, totalAbzuege: 1112.17 };

/* ---------------- schema, annotations, registry ---------------- */

test('take_home_pay: registered on the tax server, open-world, read-only, ten-country enum, no imperatives in the description', async () => {
  const t = ALL_TOOLS.take_home_pay;
  assert.equal(t.server, 'tax');
  assert.equal(t.serverUrl, 'https://databutler.dev/api/mcp/tax');
  assert.equal(t.freshness, 'live');
  assert.deepEqual(t.inputSchema.properties.country.enum, ['uk', 'us', 'ca', 'au', 'in', 'br', 'pl', 'fr', 'de', 'es']);
  assert.deepEqual(t.inputSchema.required, ['country', 'gross']);
  assert.deepEqual(t.inputSchema.properties.period.enum, ['annual', 'monthly']);
  assert.deepEqual(t.annotations, { title: 'Take-home pay', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
  // Directory policy: descriptions state what the tool returns; guidance lives in server instructions.
  assert.doesNotMatch(t.description, /\b(use this|you should|always|never|call this|do not)\b/i);
  assert.match(SERVERS.tax.instructions, /take_home_pay/);
  const list = await rpc(taxServer, 'tools/list');
  assert.deepEqual(list.body.result.tools.map((x) => x.name), ['take_home_pay']);
  assert.deepEqual(Object.keys(list.body.result.tools[0]).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title']);
  const init = await rpc(taxServer, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.body.result.serverInfo.name, 'databutler-tax');
});

test('every country entry names a currency, tax year and calculator page; only Spain lacks an upstream calculator', () => {
  for (const [code, c] of Object.entries(T.COUNTRIES)) {
    assert.match(c.currency, /^[A-Z]{3}$/, code);
    assert.ok(c.taxYear, code);
    assert.match(c.page, /^https:\/\/www\.lifebynumbers\.net\/[a-z]{2}\/calculators\/[a-z]{2}-salary$/, code);
    if (code !== 'es') {
      assert.equal(c.calculatorId, `${code}-salary`);
      assert.ok(Array.isArray(c.lines) && c.lines.length >= 2, code);
      assert.equal(typeof c.input, 'function');
      assert.equal(typeof c.assumptions, 'function');
    }
  }
  assert.equal(T.COUNTRIES.es.calculatorId, null);
  assert.equal(T.TIMEOUT_MS, 8000);
});

/* ---------------- happy paths ---------------- */

test('UK: posts {calculatorId, input} to the Lambda, returns annual+monthly figures, typed breakdown, tax year 2026/27', async () => {
  const m = mockFetch(() => jsonResponse(200, UK_50K));
  try {
    const out = await T.takeHomePay({ country: 'uk', gross: 50000 });
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].url, `${T.UPSTREAM}/calculate`);
    assert.equal(m.calls[0].opts.method, 'POST');
    assert.equal(m.calls[0].opts.headers['User-Agent'], 'databutler-hub/1.0 (+https://databutler.dev)');
    assert.equal(m.calls[0].opts.headers['Content-Type'], 'application/json');
    assert.ok(m.calls[0].opts.signal, 'abort signal for the 8s timeout');
    assert.deepEqual(m.calls[0].body, { calculatorId: 'uk-salary', input: { grossSalary: 50000, taxRegion: 'england', studentLoan: 'none', pensionPercent: 0, pensionType: 'standard', taxCode: '1257L' } });

    assert.equal(out.country, 'uk');
    assert.equal(out.currency, 'GBP');
    assert.equal(out.taxYear, '2026/27');
    assert.deepEqual(out.gross, { annual: 50000, monthly: 4166.67 });
    assert.deepEqual(out.net, { annual: 39519.6, monthly: 3293.3 });
    assert.deepEqual(out.totalDeductions, { annual: 10480.4, monthly: 873.37 });
    assert.equal(out.effectiveRate, 21);
    assert.deepEqual(out.breakdown.map((l) => [l.key, l.type, l.annual]), [
      ['incomeTax', 'tax', 7486], ['nationalInsurance', 'social', 2994.4], ['pensionContribution', 'contribution', 0], ['studentLoanRepayment', 'repayment', 0],
    ]);
    assert.equal(out.breakdownNote, undefined, 'lines reconcile with gross - net');
    assert.equal(out.details.marginalRate, 20);
    assert.ok(out.assumptions.some((a) => /England, Wales or Northern Ireland/.test(a)));
    assert.equal(out.source, 'https://www.lifebynumbers.net/uk/calculators/uk-salary');
    assert.equal(out.upstreamProvenance.attribution, 'lifebynumbers.net');
    assert.equal(out.upstreamProvenance.calculatorId, 'uk-salary');
    assert.equal(out.upstreamProvenance.requested, `${T.UPSTREAM}/calculate`);
    assert.equal(out.upstreamResult._cached, undefined, 'upstream cache flag is stripped');
    assert.equal(out.upstreamResult.weeklyTakeHome, 759.99, 'raw upstream result is passed through');
    assert.match(out.dataOrigin, /LifeByNumbers/);
    assert.equal(out.attribution, undefined, 'no collision with the envelope');
  } finally { m.restore(); }
});

test('UK: region=scotland flips taxRegion; other UK regions map to england', async () => {
  const m = mockFetch(() => jsonResponse(200, UK_50K));
  try {
    await T.takeHomePay({ country: 'uk', gross: 50000, region: 'Scotland' });
    assert.equal(m.calls[0].body.input.taxRegion, 'scotland');
    await T.takeHomePay({ country: 'uk', gross: 50000, region: 'wales' });
    assert.equal(m.calls[1].body.input.taxRegion, 'england');
    const bad = await T.takeHomePay({ country: 'uk', gross: 50000, region: 'mars' });
    assert.equal(bad.covered, false);
    assert.equal(m.calls.length, 2, 'invalid region never hits the network');
  } finally { m.restore(); }
});

test('US: state and filingStatus pass through (upper/lower-cased), monthly period is annualised, 2026 tax year', async () => {
  const m = mockFetch(() => jsonResponse(200, US_100K_TX_MJ));
  try {
    const out = await T.takeHomePay({ country: 'us', gross: 8333.333333, period: 'monthly', state: 'tx', filingStatus: 'MARRIED_JOINT' });
    const sent = m.calls[0].body;
    assert.equal(sent.calculatorId, 'us-salary');
    assert.equal(sent.input.state, 'TX');
    assert.equal(sent.input.filingStatus, 'married_joint');
    assert.ok(Math.abs(sent.input.annualSalary - 100000) < 0.001, 'monthly × 12');
    assert.equal(sent.input.k401Percent, 0);
    assert.equal(sent.input.healthInsurancePremium, 0);
    assert.equal(out.currency, 'USD');
    assert.equal(out.taxYear, '2026');
    assert.deepEqual(out.input, { gross: 8333.333333, period: 'monthly' });
    assert.equal(out.gross.annual, 100000);
    assert.deepEqual(out.net, { annual: 84710, monthly: 7059.17 });
    assert.equal(out.effectiveRate, 15.3);
    assert.deepEqual(out.breakdown.filter((l) => l.type === 'social').map((l) => l.key), ['socialSecurity', 'medicare']);
    assert.ok(out.assumptions.some((a) => /state: TX/.test(a)));
    assert.ok(out.assumptions.some((a) => /married_joint/.test(a)));
  } finally { m.restore(); }
});

test('monthly-based upstreams (DE): annual gross is divided by 12 on the way out and every line is ×12 on the way back', async () => {
  const m = mockFetch(() => jsonResponse(200, DE_4000));
  try {
    const out = await T.takeHomePay({ country: 'de', gross: 48000 });
    assert.deepEqual(m.calls[0].body, { calculatorId: 'de-salary', input: { monthlySalary: 4000, taxClass: 1, churchTax: false, state: 'other', hasChildren: false } });
    assert.equal(out.currency, 'EUR');
    assert.equal(out.taxYear, '2026');
    assert.deepEqual(out.gross, { annual: 48000, monthly: 4000 });
    assert.deepEqual(out.net, { annual: 34653.96, monthly: 2887.83 });
    assert.equal(out.breakdown.find((l) => l.key === 'lohnsteuer').monthly, 242.17);
    assert.equal(out.breakdown.find((l) => l.key === 'rentenversicherung').annual, 4464);
    assert.equal(out.details.taxClass, 1);
  } finally { m.restore(); }
});

/* ---------------- failure and near-miss paths ---------------- */

test('upstream failure: timeout and network errors are clean "upstream unavailable" results; HTTP errors say retry only for 5xx/429', async () => {
  let m = mockFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  try {
    const out = await T.takeHomePay({ country: 'uk', gross: 50000 });
    assert.equal(out.error, 'upstream unavailable');
    assert.equal(out.upstream, 'lifebynumbers.net');
    assert.equal(out.reason, 'timeout');
    assert.equal(out.retry, true);
    assert.match(out.message, /8s/);
    assert.equal(out.source, 'https://www.lifebynumbers.net/uk/calculators/uk-salary');
    assert.equal(out.upstreamProvenance.attribution, 'lifebynumbers.net');
  } finally { m.restore(); }
  m = mockFetch(() => { throw new Error('getaddrinfo ENOTFOUND'); });
  try {
    const out = await T.takeHomePay({ country: 'de', gross: 48000 });
    assert.equal(out.error, 'upstream unavailable');
    assert.match(out.reason, /ENOTFOUND/);
  } finally { m.restore(); }
  m = mockFetch(() => ({ ok: false, status: 503, json: async () => { throw new Error('not json'); } }));
  try {
    const out = await T.takeHomePay({ country: 'fr', gross: 42000 });
    assert.equal(out.error, 'upstream HTTP 503');
    assert.equal(out.retry, true);
  } finally { m.restore(); }
  m = mockFetch(() => jsonResponse(400, { error: 'Unknown calculator: uk-salary' }));
  try {
    const out = await T.takeHomePay({ country: 'uk', gross: 50000 });
    assert.equal(out.error, 'upstream HTTP 400');
    assert.equal(out.retry, false);
    assert.equal(out.upstreamError, 'Unknown calculator: uk-salary');
  } finally { m.restore(); }
  // The Lambda answers 200 with {error} for some inputs; that is still an error, not a result.
  m = mockFetch(() => jsonResponse(200, { error: "can't multiply sequence by non-int of type 'float'" }));
  try {
    const out = await T.takeHomePay({ country: 'uk', gross: 50000 });
    assert.equal(out.error, 'upstream HTTP 200');
    assert.match(out.upstreamError, /multiply/);
  } finally { m.restore(); }
});

test('bad country, bad gross, bad period, bad state/province are near-misses that never hit the network', async () => {
  const m = mockFetch(() => { throw new Error('should not be called'); });
  try {
    const xx = await T.takeHomePay({ country: 'xx', gross: 1000 });
    assert.equal(xx.covered, false);
    assert.match(xx.message, /unknown country/);
    assert.deepEqual(xx.coverage, T.COUNTRY_CODES);
    assert.ok(Array.isArray(xx.nearest) && xx.nearest.length === 3);
    assert.equal(m.calls.length, 0);
  } finally { m.restore(); }
  // country is case/space tolerant
  const ok = mockFetch(() => jsonResponse(200, UK_50K));
  try {
    assert.equal((await T.takeHomePay({ country: 'UK ', gross: 1000 })).country, 'uk');
    assert.equal(ok.calls[0].body.calculatorId, 'uk-salary');
  } finally { ok.restore(); }
  const m2 = mockFetch(() => { throw new Error('should not be called'); });
  try {
    assert.equal((await T.takeHomePay({})).covered, false);
    assert.match((await T.takeHomePay({ country: 'uk' })).message, /positive number/);
    assert.equal((await T.takeHomePay({ country: 'uk', gross: 'abc' })).covered, false);
    assert.equal((await T.takeHomePay({ country: 'uk', gross: -5 })).covered, false);
    assert.equal((await T.takeHomePay({ country: 'uk', gross: 50000, period: 'weekly' })).covered, false);
    const st = await T.takeHomePay({ country: 'us', gross: 50000, state: 'ZZ' });
    assert.equal(st.covered, false);
    assert.deepEqual(st.coverage, T.US_STATES);
    assert.equal((await T.takeHomePay({ country: 'us', gross: 50000, filingStatus: 'widow' })).covered, false);
    const pr = await T.takeHomePay({ country: 'ca', gross: 50000, province: 'XX' });
    assert.equal(pr.covered, false);
    assert.deepEqual(pr.coverage, T.CA_PROVINCES);
    assert.equal(m2.calls.length, 0);
  } finally { m2.restore(); }
});

test('Spain: listed in the enum, answers covered:false with the calculator link, no network call', async () => {
  const m = mockFetch(() => { throw new Error('should not be called'); });
  try {
    const out = await T.takeHomePay({ country: 'es', gross: 40000 });
    assert.equal(out.covered, false);
    assert.equal(out.country, 'es');
    assert.equal(out.currency, 'EUR');
    assert.match(out.message, /client-side/);
    assert.equal(out.source, 'https://www.lifebynumbers.net/es/calculators/es-salary');
    assert.deepEqual(out.coverage, ['uk', 'us', 'ca', 'au', 'in', 'br', 'pl', 'fr', 'de']);
    assert.equal(m.calls.length, 0);
  } finally { m.restore(); }
});

/* ---------------- MCP server, front door, REST, citation page, coverage ---------------- */

test('MCP: tools/call on /api/mcp/tax and the front door both carry the live envelope and a cite permalink', async () => {
  const m = mockFetch(() => jsonResponse(200, UK_50K));
  try {
    const direct = await callTool(taxServer, 'take_home_pay', { country: 'uk', gross: 50000 });
    assert.equal(direct.isError, false);
    assert.equal(direct.data.net.annual, 39519.6);
    assert.equal(direct.data.freshness.staleness, 'live');
    assert.equal(direct.data.cite.url, 'https://databutler.dev/r/tax/take-home?country=uk&gross=50000');
    assert.match(direct.data.cite.text, /computed live \d{4}-\d{2}-\d{2} against https:\/\/www\.lifebynumbers\.net\/uk\/calculators\/uk-salary/);
    assert.equal(direct.data.attribution, 'databutler.dev');

    const list = await rpc(frontDoor, 'tools/list');
    assert.ok(list.body.result.tools.some((t) => t.name === 'take_home_pay'), 'listed directly at the front door');
    const fd = await callTool(frontDoor, 'take_home_pay', { country: 'uk', gross: 50000, region: 'scotland' });
    assert.equal(fd.isError, false);
    assert.equal(fd.data.cite.url, 'https://databutler.dev/r/tax/take-home?country=uk&gross=50000&region=scotland');
    const viaCall = await callTool(frontDoor, 'call', { tool: 'take_home_pay', arguments: { country: 'uk', gross: 50000 } });
    assert.equal(viaCall.data.upstreamProvenance.attribution, 'lifebynumbers.net');
    const cat = await callTool(frontDoor, 'catalogue', { query: 'salary' });
    assert.ok(cat.data.tools.some((t) => t.name === 'take_home_pay' && t.server === 'tax' && t.listedAtFrontDoor === true));
  } finally { m.restore(); }
});

test('REST GET /api/tax/take-home mirrors the tool: numeric gross, 400 without country/gross, envelope + cite', async () => {
  assert.equal((await get(takeHomeRest, '/api/tax/take-home')).status, 400);
  assert.equal((await get(takeHomeRest, '/api/tax/take-home?country=uk')).status, 400);
  assert.equal((await get(takeHomeRest, '/api/tax/take-home?gross=50000')).status, 400);
  const m = mockFetch(() => jsonResponse(200, US_100K_TX_MJ));
  try {
    const res = await get(takeHomeRest, '/api/tax/take-home?country=us&gross=100000&state=TX&filingStatus=married_joint');
    assert.equal(res.status, 200);
    assert.equal(m.calls[0].body.input.annualSalary, 100000, 'query string gross becomes a number');
    assert.equal(res.body.net.annual, 84710);
    assert.equal(res.body.freshness.staleness, 'live');
    assert.equal(res.body.cite.url, 'https://databutler.dev/r/tax/take-home?country=us&gross=100000&state=TX&filingStatus=married_joint');
    assert.equal(res.body.attribution, 'databutler.dev');
  } finally { m.restore(); }
});

test('/r/tax/take-home citation page renders the answer with the calculator link; upstream outage still renders', async () => {
  let m = mockFetch(() => jsonResponse(200, UK_50K));
  try {
    const res = await get(r, '/api/r?path=tax/take-home&country=uk&gross=50000');
    assert.equal(res.status, 200);
    assert.equal(m.calls[0].body.input.grossSalary, 50000, 'query gross is numeric for the tool');
    assert.match(String(res.raw), /lifebynumbers\.net\/uk\/calculators\/uk-salary/);
    assert.match(String(res.raw), /href="\/api\/tax\/take-home\?country=uk&amp;gross=50000"/);
    assert.match(String(res.raw), /39519\.6/);
  } finally { m.restore(); }
  m = mockFetch(() => { throw new Error('offline'); });
  try {
    const res = await get(r, '/api/r?path=tax/take-home&country=de&gross=48000');
    assert.equal(res.status, 200);
    assert.match(String(res.raw), /upstream unavailable/);
  } finally { m.restore(); }
});

test('coverage area "tax" lists all ten countries, flags Spain as not computed, names the options', () => {
  const cov = coverageFor('tax');
  assert.equal(cov.area, 'tax');
  assert.equal(cov.tool, 'take_home_pay');
  assert.deepEqual(Object.keys(cov.countries), T.COUNTRY_CODES);
  assert.equal(cov.countries.es.computed, false);
  assert.equal(cov.countries.uk.computed, true);
  assert.equal(cov.countries.uk.taxYear, '2026/27');
  assert.deepEqual(cov.options, { us: ['state', 'filingStatus'], ca: ['province'], uk: ['region'] });
  assert.ok(cov.notCovered.some((x) => /Spain/.test(x)));
});
