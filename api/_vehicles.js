/**
 * Vehicles vertical — local datasets: French recalls (RappelConso) and
 * Japanese recalls/complaints (MLIT), derived by scripts/vehicles.js from the
 * sibling car-site repos. Query-time matching only; records are served as
 * published. The UK MOT tools live in _mot.js (live proxy).
 */
const FR = require('../data/vehicles/fr-recalls.json');
const JP = require('../data/vehicles/jp-recalls.json');
const { norm, brandSlug, modelPortion, hasWord } = require('./_vehicles_text');
const { nearest } = require('./_text');

const MAX_RESULTS = 50;

const FR_ATTRIBUTION = {
  source: FR.source,
  dataset: FR.dataset,
  datasetUrl: FR.datasetUrl,
  publisher: FR.publisher,
  licence: FR.licence,
  attributionNote:
    'Official published recall notices (RappelConso, DGCCRF), reused under Licence Ouverte 2.0 — a citation, ' +
    'not an endorsement by the French state or any manufacturer. Fiche counts are not a reliability measure.',
};
const JP_ATTRIBUTION = {
  source: JP.source,
  sourceName: JP.sourceName,
  licence: JP.licence,
  attributionNote:
    '出典：国土交通省「自動車のリコール・不具合情報」. Official filings and owner-submitted reports; a complaint is a ' +
    'report, not a verified defect, and counts are not normalised by sales volume.',
};

/* ---------------- FR helpers ---------------- */

let frBrandIndex = null;
function frBrands() {
  if (!frBrandIndex) {
    frBrandIndex = {};
    for (const r of FR.records) for (const s of r.brands) frBrandIndex[s] = (frBrandIndex[s] || 0) + 1;
  }
  return frBrandIndex;
}

const frRecord = (r, matchedBy) => ({
  fiche: r.fiche,
  date: r.date,
  brand: r.brand,
  models: r.models,
  label: r.label,
  risks: r.risks,
  motif: r.motif,
  periods: r.periods,
  ...(r.advice ? { advice: r.advice } : {}),
  link: r.link,
  ...(matchedBy ? { matchedBy } : {}),
});

const byDateDesc = (a, b) => b.date.localeCompare(a.date) || b.id - a.id;

function validSince(since) {
  if (since === undefined || since === null || since === '') return { ok: true, since: null };
  const s = String(since).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return { ok: false };
  return { ok: true, since: s };
}

/** Recalls for one brand + model. Curated index (sibling site's reviewed aliases) ∪ whole-word text match. */
function frRecallsForModel({ brand, model } = {}) {
  const b = brandSlug(brand);
  const brands = frBrands();
  if (!b) {
    return { covered: false, requested: { brand, model }, message: 'pass a brand (and a model)', coverage: { brands: Object.keys(brands).sort() } };
  }
  const brandKeys = Object.keys(brands).filter((k) => k === b || k.startsWith(`${b}-`));
  if (!brandKeys.length) {
    return {
      covered: false, requested: { brand, model }, message: `no RappelConso automobile fiche lists brand "${brand}"`,
      nearest: nearest(b, Object.keys(brands)), coverage: { brands: Object.keys(brands).sort(), fiches: FR.count, dateRange: FR.dateRange },
    };
  }
  const brandRecords = FR.records.filter((r) => r.brands.some((s) => brandKeys.includes(s)));
  // A brand with a handful of fiches is often an official-data misspelling
  // ("peugot"); surface the likely intended brand without guessing for the caller.
  const rare = brandRecords.length < 5
    ? { rareBrandNote: `only ${brandRecords.length} fiche(s) carry brand "${b}" — possibly a misspelling in the source; similar brands: ` +
        nearest(b, Object.keys(brands).filter((k) => !brandKeys.includes(k))).join(', ') }
    : {};
  const m = norm(model);
  if (!m) {
    const out = brandRecords.slice().sort(byDateDesc);
    return {
      brand: b, model: null, count: out.length, truncated: out.length > MAX_RESULTS,
      recalls: out.slice(0, MAX_RESULTS).map((r) => frRecord(r)), ...rare,
      dateRange: FR.dateRange, verifiedDate: FR.verifiedDate, ...FR_ATTRIBUTION,
    };
  }
  const slug = `${b}-${m.replace(/ /g, '-')}`;
  const curated = FR.curatedModels[slug];
  const curatedIds = new Set(curated ? curated.ficheIds : []);
  const hits = new Map();
  for (const r of brandRecords) {
    const text = hasWord(modelPortion(r.models), m) || hasWord(modelPortion(r.label), m);
    const cur = curatedIds.has(r.id);
    if (cur || text) hits.set(r.id, { r, matchedBy: cur && text ? 'curated+text' : cur ? 'curated' : 'text' });
  }
  const out = [...hits.values()].sort((x, y) => byDateDesc(x.r, y.r));
  return {
    brand: b, model: m, ...(curated ? { curatedModel: `${curated.make} ${curated.model}` } : {}),
    count: out.length, truncated: out.length > MAX_RESULTS,
    recalls: out.slice(0, MAX_RESULTS).map(({ r, matchedBy }) => frRecord(r, matchedBy)),
    ...(out.length ? {} : { brandFicheCount: brandRecords.length, hint: 'no fiche names this model; try fr_recalls_search with a keyword, or omit model to list the brand' }),
    ...rare,
    matching:
      'curated = reviewed brand/model alias match from controle-technique-fiabilite.com (longest alias wins, ' +
      'e.g. "c3 aircross" never counts as "c3"); text = whole-word match of your model string in the fiche\'s ' +
      'model/label text, which can include variants (e.g. "e-208" for "208"). Check `models` on each fiche.',
    dateRange: FR.dateRange, verifiedDate: FR.verifiedDate, ...FR_ATTRIBUTION,
  };
}

/** Free-text search over brand, models, label and motif; optional since date. */
function frRecallsSearch({ text, since } = {}) {
  const tokens = norm(text).split(' ').filter(Boolean);
  if (!tokens.length) {
    return { covered: false, requested: { text, since }, message: 'pass text to search (e.g. "airbag takata", "incendie batterie")', example: { text: 'airbag', since: '2025-01-01' } };
  }
  const s = validSince(since);
  if (!s.ok) return { covered: false, requested: { text, since }, message: 'since must be an ISO date YYYY-MM-DD', example: { text, since: '2025-01-01' } };
  const out = FR.records.filter((r) => {
    if (s.since && r.date < s.since) return false;
    const hay = norm(`${r.brand} ${r.models} ${r.label} ${r.motif} ${r.risks.join(' ')}`);
    return tokens.every((t) => hay.includes(t));
  }).sort(byDateDesc);
  return {
    text, since: s.since, count: out.length, truncated: out.length > MAX_RESULTS,
    recalls: out.slice(0, MAX_RESULTS).map((r) => frRecord(r)),
    ...(out.length ? {} : { hint: 'no fiche matches every word; RappelConso text is French and lowercase — try "incendie" rather than "fire"' }),
    dateRange: FR.dateRange, verifiedDate: FR.verifiedDate, ...FR_ATTRIBUTION,
  };
}

/* ---------------- JP helpers ---------------- */

const jpKey = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\-–—−ー・:：]/g, '');

function jpFindModel(make, model) {
  const mk = jpKey(make), md = jpKey(model);
  const makes = {};
  for (const [slug, m] of Object.entries(JP.models)) {
    const makeSlug = slug.split('-')[0];
    makes[makeSlug] = makes[makeSlug] || { makeEn: m.makeEn, make: m.make, models: [] };
    makes[makeSlug].models.push({ slug, modelSlug: slug.slice(makeSlug.length + 1), modelEn: m.modelEn, model: m.model });
  }
  const makeEntry = Object.entries(makes).find(([slug, v]) => mk && [slug, jpKey(v.makeEn), jpKey(v.make)].includes(mk));
  if (!mk || !makeEntry) {
    return {
      miss: {
        covered: false, requested: { make, model }, message: mk ? `make "${make}" is not covered` : 'pass make and model',
        nearest: mk ? nearest(mk, Object.keys(makes)) : [],
        coverage: Object.fromEntries(Object.entries(makes).map(([k, v]) => [k, v.models.map((x) => x.modelEn)])),
      },
    };
  }
  const [makeSlug, mkv] = makeEntry;
  const hit = md && mkv.models.find((x) => [jpKey(x.modelSlug), jpKey(x.modelEn), jpKey(x.model), jpKey(JP.models[x.slug].complaintName)].includes(md));
  if (!hit) {
    return {
      miss: {
        covered: false, requested: { make, model }, message: md ? `${mkv.makeEn} ${model} is not a covered model` : `pass a model for ${mkv.makeEn}`,
        nearest: md ? nearest(md, mkv.models.map((x) => x.modelSlug)) : [],
        coverage: { [makeSlug]: mkv.models.map((x) => x.modelEn) },
      },
    };
  }
  return { slug: hit.slug, entry: JP.models[hit.slug] };
}

function jpRecallsForModel({ make, model } = {}) {
  const f = jpFindModel(make, model);
  if (f.miss) return f.miss;
  const { slug, entry } = f;
  const recalls = entry.recallNos.map((no) => JP.recalls[no]).filter(Boolean);
  return {
    model: { slug, make: entry.make, model: entry.model, makeEn: entry.makeEn, modelEn: entry.modelEn },
    count: recalls.length, truncated: recalls.length > MAX_RESULTS,
    recalls: recalls.slice(0, MAX_RESULTS).map((r) => ({
      notificationNo: r.no, date: r.date, device: r.device, affectedVehicles: r.carCount,
      kind: r.isRecall ? 'リコール (recall)' : '改善対策 (improvement measure)',
      situation: r.situation, measures: r.measures, officialPdf: r.pdf,
    })),
    note: 'A filing often covers several models (same part); affectedVehicles is the filing total, not this model\'s share. Texts are MLIT\'s Japanese originals.',
    dateRange: JP.dateRange, verifiedDate: JP.verifiedDate, ...JP_ATTRIBUTION,
  };
}

function jpComplaintsSummary({ make, model } = {}) {
  const f = jpFindModel(make, model);
  if (f.miss) return f.miss;
  const { slug, entry } = f;
  const c = entry.complaints;
  const byDevice = Object.entries(c.byDevice).map(([device, count]) => ({ device, count, share: c.sampled ? Math.round((count / c.sampled) * 1000) / 10 : null }));
  return {
    model: { slug, make: entry.make, model: entry.model, makeEn: entry.makeEn, modelEn: entry.modelEn, mlitName: entry.complaintName },
    complaints: { total: c.total, sampledForBreakdown: c.sampled, byDevice },
    recallFilings: entry.recallNos.length,
    note:
      `total = all owner reports MLIT holds for this model name; the by-device breakdown (share = % of sampled) uses the newest ${c.sampled} ` +
      'reports. Owner reports are unverified and not normalised by sales volume — compare shapes, not raw counts.',
    verifiedDate: JP.verifiedDate, ...JP_ATTRIBUTION,
  };
}

/* ---------------- EU stub ---------------- */

const EU_SAFETY_GATE_URL = 'https://ec.europa.eu/safety-gate-alerts/screen/webReport';

function euSafetyGateStub(args = {}) {
  return {
    covered: false,
    status: 'planned',
    requested: args,
    message: 'EU Safety Gate (RAPEX) vehicle alerts are not served yet — this tool is a stub while the dataset is built.',
    officialSource: EU_SAFETY_GATE_URL,
    hint:
      'For now: fr_recalls_for_model / fr_recalls_search — RappelConso republishes the Safety Gate automobile alerts ' +
      'that concern France (fiche links ending /rapex), so most EU-wide vehicle recalls appear there in French.',
  };
}

function vehiclesCoverage() {
  const brands = frBrands();
  const makes = {};
  for (const [slug, m] of Object.entries(JP.models)) {
    const mk = slug.split('-')[0];
    makes[mk] = makes[mk] || [];
    makes[mk].push(m.modelEn);
  }
  return {
    ukMot: {
      how: 'live proxy to whatbreaks.uk (same operator): UK DfT anonymised MOT test results aggregated per model generation',
      coverage: 'GB passenger cars, 530 model generations — use uk_mot_vehicle_search to check a model',
    },
    frRecalls: {
      fiches: FR.count, dateRange: FR.dateRange, verifiedDate: FR.verifiedDate,
      brands: Object.keys(brands).sort(), curatedModels: FR.curatedModelCount, scope: FR.filter,
    },
    jpRecalls: {
      models: JP.counts.models, recallFilings: JP.counts.recallFilings, complaints: JP.counts.complaints,
      dateRange: JP.dateRange, verifiedDate: JP.verifiedDate, makes,
    },
    euSafetyGate: { status: 'planned (stub tool eu_safety_gate_recalls)', officialSource: EU_SAFETY_GATE_URL },
    notCovered: [
      'EU Safety Gate alerts directly (stub; use fr_recalls_* meanwhile)',
      'UK DVSA recalls (only MOT outcomes via whatbreaks.uk)',
      'US NHTSA recalls/complaints',
      'German KBA recalls / TÜV reports',
      'Japanese models outside the 75 covered (shakendata.com list)',
      'RappelConso categories other than automobiles/motos/scooters (tyres, bikes, child seats)',
    ],
  };
}

module.exports = {
  frRecallsForModel, frRecallsSearch, jpRecallsForModel, jpComplaintsSummary, euSafetyGateStub, vehiclesCoverage,
  FR, JP, EU_SAFETY_GATE_URL, MAX_RESULTS,
};
