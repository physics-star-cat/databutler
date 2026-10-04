#!/usr/bin/env node
/**
 * Regenerate data/calendar.json — the committed monthly snapshot behind the
 * calendar server (calendar_facts, next_holiday): public holidays, tax-year
 * starts and daylight-saving switches for 2026–2028.
 *
 *   node scripts/calendar.js              # fetch the machine-readable sources, merge data/calendar/manual.json
 *   CAL_DIR=/path/to/saved node scripts/calendar.js
 *                                         # build from saved copies instead: gov-uk-bank-holidays.json,
 *                                         # opm-federal-holidays.html, fr-<zone>-<year>.json
 *                                         # (the fetch date is then the newest file's mtime)
 *
 * Fetched (User-Agent "databutler.dev data curation (+https://databutler.dev)", 500 ms apart):
 *   - https://www.gov.uk/bank-holidays.json           UK: England & Wales, Scotland, Northern Ireland (OGL v3)
 *   - https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/
 *                                                     US: OPM's federal holiday tables, one per year (US Government work)
 *   - https://calendrier.api.gouv.fr/jours-feries/<zone>/<year>.json
 *                                                     France: métropole and Alsace-Moselle (Licence Ouverte 2.0)
 * Hand-verified (data/calendar/manual.json, every entry with its source page and the sentence read):
 *   - Germany's holidays as rules (nine nationwide per the BMI, per-Land additions per the Land statutes
 *     and pages), dated here from the rule (Easter-relative dates via the Gregorian computus) and
 *     asserted against the dates two Land ministries publish for 2026/2027;
 *   - the US statutory rules of 5 U.S.C. § 6103, asserted against OPM's table (OPM's date is the
 *     observed one when the holiday falls on a weekend);
 *   - tax-year starts/ends for nine countries, as rules with the statute or official page quoted;
 *   - daylight-saving rules, dated here from the rule and asserted against gov.uk's clock-change
 *     table and the NSW Government's dates.
 * Records are reshaped, never edited. A check that fails stops the build.
 *
 * Changelog (area: calendar), appended with mergeEntries and published at /changes:
 *   - first derivation (no committed file): one `<country>/<kind>` entry per block (null → covered);
 *   - later runs: `<country>/holidays/<year>` when a new year appears; `<country>/holidays/<region>/<year>/<key>`
 *     when a holiday is added, removed or its date moves; `<country>/tax-year/<personal|government>` and
 *     `<country>/dst/<year>` when a rule or a transition date changes. Notes are left blank for the maintainer.
 */
const fs = require('node:fs');
const path = require('node:path');
// Pure helpers only: requiring api/_changelog here would load every area module, and this area's module
// requires the data file this script is about to write (first derivation). api/_areas.js tolerates that
// now (the area is marked unavailable), but the script needs none of it.
const { mergeEntries } = require('../api/_area_kit');
const { previousSnapshot } = require('./_git');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/calendar.json');
const MANUAL = path.join(ROOT, 'data/calendar/manual.json');
const CHANGELOG = path.join(ROOT, 'data/changelog.json');

const UA = 'databutler.dev data curation (+https://databutler.dev)';
const PAUSE_MS = 500;
const REFRESH_DAYS = 35;

const GOVUK = 'https://www.gov.uk/bank-holidays.json';
const GOVUK_PAGE = 'https://www.gov.uk/bank-holidays';
const OPM = 'https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/';
const FR_API = 'https://calendrier.api.gouv.fr/jours-feries/';
const FR_DATASET = 'https://www.data.gouv.fr/fr/datasets/jours-feries-en-france/';
const FR_ZONES = ['metropole', 'alsace-moselle'];

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function plusDays(isoDay, n) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekdayOf = (isoDay) => new Date(`${isoDay}T00:00:00Z`).getUTCDay(); // 0 = Sunday

/* ---------------- date rules ---------------- */

/** Gregorian Easter Sunday (Meeus/Jones/Butcher) as YYYY-MM-DD. */
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/** The nth (1–5) or last weekday (0 = Sunday … 6) of a month, as YYYY-MM-DD. */
function nthWeekday(year, month, nth, weekday) {
  if (nth === 'last') {
    const lastDay = new Date(Date.UTC(year, month, 0));
    const back = (lastDay.getUTCDay() - weekday + 7) % 7;
    return iso(year, month, lastDay.getUTCDate() - back);
  }
  const first = new Date(Date.UTC(year, month - 1, 1));
  const fwd = (weekday - first.getUTCDay() + 7) % 7;
  return iso(year, month, 1 + fwd + (nth - 1) * 7);
}

/** A manual.json rule → the date in `year`: fixed {month, day}; {easter: offsetDays}; {month, nth, weekday}; {wednesdayBefore: 'MM-DD'}. */
function dateFromRule(rule, year) {
  if (rule.easter !== undefined) return plusDays(easter(year), rule.easter);
  if (rule.day !== undefined) return iso(year, rule.month, rule.day);
  if (rule.nth !== undefined) return nthWeekday(year, rule.month, rule.nth, rule.weekday);
  if (rule.wednesdayBefore) {
    let d = `${year}-${rule.wednesdayBefore}`;
    do d = plusDays(d, -1); while (weekdayOf(d) !== 3);
    return d;
  }
  throw new Error(`unknown rule ${JSON.stringify(rule)}`);
}

/* ---------------- source parsers ---------------- */

/** gov.uk/bank-holidays.json → { division: [{ date, name, notes?, substitute? }] } for the years wanted. */
function parseGovUk(json, years) {
  const out = {};
  for (const [division, block] of Object.entries(json)) {
    if (!block || !Array.isArray(block.events)) throw new Error(`gov.uk: ${division} has no events`);
    out[division] = {};
    for (const y of years) {
      const rows = block.events.filter((e) => String(e.date).startsWith(`${y}-`)).sort((a, b) => a.date.localeCompare(b.date));
      if (!rows.length) throw new Error(`gov.uk: ${division} publishes nothing for ${y}`);
      // gov.uk flags a substitute day in `notes` ("Substitute day"); the HTML page appends "(substitute day)" to the title
      out[division][y] = rows.map((e) => ({
        date: e.date,
        name: e.title,
        key: slug(e.title.replace(/\s*\(substitute day\)/i, '')),
        ...(/substitute day/i.test(`${e.title} ${e.notes || ''}`) ? { substitute: true } : {}),
        ...(e.notes ? { notes: e.notes } : {}),
      }));
    }
  }
  return out;
}

const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#8217;|&rsquo;|’/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * OPM's federal-holidays page → { year: [{ monthDay: 'MM-DD', weekday, name, marker }] } for the years wanted.
 * Each year is one <table> whose caption reads "YYYY Holiday Schedule"; each row is a date cell
 * ("Monday, February 16"), an optional footnote marker cell (* or **) and the holiday name.
 */
function parseOpm(html, years) {
  const out = {};
  for (const m of html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/g)) {
    const table = m[0];
    const cap = table.match(/(\d{4}) Holiday Schedule/);
    if (!cap) continue;
    const year = Number(cap[1]);
    if (!years.includes(year)) continue;
    const rows = [];
    for (const r of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => stripTags(c[1])).filter(Boolean);
      if (cells.length < 2 || /^Date$/i.test(cells[0])) continue;
      // "Monday, February 16" with an optional footnote marker ("*", "**") in the same cell or the next one
      const dm = cells[0].match(/^(\w+),\s+(\w+)\s+(\d{1,2})\s*(\*{0,3})$/);
      if (!dm) throw new Error(`OPM ${year}: unparsed date cell "${cells[0]}"`);
      const month = MONTHS.indexOf(dm[2].toLowerCase()) + 1;
      if (!month) throw new Error(`OPM ${year}: unknown month in "${cells[0]}"`);
      const marker = dm[4] || (cells.length > 2 ? cells[1] : '');
      rows.push({ monthDay: `${pad(month)}-${pad(dm[3])}`, weekday: dm[1], name: cells[cells.length - 1], marker });
    }
    if (rows.length < 10) throw new Error(`OPM ${year}: only ${rows.length} rows parsed`);
    out[year] = rows;
  }
  for (const y of years) if (!out[y]) throw new Error(`OPM publishes no ${y} table`);
  return out;
}

/** calendrier.api.gouv.fr JSON ({ 'YYYY-MM-DD': name }) → [{ date, name, key }] sorted. */
function parseFrance(json, zone, year) {
  const rows = Object.entries(json).map(([date, name]) => ({ date, name, key: slug(name) })).sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length || rows.some((r) => !r.date.startsWith(`${year}-`))) throw new Error(`calendrier.api.gouv.fr ${zone}/${year}: unexpected dates`);
  return rows;
}

/* ---------------- builders ---------------- */

const normName = (s) => s.replace(/[’']/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** US federal holidays for one year: statutory date from 5 U.S.C. § 6103 rules, OPM's date as `observed` when it differs. */
function usYear(manual, opmRows, year) {
  const statute = manual.usStatute;
  const seen = new Set();
  const list = statute.holidays.map((h) => {
    const date = dateFromRule(h.rule, year);
    const row = opmRows.find((r) => normName(r.name) === normName(h.name));
    if (!row) throw new Error(`OPM ${year}: no row for ${h.name}`);
    seen.add(row);
    // OPM prints month and day only; the observed date is the candidate within three days of the statutory one.
    const candidates = [year - 1, year, year + 1].map((y) => `${y}-${row.monthDay}`);
    const observed = candidates.find((c) => Math.abs((Date.parse(c) - Date.parse(date)) / 86400000) <= 3);
    if (!observed) throw new Error(`OPM ${year}: ${h.name} on ${row.monthDay} is not within three days of the statutory ${date}`);
    return {
      date, name: h.name, key: h.key,
      ...(observed !== date ? { observed, note: `${h.name} ${year} falls on a ${weekdayOf(date) === 6 ? 'Saturday' : 'Sunday'}; OPM lists ${observed} (${row.weekday}) as the holiday for pay and leave purposes` } : {}),
    };
  });
  const extra = opmRows.filter((r) => !seen.has(r));
  for (const r of extra) {
    if (!/inauguration/i.test(r.name)) throw new Error(`OPM ${year}: unexpected row "${r.name}"`);
    list.push({ date: `${year}-${r.monthDay}`, name: r.name, key: 'inauguration-day', scope: 'Washington DC area federal employees only (5 U.S.C. § 6103(c))' });
  }
  return list.sort((a, b) => (a.observed || a.date).localeCompare(b.observed || b.date));
}

/** German holidays for one Land (or 'nationwide') in one year, dated from the rules. */
function germanyYear(manual, landKey, year) {
  const g = manual.germany;
  const land = landKey === 'nationwide' ? { add: [], partial: [] } : g.laender[landKey];
  const items = g.nationwide.holidays.map((h) => ({ date: dateFromRule(h.rule, year), name: h.name, key: h.key }));
  for (const k of land.add || []) {
    const h = g.additional[k];
    if (!h) throw new Error(`manual.json: ${landKey} adds unknown holiday ${k}`);
    items.push({ date: dateFromRule(h.rule, year), name: h.name, key: k });
  }
  for (const p of land.partial || []) {
    const h = g.additional[p.key];
    if (!h) throw new Error(`manual.json: ${landKey} partial unknown holiday ${p.key}`);
    items.push({ date: dateFromRule(h.rule, year), name: h.name, key: p.key, partial: true, scope: p.scope });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

function assertChecks(label, got, expected) {
  for (const [k, want] of Object.entries(expected)) {
    const have = typeof got === 'string' ? got : got[k];
    if (typeof want === 'object') assertChecks(`${label}/${k}`, got[k], want);
    else if (have !== want) throw new Error(`check failed ${label}/${k}: computed ${have}, official page says ${want}`);
  }
}

/** Tax-year periods starting in each year, from the rule's MM-DD start/end. */
function periods(block, years) {
  const out = {};
  for (const y of years) {
    const start = `${y}-${block.starts}`;
    const end = block.starts === '01-01' ? `${y}-12-31` : `${y + 1}-${block.ends}`;
    const label = block.starts === '01-01' ? String(y) : block.namedForEndYear ? `FY${y + 1}` : `${y}-${String(y + 1).slice(2)}`;
    out[y] = { start, end, label };
  }
  return out;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * Pure builder. raw = { govuk: <bank-holidays.json>, opm: <html>, fr: { '<zone>/<year>': <json> } }.
 * Throws when a source lacks a year or a hand-computed check disagrees with an official page.
 */
function buildFrom(raw, manual, { fetched, via }) {
  const years = manual.years;
  const verifiedDate = String(fetched).slice(0, 10);
  const holidays = {};

  // UK
  const uk = parseGovUk(raw.govuk, years);
  const ukNames = { 'england-and-wales': 'England and Wales', scotland: 'Scotland', 'northern-ireland': 'Northern Ireland' };
  for (const k of Object.keys(ukNames)) if (!uk[k]) throw new Error(`gov.uk: division ${k} missing`);
  holidays.uk = {
    name: 'United Kingdom', kind: 'bank and public holidays',
    source: GOVUK, page: GOVUK_PAGE, publisher: 'GOV.UK (Government Digital Service) — bank-holidays.json',
    licence: 'Open Government Licence v3.0 ("All content is available under the Open Government Licence v3.0, except where otherwise stated © Crown copyright")',
    statute: { source: 'https://www.legislation.gov.uk/ukpga/1971/80/schedule/1', note: 'Banking and Financial Dealings Act 1971, Schedule 1 (bank holidays by division); the remaining days are proclaimed or customary, as GOV.UK lists them.' },
    defaultRegion: 'england-and-wales',
    regions: Object.fromEntries(Object.entries(ukNames).map(([k, name]) => [k, { name, years: uk[k] }])),
    notes: 'Substitute days (when a holiday falls on a weekend) are listed as GOV.UK publishes them, flagged `substitute`.',
  };

  // US
  const opm = parseOpm(raw.opm, years);
  holidays.us = {
    name: 'United States', kind: 'federal holidays',
    source: OPM, publisher: 'U.S. Office of Personnel Management — federal holidays tables',
    licence: manual.usStatute.licence,
    statute: { source: manual.usStatute.source, quote: manual.usStatute.quote, observedRule: manual.usStatute.observedRule, inaugurationDay: manual.usStatute.inaugurationDay },
    defaultRegion: 'federal',
    regions: { federal: { name: 'Federal (5 U.S.C. § 6103)', years: Object.fromEntries(years.map((y) => [y, usYear(manual, opm[y], y)])) } },
    notes: '`date` is the statutory date; `observed` is OPM\'s date for pay and leave when the holiday falls on a Saturday (preceding Friday) or Sunday (following Monday). State holidays are not covered.',
  };

  // Germany
  const g = manual.germany;
  const deRegions = { nationwide: { name: 'Bundesweit (die neun bundeseinheitlichen Feiertage)', source: g.nationwide.source, publisher: g.nationwide.publisher, quote: g.nationwide.quote, years: Object.fromEntries(years.map((y) => [y, germanyYear(manual, 'nationwide', y)])) } };
  for (const [code, land] of Object.entries(g.laender)) {
    deRegions[code] = {
      name: land.name, ...pick(land, ['source', 'quote', 'verification']),
      nonOfficial: /NOT VERIFIED/.test(land.verification || ''),
      years: Object.fromEntries(years.map((y) => [y, germanyYear(manual, code, y)])),
    };
  }
  for (const [code, byYear] of Object.entries(g.checks)) {
    for (const [y, expected] of Object.entries(byYear)) {
      const got = Object.fromEntries(deRegions[code].years[y].map((h) => [h.key, h.date]));
      assertChecks(`de/${code}/${y}`, got, expected);
    }
  }
  holidays.de = {
    name: 'Germany', kind: 'gesetzliche Feiertage',
    source: g.nationwide.source, publisher: g.nationwide.publisher, licence: 'Statutory texts and ministry pages are official works (§ 5 UrhG); the BMI page carries no separate licence statement.',
    overview: g.overview,
    defaultRegion: 'nationwide', regions: deRegions,
    notes: 'Dates are computed from each holiday\'s rule (fixed date or Easter offset) and asserted against the 2026/2027 dates the Hessen and Rheinland-Pfalz ministries publish. `partial` holidays apply only in the Gemeinden named in `scope`. A Land marked `nonOfficial` has an addition that could not be re-verified against an official page on verifiedDate — see its `verification`.',
  };

  // France
  const frRegions = {};
  for (const zone of FR_ZONES) {
    frRegions[zone] = {
      name: zone === 'metropole' ? 'France métropolitaine (cas général)' : 'Alsace-Moselle (Bas-Rhin, Haut-Rhin, Moselle)',
      years: Object.fromEntries(years.map((y) => [y, parseFrance(raw.fr[`${zone}/${y}`], zone, y)])),
    };
  }
  holidays.fr = {
    name: 'France', kind: 'jours fériés (fêtes légales)',
    source: `${FR_API}<zone>/<year>.json`, dataset: FR_DATASET, publisher: 'data.gouv.fr / DINUM — "Jours fériés en France" (API calendrier.api.gouv.fr)',
    licence: 'Licence Ouverte / Open Licence version 2.0 (Etalab), as stated on the data.gouv.fr dataset page',
    statute: { source: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2405', note: 'Code du travail art. L3133-1 (the dataset page: "La liste des jours fériés est définie dans le code du travail"); service-public.fr F2405 publishes the same 2026 and 2027 tables, including the Alsace-Moselle Vendredi saint and Saint Étienne.' },
    defaultRegion: 'metropole', regions: frRegions,
    notes: 'Overseas zones (Guadeloupe, Martinique, Guyane, La Réunion, Mayotte, …) exist in the same API but are not included.',
  };

  // Tax years
  const taxYears = {};
  for (const [cc, t] of Object.entries(manual.taxYears)) {
    taxYears[cc] = { name: t.name };
    for (const part of ['personal', 'government']) {
      if (!t[part]) continue;
      const b = t[part];
      taxYears[cc][part] = {
        label: b.label, statement: b.statement, rule: { starts: b.starts, ends: b.ends, ...(b.namedForEndYear ? { namedForEndYear: true } : {}) },
        periods: periods(b, years),
        ...pick(b, ['source', 'publisher', 'quote', 'secondarySource', 'secondaryQuote', 'licence', 'verification']),
        nonOfficial: /NOT /.test(b.verification || '') && !/fetched 2026/.test(b.verification || ''),
      };
    }
  }

  // DST
  const dst = {};
  for (const [cc, d] of Object.entries(manual.dst)) {
    const block = { name: d.name, observed: d.observed, zoneName: d.zoneName, ruleText: d.ruleText, ...pick(d, ['observing', 'notObserving', 'exemptionsNote']) };
    if (d.rule) {
      block.rule = d.rule;
      block.transitions = {};
      for (const y of years) {
        const start = nthWeekday(y, d.rule.start.month, d.rule.start.nth, d.rule.start.weekday);
        const end = nthWeekday(y, d.rule.end.month, d.rule.end.nth, d.rule.end.weekday);
        block.transitions[y] = d.rule.start.month > d.rule.end.month
          ? { clocksBack: end, clocksForward: start, note: `southern hemisphere: the summer-time period that begins ${start} ends on the first Sunday in April ${y + 1}` }
          : { clocksForward: start, clocksBack: end };
      }
      if (d.checks) {
        for (const [y, want] of Object.entries(d.checks)) {
          const t = block.transitions[y];
          assertChecks(`dst/${cc}/${y}`, { start: t.clocksForward, end: t.clocksBack }, want);
        }
      }
    }
    Object.assign(block, pick(d, ['statute', 'euBasis', 'verifiedAgainst', 'verification']));
    block.nonOfficial = /NOT re-verified|NOT VERIFIED/.test(d.verification || '');
    block.source = (d.statute && d.statute.source) || null;
    dst[cc] = block;
  }

  const count = (h) => Object.values(h.regions).reduce((n, r) => n + Object.values(r.years).reduce((m, l) => m + l.length, 0), 0);
  return {
    dataset: 'Calendar facts a model with a training cutoff cannot know for next year: public holidays (UK, US, Germany, France), tax-year starts and ends (UK, US, Australia, India, Canada, Germany, France, Brazil, Poland) and daylight-saving switches (UK, Germany, France, US, Australia; Brazil has none), for ' + years.join(', '),
    years,
    verifiedDate,
    nextScheduledRefresh: plusDays(verifiedDate, REFRESH_DAYS),
    fetched, fetchedVia: via,
    licence: 'Per source: gov.uk — Open Government Licence v3.0; OPM and the US Code — US Government works, public domain; calendrier.api.gouv.fr — Licence Ouverte 2.0; German statutes and ministry pages — official works (§ 5 UrhG); other statutes as recorded on each block.',
    verificationMethod:
      `The three machine-readable sources were fetched on \`fetched\` (User-Agent "${UA}", ${PAUSE_MS} ms apart) and reshaped, not edited. Everything else comes from data/calendar/manual.json, ` +
      'where each entry names the official page it was read from on verifiedDate and quotes the sentence; rule-based dates (Easter-relative holidays, US statutory dates, DST transitions, tax-year ' +
      'periods) are computed by scripts/calendar.js from the quoted rule and asserted against dates official pages publish. Entries that could not be re-verified against an official page carry `nonOfficial: true` and say why.',
    manualVerifiedDate: manual.verifiedDate,
    counts: { holidays: Object.fromEntries(Object.entries(holidays).map(([cc, h]) => [cc, count(h)])), taxYearCountries: Object.keys(taxYears).length, dstCountries: Object.keys(dst).length },
    holidays, taxYears, dst,
  };
}

/* ---------------- fetch ---------------- */

async function loadRaw(manual) {
  const years = manual.years;
  if (process.env.CAL_DIR) {
    const dir = process.env.CAL_DIR;
    const files = ['gov-uk-bank-holidays.json', 'opm-federal-holidays.html', ...FR_ZONES.flatMap((z) => years.map((y) => `fr-${z}-${y}.json`))];
    let newest = 0;
    for (const f of files) newest = Math.max(newest, fs.statSync(path.join(dir, f)).mtimeMs);
    const fr = {};
    for (const z of FR_ZONES) for (const y of years) fr[`${z}/${y}`] = readJson(path.join(dir, `fr-${z}-${y}.json`));
    return { raw: { govuk: readJson(path.join(dir, 'gov-uk-bank-holidays.json')), opm: fs.readFileSync(path.join(dir, 'opm-federal-holidays.html'), 'utf8'), fr }, fetched: new Date(newest).toISOString(), via: `local files ${dir}/` };
  }
  const fetched = new Date().toISOString();
  const get = async (url, accept) => {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    console.log(`${url}: ${r.status}`);
    await sleep(PAUSE_MS);
    return r;
  };
  const govuk = await (await get(GOVUK, 'application/json')).json();
  const opm = await (await get(OPM, 'text/html')).text();
  const fr = {};
  for (const z of FR_ZONES) for (const y of years) fr[`${z}/${y}`] = await (await get(`${FR_API}${z}/${y}.json`, 'application/json')).json();
  return { raw: { govuk, opm, fr }, fetched, via: `${GOVUK}, ${OPM}, ${FR_API}<zone>/<year>.json — one request each` };
}

/* ---------------- changelog ---------------- */

const KEY_ORDER = ['area', 'key', 'label', 'from', 'to', 'effectiveFrom', 'source', 'verifiedDate', 'note'];
const ordered = (e) => Object.fromEntries(KEY_ORDER.map((k) => [k, e[k]]));

function firstEntries(data, today) {
  const out = [];
  for (const [cc, h] of Object.entries(data.holidays)) {
    out.push({
      area: 'calendar', key: `${cc}/holidays`, label: `${h.name} ${h.kind} dataset`, from: null, to: 'covered', effectiveFrom: data.verifiedDate, source: h.page || h.source.replace('<zone>/<year>.json', 'metropole/2026.json'), verifiedDate: today,
      note: `First derivation of data/calendar.json for ${h.name}: ${data.counts.holidays[cc]} holiday entries across ${Object.keys(h.regions).length} region(s) for ${data.years.join(', ')} from ${h.publisher} (${h.licence.split(' (')[0]}), fetched/verified ${data.verifiedDate}.`,
    });
  }
  for (const [cc, t] of Object.entries(data.taxYears)) {
    const p = t.personal;
    out.push({
      area: 'calendar', key: `${cc}/tax-year`, label: `${t.name} tax year`, from: null, to: 'covered', effectiveFrom: data.verifiedDate, source: p.source, verifiedDate: today,
      note: `First derivation: ${p.statement}${t.government ? ` Government: ${t.government.statement}` : ''} Source quoted in the data file; verified ${data.verifiedDate}.`,
    });
  }
  for (const [cc, d] of Object.entries(data.dst)) {
    out.push({
      area: 'calendar', key: `${cc}/dst`, label: `${d.name} daylight saving`, from: null, to: 'covered', effectiveFrom: data.verifiedDate, source: d.source || (d.verifiedAgainst && d.verifiedAgainst.source), verifiedDate: today,
      note: `First derivation: ${d.ruleText} ${d.transitions ? `Transitions for ${data.years.join(', ')} computed from the rule` : 'No transitions (not observed)'}${d.nonOfficial ? ' — statute text not re-verified on the verification date, see the data file' : ''}; verified ${data.verifiedDate}.`,
    });
  }
  return out;
}

/**
 * Changelog entries for the snapshot, pure. prev === null → first derivation (one entry per block).
 * Otherwise: new year → `<cc>/holidays/<year>`; a holiday added/removed/moved (by observed or statutory date)
 * → `<cc>/holidays/<region>/<year>/<key>`; a tax-year rule change → `<cc>/tax-year/<part>`;
 * a DST transition or observed-flag change → `<cc>/dst/<year>` or `<cc>/dst`.
 */
function datasetEntries(prev, data, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!prev) return firstEntries(data, today).map(ordered);
  const out = [];
  const base = (key, label, from, to, effectiveFrom, source) => ({ area: 'calendar', key, label, from, to, effectiveFrom, source, verifiedDate: data.verifiedDate, note: '' });
  for (const [cc, h] of Object.entries(data.holidays)) {
    const ph = prev.holidays && prev.holidays[cc];
    if (!ph) { out.push(base(`${cc}/holidays`, `${h.name} ${h.kind} dataset`, null, 'covered', data.verifiedDate, h.page || h.source)); continue; }
    const prevYears = new Set(Object.values(ph.regions).flatMap((r) => Object.keys(r.years)));
    const nowYears = [...new Set(Object.values(h.regions).flatMap((r) => Object.keys(r.years)))].sort();
    for (const y of nowYears) if (!prevYears.has(y)) out.push(base(`${cc}/holidays/${y}`, `${h.name} ${h.kind} ${y}`, null, 'covered', `${y}-01-01`, h.page || h.source));
    for (const [rk, r] of Object.entries(h.regions)) {
      const pr = ph.regions[rk];
      if (!pr) continue;
      for (const [y, list] of Object.entries(r.years)) {
        if (!pr.years[y]) continue;
        const was = new Map(pr.years[y].map((x) => [x.key + (x.substitute ? '-substitute' : ''), x]));
        const now = new Map(list.map((x) => [x.key + (x.substitute ? '-substitute' : ''), x]));
        const eff = (x) => x.observed || x.date;
        for (const [k, x] of now) {
          const w = was.get(k);
          if (!w) out.push(base(`${cc}/holidays/${rk}/${y}/${k}`, `${h.name} (${r.name}) ${x.name} ${y}`, null, eff(x), eff(x), h.page || h.source));
          else if (eff(w) !== eff(x)) out.push(base(`${cc}/holidays/${rk}/${y}/${k}`, `${h.name} (${r.name}) ${x.name} ${y}`, eff(w), eff(x), eff(x), h.page || h.source));
        }
        for (const [k, w] of was) if (!now.has(k)) out.push(base(`${cc}/holidays/${rk}/${y}/${k}`, `${h.name} (${r.name}) ${w.name} ${y}`, eff(w), null, data.verifiedDate, h.page || h.source));
      }
    }
  }
  for (const [cc, t] of Object.entries(data.taxYears)) {
    const pt = prev.taxYears && prev.taxYears[cc];
    if (!pt) { out.push(base(`${cc}/tax-year`, `${t.name} tax year`, null, 'covered', data.verifiedDate, t.personal.source)); continue; }
    for (const part of ['personal', 'government']) {
      if (!t[part] || !pt[part]) continue;
      const a = `${pt[part].rule.starts} → ${pt[part].rule.ends}`, b = `${t[part].rule.starts} → ${t[part].rule.ends}`;
      if (a !== b) out.push(base(`${cc}/tax-year/${part}`, `${t.name} ${t[part].label}`, a, b, data.verifiedDate, t[part].source));
    }
  }
  for (const [cc, d] of Object.entries(data.dst)) {
    const pd = prev.dst && prev.dst[cc];
    if (!pd) { out.push(base(`${cc}/dst`, `${d.name} daylight saving`, null, 'covered', data.verifiedDate, d.source)); continue; }
    if (String(pd.observed) !== String(d.observed)) out.push(base(`${cc}/dst`, `${d.name} daylight saving observed`, pd.observed, d.observed, data.verifiedDate, d.source));
    for (const [y, t] of Object.entries(d.transitions || {})) {
      const w = pd.transitions && pd.transitions[y];
      const s = (x) => `${x.clocksForward} / ${x.clocksBack}`;
      if (w && s(w) !== s(t)) out.push(base(`${cc}/dst/${y}`, `${d.name} daylight saving ${y}`, s(w), s(t), t.clocksForward, d.source));
    }
  }
  return out.map(ordered);
}

async function main() {
  const manual = readJson(MANUAL);
  const src = await loadRaw(manual);
  const data = buildFrom(src.raw, manual, src);
  const prev = previousSnapshot('data/calendar.json'); // the committed file: a re-run before committing appends nothing new
  const text = JSON.stringify(data, null, 1) + '\n';
  fs.writeFileSync(OUT, text);
  console.log(`calendar.json: ${Math.round(Buffer.byteLength(text) / 1024)} KB, holidays ${JSON.stringify(data.counts.holidays)}, ${data.counts.taxYearCountries} tax-year countries, ${data.counts.dstCountries} DST countries, verifiedDate ${data.verifiedDate}${prev ? '' : ' (first derivation)'}`);
  const incoming = datasetEntries(prev, data);
  if (!incoming.length) { console.log('changelog: nothing moved against the committed file'); return; }
  const existing = fs.existsSync(CHANGELOG) ? readJson(CHANGELOG) : [];
  const { merged, added } = mergeEntries(existing, incoming);
  fs.writeFileSync(CHANGELOG, JSON.stringify(merged, null, 2) + '\n');
  console.log(`changelog: ${added.length} entr${added.length === 1 ? 'y' : 'ies'} added — review each note (blank for later-run moves), then commit data/ together:`);
  for (const e of added) console.log(`  ${e.key}: ${e.from} → ${e.to}`);
}

if (require.main === module) main().catch((e) => { console.error(e.message || e); process.exit(1); });
module.exports = { easter, nthWeekday, dateFromRule, parseGovUk, parseOpm, parseFrance, usYear, germanyYear, periods, buildFrom, datasetEntries, UA, REFRESH_DAYS, GOVUK, OPM, FR_API, FR_ZONES, plusDays, slug };
