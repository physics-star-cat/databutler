/**
 * Calendar vertical — the boring calendar facts a model with a training cutoff
 * cannot know for next year: public holidays (UK, US, Germany, France), tax-year
 * starts and ends (nine countries) and daylight-saving switches, from the
 * committed monthly snapshot data/calendar.json built by scripts/calendar.js.
 * Query-time work only: resolve a country/region/kind, pick the year, read.
 */
const DATA = require('../data/calendar.json');
const { nearest } = require('./_text');

const KINDS = ['holidays', 'tax-year', 'dst'];
const YEARS = DATA.years;

const norm = (s) => String(s ?? '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');

/** Country names callers use → the two-letter code the data is keyed by. */
const COUNTRY_ALIASES = {
  uk: 'uk', gb: 'uk', 'united-kingdom': 'uk', 'great-britain': 'uk', britain: 'uk', england: 'uk', scotland: 'uk', wales: 'uk', 'northern-ireland': 'uk',
  us: 'us', usa: 'us', 'united-states': 'us', 'united-states-of-america': 'us', america: 'us',
  de: 'de', germany: 'de', deutschland: 'de',
  fr: 'fr', france: 'fr',
  au: 'au', australia: 'au',
  in: 'in', india: 'in', bharat: 'in',
  ca: 'ca', canada: 'ca',
  br: 'br', brazil: 'br', brasil: 'br',
  pl: 'pl', poland: 'pl', polska: 'pl',
};
/** A country alias that is itself a UK nation picks the region. */
const REGION_HINT = { england: 'england-and-wales', wales: 'england-and-wales', scotland: 'scotland', 'northern-ireland': 'northern-ireland' };

const DE_NAMES = {
  'baden-wurttemberg': 'BW', bavaria: 'BY', bayern: 'BY', berlin: 'BE', brandenburg: 'BB', bremen: 'HB', hamburg: 'HH', hessen: 'HE', hesse: 'HE',
  'mecklenburg-vorpommern': 'MV', 'mecklenburg-western-pomerania': 'MV', niedersachsen: 'NI', 'lower-saxony': 'NI', 'nordrhein-westfalen': 'NW', 'north-rhine-westphalia': 'NW', nrw: 'NW',
  'rheinland-pfalz': 'RP', 'rhineland-palatinate': 'RP', saarland: 'SL', sachsen: 'SN', saxony: 'SN', 'sachsen-anhalt': 'ST', 'saxony-anhalt': 'ST',
  'schleswig-holstein': 'SH', thuringen: 'TH', thuringia: 'TH', nationwide: 'nationwide', bundesweit: 'nationwide', national: 'nationwide', all: 'nationwide', germany: 'nationwide', deutschland: 'nationwide',
};
const REGION_ALIASES = {
  uk: { england: 'england-and-wales', wales: 'england-and-wales', 'england-and-wales': 'england-and-wales', ew: 'england-and-wales', 'england-wales': 'england-and-wales', scotland: 'scotland', sco: 'scotland', 'northern-ireland': 'northern-ireland', ni: 'northern-ireland', ulster: 'northern-ireland' },
  us: { federal: 'federal', national: 'federal', us: 'federal', all: 'federal' },
  de: DE_NAMES,
  fr: { metropole: 'metropole', metropolitan: 'metropole', mainland: 'metropole', france: 'metropole', 'cas-general': 'metropole', alsace: 'alsace-moselle', moselle: 'alsace-moselle', 'alsace-moselle': 'alsace-moselle', 'bas-rhin': 'alsace-moselle', 'haut-rhin': 'alsace-moselle' },
};
const KIND_ALIASES = {
  holidays: 'holidays', holiday: 'holidays', 'public-holidays': 'holidays', 'public-holiday': 'holidays', 'bank-holidays': 'holidays', 'bank-holiday': 'holidays', feiertage: 'holidays', 'jours-feries': 'holidays', 'federal-holidays': 'holidays',
  'tax-year': 'tax-year', tax: 'tax-year', taxyear: 'tax-year', 'tax-years': 'tax-year', 'fiscal-year': 'tax-year', 'financial-year': 'tax-year', fiscal: 'tax-year', 'income-year': 'tax-year',
  dst: 'dst', 'daylight-saving': 'dst', 'daylight-saving-time': 'dst', 'daylight-savings': 'dst', 'summer-time': 'dst', clocks: 'dst', 'clock-change': 'dst', bst: 'dst',
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const day = (d) => new Date(d).toISOString().slice(0, 10);
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const weekday = (isoDay) => WEEKDAYS[new Date(`${isoDay}T00:00:00Z`).getUTCDay()];
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const effective = (h) => h.observed || h.date;

const COUNTRIES = {};
for (const block of [DATA.holidays, DATA.taxYears, DATA.dst]) for (const [cc, v] of Object.entries(block)) COUNTRIES[cc] = v.name;
const CODES = Object.keys(COUNTRIES);
const kindsFor = (cc) => KINDS.filter((k) => (k === 'holidays' ? DATA.holidays[cc] : k === 'tax-year' ? DATA.taxYears[cc] : DATA.dst[cc]));
const frSource = (h) => h.source.replace('<zone>/<year>.json', `metropole/${YEARS[0]}.json`);

function listing() {
  const countries = {};
  for (const cc of CODES) {
    const h = DATA.holidays[cc];
    countries[cc] = { name: COUNTRIES[cc], kinds: kindsFor(cc), ...(h ? { holidayRegions: Object.fromEntries(Object.entries(h.regions).map(([k, r]) => [k, r.name])) } : {}) };
  }
  return {
    countries, kinds: KINDS, years: YEARS, verifiedDate: DATA.verifiedDate,
    usage: 'pass country=<code or name> and kind=holidays|tax-year|dst; year (one of the years listed) and region (a UK nation, a German Land code or name, metropole|alsace-moselle) are optional',
    source: DATA.holidays.uk.page,
  };
}

function resolveCountry(country) {
  const key = norm(country);
  if (!key) return { listing: true };
  const cc = COUNTRY_ALIASES[key];
  if (!cc) {
    const near = [...new Set(nearest(key, [...CODES, ...Object.keys(COUNTRY_ALIASES)], 6).map((k) => COUNTRY_ALIASES[k] || k))].slice(0, 3);
    return { miss: { covered: false, requested: country, message: `"${country}" is not one of the ${CODES.length} countries covered`, nearest: near, coverage: Object.fromEntries(CODES.map((c) => [c, { name: COUNTRIES[c], kinds: kindsFor(c) }])) } };
  }
  return { cc, hint: REGION_HINT[key] };
}

function resolveRegion(cc, region, hint) {
  const h = DATA.holidays[cc];
  const keys = Object.keys(h.regions);
  if (region === undefined || region === null || String(region).trim() === '') return { key: hint || h.defaultRegion };
  const q = norm(region);
  const hit = (REGION_ALIASES[cc] || {})[q] || keys.find((k) => norm(k) === q || k.toLowerCase() === q) || keys.find((k) => norm(h.regions[k].name) === q);
  if (hit) return { key: hit };
  const names = Object.fromEntries(keys.map((k) => [k, h.regions[k].name]));
  return { miss: { covered: false, requested: { country: cc, region }, message: `"${region}" is not a ${COUNTRIES[cc]} region in this dataset`, nearest: nearest(q, [...keys, ...Object.keys(REGION_ALIASES[cc] || {})]).slice(0, 3), regions: names, defaultRegion: h.defaultRegion } };
}

function pickYear(year, asOf) {
  if (year === undefined || year === null || year === '') {
    const current = Number(asOf.slice(0, 4));
    return { year: YEARS.includes(current) ? current : YEARS[0], defaulted: true };
  }
  const y = Number(year);
  if (!YEARS.includes(y)) return { miss: { covered: false, requested: { year }, message: `year ${year} is not in this dataset`, yearsCovered: YEARS, hint: `pass one of ${YEARS.join(', ')} or omit year for the current year` } };
  return { year: y };
}

const provenance = (o) => ({
  ...(o.publisher ? { publisher: o.publisher } : {}), ...(o.quote ? { quote: o.quote } : {}), ...(o.secondarySource ? { secondarySource: o.secondarySource, secondaryQuote: o.secondaryQuote } : {}),
  ...(o.licence ? { licence: o.licence } : {}), ...(o.verification ? { verification: o.verification } : {}),
  ...(o.nonOfficial ? { nonOfficial: true, nonOfficialNote: 'This entry could not be re-verified against an official page on verifiedDate — `verification` says what was tried; treat it as non-official until the next refresh confirms it.' } : {}),
});

function holidaysAnswer(cc, { year, region, hint }, asOf) {
  const h = DATA.holidays[cc];
  const r = resolveRegion(cc, region, hint);
  if (r.miss) return r.miss;
  const y = pickYear(year, asOf);
  if (y.miss) return y.miss;
  const reg = h.regions[r.key];
  const list = reg.years[y.year].map((x) => ({ ...x, weekday: weekday(x.date), ...(x.observed ? { observedWeekday: weekday(x.observed) } : {}) }));
  return {
    country: cc, name: COUNTRIES[cc], kind: 'holidays', region: r.key, regionName: reg.name, year: y.year, ...(y.defaulted ? { yearDefaulted: true } : {}),
    count: list.length,
    statement: `${COUNTRIES[cc]} ${h.kind} ${y.year}, ${reg.name}: ${list.length} ${list.length === 1 ? 'day' : 'days'} — ${list.map((x) => `${x.name} ${effective(x)}`).join('; ')}.`,
    holidays: list,
    regions: Object.fromEntries(Object.entries(h.regions).map(([k, v]) => [k, v.name])), defaultRegion: h.defaultRegion, yearsCovered: YEARS,
    ...(h.notes ? { notes: h.notes } : {}),
    ...(reg.source || reg.quote || reg.verification ? { regionProvenance: { ...(reg.source ? { source: reg.source } : {}), ...provenance(reg) } } : {}),
    ...(h.statute ? { statute: h.statute } : {}),
    source: reg.source || h.page || (cc === 'fr' ? frSource(h) : h.source),
    ...(h.dataset ? { dataset: h.dataset } : {}),
    publisher: h.publisher, licence: h.licence,
    verifiedDate: DATA.verifiedDate,
  };
}

function taxYearAnswer(cc, { year }) {
  const t = DATA.taxYears[cc];
  let y = null;
  if (year !== undefined && year !== null && year !== '') {
    const p = pickYear(year, '');
    if (p.miss) return p.miss;
    y = p.year;
  }
  const part = (b) => b && ({ label: b.label, statement: b.statement, rule: b.rule, periods: y ? { [y]: b.periods[y] } : b.periods, source: b.source, ...provenance(b) });
  return {
    country: cc, name: t.name, kind: 'tax-year', ...(y ? { year: y } : {}),
    statement: t.personal.statement + (t.government ? ` ${t.government.statement}` : ''),
    personal: part(t.personal), ...(t.government ? { government: part(t.government) } : {}),
    yearsCovered: YEARS, source: t.personal.source, verifiedDate: DATA.verifiedDate,
  };
}

function dstAnswer(cc, { year }) {
  const d = DATA.dst[cc];
  let y = null;
  if (year !== undefined && year !== null && year !== '') {
    const p = pickYear(year, '');
    if (p.miss) return p.miss;
    y = p.year;
  }
  const { source, nonOfficial, verification, statute, euBasis, verifiedAgainst, transitions, ...rest } = d;
  return {
    country: cc, kind: 'dst', ...(y ? { year: y } : {}),
    ...rest,
    statement: d.ruleText + (transitions ? ` ${Object.entries(y ? { [y]: transitions[y] } : transitions).map(([yy, t]) => `${yy}: clocks forward ${t.clocksForward}, back ${t.clocksBack}`).join('; ')}.` : ''),
    ...(transitions ? { transitions: y ? { [y]: transitions[y] } : transitions } : {}),
    ...(statute ? { statute } : {}), ...(euBasis ? { euBasis } : {}), ...(verifiedAgainst ? { verifiedAgainst } : {}),
    yearsCovered: YEARS, ...provenance({ verification, nonOfficial }),
    source: source || (verifiedAgainst && verifiedAgainst.source) || null, verifiedDate: DATA.verifiedDate,
  };
}

/** calendar_facts {country, kind, year?, region?}; `now` is injectable for tests. */
function calendarFacts({ country, kind, year, region } = {}, now = new Date()) {
  const asOf = day(now);
  const c = resolveCountry(country);
  if (c.listing) return listing();
  if (c.miss) return c.miss;
  const { cc, hint } = c;
  const available = kindsFor(cc);
  if (kind === undefined || kind === null || String(kind).trim() === '') {
    const h = DATA.holidays[cc];
    return {
      country: cc, name: COUNTRIES[cc], kinds: available, yearsCovered: YEARS,
      ...(h ? { holidayRegions: Object.fromEntries(Object.entries(h.regions).map(([k, r]) => [k, r.name])), defaultRegion: h.defaultRegion } : {}),
      usage: `pass kind=${available.join('|')}`, source: h ? (h.page || (cc === 'fr' ? frSource(h) : h.source)) : (DATA.taxYears[cc] || {}).personal?.source || DATA.dst[cc].source, verifiedDate: DATA.verifiedDate,
    };
  }
  const k = KIND_ALIASES[norm(kind)];
  if (!k) return { covered: false, requested: { country: cc, kind }, message: `unknown kind "${kind}"`, nearest: nearest(norm(kind), [...KINDS, ...Object.keys(KIND_ALIASES)]).slice(0, 3), coverage: available };
  if (!available.includes(k)) {
    const why = k === 'holidays' ? `${COUNTRIES[cc]} public holidays are not in this dataset (they are set per state, province or territory and were not curated)` : `${COUNTRIES[cc]} ${k} is not in this dataset`;
    return { covered: false, requested: { country: cc, kind: k }, message: why, coverage: available };
  }
  if (k === 'holidays') return holidaysAnswer(cc, { year, region, hint }, asOf);
  if (k === 'tax-year') return taxYearAnswer(cc, { year });
  return dstAnswer(cc, { year });
}

/** next_holiday {country, from?, region?}: the next public holiday strictly after `from` (default today). */
function nextHoliday({ country, from, region } = {}, now = new Date()) {
  const asOf = day(now);
  const c = resolveCountry(country);
  if (c.listing) return { covered: false, message: 'pass a country', coverage: Object.fromEntries(Object.keys(DATA.holidays).map((cc) => [cc, COUNTRIES[cc]])) };
  if (c.miss) return c.miss;
  const { cc, hint } = c;
  if (!DATA.holidays[cc]) return { covered: false, requested: { country: cc }, message: `${COUNTRIES[cc]} public holidays are not in this dataset`, coverage: Object.fromEntries(Object.keys(DATA.holidays).map((x) => [x, COUNTRIES[x]])) };
  let start = asOf;
  if (from !== undefined && from !== null && String(from).trim() !== '') {
    if (!isDay(String(from).trim())) return { covered: false, requested: { country: cc, from }, message: 'from must be an ISO date (YYYY-MM-DD)', example: { country: cc, from: asOf } };
    start = String(from).trim();
  }
  const h = DATA.holidays[cc];
  const r = resolveRegion(cc, region, hint);
  if (r.miss) return r.miss;
  const reg = h.regions[r.key];
  const all = Object.values(reg.years).flat().slice().sort((a, b) => effective(a).localeCompare(effective(b)));
  const decorate = (x) => ({ ...x, weekday: weekday(x.date), ...(x.observed ? { observedWeekday: weekday(x.observed) } : {}), daysUntil: daysBetween(start, effective(x)) });
  const upcoming = all.filter((x) => effective(x) > start);
  const last = all.length ? effective(all[all.length - 1]) : null;
  if (!upcoming.length) {
    return { covered: false, requested: { country: cc, from: start, region: r.key }, message: `no ${COUNTRIES[cc]} holidays after ${start} in this dataset (it ends ${last})`, yearsCovered: YEARS, source: reg.source || h.page || (cc === 'fr' ? frSource(h) : h.source) };
  }
  const next = decorate(upcoming[0]);
  const onDate = all.filter((x) => effective(x) === start).map(decorate);
  return {
    country: cc, name: COUNTRIES[cc], region: r.key, regionName: reg.name, from: start, ...(from ? {} : { fromDefaulted: 'today' }),
    next,
    statement: `The next ${COUNTRIES[cc]} public holiday in ${reg.name} after ${start} is ${next.name} on ${effective(next)} (${weekday(effective(next))}), ${next.daysUntil} ${next.daysUntil === 1 ? 'day' : 'days'} later${next.observed ? ` — observed ${next.observed}; the statutory date is ${next.date}` : ''}.`,
    following: upcoming.slice(1, 4).map(decorate),
    ...(onDate.length ? { onFromDate: onDate } : {}),
    yearsCovered: YEARS, lastDateCovered: last,
    source: reg.source || h.page || (cc === 'fr' ? frSource(h) : h.source), publisher: h.publisher, licence: h.licence, verifiedDate: DATA.verifiedDate,
  };
}

function calendarCoverage() {
  const nonOfficial = [];
  for (const [cc, h] of Object.entries(DATA.holidays)) for (const [k, r] of Object.entries(h.regions)) if (r.nonOfficial) nonOfficial.push(`${cc}/holidays/${k}`);
  for (const [cc, t] of Object.entries(DATA.taxYears)) for (const p of ['personal', 'government']) if (t[p] && t[p].nonOfficial) nonOfficial.push(`${cc}/tax-year/${p}`);
  for (const [cc, d] of Object.entries(DATA.dst)) if (d.nonOfficial) nonOfficial.push(`${cc}/dst`);
  return {
    countries: Object.fromEntries(CODES.map((cc) => [cc, { name: COUNTRIES[cc], kinds: kindsFor(cc), ...(DATA.holidays[cc] ? { holidayRegions: Object.keys(DATA.holidays[cc].regions) } : {}) }])),
    kinds: KINDS, years: YEARS, counts: DATA.counts,
    verifiedDate: DATA.verifiedDate, nextScheduledRefresh: DATA.nextScheduledRefresh,
    scope:
      'public holidays as the official lists publish them (gov.uk bank-holidays.json for England & Wales, Scotland, Northern Ireland; OPM\'s federal tables for the US; the BMI\'s nine nationwide ' +
      'days plus each Land\'s additions for Germany; calendrier.api.gouv.fr for metropolitan France and Alsace-Moselle), tax-year starts and ends with the statute or official page quoted, ' +
      `daylight-saving rules with the computed transitions — for ${YEARS[0]}–${YEARS[YEARS.length - 1]}, a committed monthly snapshot`,
    nonOfficial,
    notCovered: [
      'school terms and school holidays',
      'religious observances that are not on the official public-holiday lists (Diwali, Eid, Yom Kippur, Orthodox Easter, …)',
      'public holidays of countries other than the UK, US, Germany and France — Australian, Canadian, Indian, Brazilian and Polish holidays are set per state/province or were not curated',
      'US state holidays, and the Washington DC-area Inauguration Day except where OPM lists it',
      'German Gemeinde-level variation beyond the `partial` entries (which Bavarian Gemeinden observe Mariä Himmelfahrt, which Saxon and Thuringian Gemeinden observe Fronleichnam)',
      'French overseas zones (Guadeloupe, Martinique, Guyane, La Réunion, Mayotte, Nouvelle-Calédonie, Polynésie, …) and local or professional holidays',
      'Scottish and Northern Irish local holidays, and whether a given employer or shop closes',
      'which US states and territories have exempted themselves from daylight saving, Lord Howe Island\'s half-hour shift, and time-zone offsets generally',
      'tax filing and payment deadlines, and corporate fiscal years that differ from the statutory default',
      `years outside ${YEARS.join(', ')}`,
    ],
  };
}

module.exports = { calendarFacts, nextHoliday, calendarCoverage, resolveCountry, resolveRegion, DATA, KINDS, YEARS, CODES, COUNTRIES, COUNTRY_ALIASES, REGION_ALIASES, KIND_ALIASES };
