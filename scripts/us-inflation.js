#!/usr/bin/env node
/**
 * Regenerate data/us-inflation.json — the US CPI-U figures behind the us-inflation area
 * (us_inflation_lookup, and the Verified Facts us/cpi-u/*).
 *
 *   node scripts/us-inflation.js                 # fetch from the BLS
 *   US_INFLATION_DIR=tests/fixtures/us-inflation node scripts/us-inflation.js
 *                                                # build from saved files instead (offline; tests)
 *   US_INFLATION_SAVE=tests/fixtures/us-inflation node scripts/us-inflation.js
 *                                                # fetch, and also write the fixture files (excerpts)
 *   BLS_API_KEY=… node scripts/us-inflation.js   # optional registration key: the API then returns its own
 *                                                # 12-month calculation, which is cross-checked too
 *
 * Everything comes from the U.S. Bureau of Labor Statistics, identifying itself as databutler.dev:
 *   - the Public Data API v2, series CUUR0000SA0 (CPI-U, U.S. city average, all items, not seasonally
 *     adjusted, 1982-84=100), monthly values M01–M12 and annual averages M13;
 *   - the CPI release archive (https://www.bls.gov/bls/news-release/cpi.htm): which day each reference
 *     month was released, and the archived release itself, whose "Not seasonally adjusted CPI measures"
 *     sentence states the 12-month change and the index level;
 *   - the CPI release schedule (https://www.bls.gov/schedule/news_release/cpi.htm): the next release day.
 * BLS publications are in the public domain (https://www.bls.gov/bls/linksite.htm).
 *
 * The 12-month change is read from the release sentence and must equal the change computed from the two
 * published index values (rounded to one decimal, as BLS publishes it); a mismatch stops the script. When the
 * year-ago index is missing (October 2025 was never collected — "Data unavailable due to the 2025 lapse in
 * appropriations"), the release sentence alone gives it, and the quote says so.
 *
 * Changelog: this script only writes the data file. The area uses the standard figure diff
 * (api/_areas/us-inflation.js changelog.diff), so `node scripts/changelog.js --only us-inflation` afterwards
 * appends one entry per figure that moved (from → to), as the monthly workflow does.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/us-inflation.json');

const SERIES = 'CUUR0000SA0';
const API = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const SERIES_PAGE = `https://data.bls.gov/timeseries/${SERIES}`;
const CPI_PAGE = 'https://www.bls.gov/cpi/';
const ARCHIVE = 'https://www.bls.gov/bls/news-release/cpi.htm';
const SCHEDULE = 'https://www.bls.gov/schedule/news_release/cpi.htm';
const COPYRIGHT = 'https://www.bls.gov/bls/linksite.htm';
const UA = 'databutler.dev data curation (+https://databutler.dev)';
const FIRST_YEAR = 2020; // the API's first year requested; annual averages are served from FIRST_AVERAGE on
const FIRST_AVERAGE = 2021;
const LICENCE =
  'Public domain — "The Bureau of Labor Statistics (BLS) is a Federal government agency and everything that we publish, ' +
  'both in hard copy and electronically, is in the public domain, except for previously copyrighted photographs and ' +
  'illustrations. You are free to use our public domain material without specific permission, although we do ask that you ' +
  `cite the Bureau of Labor Statistics as the source." (${COPYRIGHT}, Copyright Information)`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');
const ym = (year, month) => `${year}-${pad(month)}`; // reference month as "2026-09"
const monthName = (p) => `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;

/** Visible text of an HTML page, whitespace collapsed (also safe on text that is already plain). */
function textOf(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8212;|&mdash;/g, '—').replace(/&#8211;|&ndash;/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Nov. 10, 2026" / "May 12, 2027" / "September 11, 2026" → "2026-11-10". */
function isoDate(s) {
  const m = String(s).trim().match(/^([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4})$/);
  if (!m) throw new Error(`not a BLS date: "${s}"`);
  const i = MON3.indexOf(m[1].slice(0, 3));
  if (i === -1) throw new Error(`not a month: "${m[1]}"`);
  return `${m[3]}-${pad(i + 1)}-${pad(m[2])}`;
}

/* ---------------- parsers (pure) ---------------- */

/** API response → { monthly: Map('2026-09' → item), annual: Map('2025' → item) }. */
function parseApi(api) {
  if (!api || api.status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS API: status ${api && api.status} ${JSON.stringify(api && api.message)}`);
  const series = (api.Results && api.Results.series || []).find((s) => s.seriesID === SERIES);
  if (!series || !Array.isArray(series.data) || !series.data.length) throw new Error(`BLS API: no data for ${SERIES}`);
  const monthly = new Map();
  const annual = new Map();
  for (const d of series.data) {
    const item = { year: d.year, period: d.period, periodName: d.periodName, value: d.value, latest: d.latest === 'true', footnotes: (d.footnotes || []).filter((f) => f && f.text).map((f) => f.text), calculations: d.calculations || null };
    if (d.period === 'M13') annual.set(String(d.year), item);
    else if (/^M(0[1-9]|1[0-2])$/.test(d.period)) monthly.set(ym(d.year, Number(d.period.slice(1))), item);
  }
  return { monthly, annual };
}

/** A published index value as a number, or null when BLS left it blank ("-") — never a guess. */
const indexValue = (item) => (item && /^\d+(\.\d+)?$/.test(item.value) ? Number(item.value) : null);

/** 12-month percent change from two published index levels, rounded to one decimal as BLS publishes it. */
function twelveMonth(now, yearAgo) {
  const pct = (now / yearAgo - 1) * 100;
  return Math.round(Math.round(pct * 1e6) / 1e5) / 10; // round the 1e-6-cleaned value to 0.1
}

/** Archive page HTML → Map('2026-09' → { date: '2026-10-14', url }) from its "<Month YYYY> Consumer Price Index" links. */
function parseArchive(html) {
  const out = new Map();
  const re = /<a href="(\/news\.release\/archives\/cpi_(\d{2})(\d{2})(\d{4})\.htm)">\s*([A-Z][a-z]+) (\d{4}) Consumer Price Index\s*<\/a>/g;
  for (const m of String(html).matchAll(re)) {
    const month = MONTHS.indexOf(m[5]);
    if (month === -1) continue;
    const key = ym(m[6], month + 1);
    if (!out.has(key)) out.set(key, { date: `${m[4]}-${m[2]}-${m[3]}`, url: `https://www.bls.gov${m[1]}` });
  }
  if (!out.size) throw new Error(`${ARCHIVE}: no "<Month YYYY> Consumer Price Index" release links found`);
  return out;
}

/** Schedule page text → [{ referenceMonth: '2026-10', date: '2026-11-10' }, …] in page order. */
function parseSchedule(text) {
  const t = textOf(text);
  const re = /\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4}) ([A-Z][a-z]{2}\.? \d{1,2}, \d{4}) \d{2}:\d{2} [AP]M\b/g;
  const out = [];
  for (const m of t.matchAll(re)) out.push({ referenceMonth: ym(m[2], MONTHS.indexOf(m[1]) + 1), date: isoDate(m[3]) });
  if (!out.length) throw new Error(`${SCHEDULE}: no "<Month YYYY> <date> <time>" rows found`);
  return out;
}

/**
 * Release text → { sentence, change, index, embargoDate }. The sentence is the release's own statement under
 * "Not seasonally adjusted CPI measures"; change is signed (decreased → negative).
 */
function parseRelease(text) {
  const t = textOf(text);
  const m = t.match(/The Consumer Price Index for All Urban Consumers \(CPI-U\) (increased|decreased|rose|fell|was unchanged)(?: (\d+(?:\.\d+)?) percent)? over the last 12 months to an index level of (\d+\.\d+) \(1982-84=100\)\./);
  if (!m) throw new Error('release: no "CPI-U … over the last 12 months to an index level of … (1982-84=100)." sentence');
  const sign = m[1] === 'decreased' || m[1] === 'fell' ? -1 : 1;
  const change = m[1] === 'was unchanged' ? 0 : sign * Number(m[2]);
  const e = t.match(/embargoed until [^,]*?, ([A-Z][a-z]+ \d{1,2}, \d{4})/);
  return { sentence: m[0], change, index: m[3], embargoDate: e ? isoDate(e[1]) : null };
}

/* ---------------- build (pure) ---------------- */

/**
 * raw = { api, archive (html), schedule (text or html), releases: { '2026-09': text, '2026-08': text } }.
 * Builds the categories → figures file; throws on any disagreement between the API, the release and the archive.
 */
function buildFrom(raw, { fetched, via }) {
  const verifiedDate = String(fetched).slice(0, 10);
  const { monthly, annual } = parseApi(raw.api);
  const archive = parseArchive(raw.archive);
  const schedule = parseSchedule(raw.schedule);

  const months = [...monthly.keys()].filter((k) => indexValue(monthly.get(k)) !== null).sort();
  const latest = months[months.length - 1];
  const flagged = [...monthly.entries()].find(([, v]) => v.latest);
  if (flagged && flagged[0] !== latest) throw new Error(`BLS API marks ${flagged[0]} latest, but the newest published value is ${latest}`);
  const prior = months[months.length - 2];

  /** One reference month: index, release, 12-month change (release sentence, cross-checked with the indexes). */
  function month(p) {
    const item = monthly.get(p);
    const rel = archive.get(p);
    if (!rel) throw new Error(`${ARCHIVE}: no release link for ${monthName(p)}`);
    const text = raw.releases && raw.releases[p];
    if (!text) throw new Error(`release text for ${p} (${rel.url}) missing`);
    const r = parseRelease(text);
    if (r.index !== item.value) throw new Error(`${rel.url}: index level ${r.index} ≠ API ${item.value} for ${p}`);
    if (r.embargoDate && r.embargoDate !== rel.date) throw new Error(`${rel.url}: release date ${r.embargoDate} ≠ archive ${rel.date}`);
    const yearAgoKey = ym(Number(p.slice(0, 4)) - 1, Number(p.slice(5)));
    const yearAgo = monthly.get(yearAgoKey);
    const computed = indexValue(yearAgo) === null ? null : twelveMonth(indexValue(item), indexValue(yearAgo));
    if (computed !== null && computed !== r.change) throw new Error(`${p}: release states ${r.change}%, the indexes give ${computed}%`);
    const apiCalc = item.calculations && item.calculations.pct_changes && item.calculations.pct_changes['12'];
    if (apiCalc !== undefined && apiCalc !== null && Number(apiCalc) !== r.change) throw new Error(`${p}: release states ${r.change}%, the API calculation ${apiCalc}%`);
    const head = `${SERIES} ${item.year} ${item.period} (${item.periodName}) ${item.value}`;
    const basis = computed !== null
      ? `${head}; ${yearAgo.year} ${yearAgo.period} (${yearAgo.periodName}) ${yearAgo.value}`
      : `${head}; ${yearAgoKey.slice(0, 4)} ${yearAgo ? yearAgo.period : `M${yearAgoKey.slice(5)}`} not published${yearAgo && yearAgo.footnotes.length ? ` (${yearAgo.footnotes.join('; ')})` : ''}, so the change is the release's own figure`;
    return { p, item, rel, r, computed, basis };
  }

  const cur = month(latest);
  const prev = month(prior);
  const next = schedule.find((s) => s.date > verifiedDate) || null;
  if (!next) throw new Error(`${SCHEDULE}: no release listed after ${verifiedDate}`);

  const figures = [
    {
      key: 'annual-rate',
      label: 'CPI-U 12-month percent change (all items, U.S. city average, not seasonally adjusted)',
      value: cur.r.change,
      unit: '%',
      period: cur.p,
      effectiveFrom: cur.rel.date,
      source: cur.rel.url,
      quote: `"${cur.r.sentence}" (${monthName(cur.p)} CPI release, ${cur.rel.date}) — ${cur.basis}`,
      previous: { value: prev.r.change, period: prev.p, effectiveFrom: prev.rel.date, source: prev.rel.url, title: `${monthName(prev.p)} Consumer Price Index release` },
    },
    {
      key: 'index-level',
      label: 'CPI-U index level (all items, U.S. city average, not seasonally adjusted, 1982-84=100)',
      value: indexValue(cur.item),
      unit: 'index, 1982-84=100',
      period: cur.p,
      effectiveFrom: cur.rel.date,
      quote: `${SERIES} ${cur.item.year} ${cur.item.period} (${cur.item.periodName}) ${cur.item.value}`,
      previous: { value: indexValue(prev.item), period: prev.p, effectiveFrom: prev.rel.date, source: SERIES_PAGE },
    },
  ];
  const years = [...annual.keys()].filter((y) => Number(y) >= FIRST_AVERAGE && indexValue(annual.get(y)) !== null).sort();
  for (const y of years) {
    const a = annual.get(y);
    const dec = archive.get(ym(y, 12));
    if (!dec) throw new Error(`${ARCHIVE}: no December ${y} release (the annual average is published with it)`);
    figures.push({
      key: `annual-average-${y}`,
      label: `CPI-U annual average ${y} (all items, U.S. city average, 1982-84=100)`,
      value: indexValue(a),
      unit: 'index, 1982-84=100',
      period: y,
      effectiveFrom: dec.date,
      quote: `${SERIES} ${a.year} ${a.period} (${a.periodName}) ${a.value}`,
    });
  }

  return {
    area: 'us-inflation',
    dataset: 'US Consumer Price Index for All Urban Consumers (CPI-U), U.S. city average, all items, not seasonally adjusted — BLS series CUUR0000SA0',
    series: SERIES,
    publisher: 'U.S. Bureau of Labor Statistics (BLS), U.S. Department of Labor',
    jurisdiction: 'United States (U.S. city average; all urban consumers, about 90% of the population)',
    licence: LICENCE,
    attribution: 'Source: U.S. Bureau of Labor Statistics, Consumer Price Index, series CUUR0000SA0.',
    verifiedDate,
    nextScheduledRefresh: next.date,
    latestRelease: { referenceMonth: cur.p, date: cur.rel.date, source: cur.rel.url },
    nextRelease: { referenceMonth: next.referenceMonth, date: next.date, source: SCHEDULE },
    releaseSchedule: schedule,
    fetchedVia: via,
    verificationMethod:
      `The BLS Public Data API v2 (${API}, series ${SERIES}, ${FIRST_YEAR}–present with annual averages) gives every index level; ` +
      `the CPI release archive (${ARCHIVE}) gives each reference month's release day and archived release; that release's ` +
      '"Not seasonally adjusted CPI measures" sentence gives the 12-month change and must state the same index level as the API ' +
      'and the same change as the two published index values (rounded to one decimal); ' +
      `the next release day is read from the schedule (${SCHEDULE}). Values are copied as published, never estimated.`,
    categories: {
      'cpi-u': {
        title: 'Consumer Price Index for All Urban Consumers (CPI-U), all items, U.S. city average, not seasonally adjusted',
        source: SERIES_PAGE,
        scope: 'United States, U.S. city average; CPI-U all items, not seasonally adjusted, 1982-84=100 (BLS series CUUR0000SA0)',
        figures,
      },
    },
  };
}

/* ---------------- fetch ---------------- */

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function fetchApi(endYear) {
  const body = { seriesid: [SERIES], startyear: String(FIRST_YEAR), endyear: String(endYear), annualaverage: true, calculations: true };
  if (process.env.BLS_API_KEY) body.registrationkey = process.env.BLS_API_KEY;
  const r = await fetch(API, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${API}: HTTP ${r.status}`);
  return r.json();
}

/** The two newest reference months with a published value (the ones whose releases are read). */
function lastTwoMonths(api) {
  const { monthly } = parseApi(api);
  return [...monthly.keys()].filter((k) => indexValue(monthly.get(k)) !== null).sort().slice(-2);
}

/** Fixture excerpts: the parts of each page the parsers read, so tests stay small and offline. */
function saveFixtures(dir, raw, fetched) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'api.json'), JSON.stringify(raw.api, null, 1) + '\n');
  const links = String(raw.archive).split('\n').filter((l) => { const m = l.match(/cpi_\d{4}(\d{4})\.htm/); return m && Number(m[1]) >= FIRST_YEAR; }).map((l) => l.trim());
  fs.writeFileSync(path.join(dir, 'archive.html'), `<!-- excerpt of ${ARCHIVE}: the release links -->\n${links.join('\n')}\n`);
  const s = textOf(raw.schedule);
  const i = s.indexOf('Reference Month Release Date');
  if (i === -1) throw new Error(`${SCHEDULE}: no "Reference Month Release Date" table`);
  const j = s.indexOf('Subscribe', i);
  fs.writeFileSync(path.join(dir, 'schedule.txt'), `${s.slice(i, j === -1 ? undefined : j).trim()}\n`);
  for (const [p, html] of Object.entries(raw.releases)) {
    const t = textOf(html);
    const r = parseRelease(t);
    const e = t.match(/Transmission of material in this release is embargoed until [^,]*?, [A-Z][a-z]+ \d{1,2}, \d{4}/);
    fs.writeFileSync(path.join(dir, `release-${p}.txt`), `${e ? e[0] : ''}\n${r.sentence}\n`);
  }
  fs.writeFileSync(path.join(dir, 'fetched.txt'), `${fetched}\n`);
}

async function loadRaw() {
  const dir = process.env.US_INFLATION_DIR;
  if (dir) {
    const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
    const api = JSON.parse(read('api.json'));
    const releases = Object.fromEntries(lastTwoMonths(api).map((p) => [p, read(`release-${p}.txt`)]));
    return { raw: { api, archive: read('archive.html'), schedule: read('schedule.txt'), releases }, fetched: read('fetched.txt').trim(), via: `local files ${dir}` };
  }
  const fetched = new Date().toISOString().slice(0, 10);
  const api = await fetchApi(Number(fetched.slice(0, 4)));
  const archive = await get(ARCHIVE);
  const links = parseArchive(archive);
  const releases = {};
  for (const p of lastTwoMonths(api)) {
    if (!links.get(p)) throw new Error(`${ARCHIVE}: no release link for ${monthName(p)}`);
    releases[p] = await get(links.get(p).url);
  }
  const schedule = await get(SCHEDULE);
  const raw = { api, archive, schedule, releases };
  if (process.env.US_INFLATION_SAVE) saveFixtures(process.env.US_INFLATION_SAVE, raw, fetched);
  return { raw, fetched, via: `${API} (POST, series ${SERIES}), ${ARCHIVE} and the two newest archived releases, ${SCHEDULE}` };
}

async function main() {
  const src = await loadRaw();
  const data = buildFrom(src.raw, src);
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
  const [rate, index] = data.categories['cpi-u'].figures;
  console.log(`us-inflation.json: ${rate.period} CPI-U ${index.value} (${rate.value}% over 12 months), released ${rate.effectiveFrom}; next release ${data.nextRelease.date} (${data.nextRelease.referenceMonth}); verifiedDate ${data.verifiedDate}`);
  console.log('next: node scripts/changelog.js --only us-inflation (one entry per figure that moved), then node scripts/sign-facts.js');
}

if (require.main === module) main().catch((e) => { console.error(e.message || e); process.exit(1); });
module.exports = { buildFrom, parseApi, parseArchive, parseSchedule, parseRelease, twelveMonth, textOf, isoDate, SERIES, SERIES_PAGE, CPI_PAGE, ARCHIVE, SCHEDULE, COPYRIGHT, LICENCE, UA };
