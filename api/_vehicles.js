/**
 * Vehicles vertical — local datasets: UK recalls (DVSA), French recalls
 * (RappelConso) and Japanese recalls/complaints (MLIT), built by
 * scripts/vehicles.js (FR/JP from the sibling car-site repos, UK from DVSA's
 * bulk CSV). Query-time matching only; records are served as published. The
 * UK MOT tools live in _mot.js (live proxy).
 */
const FR = require('../data/vehicles/fr-recalls.json');
const JP = require('../data/vehicles/jp-recalls.json');
const UK = require('../data/vehicles/uk-recalls.json');
const { norm, brandSlug, modelPortion, hasWord, ukMakeSlug } = require('./_vehicles_text');
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
const UK_ATTRIBUTION = {
  source: UK.source,
  dataset: UK.dataset,
  datasetUrl: UK.datasetUrl,
  publisher: UK.publisher,
  licence: UK.licence,
  attributionNote:
    'Contains public sector information licensed under the Open Government Licence v3.0 — DVSA safety recall notices ' +
    'as published (texts unedited); a citation, not an endorsement by DVSA or any manufacturer. Recall counts are not a ' +
    'reliability measure (sales volume, multi-model campaigns).',
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

/* ---------------- UK helpers ---------------- */

// Recall-number prefixes the check-vehicle-recalls service files under
// "vehicle"; the rest (components, tyres, pedal cycles) are "equipment",
// whose pages were not verified, so those records link to the dataset.
const UK_VEHICLE_PREFIXES = new Set(['R', 'RM', 'RSPV', 'RCT', 'RPT']);
const ukPrefix = (no) => String(no).split('/')[0];
const ukCategory = (no) => UK.recallNumberPrefixes[ukPrefix(no)] || null;

let ukMakeIndex = null;
function ukMakes() {
  if (!ukMakeIndex) {
    ukMakeIndex = {};
    for (const r of UK.records) ukMakeIndex[r.makeSlug] = (ukMakeIndex[r.makeSlug] || 0) + 1;
  }
  return ukMakeIndex;
}

/** Official page listing this recall: the service's make/model/build-year view (verified 2026-10-03), or the dataset. */
function ukLink(r, modelTuple) {
  const model = modelTuple && modelTuple[0];
  if (!model || !UK_VEHICLE_PREFIXES.has(ukPrefix(r.no))) return UK.datasetUrl;
  const year = (modelTuple[1] || r.date).slice(0, 4);
  return `${UK.source}recall-type/vehicle/make/${encodeURIComponent(r.make)}/model/${encodeURIComponent(model)}/year/${year}/recalls`;
}

const ukModelObj = ([model, buildStart, buildEnd, vehiclesAffected]) => ({ model, buildStart, buildEnd, vehiclesAffected });

/** One output record per recall; `matched` narrows the model rows to those the query hit. */
function ukRecord(r, matched, matchedBy) {
  const ms = matched && matched.length ? matched : r.models;
  const starts = ms.map((m) => m[1]).filter(Boolean).sort();
  const ends = ms.map((m) => m[2]).filter(Boolean).sort();
  const vehicles = ms.map((m) => m[3]).filter((n) => n !== null && n !== undefined);
  const others = matched ? [...new Set(r.models.filter((m) => !matched.includes(m)).map((m) => m[0]).filter(Boolean))] : [];
  return {
    recallNumber: r.no,
    launchDate: r.date,
    category: ukCategory(r.no),
    make: r.make,
    model: [...new Set(ms.map((m) => m[0]).filter(Boolean))].join(' / ') || null,
    buildStart: starts[0] || null,
    buildEnd: ends[ends.length - 1] || null,
    vehiclesAffected: vehicles.length ? Math.max(...vehicles) : null,
    concern: r.concern,
    defect: r.defect,
    remedy: r.remedy,
    models: ms.map(ukModelObj),
    ...(others.length ? { otherModelsOnRecall: others } : {}),
    link: ukLink(r, ms[0]),
    ...(matchedBy ? { matchedBy } : {}),
  };
}

const UK_NOTES = {
  vehiclesAffected:
    'DVSA records the recall total against each model row (occasionally a per-model figure); vehiclesAffected is the ' +
    'largest figure among the model rows shown, so a multi-model recall is not this model\'s share.',
  link: 'link opens the GOV.UK recall checker at make / model / build year, which lists this recall among any others for that year.',
};

const ukByDateDesc = (a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no);

/** Recalls for one make + model: exact normalised model name, or whole-word match inside the model name. */
function ukRecallsForModel({ make, model, since } = {}) {
  const mk = ukMakeSlug(make);
  const makes = ukMakes();
  const makeList = Object.keys(makes).sort();
  if (!mk) {
    return { covered: false, requested: { make, model, since }, message: 'pass a make (and a model)', coverage: { makes: makeList, recalls: UK.count, dateRange: UK.dateRange } };
  }
  const makeKeys = makeList.filter((k) => k === mk || k.startsWith(`${mk}-`));
  if (!makeKeys.length) {
    return {
      covered: false, requested: { make, model, since },
      message: `no DVSA recall launched since ${UK.filter.launchDateFrom} lists make "${make}"`,
      nearest: nearest(mk, makeList), coverage: { makes: makeList, recalls: UK.count, dateRange: UK.dateRange },
    };
  }
  const s = validSince(since);
  if (!s.ok) return { covered: false, requested: { make, model, since }, message: 'since must be an ISO date YYYY-MM-DD', example: { make, model, since: '2024-01-01' } };
  const makeRecords = UK.records.filter((r) => makeKeys.includes(r.makeSlug) && (!s.since || r.date >= s.since));
  const makeNames = [...new Set(makeRecords.map((r) => r.make))].sort();
  const modelNames = [...new Set(makeRecords.flatMap((r) => r.models.map((m) => m[0]).filter(Boolean)))].sort();
  const base = {
    make: mk, makeNamesInSource: makeNames, since: s.since,
    dateRange: UK.dateRange, launchDateFrom: UK.filter.launchDateFrom, verifiedDate: UK.verifiedDate, ...UK_ATTRIBUTION,
  };
  const m = norm(model);
  if (!m) {
    const out = makeRecords.slice().sort(ukByDateDesc);
    return {
      ...base, model: null, count: out.length, truncated: out.length > MAX_RESULTS,
      recalls: out.slice(0, MAX_RESULTS).map((r) => ukRecord(r)),
      modelsInSource: modelNames, notes: UK_NOTES,
    };
  }
  const hits = [];
  for (const r of makeRecords) {
    const matched = r.models.filter((mm) => mm[0] && (norm(mm[0]) === m || hasWord(norm(mm[0]), m)));
    if (matched.length) hits.push({ r, matched, matchedBy: matched.some((mm) => norm(mm[0]) === m) ? 'exact' : 'text' });
  }
  hits.sort((x, y) => ukByDateDesc(x.r, y.r));
  return {
    ...base, model: m, count: hits.length, truncated: hits.length > MAX_RESULTS,
    recalls: hits.slice(0, MAX_RESULTS).map(({ r, matched, matchedBy }) => ukRecord(r, matched, matchedBy)),
    ...(hits.length ? {} : {
      makeRecallCount: makeRecords.length,
      nearestModels: nearest(m, modelNames.map((x) => norm(x))).filter(Boolean),
      hint: 'no DVSA recall in the served window names this model; try uk_recalls_search with a keyword, or omit model to list the make\'s recalls and model names',
    }),
    matching:
      'exact = the recall\'s model name equals yours after normalisation (case, accents, punctuation ignored); text = your ' +
      'model string appears as a whole word inside the recall\'s model name (so "corsa" also matches "CORSA D" and "CORSA-e", ' +
      'never "CORSAVAN"). A make query also covers DVSA\'s product-line entries for that brand (e.g. "mercedes" includes ' +
      'MERCEDES-BENZ VANS); makeNamesInSource lists the published make strings behind the slug.',
    notes: UK_NOTES,
  };
}

/** Free-text search over make, model names, concern, defect and remedy; optional since date. */
function ukRecallsSearch({ text, since } = {}) {
  const tokens = norm(text).split(' ').filter(Boolean);
  if (!tokens.length) {
    return { covered: false, requested: { text, since }, message: 'pass text to search (e.g. "airbag takata", "fire battery", "steering rack")', example: { text: 'airbag', since: '2025-01-01' } };
  }
  const s = validSince(since);
  if (!s.ok) return { covered: false, requested: { text, since }, message: 'since must be an ISO date YYYY-MM-DD', example: { text, since: '2025-01-01' } };
  const out = UK.records.filter((r) => {
    if (s.since && r.date < s.since) return false;
    const hay = norm(`${r.make} ${r.models.map((m) => m[0]).join(' ')} ${r.concern} ${r.defect} ${r.remedy}`);
    return tokens.every((t) => hay.includes(t));
  }).sort(ukByDateDesc);
  return {
    text, since: s.since, count: out.length, truncated: out.length > MAX_RESULTS,
    recalls: out.slice(0, MAX_RESULTS).map((r) => ukRecord(r)),
    ...(out.length ? {} : { hint: 'no recall in the served window contains every word; DVSA text is English — try a component name ("steering rack", "fuel pump") or a symptom ("fire", "loss of power")' }),
    notes: UK_NOTES,
    dateRange: UK.dateRange, launchDateFrom: UK.filter.launchDateFrom, verifiedDate: UK.verifiedDate, ...UK_ATTRIBUTION,
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
    ukRecalls: {
      recalls: UK.count, modelRows: UK.modelRows, dateRange: UK.dateRange, launchDateFrom: UK.filter.launchDateFrom,
      verifiedDate: UK.verifiedDate, makes: Object.keys(ukMakes()).sort(), categories: UK.recallNumberPrefixes,
      scope: 'every DVSA safety recall (cars, HGVs, PSVs, motorcycles, trailers, special-purpose vehicles, components, tyres) launched on or after launchDateFrom',
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
      `UK DVSA recalls launched before ${UK.filter.launchDateFrom} (in the source CSV, not served here)`,
      'UK recall status for an individual VIN or registration (the GOV.UK checker and manufacturers hold that)',
      'US NHTSA recalls/complaints',
      'German KBA recalls / TÜV reports',
      'Japanese models outside the 75 covered (shakendata.com list)',
      'RappelConso categories other than automobiles/motos/scooters (tyres, bikes, child seats)',
    ],
  };
}

module.exports = {
  frRecallsForModel, frRecallsSearch, ukRecallsForModel, ukRecallsSearch, jpRecallsForModel, jpComplaintsSummary,
  euSafetyGateStub, vehiclesCoverage,
  FR, JP, UK, EU_SAFETY_GATE_URL, MAX_RESULTS,
};
