#!/usr/bin/env node
/**
 * Regenerate data/software-eol.json — the committed monthly snapshot behind
 * the software-eol server (support_status, support_timeline).
 *
 *   node scripts/software-eol.js            # fetch all 14 products from endoflife.date
 *   EOL_DIR=/path/to/saved node scripts/software-eol.js
 *                                           # build from saved <product>.json files instead
 *                                           # (the fetch date is then the newest file's mtime)
 *
 * Source: endoflife.date open data, one request per product to
 * https://endoflife.date/api/<product>.json (MIT License — repository
 * https://github.com/endoflife-date/endoflife.date), identifying itself as
 * databutler.dev with a 500 ms pause between requests. Records are reshaped
 * (field names normalised, the Ruby link template filled in), never edited.
 *
 * Changelog (area: software-eol), appended with mergeEntries for dedupe and
 * published at /changes and through what_changed_since:
 *   - first derivation (no committed file): one `<product>/dataset` entry per
 *     product (null → covered), effectiveFrom = the snapshot date, note = the
 *     counts the script can see;
 *   - later runs, per cycle: `<product>/<cycle>` when its eol date moved
 *     (from the old date to the new one, effectiveFrom = the new eol date),
 *     when it reached end of life between the two snapshots (supported →
 *     end of life, effectiveFrom = the eol date), or when the cycle is new
 *     (null → released, effectiveFrom = its release date). Notes are left
 *     blank for the maintainer, same as scripts/vehicles.js.
 */
const fs = require('node:fs');
const path = require('node:path');
// Pure helpers only: requiring api/_changelog here would load every area module, and this area's module
// requires the data file this script is about to write (first derivation). api/_areas.js tolerates that
// now (the area is marked unavailable), but the script needs none of it.
const { mergeEntries } = require('../api/_area_kit');
const { previousSnapshot } = require('./_git');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/software-eol.json');
const CHANGELOG = path.join(ROOT, 'data/changelog.json');

const SITE = 'https://endoflife.date/';
const API = `${SITE}api/`;
const REPO = 'https://github.com/endoflife-date/endoflife.date';
const LICENCE = `MIT License — ${REPO}/blob/master/LICENSE (copyright 2020 endoflife.date contributors)`;
const UA = 'databutler.dev data curation (+https://databutler.dev)';
const PAUSE_MS = 500;
// Monthly refresh; the freshness block reports `due` from 35 days after the fetch.
const REFRESH_DAYS = 35;

/**
 * The 14 products served, keyed by endoflife.date's own product id (the
 * /api/<id>.json file and the /<id> page). "Java" has no product of its own
 * on the site: /java and /jdk redirect to the java-distribution tag, whose
 * canonical Oracle entry is oracle-jdk (Java SE as Oracle ships it); the
 * other distributions (openjdk-builds-from-oracle, redhat-build-of-openjdk,
 * microsoft-build-of-openjdk …) are listed as not covered.
 */
const PRODUCTS = {
  nodejs: { name: 'Node.js', kind: 'runtime' },
  python: { name: 'Python', kind: 'runtime' },
  ubuntu: { name: 'Ubuntu', kind: 'operating system' },
  debian: { name: 'Debian', kind: 'operating system' },
  android: { name: 'Android', kind: 'operating system' },
  ios: { name: 'iOS', kind: 'operating system' },
  macos: { name: 'macOS', kind: 'operating system' },
  windows: { name: 'Windows', kind: 'operating system' },
  'oracle-jdk': { name: 'Oracle JDK (Java SE)', kind: 'runtime' },
  go: { name: 'Go', kind: 'runtime' },
  ruby: { name: 'Ruby', kind: 'runtime' },
  php: { name: 'PHP', kind: 'runtime' },
  postgresql: { name: 'PostgreSQL', kind: 'database' },
  react: { name: 'React', kind: 'framework' },
};
const PRODUCT_IDS = Object.keys(PRODUCTS);

const CYCLE_FIELDS = {
  cycle: 'release cycle id as endoflife.date names it (e.g. "18", "3.11", "22.04", "11-24h2-w")',
  releaseDate: 'first release of the cycle (YYYY-MM-DD)',
  eol: 'end of life: the date security updates stop under standard support (YYYY-MM-DD); false = no end-of-life date set; true = end of life, date not recorded',
  lts: 'long-term-support status as published: true, false, or the date LTS status begins',
  latest: 'latest release in the cycle at the snapshot',
  latestReleaseDate: 'date of that latest release',
  support: 'end of active (feature and bug-fix) support (YYYY-MM-DD); true = in active support with no end date set; absent = not tracked for this product',
  extendedSupport: 'end of extended/paid support where the vendor offers one (YYYY-MM-DD); true = available, no end date set; absent = none',
  link: 'vendor release page endoflife.date records for the cycle',
  codename: 'release codename where the vendor uses one (Debian, Ubuntu, Android, macOS)',
  releaseLabel: 'display label where the cycle id is a slug (Windows, Android, macOS)',
  apiVersion: 'Android API level',
};

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const day = (iso) => String(iso).slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function plusDays(isoDay, n) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** One cycle as served: endoflife.date's fields under stable names, nothing invented. */
function normaliseCycle(c, productId) {
  const cycle = String(c.cycle);
  if (!cycle) throw new Error(`${productId}: cycle without an id: ${JSON.stringify(c)}`);
  if (!(isDay(c.eol) || c.eol === false || c.eol === true)) throw new Error(`${productId} ${cycle}: eol must be a date or boolean, got ${JSON.stringify(c.eol)}`);
  const latest = c.latest === undefined || c.latest === null ? null : String(c.latest);
  const out = {
    cycle,
    releaseDate: isDay(c.releaseDate) ? c.releaseDate : null,
    eol: c.eol,
    lts: isDay(c.lts) ? c.lts : c.lts === true,
    latest,
  };
  if (isDay(c.latestReleaseDate)) out.latestReleaseDate = c.latestReleaseDate;
  if (isDay(c.support) || c.support === true) out.support = c.support;
  if (isDay(c.extendedSupport) || c.extendedSupport === true) out.extendedSupport = c.extendedSupport;
  if (typeof c.link === 'string' && c.link.startsWith('http')) {
    // Ruby's link is a template over the latest release ("v__LATEST__").
    out.link = latest ? c.link.replace(/__LATEST__/g, latest) : c.link;
  }
  if (typeof c.codename === 'string' && c.codename) out.codename = c.codename;
  if (typeof c.releaseLabel === 'string' && c.releaseLabel) out.releaseLabel = c.releaseLabel;
  if (c.apiVersion !== undefined && c.apiVersion !== null) out.apiVersion = String(c.apiVersion);
  return out;
}

/**
 * Pure builder: raw = { [productId]: <array from /api/<id>.json> }. Every one
 * of the 14 products must be present — a partial snapshot is not committed.
 */
function buildFrom(raw, { fetched, via }) {
  const missing = PRODUCT_IDS.filter((id) => !Array.isArray(raw[id]));
  if (missing.length) throw new Error(`missing product data for ${missing.join(', ')}`);
  const verifiedDate = day(fetched);
  const products = {};
  let cycleCount = 0;
  for (const id of PRODUCT_IDS) {
    const cycles = raw[id].map((c) => normaliseCycle(c, id));
    if (!cycles.length) throw new Error(`${id}: no cycles`);
    const ids = cycles.map((c) => c.cycle);
    if (new Set(ids).size !== ids.length) throw new Error(`${id}: duplicate cycle ids`);
    // endoflife.date lists newest first; keep that order (it is the product's own).
    cycleCount += cycles.length;
    products[id] = {
      id,
      name: PRODUCTS[id].name,
      kind: PRODUCTS[id].kind,
      page: `${SITE}${id}`,
      api: `${API}${id}.json`,
      cycleCount: cycles.length,
      cycles,
    };
  }
  return {
    dataset: 'endoflife.date — release cycles with release, active-support and end-of-life dates for 14 runtimes, operating systems, a database and a framework',
    source: SITE,
    api: API,
    repository: REPO,
    publisher: 'endoflife.date contributors (community-maintained open data compiled from vendor release and support pages)',
    licence: LICENCE,
    attribution: 'Data from endoflife.date (MIT License), https://endoflife.date/ — reshaped, not edited; a citation, not an endorsement by endoflife.date or any vendor.',
    updateCadence: `endoflife.date changes continuously (community pull requests and automated vendor checks); refreshed here monthly, freshness reports due ${REFRESH_DAYS} days after the fetch.`,
    fetched,
    fetchedVia: via,
    verifiedDate,
    nextScheduledRefresh: plusDays(verifiedDate, REFRESH_DAYS),
    verificationMethod:
      `One request per product to ${API}<product>.json on \`fetched\` (User-Agent "${UA}", ${PAUSE_MS} ms apart); each cycle's ` +
      'fields are kept under the names in cycleFields with nothing added — eol/support/extendedSupport are endoflife.date\'s ' +
      'values, which it compiles from the vendors\' own lifecycle pages; the Ruby link template is filled with the latest release.',
    cycleFields: CYCLE_FIELDS,
    productCount: PRODUCT_IDS.length,
    cycleCount,
    products,
  };
}

/* ---------------- fetch ---------------- */

async function loadRaw() {
  const raw = {};
  if (process.env.EOL_DIR) {
    let newest = 0;
    for (const id of PRODUCT_IDS) {
      const p = path.join(process.env.EOL_DIR, `${id}.json`);
      raw[id] = readJson(p);
      newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
    return { raw, fetched: new Date(newest).toISOString(), via: `local files ${process.env.EOL_DIR}/<product>.json` };
  }
  const fetched = new Date().toISOString();
  for (const id of PRODUCT_IDS) {
    const url = `${API}${id}.json`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    raw[id] = await r.json();
    console.log(`${id}: ${raw[id].length} cycles`);
    await sleep(PAUSE_MS);
  }
  return { raw, fetched, via: `${API}<product>.json, one request per product` };
}

/* ---------------- changelog ---------------- */

const eolValue = (c) => (isDay(c.eol) ? c.eol : null);
const label = (p, cycle) => `${p.name} ${cycle.releaseLabel || cycle.cycle}`;

function datasetEntry(p, data, today) {
  const dates = p.cycles.map((c) => c.releaseDate).filter(Boolean).sort();
  const open = p.cycles.filter((c) => c.eol === false || (isDay(c.eol) && c.eol > data.verifiedDate)).length;
  return {
    area: 'software-eol', key: `${p.id}/dataset`, label: `${p.name} support lifecycle dataset`, from: null, to: 'covered',
    effectiveFrom: data.verifiedDate, source: p.page, verifiedDate: today,
    note:
      `First derivation of data/software-eol.json for ${p.name} from endoflife.date (${p.api}, MIT License) fetched ${data.verifiedDate}: ` +
      `${p.cycleCount} release cycles (${dates[0]} → ${dates[dates.length - 1]}), ${open} not yet at end of life. ` +
      'Fields kept as published, never edited.',
  };
}

/**
 * Changelog entries for the snapshot, pure. prev === null means first
 * derivation: one `<product>/dataset` entry per product. Otherwise, per cycle:
 * eol moved → from/to dates (effectiveFrom = the new date); reached end of
 * life between the snapshots → supported → end of life (effectiveFrom = the
 * eol date); new cycle → null → released (effectiveFrom = its release date).
 */
function datasetEntries(prev, data, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const out = [];
  for (const p of Object.values(data.products)) {
    const pp = prev && prev.products ? prev.products[p.id] : null;
    if (!pp) { out.push(datasetEntry(p, data, today)); continue; }
    const before = new Map(pp.cycles.map((c) => [c.cycle, c]));
    for (const c of p.cycles) {
      const was = before.get(c.cycle);
      const base = { area: 'software-eol', key: `${p.id}/${c.cycle}`, source: p.page, verifiedDate: data.verifiedDate, note: '' };
      if (!was) {
        out.push({ ...base, label: `${label(p, c)} release cycle`, from: null, to: 'released', effectiveFrom: c.releaseDate || data.verifiedDate });
      } else if (JSON.stringify(was.eol) !== JSON.stringify(c.eol)) {
        out.push({ ...base, label: `${label(p, c)} end of life`, from: eolValue(was), to: eolValue(c), effectiveFrom: eolValue(c) || data.verifiedDate });
      } else if (isDay(c.eol) && c.eol > prev.verifiedDate && c.eol <= data.verifiedDate) {
        out.push({ ...base, label: `${label(p, c)} support status`, from: 'supported', to: 'end of life', effectiveFrom: c.eol });
      }
    }
  }
  // Key order matches every other generated entry (changes-page tests compare it).
  return out.map(({ area, key, label: l, from, to, effectiveFrom, source, verifiedDate, note }) => ({ area, key, label: l, from, to, effectiveFrom, source, verifiedDate, note }));
}

async function main() {
  const src = await loadRaw();
  const data = buildFrom(src.raw, src);
  const prev = previousSnapshot('data/software-eol.json'); // the committed file: a re-run before committing appends nothing new
  fs.writeFileSync(OUT, JSON.stringify(data) + '\n');
  const kb = Math.round(Buffer.byteLength(JSON.stringify(data)) / 1024);
  console.log(`software-eol.json: ${kb} KB, ${data.productCount} products, ${data.cycleCount} cycles, verifiedDate ${data.verifiedDate}${prev ? '' : ' (first derivation)'}`);
  const incoming = datasetEntries(prev, data);
  if (incoming.length) {
    const existing = fs.existsSync(CHANGELOG) ? readJson(CHANGELOG) : [];
    const { merged, added } = mergeEntries(existing, incoming);
    fs.writeFileSync(CHANGELOG, JSON.stringify(merged, null, 2) + '\n');
    console.log(`changelog: ${added.length} entr${added.length === 1 ? 'y' : 'ies'} added — review each note (blank for cycle moves), then commit data/ together; they publish at /changes, /changes.rss, /changes.atom:`);
    for (const e of added) console.log(`  ${e.key}: ${e.from} → ${e.to}`);
  } else {
    console.log('changelog: nothing moved against the committed file');
  }
}

if (require.main === module) main().catch((e) => { console.error(e.message || e); process.exit(1); });
module.exports = { buildFrom, normaliseCycle, datasetEntries, PRODUCTS, PRODUCT_IDS, CYCLE_FIELDS, SITE, API, REPO, LICENCE, UA, REFRESH_DAYS, plusDays };
