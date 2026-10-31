#!/usr/bin/env node
/**
 * Regenerate data/uk-inflation.json — UK consumer price inflation as published by the
 * Office for National Statistics (ONS), in the categories → figures shape the
 * uk-inflation area serves (api/_areas/uk-inflation.js).
 *
 *   node scripts/uk-inflation.js                 # fetch the three ONS time series
 *   UK_INFLATION_DIR=tests/fixtures/uk-inflation node scripts/uk-inflation.js
 *                                                # build from saved <series>.json files instead
 *   VERIFIED_DATE=2026-10-31 …                   # stamp a given verifiedDate (default: today, UK time)
 *
 * Source: one request per series to
 * https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/<id>/mm23/data
 * (the JSON behind the human page at the same URL without /data, which is each figure's
 * `source`), identifying itself as databutler.dev with a 500 ms pause between requests.
 * Values are copied as the ONS states them (strings parsed to numbers), never edited.
 *
 * This script only writes the data file. The changelog is the standard per-figure diff
 * (changelog.diff in the module): run `node scripts/changelog.js --only uk-inflation`
 * afterwards, which appends one entry per figure whose value moved (from → to) and
 * pre-fills its note; then `node scripts/sign-facts.js`.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/uk-inflation.json');

const PAGE = (id) => `https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/${id}/mm23`;
const UA = 'databutler.dev data curation (+https://databutler.dev)';
const PAUSE_MS = 500;
/** Annual averages are served from this year to the latest complete year; earlier keys never disappear. */
const FIRST_YEAR = 2021;
const LICENCE =
  'Open Government Licence v3.0 — "All content is available under the Open Government Licence v3.0, except where otherwise stated" ' +
  '(footer of every ONS time-series page); http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/. ' +
  'Source: Office for National Statistics.';

/** The three series, keyed by the ONS series id (CDID, lower case as in the URL). */
const SERIES = {
  d7g7: { cdid: 'D7G7', what: 'CPI 12-month rate, all items' },
  l55o: { cdid: 'L55O', what: 'CPIH 12-month rate, all items' },
  d7bt: { cdid: 'D7BT', what: 'CPI index, all items, 2015=100' },
};
const SERIES_IDS = Object.keys(SERIES);

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const MONTH_NAMES = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An ISO timestamp → the calendar day in the UK (ONS stamps a release as midnight UK time, e.g. 2026-10-20T23:00Z = 21 Oct BST). */
function ukDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`not a timestamp: ${JSON.stringify(iso)}`);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** "18 November 2026" → "2026-11-18". */
function parseLongDate(s) {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*$/.exec(String(s || ''));
  const mm = m && MONTH_NAMES[m[2].toLowerCase()];
  if (!mm) throw new Error(`not a "D Month YYYY" date: ${JSON.stringify(s)}`);
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
}

/** "2026 SEP" → "2026-09". */
function monthPeriod(s) {
  const m = /^(\d{4}) ([A-Z]{3})$/.exec(String(s || ''));
  if (!m || !MONTHS[m[2]]) throw new Error(`not a "YYYY MON" month: ${JSON.stringify(s)}`);
  return `${m[1]}-${MONTHS[m[2]]}`;
}

function num(v, where) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw new Error(`${where}: not a number: ${JSON.stringify(v)}`);
  return n;
}

const quoteOf = (series, date, value) => `${series.description.title}, ${date}: ${value}`;

/** Latest and prior month of a series, checked: months[] in date order, both numeric. */
function lastTwoMonths(id, s) {
  const months = (s.months || []).filter((m) => m.value !== '');
  if (months.length < 2) throw new Error(`${id}: fewer than two monthly observations`);
  const latest = months[months.length - 1];
  const prior = months[months.length - 2];
  if (latest.date !== s.description.date) throw new Error(`${id}: last month ${latest.date} ≠ description.date ${s.description.date}`);
  if (monthPeriod(prior.date) >= monthPeriod(latest.date)) throw new Error(`${id}: months[] not in date order`);
  return { latest, prior };
}

/** A monthly figure (latest month) with the prior month as `previous`. */
function monthlyFigure(id, s, { key, label, unit }) {
  const { latest, prior } = lastTwoMonths(id, s);
  return {
    key,
    label,
    value: num(latest.value, `${id} ${latest.date}`),
    unit,
    period: monthPeriod(latest.date),
    effectiveFrom: ukDay(s.description.releaseDate),
    source: PAGE(id),
    series: SERIES[id].cdid,
    quote: quoteOf(s, latest.date, latest.value),
    previous: {
      value: num(prior.value, `${id} ${prior.date}`),
      period: monthPeriod(prior.date),
      effectiveFrom: ukDay(prior.updateDate),
      source: PAGE(id),
      quote: quoteOf(s, prior.date, prior.value),
    },
  };
}

/**
 * Pure builder: raw = { d7g7, l55o, d7bt } (the parsed /data JSON of each series). Every series
 * must be present, on the same release and the same latest month — a partial or mixed snapshot is
 * not written.
 */
function buildFrom(raw, { verifiedDate, via = 'ONS time-series JSON' }) {
  const missing = SERIES_IDS.filter((id) => !raw[id] || !raw[id].description || !Array.isArray(raw[id].months));
  if (missing.length) throw new Error(`missing series data for ${missing.join(', ')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedDate || '')) throw new Error(`verifiedDate must be YYYY-MM-DD, got ${JSON.stringify(verifiedDate)}`);
  for (const id of SERIES_IDS) {
    const cdid = raw[id].description.cdid;
    if (cdid !== SERIES[id].cdid) throw new Error(`${id}: description.cdid is ${cdid}, expected ${SERIES[id].cdid}`);
  }
  const one = (field) => {
    const vals = [...new Set(SERIES_IDS.map((id) => raw[id].description[field]))];
    if (vals.length !== 1) throw new Error(`series disagree on description.${field}: ${vals.join(' / ')}`);
    return vals[0];
  };
  const releaseDate = ukDay(one('releaseDate'));
  const nextRelease = parseLongDate(one('nextRelease'));
  const referenceMonth = monthPeriod(one('date'));
  if (nextRelease <= releaseDate) throw new Error(`nextRelease ${nextRelease} is not after releaseDate ${releaseDate}`);

  const cpi = raw.d7g7;
  const latestYear = Number(referenceMonth.slice(0, 4));
  const years = (cpi.years || []).filter((y) => Number(y.date) >= FIRST_YEAR && Number(y.date) < latestYear + 1 && y.value !== '');
  const averages = years.map((y) => ({
    key: `annual-average-${y.date}`,
    label: `CPI annual rate for ${y.date} (change in the calendar-year average index)`,
    value: num(y.value, `d7g7 ${y.date}`),
    unit: '%',
    period: String(y.date),
    effectiveFrom: ukDay(y.updateDate),
    source: PAGE('d7g7'),
    series: 'D7G7',
    quote: quoteOf(cpi, y.date, y.value),
  }));
  if (!averages.some((f) => f.period === String(FIRST_YEAR))) throw new Error(`d7g7: no annual value for ${FIRST_YEAR}`);

  return {
    area: 'uk-inflation',
    dataset: 'UK consumer price inflation (CPI, CPIH) from the ONS Consumer price inflation time series (dataset MM23)',
    publisher: 'Office for National Statistics (ONS)',
    jurisdiction: 'United Kingdom',
    licence: LICENCE,
    releaseDate,
    referenceMonth,
    nextRelease,
    verifiedDate,
    nextScheduledRefresh: nextRelease,
    fetchedVia: via,
    verificationMethod:
      `One request per series to ${PAGE('<id>')}/data (User-Agent "${UA}", ${PAUSE_MS} ms apart); values copied as stated in months[] ` +
      '(latest and prior month) and years[] (calendar years), effectiveFrom = the ONS release day in UK time ' +
      '(description.releaseDate for the latest month, each observation\'s updateDate otherwise), nextScheduledRefresh = description.nextRelease.',
    sources: SERIES_IDS.map((id) => PAGE(id)),
    categories: {
      cpi: {
        title: 'Consumer Prices Index (CPI)',
        source: PAGE('d7g7'),
        scope: 'United Kingdom; Consumer Prices Index, all items (ONS series D7G7, D7BT)',
        figures: [
          monthlyFigure('d7g7', cpi, { key: 'annual-rate', label: 'CPI 12-month inflation rate (all items)', unit: '%' }),
          monthlyFigure('d7bt', raw.d7bt, { key: 'index', label: 'CPI index (all items)', unit: 'index, 2015=100' }),
          ...averages,
        ],
      },
      cpih: {
        title: "Consumer Prices Index including owner occupiers' housing costs (CPIH)",
        source: PAGE('l55o'),
        scope: "United Kingdom; Consumer Prices Index including owner occupiers' housing costs, all items (ONS series L55O)",
        figures: [
          monthlyFigure('l55o', raw.l55o, { key: 'annual-rate', label: 'CPIH 12-month inflation rate (all items)', unit: '%' }),
        ],
      },
    },
  };
}

/* ---------------- fetch ---------------- */

async function loadRaw() {
  const raw = {};
  if (process.env.UK_INFLATION_DIR) {
    for (const id of SERIES_IDS) raw[id] = readJson(path.join(process.env.UK_INFLATION_DIR, `${id}.json`));
    return { raw, via: `local files ${process.env.UK_INFLATION_DIR}/<series>.json` };
  }
  for (const id of SERIES_IDS) {
    const url = `${PAGE(id)}/data`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    raw[id] = await r.json();
    console.log(`${id}: ${raw[id].description.title}, ${raw[id].description.date} = ${raw[id].description.number}`);
    await sleep(PAUSE_MS);
  }
  return { raw, via: `${PAGE('<id>')}/data, one request per series` };
}

async function main() {
  const { raw, via } = await loadRaw();
  const verifiedDate = process.env.VERIFIED_DATE || ukDay(new Date().toISOString());
  const data = buildFrom(raw, { verifiedDate, via });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
  const figs = Object.values(data.categories).flatMap((c) => c.figures);
  console.log(`uk-inflation.json: ${figs.length} figures, reference month ${data.referenceMonth}, released ${data.releaseDate}, next release ${data.nextRelease}, verifiedDate ${data.verifiedDate}`);
  console.log('next: node scripts/changelog.js --only uk-inflation, review the notes, node scripts/sign-facts.js');
}

if (require.main === module) main().catch((e) => { console.error(e.message || e); process.exit(1); });
module.exports = { buildFrom, ukDay, parseLongDate, monthPeriod, SERIES, SERIES_IDS, PAGE, UA, LICENCE, FIRST_YEAR };
