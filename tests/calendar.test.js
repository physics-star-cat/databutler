// tests/calendar.test.js — calendar facts: dataset shape + provenance, pinned official dates, rule arithmetic,
// source parsers, calendar_facts / next_holiday resolution and near-misses, MCP + REST + cite, changelog entries.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const C = require('../api/_calendar');
const AREA_MODULE = require('../api/_areas/calendar');
const S = require('../scripts/calendar');
const { ALL_TOOLS, SERVERS } = require('../api/_registry');
const { freshnessFor, DUE_WINDOW_DAYS } = require('../api/_freshness');
const { coverageFor } = require('../api/_coverage');
const { CHANGELOG_AREAS } = require('../api/_changelog');
const WELL_KNOWN = require('../public/.well-known/changes.json');
const router = require('../api/router');
const frontDoor = require('../api/_routes/mcp');
const cite = require('../api/_routes/r');

const D = C.DATA;
const AREA = 'calendar';
const server = router.ROUTES['mcp/calendar'];
const factsRest = router.ROUTES.calendar;
const nextRest = router.ROUTES['calendar/next'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const NOW = new Date('2026-10-04T12:00:00Z');
const get = (h, url) => invoke(h, undefined, { method: 'GET', url });
const day = (iso) => new Date(`${iso}T12:00:00Z`);
const dates = (cc, region, year) => Object.fromEntries(D.holidays[cc].regions[region].years[year].map((h) => [h.key + (h.substitute ? '-substitute' : ''), h.date]));

test('dataset: years 2026–2028, provenance header, 35-day refresh, every holiday entry well-formed and sorted', () => {
  assert.deepEqual(D.years, [2026, 2027, 2028]);
  assert.match(D.verifiedDate, ISO);
  assert.equal(D.verifiedDate, D.fetched.slice(0, 10));
  assert.equal(D.nextScheduledRefresh, S.plusDays(D.verifiedDate, 35));
  assert.equal(D.manualVerifiedDate, '2026-10-04');
  assert.match(D.licence, /Open Government Licence v3\.0/); assert.match(D.licence, /Licence Ouverte 2\.0/); assert.match(D.licence, /public domain/);
  assert.deepEqual(Object.keys(D.holidays), ['uk', 'us', 'de', 'fr']);
  assert.deepEqual(Object.keys(D.taxYears), ['uk', 'us', 'au', 'in', 'ca', 'de', 'fr', 'br', 'pl']);
  assert.deepEqual(Object.keys(D.dst), ['uk', 'de', 'fr', 'us', 'au', 'br']);
  for (const [cc, h] of Object.entries(D.holidays)) {
    assert.ok(h.name && h.kind && h.source && h.publisher && h.licence && h.defaultRegion, cc);
    assert.ok(h.regions[h.defaultRegion], `${cc} default region exists`);
    let n = 0;
    for (const [rk, r] of Object.entries(h.regions)) {
      assert.ok(r.name, `${cc}/${rk} name`);
      assert.deepEqual(Object.keys(r.years).map(Number), D.years, `${cc}/${rk} covers every year`);
      for (const [y, list] of Object.entries(r.years)) {
        assert.ok(list.length >= 8 && list.length <= 14, `${cc}/${rk}/${y} has ${list.length} entries`);
        for (let i = 0; i < list.length; i++) {
          const x = list[i];
          assert.match(x.date, ISO, `${cc}/${rk}/${y} date`); assert.ok(x.date.startsWith(`${y}-`), `${cc}/${rk}/${y} ${x.key} in year`);
          assert.ok(x.name && x.key && /^[a-z0-9-]+$/.test(x.key), `${cc}/${rk}/${y} key ${x.key}`);
          if (x.observed) assert.match(x.observed, ISO);
          if (i) assert.ok((x.observed || x.date) >= (list[i - 1].observed || list[i - 1].date), `${cc}/${rk}/${y} sorted`);
        }
        n += list.length;
      }
    }
    assert.equal(D.counts.holidays[cc], n);
  }
  assert.equal(Object.keys(D.holidays.de.regions).length, 17, 'nationwide + 16 Länder');
  assert.deepEqual(Object.keys(D.holidays.uk.regions), ['england-and-wales', 'scotland', 'northern-ireland']);
  assert.deepEqual(Object.keys(D.holidays.fr.regions), ['metropole', 'alsace-moselle']);
  for (const [cc, t] of Object.entries(D.taxYears)) {
    assert.ok(t.name && t.personal.statement && t.personal.source.startsWith('http') && t.personal.quote, `${cc} tax year`);
    assert.match(t.personal.rule.starts, /^\d{2}-\d{2}$/);
    assert.deepEqual(Object.keys(t.personal.periods).map(Number), D.years);
  }
  for (const [cc, d] of Object.entries(D.dst)) {
    assert.ok(d.name && d.ruleText && d.statute && d.statute.source, `${cc} dst`);
    if (d.observed) assert.deepEqual(Object.keys(d.transitions).map(Number), D.years);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(D)) < 300 * 1024, 'under 300 KB compact');
});

test('pinned official dates: gov.uk, OPM, Länder ministries, calendrier.api.gouv.fr, statutes', () => {
  // UK — gov.uk/bank-holidays.json, read 2026-10-04
  assert.deepEqual(dates('uk', 'england-and-wales', 2027), { 'new-years-day': '2027-01-01', 'good-friday': '2027-03-26', 'easter-monday': '2027-03-29', 'early-may-bank-holiday': '2027-05-03', 'spring-bank-holiday': '2027-05-31', 'summer-bank-holiday': '2027-08-30', 'christmas-day-substitute': '2027-12-27', 'boxing-day-substitute': '2027-12-28' });
  assert.equal(dates('uk', 'scotland', 2026)['st-andrews-day'], '2026-11-30');
  assert.equal(dates('uk', 'scotland', 2027)['2nd-january-substitute'], '2027-01-04');
  assert.equal(dates('uk', 'northern-ireland', 2026)['battle-of-the-boyne-orangemens-day-substitute'], '2026-07-13');
  assert.equal(dates('uk', 'england-and-wales', 2028)['good-friday'], '2028-04-14');
  assert.equal(D.holidays.uk.regions['england-and-wales'].years[2026].find((h) => h.key === 'boxing-day').substitute, true, 'Boxing Day 2026 is a substitute day (28 Dec)');
  // US — OPM table + 5 U.S.C. § 6103
  const us26 = D.holidays.us.regions.federal.years[2026];
  assert.equal(us26.length, 11);
  assert.deepEqual(us26.find((h) => h.key === 'independence-day'), { date: '2026-07-04', name: 'Independence Day', key: 'independence-day', observed: '2026-07-03', note: 'Independence Day 2026 falls on a Saturday; OPM lists 2026-07-03 (Friday) as the holiday for pay and leave purposes' });
  assert.equal(us26.find((h) => h.key === 'thanksgiving-day').date, '2026-11-26');
  assert.equal(us26.find((h) => h.key === 'birthday-of-martin-luther-king-jr').date, '2026-01-19');
  const us28 = D.holidays.us.regions.federal.years[2028];
  assert.equal(us28[0].key, 'new-years-day'); assert.equal(us28[0].date, '2028-01-01'); assert.equal(us28[0].observed, '2027-12-31');
  assert.equal(us28.find((h) => h.key === 'veterans-day').observed, '2028-11-10');
  assert.equal(D.holidays.us.regions.federal.years[2027].find((h) => h.key === 'christmas-day').observed, '2027-12-24');
  assert.equal(D.holidays.us.regions.federal.years[2027].find((h) => h.key === 'juneteenth-national-independence-day').observed, '2027-06-18', '19 June 2027 is a Saturday; OPM lists Friday 18 June');
  // Germany — Hessen 2026 and RLP 2026/2027 ministry tables, BMI nine, Länder statutes
  assert.deepEqual(dates('de', 'HE', 2026), { neujahr: '2026-01-01', karfreitag: '2026-04-03', ostermontag: '2026-04-06', 'tag-der-arbeit': '2026-05-01', 'christi-himmelfahrt': '2026-05-14', pfingstmontag: '2026-05-25', fronleichnam: '2026-06-04', 'tag-der-deutschen-einheit': '2026-10-03', 'erster-weihnachtstag': '2026-12-25', 'zweiter-weihnachtstag': '2026-12-26' });
  assert.equal(dates('de', 'RP', 2027).fronleichnam, '2027-05-27'); assert.equal(dates('de', 'RP', 2027).allerheiligen, '2027-11-01');
  assert.equal(D.holidays.de.regions.nationwide.years[2027].length, 9);
  assert.equal(dates('de', 'BY', 2027)['heilige-drei-koenige'], '2027-01-06');
  assert.equal(D.holidays.de.regions.BY.years[2026].find((h) => h.key === 'mariae-himmelfahrt').partial, true);
  assert.equal(D.holidays.de.regions.BY.years[2026].find((h) => h.key === 'friedensfest').scope, 'Stadt Augsburg only (Art. 1 Abs. 2 FTG)');
  assert.equal(dates('de', 'BE', 2026).frauentag, '2026-03-08');
  assert.equal(dates('de', 'BB', 2026).ostersonntag, '2026-04-05'); assert.equal(dates('de', 'BB', 2026).pfingstsonntag, '2026-05-24');
  assert.equal(dates('de', 'SN', 2026)['buss-und-bettag'], '2026-11-18'); assert.equal(dates('de', 'SN', 2027)['buss-und-bettag'], '2027-11-17'); assert.equal(dates('de', 'SN', 2028)['buss-und-bettag'], '2028-11-22');
  assert.equal(dates('de', 'NI', 2026).reformationstag, '2026-10-31');
  assert.equal(dates('de', 'TH', 2026).weltkindertag, '2026-09-20');
  assert.deepEqual(Object.entries(D.holidays.de.regions).filter(([, r]) => r.nonOfficial).map(([k]) => k), ['HB', 'MV', 'SH', 'TH'], 'the four Länder whose additions could not be re-verified against an official page');
  for (const k of ['BY', 'BE', 'BB', 'HE', 'HH', 'NI', 'RP', 'SN']) assert.ok(D.holidays.de.regions[k].quote, `${k} carries the sentence it was read from`);
  // France — calendrier.api.gouv.fr
  assert.equal(dates('fr', 'metropole', 2027)['lundi-de-paques'], '2027-03-29');
  assert.equal(dates('fr', 'metropole', 2026).ascension, '2026-05-14');
  assert.equal(dates('fr', 'alsace-moselle', 2026)['vendredi-saint'], '2026-04-03');
  assert.equal(dates('fr', 'alsace-moselle', 2028)['2eme-jour-de-noel'], '2028-12-26');
  assert.equal(D.holidays.fr.regions.metropole.years[2026].length, 11); assert.equal(D.holidays.fr.regions['alsace-moselle'].years[2026].length, 13);
  // Tax years
  assert.deepEqual(D.taxYears.uk.personal.periods[2026], { start: '2026-04-06', end: '2027-04-05', label: '2026-27' });
  assert.deepEqual(D.taxYears.uk.government.periods[2027], { start: '2027-04-01', end: '2028-03-31', label: '2027-28' });
  assert.deepEqual(D.taxYears.us.personal.periods[2026], { start: '2026-01-01', end: '2026-12-31', label: '2026' });
  assert.deepEqual(D.taxYears.us.government.periods[2026], { start: '2026-10-01', end: '2027-09-30', label: 'FY2027' });
  assert.deepEqual(D.taxYears.au.personal.periods[2026], { start: '2026-07-01', end: '2027-06-30', label: '2026-27' });
  assert.deepEqual(D.taxYears.in.personal.periods[2026], { start: '2026-04-01', end: '2027-03-31', label: '2026-27' });
  assert.match(D.taxYears.in.personal.statement, /Income Tax Act, 2025/);
  assert.equal(D.taxYears.ca.government.rule.starts, '04-01'); assert.equal(D.taxYears.ca.personal.rule.starts, '01-01');
  for (const cc of ['de', 'fr', 'br', 'pl']) assert.equal(D.taxYears[cc].personal.rule.starts, '01-01', `${cc} calendar year`);
  assert.match(D.taxYears.uk.personal.quote, /^The current tax year is from 6 April 2026 to 5 April 2027\.$/);
  assert.match(D.taxYears.pl.personal.quote, /Rokiem podatkowym jest rok kalendarzowy/);
  assert.equal(D.taxYears.br.personal.nonOfficial, true); assert.equal(D.taxYears.br.government.nonOfficial, false);
  // DST
  assert.deepEqual(D.dst.uk.transitions, { 2026: { clocksForward: '2026-03-29', clocksBack: '2026-10-25' }, 2027: { clocksForward: '2027-03-28', clocksBack: '2027-10-31' }, 2028: { clocksForward: '2028-03-26', clocksBack: '2028-10-29' } });
  assert.deepEqual(D.dst.de.transitions, D.dst.uk.transitions); assert.deepEqual(D.dst.fr.transitions, D.dst.uk.transitions);
  assert.deepEqual(D.dst.us.transitions[2026], { clocksForward: '2026-03-08', clocksBack: '2026-11-01' });
  assert.deepEqual(D.dst.us.transitions[2028], { clocksForward: '2028-03-12', clocksBack: '2028-11-05' });
  assert.equal(D.dst.au.transitions[2026].clocksForward, '2026-10-04'); assert.equal(D.dst.au.transitions[2027].clocksBack, '2027-04-04');
  assert.deepEqual(D.dst.au.notObserving, ['Queensland', 'Western Australia', 'Northern Territory']);
  assert.equal(D.dst.br.observed, false); assert.equal(D.dst.br.transitions, undefined); assert.equal(D.dst.br.nonOfficial, true);
  assert.equal(D.dst.uk.nonOfficial, false); assert.equal(D.dst.us.nonOfficial, false); assert.equal(D.dst.fr.nonOfficial, true);
  assert.match(D.dst.uk.statute.quote, /last Sunday in March/);
  assert.match(D.dst.us.statute.quote, /second Sunday of March/);
});

test('rule arithmetic: Gregorian Easter, nth/last weekday, rule dates', () => {
  assert.equal(S.easter(2026), '2026-04-05'); assert.equal(S.easter(2027), '2027-03-28'); assert.equal(S.easter(2028), '2028-04-16');
  assert.equal(S.easter(2024), '2024-03-31'); assert.equal(S.easter(2000), '2000-04-23'); assert.equal(S.easter(1943), '1943-04-25');
  assert.equal(S.nthWeekday(2026, 3, 'last', 0), '2026-03-29'); assert.equal(S.nthWeekday(2027, 10, 'last', 0), '2027-10-31');
  assert.equal(S.nthWeekday(2026, 3, 2, 0), '2026-03-08'); assert.equal(S.nthWeekday(2026, 11, 1, 0), '2026-11-01');
  assert.equal(S.nthWeekday(2026, 11, 4, 4), '2026-11-26'); assert.equal(S.nthWeekday(2027, 5, 'last', 1), '2027-05-31');
  assert.equal(S.dateFromRule({ easter: 60 }, 2026), '2026-06-04'); assert.equal(S.dateFromRule({ easter: -2 }, 2028), '2028-04-14');
  assert.equal(S.dateFromRule({ wednesdayBefore: '11-23' }, 2026), '2026-11-18');
  assert.equal(S.dateFromRule({ month: 10, day: 3 }, 2027), '2027-10-03');
  assert.throws(() => S.dateFromRule({ foo: 1 }, 2026), /unknown rule/);
});

test('parsers: OPM table markup, gov.uk JSON, calendrier.api.gouv.fr JSON — and the builder refuses missing years or failed checks', () => {
  const opmHtml = `
    <table><caption>2027 Holiday Schedule</caption><tr><th>Date</th><th>Holiday</th></tr>
    <tr><td>Friday, January 01</td><td>New Year’s Day</td></tr>
    <tr><td>Monday, January 18</td><td>Birthday of Martin Luther King, Jr.</td></tr>
    <tr><td>Monday, February 15 *</td><td>Washington’s Birthday</td></tr>
    <tr><td>Monday, May 31</td><td>Memorial Day</td></tr>
    <tr><td>Friday, June 18</td><td>**</td><td>Juneteenth National Independence Day</td></tr>
    <tr><td>Monday, July 05 **</td><td>Independence Day</td></tr>
    <tr><td>Monday, September 06</td><td>Labor Day</td></tr>
    <tr><td>Monday, October 11</td><td>Columbus Day</td></tr>
    <tr><td>Thursday, November 11</td><td>Veterans Day</td></tr>
    <tr><td>Thursday, November 25</td><td>Thanksgiving Day</td></tr>
    <tr><td>Friday, December 24 **</td><td>Christmas Day</td></tr></table>
    <table><tr><td>nav</td></tr></table>`;
  const rows = S.parseOpm(opmHtml, [2027])[2027];
  assert.equal(rows.length, 11);
  assert.deepEqual(rows[2], { monthDay: '02-15', weekday: 'Monday', name: "Washington's Birthday", marker: '*' });
  assert.deepEqual(rows[4], { monthDay: '06-18', weekday: 'Friday', name: 'Juneteenth National Independence Day', marker: '**' });
  assert.throws(() => S.parseOpm(opmHtml, [2027, 2028]), /no 2028 table/);
  const manual = require('../data/calendar/manual.json');
  const us27 = S.usYear(manual, rows, 2027);
  assert.equal(us27.find((h) => h.key === 'juneteenth-national-independence-day').observed, '2027-06-18');
  assert.equal(us27.find((h) => h.key === 'independence-day').observed, '2027-07-05');
  assert.equal(us27.find((h) => h.key === 'memorial-day').observed, undefined);
  assert.throws(() => S.usYear(manual, rows.filter((r) => r.name !== 'Labor Day'), 2027), /no row for Labor Day/);
  const govuk = { 'england-and-wales': { events: [{ title: 'Boxing Day (substitute day)', date: '2026-12-28', notes: 'Substitute day', bunting: true }, { title: 'Christmas Day', date: '2026-12-25', notes: '', bunting: true }] } };
  assert.deepEqual(S.parseGovUk(govuk, [2026])['england-and-wales'][2026], [{ date: '2026-12-25', name: 'Christmas Day', key: 'christmas-day' }, { date: '2026-12-28', name: 'Boxing Day (substitute day)', key: 'boxing-day', substitute: true, notes: 'Substitute day' }]);
  assert.equal(S.parseGovUk({ scotland: { events: [{ title: '2nd January', date: '2027-01-04', notes: 'Substitute day', bunting: true }] } }, [2027]).scotland[2027][0].substitute, true, 'the JSON flags substitutes in notes');
  assert.throws(() => S.parseGovUk(govuk, [2026, 2027]), /publishes nothing for 2027/);
  assert.deepEqual(S.parseFrance({ '2027-05-06': 'Ascension', '2027-01-01': '1er janvier' }, 'metropole', 2027), [{ date: '2027-01-01', name: '1er janvier', key: '1er-janvier' }, { date: '2027-05-06', name: 'Ascension', key: 'ascension' }]);
  assert.throws(() => S.parseFrance({ '2026-01-01': 'x' }, 'metropole', 2027), /unexpected dates/);
  // a check that disagrees with the official page stops the build
  const bad = JSON.parse(JSON.stringify(manual)); bad.germany.checks.HE[2026].fronleichnam = '2026-06-05';
  const tiny = { govuk: {}, opm: '', fr: {} };
  assert.throws(() => S.buildFrom(tiny, bad, { fetched: '2026-10-04T00:00:00Z', via: 't' }), /gov\.uk|check failed/);
  assert.deepEqual(S.germanyYear(manual, 'nationwide', 2028).map((h) => h.date), ['2028-01-01', '2028-04-14', '2028-04-17', '2028-05-01', '2028-05-25', '2028-06-05', '2028-10-03', '2028-12-25', '2028-12-26']);
  assert.deepEqual(S.periods({ starts: '10-01', ends: '09-30', namedForEndYear: true }, [2026])[2026], { start: '2026-10-01', end: '2027-09-30', label: 'FY2027' });
});

test('calendar_facts: listing, country + region resolution, defaults, statements, provenance on every answer', () => {
  const list = C.calendarFacts({}, NOW);
  assert.deepEqual(Object.keys(list.countries), ['uk', 'us', 'de', 'fr', 'au', 'in', 'ca', 'br', 'pl']);
  assert.deepEqual(list.countries.au.kinds, ['tax-year', 'dst']); assert.deepEqual(list.countries.pl.kinds, ['tax-year']);
  assert.ok(list.source && list.usage);
  const uk = C.calendarFacts({ country: 'United Kingdom', kind: 'bank holidays' }, NOW);
  assert.equal(uk.country, 'uk'); assert.equal(uk.region, 'england-and-wales'); assert.equal(uk.year, 2026); assert.equal(uk.yearDefaulted, true);
  assert.equal(uk.count, 8); assert.equal(uk.holidays[0].weekday, 'Thursday'); assert.equal(uk.source, 'https://www.gov.uk/bank-holidays');
  assert.match(uk.statement, /^United Kingdom bank and public holidays 2026, England and Wales: 8 days — New Year’s Day 2026-01-01; /);
  const sco = C.calendarFacts({ country: 'Scotland', kind: 'holidays', year: '2027' }, NOW);
  assert.equal(sco.region, 'scotland'); assert.equal(sco.year, 2027); assert.equal(sco.yearDefaulted, undefined); assert.equal(sco.count, 9);
  const ni = C.calendarFacts({ country: 'uk', kind: 'holidays', region: 'NI', year: 2026 }, NOW);
  assert.equal(ni.region, 'northern-ireland'); assert.ok(ni.holidays.some((h) => h.key === 'st-patricks-day'));
  const by = C.calendarFacts({ country: 'Germany', kind: 'Feiertage', region: 'Bavaria', year: 2027 }, NOW);
  assert.equal(by.region, 'BY'); assert.equal(by.count, 14); assert.equal(by.source, 'https://www.gesetze-bayern.de/Content/Document/BayFTG-1');
  assert.match(by.regionProvenance.quote, /Heilige Drei Könige/); assert.equal(by.regionProvenance.nonOfficial, undefined);
  const sh = C.calendarFacts({ country: 'de', kind: 'holidays', region: 'Schleswig-Holstein', year: 2026 }, NOW);
  assert.equal(sh.region, 'SH'); assert.equal(sh.regionProvenance.nonOfficial, true); assert.match(sh.regionProvenance.nonOfficialNote, /could not be re-verified/);
  const de = C.calendarFacts({ country: 'de', kind: 'holidays', year: 2028 }, NOW);
  assert.equal(de.region, 'nationwide'); assert.equal(de.count, 9); assert.equal(Object.keys(de.regions).length, 17);
  assert.equal(C.calendarFacts({ country: 'de', kind: 'holidays', region: 'Baden-Württemberg', year: 2026 }, NOW).region, 'BW');
  assert.equal(C.calendarFacts({ country: 'de', kind: 'holidays', region: 'thüringen', year: 2026 }, NOW).region, 'TH');
  const us = C.calendarFacts({ country: 'USA', kind: 'federal holidays', year: 2028 }, NOW);
  assert.equal(us.region, 'federal'); assert.equal(us.holidays[0].observed, '2027-12-31'); assert.equal(us.holidays[0].observedWeekday, 'Friday'); assert.match(us.statute.quote, /legal public holidays/);
  const am = C.calendarFacts({ country: 'France', kind: 'jours fériés', region: 'Alsace', year: 2026 }, NOW);
  assert.equal(am.region, 'alsace-moselle'); assert.equal(am.count, 13); assert.equal(am.source, 'https://calendrier.api.gouv.fr/jours-feries/metropole/2026.json'); assert.match(am.licence, /Licence Ouverte/);
  // tax-year
  const t = C.calendarFacts({ country: 'uk', kind: 'tax year' }, NOW);
  assert.equal(t.kind, 'tax-year'); assert.deepEqual(Object.keys(t.personal.periods), ['2026', '2027', '2028']); assert.equal(t.government.rule.starts, '04-01');
  assert.match(t.statement, /6 April to 5 April/); assert.equal(t.source, 'https://www.gov.uk/income-tax-rates'); assert.match(t.personal.quote, /6 April 2026 to 5 April 2027/);
  const t27 = C.calendarFacts({ country: 'Australia', kind: 'financial year', year: 2027 }, NOW);
  assert.deepEqual(t27.personal.periods, { 2027: { start: '2027-07-01', end: '2028-06-30', label: '2027-28' } }); assert.equal(t27.government, undefined);
  const inr = C.calendarFacts({ country: 'India', kind: 'tax-year' }, NOW);
  assert.match(inr.personal.secondaryQuote, /Tax Year 2026-27/); assert.equal(inr.personal.nonOfficial, undefined);
  const br = C.calendarFacts({ country: 'brasil', kind: 'fiscal year' }, NOW);
  assert.equal(br.personal.nonOfficial, true); assert.equal(br.government.nonOfficial, undefined); assert.match(br.government.quote, /ano civil/);
  // dst
  const dst = C.calendarFacts({ country: 'uk', kind: 'clocks', year: 2027 }, NOW);
  assert.equal(dst.kind, 'dst'); assert.deepEqual(dst.transitions, { 2027: { clocksForward: '2027-03-28', clocksBack: '2027-10-31' } });
  assert.match(dst.statement, /2027: clocks forward 2027-03-28, back 2027-10-31/); assert.equal(dst.source, 'https://www.legislation.gov.uk/ukpga/1972/6/section/1'); assert.match(dst.verifiedAgainst.quote, /2027 28 March 31 October/);
  const au = C.calendarFacts({ country: 'au', kind: 'daylight saving' }, NOW);
  assert.equal(au.observed, 'partly'); assert.deepEqual(au.observing.slice(0, 2), ['New South Wales', 'Victoria']); assert.equal(au.transitions[2026].clocksForward, '2026-10-04'); assert.match(au.transitions[2026].note, /southern hemisphere/);
  const brd = C.calendarFacts({ country: 'br', kind: 'dst' }, NOW);
  assert.equal(brd.observed, false); assert.equal(brd.transitions, undefined); assert.equal(brd.nonOfficial, true); assert.match(brd.ruleText, /Decreto nº 9\.772/);
  const frd = C.calendarFacts({ country: 'fr', kind: 'dst' }, NOW);
  assert.equal(frd.nonOfficial, true); assert.equal(frd.source, 'https://eur-lex.europa.eu/eli/dir/2000/84/oj');
  // kind missing → the country's summary
  const summary = C.calendarFacts({ country: 'de' }, NOW);
  assert.deepEqual(summary.kinds, ['holidays', 'tax-year', 'dst']); assert.equal(summary.defaultRegion, 'nationwide'); assert.match(summary.usage, /kind=/);
  assert.deepEqual(C.calendarFacts({ country: 'pl' }, NOW).kinds, ['tax-year']);
});

test('calendar_facts near-misses: unknown country, region, kind, year, and a kind the country lacks — covered:false, never a throw', () => {
  const es = C.calendarFacts({ country: 'spain', kind: 'holidays' }, NOW);
  assert.equal(es.covered, false); assert.equal(es.requested, 'spain'); assert.ok(Array.isArray(es.nearest) && es.nearest.length); assert.ok('uk' in es.coverage);
  const typo = C.calendarFacts({ country: 'germny', kind: 'holidays' }, NOW);
  assert.equal(typo.covered, false); assert.equal(typo.nearest[0], 'de');
  const reg = C.calendarFacts({ country: 'uk', kind: 'holidays', region: 'cornwall' }, NOW);
  assert.equal(reg.covered, false); assert.deepEqual(Object.keys(reg.regions), ['england-and-wales', 'scotland', 'northern-ireland']); assert.equal(reg.defaultRegion, 'england-and-wales');
  const kind = C.calendarFacts({ country: 'uk', kind: 'birthdays' }, NOW);
  assert.equal(kind.covered, false); assert.deepEqual(kind.coverage, ['holidays', 'tax-year', 'dst']); assert.ok(kind.nearest.length);
  const yr = C.calendarFacts({ country: 'uk', kind: 'holidays', year: 2031 }, NOW);
  assert.equal(yr.covered, false); assert.deepEqual(yr.yearsCovered, [2026, 2027, 2028]);
  assert.equal(C.calendarFacts({ country: 'us', kind: 'dst', year: 2025 }, NOW).covered, false);
  const auh = C.calendarFacts({ country: 'au', kind: 'holidays' }, NOW);
  assert.equal(auh.covered, false); assert.match(auh.message, /set per state/); assert.deepEqual(auh.coverage, ['tax-year', 'dst']);
  const pld = C.calendarFacts({ country: 'pl', kind: 'dst' }, NOW);
  assert.equal(pld.covered, false); assert.deepEqual(pld.coverage, ['tax-year']);
  // the current year outside the window defaults to the first year covered
  assert.equal(C.calendarFacts({ country: 'uk', kind: 'holidays' }, new Date('2031-06-01T00:00:00Z')).year, 2026);
});

test('next_holiday: strictly after the date, observed dates decide for the US, following three, on-date holidays, range end, bad input', () => {
  const uk = C.nextHoliday({ country: 'uk', from: '2026-12-26' }, NOW);
  assert.equal(uk.next.key, 'boxing-day'); assert.equal(uk.next.substitute, true); assert.equal(uk.next.date, '2026-12-28'); assert.equal(uk.next.daysUntil, 2);
  assert.equal(uk.onFromDate, undefined, 'Boxing Day 2026 itself is the 28th (substitute), not the 26th');
  assert.deepEqual(uk.following.map((h) => h.date), ['2027-01-01', '2027-03-26', '2027-03-29']);
  assert.match(uk.statement, /^The next United Kingdom public holiday in England and Wales after 2026-12-26 is Boxing Day on 2026-12-28 \(Monday\), 2 days later\.$/);
  assert.equal(uk.next.notes, 'Substitute day');
  const dflt = C.nextHoliday({ country: 'uk' }, NOW);
  assert.equal(dflt.from, '2026-10-04'); assert.equal(dflt.fromDefaulted, 'today'); assert.equal(dflt.next.date, '2026-12-25');
  const by = C.nextHoliday({ country: 'de', from: '2026-12-27', region: 'BY' }, NOW);
  assert.equal(by.next.date, '2027-01-01'); assert.equal(by.following[0].key, 'heilige-drei-koenige'); assert.equal(by.region, 'BY'); assert.equal(by.source, 'https://www.gesetze-bayern.de/Content/Document/BayFTG-1');
  const us = C.nextHoliday({ country: 'us', from: '2026-07-02' }, NOW);
  assert.equal(us.next.key, 'independence-day'); assert.equal(us.next.observed, '2026-07-03'); assert.equal(us.next.daysUntil, 1); assert.match(us.statement, /observed 2026-07-03; the statutory date is 2026-07-04/);
  const us2 = C.nextHoliday({ country: 'us', from: '2027-12-30' }, NOW);
  assert.equal(us2.next.observed, '2027-12-31'); assert.equal(us2.next.date, '2028-01-01'); assert.equal(us2.next.daysUntil, 1);
  const on = C.nextHoliday({ country: 'fr', from: '2026-07-14' }, NOW);
  assert.equal(on.onFromDate[0].key, '14-juillet'); assert.equal(on.next.key, 'assomption');
  const end = C.nextHoliday({ country: 'uk', from: '2028-12-26', region: 'scotland' }, NOW);
  assert.equal(end.covered, false); assert.match(end.message, /no United Kingdom holidays after 2028-12-26/); assert.match(end.message, /ends 2028-12-26/);
  assert.equal(C.nextHoliday({ country: 'uk', from: 'yesterday' }, NOW).covered, false);
  assert.equal(C.nextHoliday({ country: 'au', from: '2026-01-01' }, NOW).covered, false);
  assert.equal(C.nextHoliday({}, NOW).covered, false);
  assert.equal(C.nextHoliday({ country: 'uk', from: '2026-01-01', region: 'mars' }, NOW).covered, false);
});

test('registry: calendar server lists both tools, read-only, not open-world, plain-statement descriptions; behind the front door call', async () => {
  for (const name of ['calendar_facts', 'next_holiday']) {
    const t = ALL_TOOLS[name];
    assert.equal(t.server, AREA); assert.equal(t.serverUrl, 'https://databutler.dev/api/mcp/calendar'); assert.equal(t.freshness, AREA);
    assert.equal(t.annotations.openWorldHint, false); assert.equal(t.annotations.readOnlyHint, true);
    assert.doesNotMatch(t.description, /\b(use this|you should|always|never|call this|do not|use when|use whenever|use to)\b/i);
  }
  assert.deepEqual(ALL_TOOLS.calendar_facts.inputSchema.required, undefined);
  assert.deepEqual(ALL_TOOLS.next_holiday.inputSchema.required, ['country']);
  assert.match(SERVERS.calendar.instructions, /calendar_facts/);
  const list = await rpc(server, 'tools/list');
  assert.deepEqual(list.body.result.tools.map((x) => x.name), ['calendar_facts', 'next_holiday']);
  const init = await rpc(server, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.body.result.serverInfo.name, 'databutler-calendar');
  const fd = await rpc(frontDoor, 'tools/list');
  assert.ok(!fd.body.result.tools.some((t) => t.name === 'calendar_facts'), 'behind call, not listed at the front door');
  const cat = await callTool(frontDoor, 'catalogue', { query: 'holiday' });
  assert.deepEqual(cat.data.tools.map((t) => t.name).sort(), ['calendar_facts', 'next_holiday']);
});

test('MCP: tools/call direct and via the front door carry freshness and a cite permalink with the query', async () => {
  const direct = await callTool(server, 'calendar_facts', { country: 'uk', kind: 'holidays', year: 2027 });
  assert.equal(direct.isError, false);
  assert.equal(direct.data.count, 8); assert.equal(direct.data.freshness.verifiedDate, D.verifiedDate);
  assert.ok(['fresh', 'due', 'overdue'].includes(direct.data.freshness.staleness));
  assert.equal(direct.data.cite.url, 'https://databutler.dev/r/calendar?country=uk&kind=holidays&year=2027');
  assert.equal(direct.data.cite.text, `databutler.dev, verified ${D.verifiedDate} against https://www.gov.uk/bank-holidays`);
  assert.equal(direct.data.attribution, 'databutler.dev');
  const viaCall = await callTool(frontDoor, 'call', { tool: 'next_holiday', arguments: { country: 'de', from: '2026-12-27', region: 'BY' } });
  assert.equal(viaCall.isError, false); assert.equal(viaCall.data.next.date, '2027-01-01');
  assert.equal(viaCall.data.cite.url, 'https://databutler.dev/r/calendar/next?country=de&from=2026-12-27&region=BY');
  const miss = await callTool(server, 'calendar_facts', { country: 'spain', kind: 'holidays' });
  assert.equal(miss.isError, false); assert.equal(miss.data.covered, false);
  const listing = await callTool(server, 'calendar_facts', {});
  assert.equal(listing.data.cite.url, 'https://databutler.dev/r/calendar'); assert.ok(listing.data.countries.uk);
});

test('REST: /api/calendar (empty query → listing; year coerced) and /api/calendar/next (400 without country); envelope + cite', async () => {
  const empty = await get(factsRest, '/api/calendar');
  assert.equal(empty.status, 200); assert.ok(empty.body.countries && empty.body.freshness && empty.body.cite);
  const sco = await get(factsRest, '/api/calendar?country=uk&kind=holidays&year=2027&region=scotland');
  assert.equal(sco.status, 200); assert.equal(sco.body.year, 2027); assert.equal(sco.body.region, 'scotland');
  assert.equal(sco.body.cite.url, 'https://databutler.dev/r/calendar?country=uk&kind=holidays&year=2027&region=scotland');
  const dst = await get(factsRest, '/api/calendar?country=fr&kind=dst&year=2027');
  assert.equal(dst.body.observed, true); assert.equal(dst.body.transitions['2027'].clocksForward, '2027-03-28');
  const miss = await get(factsRest, '/api/calendar?country=zz');
  assert.equal(miss.status, 200); assert.equal(miss.body.covered, false);
  assert.equal((await get(nextRest, '/api/calendar/next')).status, 400);
  assert.match((await get(nextRest, '/api/calendar/next')).body.error, /missing \?country=/);
  const nx = await get(nextRest, '/api/calendar/next?country=de&from=2026-12-27&region=BY');
  assert.equal(nx.status, 200); assert.equal(nx.body.next.date, '2027-01-01'); assert.equal(nx.body.cite.url, 'https://databutler.dev/r/calendar/next?country=de&from=2026-12-27&region=BY');
  const viaRouter = await get(router, '/api/router?route=calendar&country=us&kind=tax-year');
  assert.equal(viaRouter.status, 200); assert.equal(viaRouter.body.government.periods['2026'].label, 'FY2027');
});

test('/r/calendar citation pages render the answer with the official source link', async () => {
  const r = await get(cite, '/api/r?path=calendar&country=uk&kind=holidays&year=2027');
  assert.equal(r.status, 200); assert.match(r.headers['X-Robots-Tag'], /noindex/);
  assert.match(String(r.raw), /Good Friday/); assert.match(String(r.raw), /href="https:\/\/www\.gov\.uk\/bank-holidays"/);
  const n = await get(cite, '/api/r?path=calendar/next&country=fr&from=2027-05-01');
  assert.equal(n.status, 200); assert.match(String(n.raw), /Ascension/);
});

test('coverage, freshness, discovery, changelog area', () => {
  const cov = coverageFor(AREA);
  assert.equal(cov.area, AREA); assert.deepEqual(Object.keys(cov.countries), C.CODES); assert.deepEqual(cov.years, [2026, 2027, 2028]);
  assert.deepEqual(cov.nonOfficial, ['de/holidays/HB', 'de/holidays/MV', 'de/holidays/SH', 'de/holidays/TH', 'br/tax-year/personal', 'fr/dst', 'br/dst']);
  assert.ok(cov.notCovered.some((x) => /school terms/.test(x))); assert.ok(cov.notCovered.some((x) => /religious observances/.test(x))); assert.ok(cov.notCovered.some((x) => /other than the UK, US, Germany and France/.test(x)));
  assert.equal(freshnessFor(AREA, day(D.verifiedDate)).staleness, 'fresh');
  assert.equal(freshnessFor(AREA, day(S.plusDays(D.nextScheduledRefresh, -1))).staleness, 'fresh');
  assert.equal(freshnessFor(AREA, day(D.nextScheduledRefresh)).staleness, 'due');
  assert.equal(freshnessFor(AREA, day(S.plusDays(D.nextScheduledRefresh, DUE_WINDOW_DAYS + 1))).staleness, 'overdue');
  assert.ok(CHANGELOG_AREAS.includes(AREA));
  const entry = WELL_KNOWN.areas.find((a) => a.name === AREA);
  assert.ok(entry); assert.equal(entry.cadence, AREA_MODULE.discovery.cadence);
  assert.equal(AREA_MODULE.changelog.diff, null); assert.equal(AREA_MODULE.changelog.script, 'scripts/calendar.js');
  assert.deepEqual(AREA_MODULE.changelog.files, ['data/calendar.json', 'data/calendar/']);
  assert.ok(AREA_MODULE.sources().every((s) => /^https:\/\//.test(s.url) && s.label));
});

test('datasetEntries: first derivation → one <cc>/<kind> per block; later runs → new year, added/moved/removed holiday, tax-year and DST rule changes; nothing when unchanged', () => {
  const first = S.datasetEntries(null, D, { today: '2026-10-04' });
  assert.equal(first.length, 19);
  assert.deepEqual(first.map((e) => e.key), ['uk/holidays', 'us/holidays', 'de/holidays', 'fr/holidays', 'uk/tax-year', 'us/tax-year', 'au/tax-year', 'in/tax-year', 'ca/tax-year', 'de/tax-year', 'fr/tax-year', 'br/tax-year', 'pl/tax-year', 'uk/dst', 'de/dst', 'fr/dst', 'us/dst', 'au/dst', 'br/dst']);
  for (const e of first) {
    assert.deepEqual(Object.keys(e), ['area', 'key', 'label', 'from', 'to', 'effectiveFrom', 'source', 'verifiedDate', 'note']);
    assert.equal(e.area, AREA); assert.equal(e.from, null); assert.equal(e.to, 'covered'); assert.equal(e.effectiveFrom, D.verifiedDate); assert.equal(e.verifiedDate, '2026-10-04');
    assert.match(e.source, /^https?:\/\//); assert.match(e.note, /^First derivation/);
  }
  assert.match(first[0].note, /82 holiday entries across 3 region\(s\)/); assert.equal(first[0].source, 'https://www.gov.uk/bank-holidays');
  assert.equal(first[3].source, 'https://calendrier.api.gouv.fr/jours-feries/metropole/2026.json');
  assert.deepEqual(S.datasetEntries(D, D), [], 'same snapshot, no entries');
  // later run
  const next = JSON.parse(JSON.stringify(D));
  next.verifiedDate = '2026-11-08';
  next.years = [2026, 2027, 2028, 2029];
  for (const r of Object.values(next.holidays.uk.regions)) r.years[2029] = [{ date: '2029-01-01', name: 'New Year’s Day', key: 'new-years-day' }];
  const ew = next.holidays.uk.regions['england-and-wales'].years[2027];
  ew.find((h) => h.key === 'early-may-bank-holiday').date = '2027-05-10';                                        // moved
  ew.push({ date: '2027-06-04', name: 'Coronation anniversary', key: 'coronation-anniversary' });                   // added
  next.holidays.uk.regions.scotland.years[2026] = next.holidays.uk.regions.scotland.years[2026].filter((h) => h.key !== 'st-andrews-day'); // removed
  next.holidays.us.regions.federal.years[2026].find((h) => h.key === 'independence-day').observed = '2026-07-06'; // observed moved
  next.taxYears.uk.personal.rule = { starts: '04-01', ends: '03-31' };
  next.dst.us.transitions[2027] = { clocksForward: '2027-03-07', clocksBack: '2027-11-07' };
  next.dst.uk.observed = false;
  const later = S.datasetEntries(D, next, { today: '2026-11-08' });
  assert.deepEqual(later.map((e) => [e.key, e.from, e.to, e.effectiveFrom]), [
    ['uk/holidays/2029', null, 'covered', '2029-01-01'],
    ['uk/holidays/england-and-wales/2027/early-may-bank-holiday', '2027-05-03', '2027-05-10', '2027-05-10'],
    ['uk/holidays/england-and-wales/2027/coronation-anniversary', null, '2027-06-04', '2027-06-04'],
    ['uk/holidays/scotland/2026/st-andrews-day', '2026-11-30', null, '2026-11-08'],
    ['us/holidays/federal/2026/independence-day', '2026-07-03', '2026-07-06', '2026-07-06'],
    ['uk/tax-year/personal', '04-06 → 04-05', '04-01 → 03-31', '2026-11-08'],
    ['uk/dst', true, false, '2026-11-08'],
    ['us/dst/2027', '2027-03-14 / 2027-11-07', '2027-03-07 / 2027-11-07', '2027-03-07'],
  ]);
  assert.ok(later.every((e) => e.area === AREA && e.note === '' && e.verifiedDate === '2026-11-08' && /^https?:\/\//.test(e.source)));
  assert.equal(later[1].label, 'United Kingdom (England and Wales) Early May bank holiday 2027');
  // a country absent from the previous file gets its dataset entry
  const prevMinus = JSON.parse(JSON.stringify(D)); delete prevMinus.holidays.fr; delete prevMinus.dst.br; delete prevMinus.taxYears.pl;
  assert.deepEqual(S.datasetEntries(prevMinus, D).map((e) => e.key), ['fr/holidays', 'pl/tax-year', 'br/dst']);
});
