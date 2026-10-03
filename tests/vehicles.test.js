const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const V = require('../api/_vehicles');
const M = require('../api/_mot');
const vehiclesServer = require('../api/router').ROUTES['mcp/vehicles'];
const frontDoor = require('../api/_routes/mcp');
const r = require('../api/_routes/r');
const { freshnessFor } = require('../api/_freshness');
const { changesSince, CHANGELOG_AREAS } = require('../api/_changelog');

const get = (handler, url) => invoke(handler, undefined, { method: 'GET', url });

/* ---------------- datasets ---------------- */

test('datasets: shape, counts, provenance and refresh dates', () => {
  assert.equal(V.FR.count, V.FR.records.length);
  assert.ok(V.FR.count >= 1600, 'FR fiches');
  assert.equal(V.FR.source, 'https://rappel.conso.gouv.fr/');
  assert.match(V.FR.licence, /Licence Ouverte/);
  assert.match(V.FR.verifiedDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(V.FR.nextScheduledRefresh > V.FR.verifiedDate);
  for (const rec of V.FR.records) {
    assert.match(rec.link, /^https:\/\/rappel\.conso\.gouv\.fr\//, rec.fiche);
    assert.match(rec.date, /^\d{4}-\d{2}-\d{2}$/);
    // One official fiche (Maxus eDeliver 7, sr/01309/26) has no marque_produit — served as published.
    assert.ok(rec.brands.length >= 1 || rec.brand === null, rec.fiche);
  }
  assert.equal(V.JP.counts.models, Object.keys(V.JP.models).length);
  assert.equal(V.JP.counts.recallFilings, Object.keys(V.JP.recalls).length);
  assert.ok(V.JP.counts.complaints > 19000);
  for (const rec of Object.values(V.JP.recalls)) {
    assert.match(rec.pdf, /^https:\/\/renrakuda\.mlit\.go\.jp\/mt\/recallpdf\/\d+\.pdf$/);
    assert.match(rec.date, /^\d{4}-\d{2}-\d{2}$/);
  }
  for (const m of Object.values(V.JP.models)) {
    assert.ok(m.makeEn && m.modelEn && m.make && m.model);
    for (const no of m.recallNos) assert.ok(V.JP.recalls[no], no);
  }
});

test('freshness: fr/jp datasets are dated from their fetch and scheduled monthly', () => {
  const fr = freshnessFor('fr-recalls', new Date(`${V.FR.verifiedDate}T12:00:00Z`));
  assert.equal(fr.verifiedDate, V.FR.verifiedDate);
  assert.equal(fr.staleness, 'fresh');
  const jp = freshnessFor('jp-recalls', new Date('2030-01-01T00:00:00Z'));
  assert.equal(jp.staleness, 'overdue');
  assert.ok(CHANGELOG_AREAS.includes('vehicles'));
  assert.equal(changesSince({ since: '2026-01-01', area: 'vehicles' }).area, 'vehicles');
});

/* ---------------- FR tools ---------------- */

test('fr_recalls_for_model: curated + text matches, newest first, official links', () => {
  const out = V.frRecallsForModel({ brand: 'Peugeot', model: '208' });
  assert.equal(out.brand, 'peugeot');
  assert.equal(out.curatedModel, 'Peugeot 208');
  assert.ok(out.count >= 40, `count ${out.count}`);
  assert.ok(out.recalls.every((x) => ['curated', 'text', 'curated+text'].includes(x.matchedBy)));
  assert.ok(out.recalls.every((x) => x.fiche && x.date && x.motif && x.link.startsWith('https://rappel.conso.gouv.fr/')));
  for (let i = 1; i < out.recalls.length; i++) assert.ok(out.recalls[i - 1].date >= out.recalls[i].date, 'sorted desc');
  assert.equal(out.source, 'https://rappel.conso.gouv.fr/');
  assert.match(out.attributionNote, /Licence Ouverte/);
});

test('fr_recalls_for_model: brand aliases (VW, Mercedes-Benz), brand-only listing, longest alias wins', () => {
  assert.equal(V.frRecallsForModel({ brand: 'VW', model: 'golf' }).brand, 'volkswagen');
  assert.ok(V.frRecallsForModel({ brand: 'Mercedes-Benz', model: 'classe a' }).count > 0);
  const all = V.frRecallsForModel({ brand: 'dacia' });
  assert.equal(all.model, null);
  assert.ok(all.count > 10 && all.recalls.length <= V.MAX_RESULTS);
  // "c3 aircross" fiches must not be counted as curated C3 hits
  const c3 = V.frRecallsForModel({ brand: 'citroen', model: 'c3' });
  const curatedOnly = c3.recalls.filter((x) => x.matchedBy !== 'text');
  assert.ok(curatedOnly.every((x) => !/c3 aircross/.test(x.models) || /\bc3\b(?! aircross)/.test(x.models)), 'curated c3 excludes aircross-only fiches');
});

test('fr_recalls_for_model: unknown brand → near-miss; unknown model → count 0 with hint; rare brand flags a possible misspelling', () => {
  const miss = V.frRecallsForModel({ brand: 'Renualt', model: 'clio' });
  assert.equal(miss.covered, false);
  assert.ok(miss.nearest.includes('renault'));
  assert.ok(miss.coverage.brands.includes('peugeot'));
  const none = V.frRecallsForModel({ brand: 'peugeot', model: 'zzzz' });
  assert.equal(none.count, 0);
  assert.ok(none.brandFicheCount > 100);
  assert.match(none.hint, /fr_recalls_search/);
  const rare = V.frRecallsForModel({ brand: 'peugot' }); // real misspelling in the official data
  assert.match(rare.rareBrandNote, /peugeot/);
  assert.equal(V.frRecallsForModel({}).covered, false);
});

test('fr_recalls_search: all tokens must match, since filters, bad since is a near-miss', () => {
  const out = V.frRecallsSearch({ text: 'airbag takata', since: '2026-01-01' });
  assert.ok(out.count > 0);
  assert.ok(out.recalls.every((x) => x.date >= '2026-01-01'));
  assert.ok(out.recalls.every((x) => /takata/.test(`${x.models} ${x.motif} ${x.label}`)));
  assert.equal(out.since, '2026-01-01');
  const none = V.frRecallsSearch({ text: 'qwertyuiop' });
  assert.equal(none.count, 0);
  assert.ok(none.hint);
  assert.equal(V.frRecallsSearch({ text: 'airbag', since: 'last year' }).covered, false);
  assert.equal(V.frRecallsSearch({}).covered, false);
});

/* ---------------- JP tools ---------------- */

test('jp_recalls_for_model: English, slug, Japanese and full-width names all resolve', () => {
  const en = V.jpRecallsForModel({ make: 'Toyota', model: 'Prius' });
  assert.equal(en.model.slug, 'toyota-prius');
  assert.ok(en.count > 10);
  assert.ok(en.recalls.every((x) => x.notificationNo && x.date && x.device && x.situation && x.officialPdf.startsWith('https://renrakuda.mlit.go.jp/mt/recallpdf/')));
  for (let i = 1; i < en.recalls.length; i++) assert.ok(en.recalls[i - 1].date >= en.recalls[i].date);
  assert.equal(V.jpRecallsForModel({ make: 'honda', model: 'N-BOX' }).count, V.jpRecallsForModel({ make: 'ホンダ', model: 'Ｎ－ＢＯＸ' }).count);
  assert.equal(V.jpRecallsForModel({ make: 'ホンダ', model: 'ｎ－ｂｏｘ' }).model.slug, 'honda-n-box');
  assert.equal(V.jpRecallsForModel({ make: 'mitsubishi', model: 'Delica D:5' }).model.slug, 'mitsubishi-delica-d5');
  assert.match(en.attributionNote, /国土交通省/);
});

test('jp tools: unknown make/model are near-misses listing coverage', () => {
  const noMake = V.jpRecallsForModel({ make: 'ford', model: 'focus' });
  assert.equal(noMake.covered, false);
  assert.ok(noMake.coverage.toyota.includes('Prius'));
  const noModel = V.jpComplaintsSummary({ make: 'toyota', model: 'supra' });
  assert.equal(noModel.covered, false);
  assert.ok(noModel.nearest.length > 0);
  assert.deepEqual(Object.keys(noModel.coverage), ['toyota']);
  assert.equal(V.jpRecallsForModel({}).covered, false);
});

test('jp_complaints_summary: totals, sampled breakdown with shares, recall count', () => {
  const out = V.jpComplaintsSummary({ make: 'honda', model: 'n-box' });
  assert.ok(out.complaints.total > 500);
  assert.ok(out.complaints.sampledForBreakdown <= 500);
  const shares = out.complaints.byDevice.map((d) => d.share);
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 100) < 1.5, `shares sum ${shares.reduce((a, b) => a + b, 0)}`);
  for (let i = 1; i < out.complaints.byDevice.length; i++) assert.ok(out.complaints.byDevice[i - 1].count >= out.complaints.byDevice[i].count);
  assert.equal(out.recallFilings, V.jpRecallsForModel({ make: 'honda', model: 'n-box' }).count);
  assert.equal(out.source, 'https://renrakuda.mlit.go.jp/');
});

test('eu_safety_gate_recalls is an explicit stub', () => {
  const out = V.euSafetyGateStub({ brand: 'x' });
  assert.equal(out.covered, false);
  assert.equal(out.status, 'planned');
  assert.equal(out.officialSource, V.EU_SAFETY_GATE_URL);
  assert.match(out.hint, /fr_recalls/);
});

/* ---------------- MOT proxy (mocked fetch) ---------------- */

function mockFetch(impl) {
  const calls = [];
  const original = M.deps.fetch;
  M.deps.fetch = async (url, opts) => { calls.push({ url, opts }); return impl(url, opts); };
  return { calls, restore: () => { M.deps.fetch = original; } };
}
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('MOT proxy: passes data through, moves whatbreaks attribution into upstreamProvenance, sets UA', async () => {
  const upstream = { vehicle: { id: 5, make: 'Volkswagen', model: 'GOLF Mk7' }, categories: [{ category: 'tyres', overallFailureRate: 0.068 }], attribution: 'whatbreaks.uk', link: 'https://whatbreaks.uk/', docs: 'https://whatbreaks.uk/api' };
  const m = mockFetch(() => jsonResponse(200, upstream));
  try {
    const out = await M.motReliability({ make: 'Volkswagen', model: 'Golf', year: 2018, mileage: 80000 });
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].url, 'https://whatbreaks.uk/api/mot?make=Volkswagen&model=Golf&year=2018&mileage=80000');
    assert.equal(m.calls[0].opts.headers['User-Agent'], 'databutler-hub/1.0 (+https://databutler.dev)');
    assert.ok(m.calls[0].opts.signal, 'abort signal for the 8s timeout');
    assert.equal(out.vehicle.model, 'GOLF Mk7');
    assert.equal(out.categories[0].category, 'tyres');
    assert.equal(out.attribution, undefined, 'upstream attribution key must not collide with the envelope');
    assert.equal(out.upstreamProvenance.attribution, 'whatbreaks.uk');
    assert.equal(out.upstreamProvenance.docs, 'https://whatbreaks.uk/api');
    assert.equal(out.source, m.calls[0].url);
    assert.match(out.dataOrigin, /Department for Transport/);
  } finally { m.restore(); }
});

test('MOT proxy: 404 is a near-miss, 400 is an upstream error, 5xx says retry, timeout is a clean error', async () => {
  let m = mockFetch(() => jsonResponse(404, { error: 'no matching vehicle — try /api/vehicles?q=<name> to see coverage.', attribution: 'whatbreaks.uk' }));
  try {
    const out = await M.motReliability({ make: 'Nope', model: 'Zzz' });
    assert.equal(out.covered, false);
    assert.equal(out.upstreamStatus, 404);
    assert.match(out.message, /no matching vehicle/);
    assert.match(out.hint, /uk_mot_vehicle_search/);
  } finally { m.restore(); }
  m = mockFetch(() => jsonResponse(400, { error: 'pass make and model' }));
  try {
    const out = await M.motVehicleSearch({ q: 'x' });
    assert.equal(out.error, 'upstream HTTP 400');
    assert.equal(out.retry, false);
    assert.equal(out.upstreamError, 'pass make and model');
  } finally { m.restore(); }
  m = mockFetch(() => ({ ok: false, status: 503, json: async () => { throw new Error('not json'); } }));
  try {
    const out = await M.motVehicleSearch({ q: 'x' });
    assert.equal(out.error, 'upstream HTTP 503');
    assert.equal(out.retry, true);
  } finally { m.restore(); }
  m = mockFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  try {
    const out = await M.motReliability({ make: 'Ford', model: 'Focus' });
    assert.equal(out.error, 'upstream unavailable');
    assert.equal(out.reason, 'timeout');
    assert.equal(out.retry, true);
    assert.equal(out.source, 'https://whatbreaks.uk/api');
  } finally { m.restore(); }
  m = mockFetch(() => { throw new Error('getaddrinfo ENOTFOUND'); });
  try {
    const out = await M.motVehicleSearch({ q: 'golf' });
    assert.equal(out.error, 'upstream unavailable');
    assert.match(out.reason, /ENOTFOUND/);
  } finally { m.restore(); }
  assert.equal(M.TIMEOUT_MS, 8000);
});

test('MOT proxy: missing params never hit the network', async () => {
  const m = mockFetch(() => { throw new Error('should not be called'); });
  try {
    assert.equal((await M.motReliability({ make: 'Ford' })).covered, false);
    assert.equal((await M.motVehicleSearch({})).covered, false);
    assert.equal(m.calls.length, 0);
  } finally { m.restore(); }
});

/* ---------------- MCP server, front door, REST, citation page ---------------- */

test('/api/mcp/vehicles lists the 9 tools; results carry the envelope with dataset freshness', async () => {
  const list = await rpc(vehiclesServer, 'tools/list');
  assert.deepEqual(list.body.result.tools.map((t) => t.name), ['uk_mot_reliability', 'uk_mot_vehicle_search', 'uk_recalls_for_model', 'uk_recalls_search', 'fr_recalls_for_model', 'fr_recalls_search', 'jp_recalls_for_model', 'jp_complaints_summary', 'eu_safety_gate_recalls']);
  const init = await rpc(vehiclesServer, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.body.result.serverInfo.name, 'databutler-vehicles');
  const fr = await callTool(vehiclesServer, 'fr_recalls_for_model', { brand: 'peugeot', model: '208' });
  assert.equal(fr.isError, false);
  assert.equal(fr.data.freshness.verifiedDate, V.FR.verifiedDate);
  assert.ok(['fresh', 'due', 'overdue'].includes(fr.data.freshness.staleness));
  assert.equal(fr.data.cite.url, 'https://databutler.dev/r/vehicles/fr/recalls?brand=peugeot&model=208');
  assert.match(fr.data.cite.text, /verified \d{4}-\d{2}-\d{2} against https:\/\/rappel\.conso\.gouv\.fr\//);
  assert.equal(fr.data.attribution, 'databutler.dev');
  const jp = await callTool(vehiclesServer, 'jp_complaints_summary', { make: 'toyota', model: 'prius' });
  assert.equal(jp.data.freshness.verifiedDate, V.JP.verifiedDate);
  assert.equal(jp.data.cite.url, 'https://databutler.dev/r/vehicles/jp/complaints?make=toyota&model=prius');
  const eu = await callTool(vehiclesServer, 'eu_safety_gate_recalls', {});
  assert.equal(eu.isError, false);
  assert.equal(eu.data.covered, false);
  const uk = await callTool(vehiclesServer, 'uk_recalls_for_model', { make: 'Vauxhall', model: 'Corsa', since: '2020-01-01' });
  assert.equal(uk.isError, false);
  assert.ok(uk.data.count > 0);
  assert.equal(uk.data.freshness.verifiedDate, V.UK.verifiedDate);
  assert.equal(uk.data.cite.url, 'https://databutler.dev/r/vehicles/uk/recalls?make=Vauxhall&model=Corsa&since=2020-01-01');
  assert.match(uk.data.cite.text, /verified \d{4}-\d{2}-\d{2} against https:\/\/www\.check-vehicle-recalls\.service\.gov\.uk\//);
  const uks = await callTool(vehiclesServer, 'uk_recalls_search', { text: 'airbag' });
  assert.equal(uks.data.cite.url, 'https://databutler.dev/r/vehicles/uk/recalls-search?text=airbag');
});

test('front door: vehicles tools are behind call (not listed), reachable, and catalogued', async () => {
  const list = await rpc(frontDoor, 'tools/list');
  assert.equal(list.body.result.tools.length, 9);
  assert.ok(!list.body.result.tools.some((t) => t.name.startsWith('fr_') || t.name.startsWith('jp_') || t.name.startsWith('uk_mot')));
  const m = mockFetch(() => jsonResponse(200, { count: 1, vehicles: [{ id: 5, make: 'Volkswagen', model: 'GOLF Mk7' }], attribution: 'whatbreaks.uk', link: 'https://whatbreaks.uk/', docs: 'https://whatbreaks.uk/api' }));
  try {
    const { isError, data } = await callTool(frontDoor, 'call', { tool: 'uk_mot_vehicle_search', arguments: { q: 'golf' } });
    assert.equal(isError, false);
    assert.equal(data.vehicles[0].model, 'GOLF Mk7');
    assert.equal(data.freshness.staleness, 'live');
    assert.equal(data.cite.url, 'https://databutler.dev/r/vehicles/uk/search?q=golf');
    assert.equal(data.upstreamProvenance.attribution, 'whatbreaks.uk');
  } finally { m.restore(); }
  const cat = await callTool(frontDoor, 'catalogue', { query: 'recall' });
  assert.ok(cat.data.tools.some((t) => t.name === 'fr_recalls_search' && t.server === 'vehicles' && t.serverUrl === 'https://databutler.dev/api/mcp/vehicles'));
  const cov = await callTool(frontDoor, 'coverage', { area: 'vehicles' });
  assert.equal(cov.data.frRecalls.fiches, V.FR.count);
  assert.equal(cov.data.ukRecalls.recalls, V.UK.count);
  assert.ok(cov.data.ukRecalls.makes.includes('vauxhall'));
  assert.ok(cov.data.notCovered.some((x) => /Safety Gate/.test(x)));
  assert.ok(!cov.data.notCovered.some((x) => /only MOT outcomes/.test(x)), 'DVSA recalls are covered now');
  assert.ok(cat.data.tools.some((t) => t.name === 'uk_recalls_search'));
});

test('REST mirrors under /api/vehicles carry freshness + cite; required params → 400', async () => {
  const cases = [
    [require('../api/router').ROUTES['vehicles/uk/recalls'], '/api/vehicles/uk/recalls?make=vauxhall&model=corsa', 'https://databutler.dev/r/vehicles/uk/recalls?make=vauxhall&model=corsa'],
    [require('../api/router').ROUTES['vehicles/uk/recalls-search'], '/api/vehicles/uk/recalls-search?text=airbag&since=2025-01-01', 'https://databutler.dev/r/vehicles/uk/recalls-search?text=airbag&since=2025-01-01'],
    [require('../api/router').ROUTES['vehicles/fr/recalls'], '/api/vehicles/fr/recalls?brand=peugeot&model=208', 'https://databutler.dev/r/vehicles/fr/recalls?brand=peugeot&model=208'],
    [require('../api/router').ROUTES['vehicles/fr/search'], '/api/vehicles/fr/search?text=airbag&since=2026-01-01', 'https://databutler.dev/r/vehicles/fr/search?text=airbag&since=2026-01-01'],
    [require('../api/router').ROUTES['vehicles/jp/recalls'], '/api/vehicles/jp/recalls?make=toyota&model=prius', 'https://databutler.dev/r/vehicles/jp/recalls?make=toyota&model=prius'],
    [require('../api/router').ROUTES['vehicles/jp/complaints'], '/api/vehicles/jp/complaints?make=honda&model=n-box', 'https://databutler.dev/r/vehicles/jp/complaints?make=honda&model=n-box'],
    [require('../api/router').ROUTES['vehicles/eu/safety-gate'], '/api/vehicles/eu/safety-gate', 'https://databutler.dev/r/vehicles/eu/safety-gate'],
  ];
  for (const [h, url, cite] of cases) {
    const res = await get(h, url);
    assert.equal(res.status, 200, url);
    assert.ok(res.body.freshness, `${url} freshness`);
    assert.equal(res.body.cite.url, cite);
    assert.equal(res.body.attribution, 'databutler.dev');
  }
  assert.equal((await get(require('../api/router').ROUTES['vehicles/fr/recalls'], '/api/vehicles/fr/recalls')).status, 400);
  assert.equal((await get(require('../api/router').ROUTES['vehicles/uk/recalls'], '/api/vehicles/uk/recalls?model=corsa')).status, 400);
  assert.equal((await get(require('../api/router').ROUTES['vehicles/uk/recalls-search'], '/api/vehicles/uk/recalls-search')).status, 400);
  assert.equal((await get(require('../api/router').ROUTES['vehicles/jp/recalls'], '/api/vehicles/jp/recalls?make=toyota')).status, 400);
  assert.equal((await get(require('../api/router').ROUTES['vehicles/uk/mot'], '/api/vehicles/uk/mot?make=Ford')).status, 400);
  assert.equal((await get(require('../api/router').ROUTES['vehicles/uk/search'], '/api/vehicles/uk/search')).status, 400);
  const m = mockFetch(() => jsonResponse(200, { vehicle: { id: 5 }, categories: [], attribution: 'whatbreaks.uk' }));
  try {
    const res = await get(require('../api/router').ROUTES['vehicles/uk/mot'], '/api/vehicles/uk/mot?make=Volkswagen&model=Golf&year=2018&mileage=80000');
    assert.equal(res.status, 200);
    assert.equal(m.calls[0].url, 'https://whatbreaks.uk/api/mot?make=Volkswagen&model=Golf&year=2018&mileage=80000');
    assert.equal(res.body.cite.url, 'https://databutler.dev/r/vehicles/uk/mot?make=Volkswagen&model=Golf&year=2018&mileage=80000');
  } finally { m.restore(); }
});

test('/r/vehicles/* citation pages render with the official source link', async () => {
  const fr = await get(r, '/api/r?path=vehicles/fr/recalls&brand=peugeot&model=208');
  assert.equal(fr.status, 200);
  assert.match(String(fr.raw), /rappel\.conso\.gouv\.fr\/fiche-rappel/);
  assert.match(String(fr.raw), /href="\/api\/vehicles\/fr\/recalls\?brand=peugeot&amp;model=208"/);
  const jp = await get(r, '/api/r?path=vehicles/jp/recalls&make=toyota&model=prius');
  assert.match(String(jp.raw), /renrakuda\.mlit\.go\.jp\/mt\/recallpdf/);
  const uk = await get(r, '/api/r?path=vehicles/uk/recalls&make=vauxhall&model=corsa');
  assert.equal(uk.status, 200);
  assert.match(String(uk.raw), /check-vehicle-recalls\.service\.gov\.uk\/recall-type\/vehicle\/make\/VAUXHALL/);
  assert.match(String(uk.raw), /href="\/api\/vehicles\/uk\/recalls\?make=vauxhall&amp;model=corsa"/);
  const m = mockFetch(() => { throw new Error('offline'); });
  try {
    const mot = await get(r, '/api/r?path=vehicles/uk/mot&make=Ford&model=Focus&year=2015');
    assert.equal(mot.status, 200);
    assert.match(String(mot.raw), /upstream unavailable/);
    assert.equal(m.calls[0].url, 'https://whatbreaks.uk/api/mot?make=Ford&model=Focus&year=2015');
  } finally { m.restore(); }
});
