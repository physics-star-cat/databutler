#!/usr/bin/env node
/**
 * Regenerate data/vehicles/*.json.
 *
 *   node scripts/vehicles.js                 # all three datasets
 *   node scripts/vehicles.js fr | jp | uk    # one
 *
 * FR and JP derive from the sibling car-site repos' committed pipeline
 * outputs — no network: those repos own the fetchers (and their politeness
 * rules); this script only derives compact, agent-shaped files.
 *   ../car_websites/controle-technique/data/rappelconso/{raw-automobiles,summary}.json
 *       (refresh there first: `node data/fetch-rappelconso.js`; override dir with RAPPELCONSO_DIR)
 *   ../car_websites/shaken-data/data/mlit/summary.json
 *       (refresh there first: `node data/fetch-mlit.js`; override dir with MLIT_DIR)
 *
 * UK has no sibling repo: `uk` downloads DVSA's bulk recalls CSV (one
 * request, ~8 MB, Open Government Licence v3.0) straight from the
 * check-vehicle-recalls service, identifying itself as databutler.dev. Set
 * DVSA_RECALLS_CSV=/path/to/RecallsFile.csv to build from a saved copy
 * instead (the fetch date is then the file's mtime).
 *
 * When a count changes against the committed file, a changelog entry
 * (area: vehicles) is appended for what_changed_since — note left blank for
 * the maintainer, same as scripts/changelog.js. The first derivation of a
 * dataset (no committed file yet) appends one `<name>/dataset` entry
 * (null → "covered") whose note carries the counts the script can see, so
 * every dataset's arrival is on record at /changes without hand-editing
 * data/changelog.json.
 */
const fs = require('node:fs');
const path = require('node:path');
const { mergeEntries } = require('../api/_changelog');
const { brandSlugs, norm, ukMakeSlug } = require('../api/_vehicles_text');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data/vehicles');
const CHANGELOG = path.join(ROOT, 'data/changelog.json');
const RAPPELCONSO_DIR = process.env.RAPPELCONSO_DIR || path.join(ROOT, '../car_websites/controle-technique/data/rappelconso');
const MLIT_DIR = process.env.MLIT_DIR || path.join(ROOT, '../car_websites/shaken-data/data/mlit');

const DVSA_SERVICE = 'https://www.check-vehicle-recalls.service.gov.uk/';
const DVSA_CSV_URL = `${DVSA_SERVICE}documents/RecallsFile.csv`;
const DVSA_GUIDE_URL = `${DVSA_SERVICE}documents/Recalls%20Data%20User%20Guide_v4.doc`;
const UA = 'databutler.dev data curation (+https://databutler.dev)';
// The committed file keeps recalls launched in the ten calendar years before
// the fetch year plus the fetch year — the DVSA guide's own "minimum of ten
// years" promise, and what keeps the file near 3 MB. Older recalls stay in
// the source CSV, which the dataset metadata links.
const UK_YEARS_BACK = 10;

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const day = (iso) => String(iso).slice(0, 10);
function plusOneMonth(isoDay) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/* ---------------- FR: RappelConso ---------------- */

function buildFr() {
  const raw = readJson(path.join(RAPPELCONSO_DIR, 'raw-automobiles.json'));
  const summary = readJson(path.join(RAPPELCONSO_DIR, 'summary.json'));
  const records = raw.records.map((r) => ({
    id: r.id,
    fiche: r.numero_fiche,
    date: day(r.date_publication),
    brand: r.marque_produit,
    brands: [...brandSlugs(r.marque_produit)],
    models: r.modeles_ou_references,
    label: r.libelle,
    motif: r.motif_rappel,
    risks: String(r.risques_encourus || '').split('|').map((s) => s.trim()).filter(Boolean),
    periods: Array.isArray(r.identification_produits) ? r.identification_produits : (r.identification_produits ? [r.identification_produits] : []),
    ...(r.conduites_a_tenir_par_le_consommateur ? { advice: r.conduites_a_tenir_par_le_consommateur } : {}),
    link: r.lien_vers_la_fiche_rappel,
  })).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  // Curated model index: the sibling site's reviewed alias matching (568
  // fiches → 94 models on 2026-10-02). Stored as fiche ids so the record is
  // never duplicated.
  const curatedModels = {};
  for (const [slug, m] of Object.entries(summary.models)) {
    curatedModels[slug] = { make: m.make, model: m.model, ficheIds: m.recalls.map((r) => r.id) };
  }
  const dates = records.map((r) => r.date).sort();
  const verifiedDate = day(raw.fetched);
  return {
    dataset: raw.dataset,
    datasetUrl: raw.dataset_url,
    source: raw.source,
    publisher: raw.publisher,
    licence: raw.licence,
    filter: raw.filter,
    fetched: raw.fetched,
    verifiedDate,
    nextScheduledRefresh: plusOneMonth(verifiedDate),
    verificationMethod:
      'Full export of the RappelConso V2 open-data sub-category "automobiles, motos, scooters" via the ' +
      'data.economie.gouv.fr Explore v2.1 API on `fetched`, as committed in the controle-technique repo; ' +
      'records are reshaped, never edited. curatedModels is that site\'s reviewed brand/model alias matching.',
    count: records.length,
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
    curatedModelCount: Object.keys(curatedModels).length,
    curatedFicheCount: new Set(Object.values(curatedModels).flatMap((m) => m.ficheIds)).size,
    curatedModels,
    records,
  };
}

/* ---------------- JP: MLIT ---------------- */

const MAKES_EN = { toyota: 'Toyota', honda: 'Honda', nissan: 'Nissan', suzuki: 'Suzuki', daihatsu: 'Daihatsu', mazda: 'Mazda', subaru: 'Subaru', mitsubishi: 'Mitsubishi' };
// Marketing spellings the slug loses; anything absent is title-cased from the slug.
const MODELS_EN = {
  'n-box': 'N-BOX', 'n-one': 'N-ONE', 'n-wgn': 'N-WGN', 'cr-v': 'CR-V', 'zr-v': 'ZR-V', stepwgn: 'Step WGN',
  'cx-30': 'CX-30', 'cx-5': 'CX-5', 'cx-60': 'CX-60', 'cx-8': 'CX-8', mazda2: 'Mazda2', mazda3: 'Mazda3',
  'c-hr': 'C-HR', gr86: 'GR86', rav4: 'RAV4', 'land-cruiser': 'Land Cruiser', 'corolla-cross': 'Corolla Cross',
  wrx: 'WRX', brz: 'BRZ', xv: 'XV', rvr: 'RVR', 'ek-cross': 'eK Cross', 'delica-d5': 'Delica D:5', 'eclipse-cross': 'Eclipse Cross',
  'x-trail': 'X-Trail', dayz: 'Dayz', 'wagon-r': 'Wagon R', canbus: 'Move Canbus',
};
const titleCase = (s) => s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const jpDate = (d) => String(d || '').replace(/\//g, '-'); // 2026/01/28 → 2026-01-28

function buildJp() {
  const summary = readJson(path.join(MLIT_DIR, 'summary.json'));
  const recalls = {};
  const models = {};
  let links = 0, complaints = 0;
  for (const [slug, m] of Object.entries(summary.models)) {
    const makeSlug = slug.split('-')[0];
    const modelSlug = slug.slice(makeSlug.length + 1);
    const recallNos = [];
    for (const r of m.recalls) {
      links++;
      recallNos.push(r.notification_no);
      recalls[r.notification_no] = recalls[r.notification_no] || {
        no: r.notification_no,
        date: jpDate(r.date),
        device: r.device,
        carCount: parseInt(r.car_count, 10) || null,
        situation: (r.situation || '').trim(),
        measures: (r.measures || '').trim(),
        isRecall: r.is_recall === true,
        pdf: `https://renrakuda.mlit.go.jp/mt/recallpdf/${r.notification_no}.pdf`,
      };
    }
    complaints += m.complaint_total;
    models[slug] = {
      make: m.make,
      model: m.model,
      makeEn: MAKES_EN[makeSlug] || titleCase(makeSlug),
      modelEn: MODELS_EN[modelSlug] || titleCase(modelSlug),
      complaintName: m.mlit_complaint_name,
      recallNos: recallNos.sort((a, b) => recalls[b].date.localeCompare(recalls[a].date)),
      complaints: {
        total: m.complaint_total,
        sampled: m.complaint_sampled,
        byDevice: Object.fromEntries(Object.entries(m.complaint_by_device).sort((a, b) => b[1] - a[1])),
      },
    };
  }
  const dates = Object.values(recalls).map((r) => r.date).sort();
  const verifiedDate = day(summary.generated);
  return {
    source: 'https://renrakuda.mlit.go.jp/',
    sourceName: '国土交通省 自動車のリコール・不具合情報 (MLIT, Japan — recall filings and owner defect reports)',
    api: 'https://renrakuda.mlit.go.jp/mt/mt-estraier.cgi',
    licence: 'MLIT terms (政府標準利用規約-compliant): reuse with source attribution',
    fetched: summary.generated,
    verifiedDate,
    nextScheduledRefresh: plusOneMonth(verifiedDate),
    verificationMethod:
      'Recall filings (class=recalldatacar) pulled per maker and matched to models by MLIT common name; ' +
      'complaints (class=releasedatacar) counted per model with the newest ≤500 sampled for the by-device ' +
      'breakdown — the shaken-data repo pipeline as committed. Reshaped here, never edited.',
    counts: {
      models: Object.keys(models).length,
      recallFilings: Object.keys(recalls).length,
      modelRecallLinks: links,
      complaints,
    },
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
    models,
    recalls,
  };
}

/* ---------------- UK: DVSA ---------------- */

/** RFC 4180 CSV → array of rows (arrays of strings). Handles quoted fields with commas, quotes and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

/** DVSA dates are dd/mm/yyyy; anything else (blank) → null. */
function ukDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function loadDvsaCsv() {
  if (process.env.DVSA_RECALLS_CSV) {
    const p = process.env.DVSA_RECALLS_CSV;
    return { text: fs.readFileSync(p, 'utf8'), fetched: fs.statSync(p).mtime.toISOString(), sourceLastModified: null, via: `local file ${p}` };
  }
  const r = await fetch(DVSA_CSV_URL, { headers: { 'User-Agent': UA, Accept: 'text/csv' } });
  if (!r.ok) throw new Error(`DVSA CSV: HTTP ${r.status}`);
  return { text: await r.text(), fetched: new Date().toISOString(), sourceLastModified: r.headers.get('last-modified'), via: DVSA_CSV_URL };
}

/**
 * One record per recall number (the CSV repeats the recall text once per
 * model); models nest as [model, buildStart, buildEnd, vehiclesAffected]
 * tuples (see `modelFields`). Texts are DVSA's, never edited — including the
 * occasional U+FFFD the source itself contains.
 */
function buildUkFrom(csvText, { fetched, sourceLastModified, via }) {
  const rows = parseCsv(csvText.replace(/^﻿/, ''));
  const header = rows[0].map((h) => h.trim());
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`DVSA CSV: column "${name}" missing — header is ${header.join(', ')}`);
    return i;
  };
  const C = {
    launch: col('Launch Date'), no: col('Recalls Number'), make: col('Make'), concern: col('Concern'), defect: col('Defect'),
    remedy: col('Remedy'), vehicles: col('Vehicle Numbers'), model: col('Model'), buildStart: col('Build Start'), buildEnd: col('Build End'),
  };
  const fetchYear = Number(fetched.slice(0, 4));
  const floor = `${fetchYear - UK_YEARS_BACK}-01-01`;
  const byNo = new Map();
  let sourceRows = 0;
  for (const r of rows.slice(1)) {
    sourceRows++;
    const no = r[C.no].trim();
    const launch = ukDate(r[C.launch]);
    if (!no || !launch) throw new Error(`DVSA CSV: row without recall number / launch date: ${r.slice(0, 3).join(' | ')}`);
    if (launch < floor) continue;
    const text = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    let rec = byNo.get(no);
    if (!rec) {
      rec = {
        no, date: launch, make: text(r[C.make]), makeSlug: ukMakeSlug(r[C.make]),
        concern: text(r[C.concern]), defect: text(r[C.defect]), remedy: text(r[C.remedy]), models: [],
      };
      byNo.set(no, rec);
    }
    const n = parseInt(String(r[C.vehicles]).replace(/[^\d]/g, ''), 10);
    rec.models.push([text(r[C.model]) || null, ukDate(r[C.buildStart]), ukDate(r[C.buildEnd]), Number.isNaN(n) ? null : n]);
  }
  const records = [...byNo.values()].sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no));
  const dates = records.map((r) => r.date).sort();
  const verifiedDate = day(fetched);
  const makes = new Set(records.map((r) => r.makeSlug));
  return {
    dataset: 'DVSA vehicle safety recalls — bulk download (RecallsFile.csv, "all recalls since 1992")',
    datasetUrl: DVSA_CSV_URL,
    guideUrl: DVSA_GUIDE_URL,
    source: DVSA_SERVICE,
    publisher: 'Driver and Vehicle Standards Agency (DVSA), Vehicle Safety Branch — GOV.UK',
    licence: 'Open Government Licence v3.0 (Crown copyright)',
    updateCadence: 'Source CSV is regenerated by DVSA daily (Last-Modified header); refreshed here monthly.',
    filter: { launchDateFrom: floor, rule: `recalls launched from 1 January ${fetchYear - UK_YEARS_BACK} (${UK_YEARS_BACK} calendar years before the fetch year) to the fetch date` },
    fetched,
    fetchedVia: via,
    sourceLastModified,
    verifiedDate,
    nextScheduledRefresh: plusOneMonth(verifiedDate),
    verificationMethod:
      'Full download of DVSA\'s RecallsFile.csv (the file linked from the check-vehicle-recalls service home page) on ' +
      '`fetched`; rows grouped by recall number (the CSV repeats a recall once per model), dates converted from dd/mm/yyyy, ' +
      'texts never edited. makeSlug is databutler\'s normalisation of the published make (importer suffixes such as ' +
      '"(GB) PLC" dropped); make is as published.',
    modelFields: ['model', 'buildStart', 'buildEnd', 'vehiclesAffected'],
    recallNumberPrefixes: {
      R: 'cars, HGVs and PSVs', RM: 'motorcycles', RCOMP: 'components (primarily aftermarket)', RCT: 'large commercial trailers (> 3,500 kg)',
      RPT: 'light trailers incl. caravans', RSPV: 'special purpose vehicles', RTW: 'wheels and tyres', RPC: 'pedal cycles (now Trading Standards)',
    },
    sourceCounts: { rows: sourceRows, recalls: new Set(rows.slice(1).map((r) => r[C.no].trim())).size },
    count: records.length,
    modelRows: records.reduce((n, r) => n + r.models.length, 0),
    makes: makes.size,
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
    records,
  };
}

async function buildUk() {
  const src = await loadDvsaCsv();
  return buildUkFrom(src.text, src);
}

/* ---------------- write + changelog ---------------- */

/**
 * Changelog entries for one derived dataset, pure. prev === null means first
 * derivation: one `<name>/dataset` entry, effectiveFrom = the snapshot date
 * (data.verifiedDate), verifiedDate = the day it was derived here (today),
 * note = the counts. Otherwise one entry per metric whose value moved.
 */
function datasetEntries(name, prev, data, metrics, { label = name, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!prev) {
    const counts = metrics.map(([, l, get]) => `${l}: ${get(data)}`).join('; ');
    return [{
      area: 'vehicles', key: `${name}/dataset`, label: `${label} dataset`, from: null, to: 'covered',
      effectiveFrom: data.verifiedDate, source: data.source, verifiedDate: today,
      note: `First derivation of data/vehicles/${name}.json from the snapshot fetched ${data.verifiedDate}${counts ? ` — ${counts}` : ''}.`,
    }];
  }
  const entries = [];
  for (const [key, label, get] of metrics) {
    const from = get(prev), to = get(data);
    if (from === to) continue;
    entries.push({ area: 'vehicles', key: `${name}/${key}`, label, from, to, effectiveFrom: data.verifiedDate, source: data.source, verifiedDate: data.verifiedDate, note: '' });
  }
  return entries;
}

function writeDataset(name, data, metrics, opts) {
  const out = path.join(OUT_DIR, `${name}.json`);
  const prev = fs.existsSync(out) ? readJson(out) : null;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data) + '\n');
  const kb = Math.round(Buffer.byteLength(JSON.stringify(data)) / 1024);
  console.log(`${name}.json: ${kb} KB, verifiedDate ${data.verifiedDate}${prev ? '' : ' (first derivation)'}`);
  return datasetEntries(name, prev, data, metrics, opts);
}

async function main() {
  const which = process.argv[2] || 'all';
  if (!['all', 'fr', 'jp', 'uk'].includes(which)) throw new Error(`usage: node scripts/vehicles.js [all|fr|jp|uk] (got "${which}")`);
  let incoming = [];
  if (which === 'all' || which === 'fr') {
    incoming.push(...writeDataset('fr-recalls', buildFr(), [
      ['count', 'RappelConso automobile fiches', (d) => d.count],
      ['curated-fiches', 'fiches matched to curated models', (d) => d.curatedFicheCount],
    ], { label: 'RappelConso automobile recalls' }));
  }
  if (which === 'all' || which === 'jp') {
    incoming.push(...writeDataset('jp-recalls', buildJp(), [
      ['recall-filings', 'MLIT recall filings matched to covered models', (d) => d.counts.recallFilings],
      ['complaints', 'MLIT owner complaints across covered models', (d) => d.counts.complaints],
    ], { label: 'MLIT recall filings and owner complaints' }));
  }
  if (which === 'all' || which === 'uk') {
    incoming.push(...writeDataset('uk-recalls', await buildUk(), [
      ['count', 'DVSA recalls in the served window', (d) => d.count],
      ['model-rows', 'DVSA recall × model rows in the served window', (d) => d.modelRows],
    ]));
  }
  if (incoming.length) {
    const existing = fs.existsSync(CHANGELOG) ? readJson(CHANGELOG) : [];
    const { merged, added } = mergeEntries(existing, incoming);
    fs.writeFileSync(CHANGELOG, JSON.stringify(merged, null, 2) + '\n');
    console.log(`changelog: ${added.length} entr${added.length === 1 ? 'y' : 'ies'} added — review each note (blank for metric moves), then commit data/ together; they publish at /changes, /changes.rss, /changes.atom:`);
    for (const e of added) console.log(`  ${e.key}: ${e.from} → ${e.to}`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e.message || e); process.exit(1); });
module.exports = { buildFr, buildJp, buildUk, buildUkFrom, parseCsv, ukDate, datasetEntries, MODELS_EN, MAKES_EN, DVSA_CSV_URL, UK_YEARS_BACK };
