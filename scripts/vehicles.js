#!/usr/bin/env node
/**
 * Regenerate data/vehicles/*.json from the sibling car-site repos' committed
 * pipeline outputs. No network: those repos own the fetchers (and their
 * politeness rules); this script only derives compact, agent-shaped files.
 *
 *   node scripts/vehicles.js            # both datasets
 *   node scripts/vehicles.js fr | jp    # one
 *
 * Inputs (override with RAPPELCONSO_DIR / MLIT_DIR):
 *   ../car_websites/controle-technique/data/rappelconso/{raw-automobiles,summary}.json
 *       (refresh there first: `node data/fetch-rappelconso.js`)
 *   ../car_websites/shaken-data/data/mlit/summary.json
 *       (refresh there first: `node data/fetch-mlit.js`)
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
const { brandSlugs, norm } = require('../api/_vehicles_text');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data/vehicles');
const CHANGELOG = path.join(ROOT, 'data/changelog.json');
const RAPPELCONSO_DIR = process.env.RAPPELCONSO_DIR || path.join(ROOT, '../car_websites/controle-technique/data/rappelconso');
const MLIT_DIR = process.env.MLIT_DIR || path.join(ROOT, '../car_websites/shaken-data/data/mlit');

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

function main() {
  const which = process.argv[2] || 'all';
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
  if (incoming.length) {
    const existing = fs.existsSync(CHANGELOG) ? readJson(CHANGELOG) : [];
    const { merged, added } = mergeEntries(existing, incoming);
    fs.writeFileSync(CHANGELOG, JSON.stringify(merged, null, 2) + '\n');
    console.log(`changelog: ${added.length} entr${added.length === 1 ? 'y' : 'ies'} added — review each note (blank for metric moves), then commit data/ together; they publish at /changes, /changes.rss, /changes.atom:`);
    for (const e of added) console.log(`  ${e.key}: ${e.from} → ${e.to}`);
  }
}

if (require.main === module) main();
module.exports = { buildFr, buildJp, datasetEntries, MODELS_EN, MAKES_EN };
