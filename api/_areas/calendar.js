/**
 * Area: calendar — the boring calendar facts a model with a training cutoff
 * cannot know for next year: public holidays (UK, US, Germany, France), tax-year
 * starts and ends (UK, US, Australia, India, Canada, Germany, France, Brazil,
 * Poland) and daylight-saving switches (UK, Germany, France, US, Australia;
 * Brazil has none), for 2026–2028. Data: data/calendar.json, a monthly snapshot
 * built by scripts/calendar.js from gov.uk/bank-holidays.json, OPM's federal
 * holiday tables and calendrier.api.gouv.fr, merged with the hand-verified
 * data/calendar/manual.json (rules with the official page and sentence quoted);
 * the script also writes the changelog entries. Logic: api/_calendar.js.
 * Contract: api/_areas/README.md. Playbook: docs/ADDING_AN_AREA.md.
 */
const CAL = require('../_calendar');
const { BASE } = require('../_area_kit');

const AREA = 'calendar';
const CADENCE_DAYS = 35; // nextScheduledRefresh = verifiedDate + 35, stamped by scripts/calendar.js
const DATA = CAL.DATA;
const YEARS = CAL.YEARS;
const SPAN = `${YEARS[0]}–${YEARS[YEARS.length - 1]}`;
const HOLIDAY_COUNTRIES = Object.keys(DATA.holidays);
const TAX_COUNTRIES = Object.keys(DATA.taxYears);
const DST_COUNTRIES = Object.keys(DATA.dst);

module.exports = {
  area: AREA,
  order: 130,
  title: 'Calendar facts: public holidays, tax years, DST',
  short: 'public holidays, tax-year and daylight-saving dates',

  server: {
    serverName: 'databutler-calendar',
    url: `${BASE}/api/mcp/calendar`,
    description: 'Public holidays (UK, US, DE, FR), tax-year dates and DST switches for 2026-2028.',
    instructions:
      `Calendar facts from databutler.dev for ${YEARS.join(', ')}: public holidays (uk, us, de, fr), tax-year starts and ends (${TAX_COUNTRIES.join(', ')}) and daylight-saving switches ` +
      `(${DST_COUNTRIES.join(', ')}; Brazil observes none). A committed monthly snapshot of the official lists (gov.uk bank-holidays.json, OPM's federal holiday tables, ` +
      'calendrier.api.gouv.fr, the German Länder statutes and ministry pages) and of statutes quoted sentence by sentence, used in place of recalling next year\'s dates from ' +
      'memory. calendar_facts answers one country and kind, with year and region optional; next_holiday gives the next public holiday after a date. Every answer carries ' +
      'source, verifiedDate and, where a fact could not be re-verified against an official page, nonOfficial: true with what was tried — present that flag when it is set. ' +
      'US federal holidays carry both the statutory date and OPM\'s observed date. Cite https://databutler.dev/ and the source URL.',
    tools: [
      {
        name: 'calendar_facts',
        title: 'Calendar facts lookup',
        description:
          `Public holidays, tax-year dates or daylight-saving switches for one country in ${SPAN}, from the official lists and statutes. kind=holidays (${HOLIDAY_COUNTRIES.join(', ')}): ` +
          'every public holiday of the year with its date and weekday, by region — UK nations (england-and-wales, scotland, northern-ireland; substitute days flagged), US federal ' +
          '(statutory date plus OPM\'s observed date when it falls on a weekend), German Länder by code or name (nationwide = the nine bundeseinheitlichen Feiertage; partial holidays ' +
          `carry their scope), French metropole or alsace-moselle. kind=tax-year (${TAX_COUNTRIES.join(', ')}): the personal tax year's start and end with the periods for ${SPAN} ` +
          `and the statute or official page quoted, plus the government fiscal year where it differs. kind=dst (${DST_COUNTRIES.join(', ')}): the statutory rule and the computed ` +
          'clocks-forward and clocks-back dates per year, with the states that observe it for Australia and observed:false for Brazil. Country names, UK nations, German Land names ' +
          '(Bavaria, Sachsen) and kind synonyms (bank holidays, financial year, clocks) resolve; no country lists everything covered; unknown countries, regions and years answer ' +
          'covered:false with the nearest matches. Entries that could not be re-verified against an official page carry nonOfficial: true.',
        inputSchema: {
          type: 'object',
          properties: {
            country: { type: 'string', description: `one of ${CAL.CODES.join(', ')}, or a name (United Kingdom, Germany, Bavaria resolves to de with region BY); omit to list` },
            kind: { type: 'string', enum: CAL.KINDS, description: 'holidays | tax-year | dst (synonyms accepted: bank holidays, financial year, daylight saving)' },
            year: { type: 'integer', description: `${YEARS[0]}–${YEARS[YEARS.length - 1]}; holidays default to the current year, tax-year and dst to all years covered` },
            region: { type: 'string', description: 'UK: england-and-wales | scotland | northern-ireland; US: federal; Germany: nationwide or a Land (BY, Bayern, Bavaria, …); France: metropole | alsace-moselle' },
          },
        },
        run: (a) => CAL.calendarFacts(a),
        freshness: AREA,
        cite: (a) => ({ path: 'calendar', query: { country: a.country, kind: a.kind, year: a.year, region: a.region } }),
      },
      {
        name: 'next_holiday',
        title: 'Next public holiday',
        description:
          `The next public holiday strictly after a date (default: today) for ${HOLIDAY_COUNTRIES.join(', ')}, with its name, date, weekday and days until it, the three that follow, ` +
          'and any holiday falling on the date itself; by region as for calendar_facts (UK nations, US federal with OPM\'s observed date deciding the order, German Länder, ' +
          `French zones). The data runs to the end of ${YEARS[YEARS.length - 1]}; a later date answers covered:false with the last date covered. From the same monthly snapshot of ` +
          'the official lists, with the list\'s URL as source.',
        inputSchema: {
          type: 'object',
          properties: {
            country: { type: 'string', description: `one of ${HOLIDAY_COUNTRIES.join(', ')}, or a name` },
            from: { type: 'string', description: 'ISO date YYYY-MM-DD; the next holiday is the first one after this day (default: today)' },
            region: { type: 'string', description: 'as for calendar_facts (default: england-and-wales, federal, nationwide, metropole)' },
          },
          required: ['country'],
        },
        run: (a) => CAL.nextHoliday(a),
        freshness: AREA,
        cite: (a) => ({ path: 'calendar/next', query: { country: a.country, from: a.from, region: a.region } }),
      },
    ],
  },

  coverage: CAL.calendarCoverage,

  freshness: { dataFile: 'data/calendar.json', cadenceDays: CADENCE_DAYS, data: DATA },

  // Entries are written by the snapshot script, not by scripts/changelog.js; the hand-verified input sits under data/calendar/.
  // datasetKeys: the first derivation's one entry per country block — tests/changes-page.test.js checks them.
  changelog: {
    diff: null, script: 'scripts/calendar.js', files: ['data/calendar.json', 'data/calendar/'],
    datasetKeys: () => [
      ...Object.keys(DATA.holidays).map((c) => `${c}/holidays`), ...Object.keys(DATA.taxYears).map((c) => `${c}/tax-year`), ...Object.keys(DATA.dst).map((c) => `${c}/dst`),
    ],
  },
  discovery: {
    description: `Public holidays (UK, US federal, German Länder, France), tax-year starts/ends (nine countries) and daylight-saving switch dates for ${SPAN}: new years published, holidays added or moved, rule changes`,
    cadence: 'monthly',
  },

  // The weekly watcher re-fetches the official pages the snapshot and the hand-verified rules were read from.
  sources: () => [
    { url: 'https://www.gov.uk/bank-holidays', label: 'GOV.UK — UK bank holidays' },
    { url: 'https://www.gov.uk/when-do-the-clocks-change', label: 'GOV.UK — when do the clocks change' },
    { url: 'https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/', label: 'OPM — federal holidays' },
    { url: `https://calendrier.api.gouv.fr/jours-feries/metropole/${YEARS[0]}.json`, label: `calendrier.api.gouv.fr — jours fériés métropole ${YEARS[0]}` },
    { url: 'https://innen.hessen.de/buerger-staat/feiertage', label: 'Hessen — Feiertage' },
    { url: 'https://mdi.rlp.de/themen/buerger-und-staat/verfassung-und-verwaltung/sonn-und-feiertagsrecht', label: 'Rheinland-Pfalz — Sonn- und Feiertagsrecht' },
    { url: 'https://dcj.nsw.gov.au/about-us/daylight-saving.html', label: 'NSW DCJ — daylight saving' },
    { url: 'https://www.payrolltax.gov.au/financial-year', label: 'payrolltax.gov.au — financial year' },
  ],

  rest: [
    // GET /api/calendar?country=uk&kind=holidays&year=2027&region=scotland — empty query answers the listing (house style)
    { path: 'calendar', tool: 'calendar_facts', args: (q) => ({ country: q.country, kind: q.kind, year: q.year, region: q.region }), numeric: ['year'] },
    { path: 'calendar/next', tool: 'next_holiday', args: (q) => ({ country: q.country, from: q.from, region: q.region }), required: ['country'] },
  ],

  hub: {
    changed: `calendar facts (public holidays for the UK, US, Germany and France; tax-year and daylight-saving rules for nine countries — new years published, holidays added or moved)`,
    coverage: `calendar facts: public holidays (${HOLIDAY_COUNTRIES.join(', ')}), tax years and daylight saving (${CAL.CODES.join(', ')}) for ${SPAN}`,
    catalogue: `calendar facts: public holidays, tax-year starts and daylight-saving switches for ${SPAN}`,
    call: `calendar facts (calendar_facts {country, kind: holidays|tax-year|dst, year?, region?} and next_holiday {country, from?} — holidays for ${HOLIDAY_COUNTRIES.join(', ')}; tax years and DST for ${CAL.CODES.join(', ')}; ${SPAN})`,
  },

  docs: {
    readme: {
      roadmapRow: `| **Calendar facts** — the boring dates a training cutoff hides: public holidays for the UK (3 nations), US federal, Germany (16 Länder) and France (2 zones) from the official lists; tax-year starts/ends for ${TAX_COUNTRIES.length} countries with the statute quoted; daylight-saving rules and computed switch dates for ${DST_COUNTRIES.length} countries — ${SPAN}, monthly snapshot, changelog when a year is published or a holiday moves | \`/api/mcp/calendar\` | **v1 — built ${DATA.verifiedDate}** |`,
      catalogueRow: `| \`/api/mcp/calendar\` | \`calendar_facts\` {country, kind: holidays\\|tax-year\\|dst, year?, region?} — holidays by region (UK nations, US federal with OPM observed dates, German Länder incl. partial/Gemeinde-scoped days, French metropole/Alsace-Moselle), tax-year periods with the statute quoted, DST rule + transitions; \`next_holiday\` {country, from?, region?} — the next public holiday after a date. Country names, Land names and kind synonyms resolve; unknowns answer covered:false + nearest | \`data/calendar.json\` (${Math.round(Buffer.byteLength(JSON.stringify(DATA)) / 1024)} KB compact, ${YEARS.join('/')}): gov.uk \`bank-holidays.json\` (OGL v3), OPM federal holiday tables (US Government work), \`calendrier.api.gouv.fr\` (Licence Ouverte 2.0), merged with \`data/calendar/manual.json\` (German Länder rules, tax years, DST rules — each with the official page and sentence quoted; \`nonOfficial: true\` where a page could not be re-fetched); regenerate with \`node scripts/calendar.js\` (appends \`calendar\` changelog entries) |`,
    },
    llms: {
      rest: [
        `- \`GET https://databutler.dev/api/calendar?country=uk&kind=holidays&year=2027\` — calendar facts for ${SPAN}: public holidays by region for the UK (england-and-wales, scotland, northern-ireland), US federal (statutory and OPM-observed dates), Germany (nationwide or any Land) and France (metropole, alsace-moselle) from the official lists; \`kind=tax-year\` for ${TAX_COUNTRIES.join(', ')} (start/end, periods, statute quoted); \`kind=dst\` for ${DST_COUNTRIES.join(', ')} (rule and clocks-forward/back dates). Empty query lists the coverage. \`GET /api/calendar/next?country=de&from=2026-12-27&region=BY\` — the next public holiday after a date.`,
      ],
      server: `- \`POST https://databutler.dev/api/mcp/calendar\` — tools \`calendar_facts\` {country, kind, year?, region?} and \`next_holiday\` {country, from?, region?}: public holidays (uk, us, de, fr by region), tax-year starts and ends (${TAX_COUNTRIES.join(', ')}) and daylight-saving switches (${DST_COUNTRIES.join(', ')}) for ${SPAN}, a monthly snapshot of gov.uk bank-holidays.json, OPM's federal tables, calendrier.api.gouv.fr and the statutes quoted in data/calendar/manual.json — with source URL, verifiedDate and a nonOfficial flag where an official page could not be re-fetched. REST mirror: \`GET https://databutler.dev/api/calendar?country=…&kind=…\`.`,
    },
    curation: [
      `| \`data/calendar.json\` | Monthly (freshness says \`due\` from ${CADENCE_DAYS} days after the fetch); and when a government publishes the next year's list (gov.uk and OPM publish ~2 years ahead, calendrier.api.gouv.fr 5 years) | \`node scripts/calendar.js\` — fetches gov.uk \`bank-holidays.json\`, OPM's federal-holidays page and \`calendrier.api.gouv.fr\` (UA names databutler.dev, 500 ms apart), merges \`data/calendar/manual.json\` (German Länder rules, tax-year and DST rules — edit that file against the official pages, bump its \`verifiedDate\`, keep every \`quote\`/\`verification\`), computes rule-based dates and stops if a hand-copied official date disagrees, bumps \`verifiedDate\`/\`nextScheduledRefresh\` (+${CADENCE_DAYS} days), appends \`calendar\` changelog entries (\`<cc>/holidays/<year>\` for a new year, \`<cc>/holidays/<region>/<year>/<key>\` for an added/removed/moved day, \`<cc>/tax-year/<part>\`, \`<cc>/dst/<year>\` for rule changes). Fill the blank notes, commit \`data/\` together. To widen the window add the year to \`manual.json\` \`years\`. \`CAL_DIR=path\` builds from saved copies. Re-try the \`nonOfficial\` entries (HB, MV, SH, TH holidays; fr and br DST; br personal tax year) each refresh. |`,
    ],
    index: { blurb: `public holidays, tax-year and clock-change dates for ${SPAN} — UK, US, Germany, France and five more, from the official lists` },
    api: () => ({
      endpoints: {
        'GET /api/calendar': {
          description:
            `Calendar facts for ${SPAN}, verified ${DATA.verifiedDate}: kind=holidays — public holidays by region for ${HOLIDAY_COUNTRIES.join(', ')} from gov.uk, OPM, the German Länder and calendrier.api.gouv.fr; ` +
            `kind=tax-year — start/end and periods for ${TAX_COUNTRIES.join(', ')} with the statute quoted; kind=dst — daylight-saving rule and switch dates for ${DST_COUNTRIES.join(', ')}. Empty query lists coverage; unknown country/region/year answers covered:false with nearest.`,
          params: { country: `one of ${CAL.CODES.join(', ')} or a name`, kind: 'holidays | tax-year | dst', year: `${YEARS[0]}–${YEARS[YEARS.length - 1]} (optional)`, region: 'UK nation, German Land, metropole | alsace-moselle (optional)' },
          example: 'https://databutler.dev/api/calendar?country=uk&kind=holidays&year=2027&region=scotland',
        },
        'GET /api/calendar/next': {
          description: `The next public holiday strictly after a date (default today) for ${HOLIDAY_COUNTRIES.join(', ')}, with the three that follow; same snapshot as /api/calendar.`,
          params: { country: `one of ${HOLIDAY_COUNTRIES.join(', ')}`, from: 'YYYY-MM-DD (optional)', region: 'as for /api/calendar (optional)' },
          example: 'https://databutler.dev/api/calendar/next?country=de&from=2026-12-27&region=BY',
        },
      },
      coverage: {
        calendar: `${HOLIDAY_COUNTRIES.join(', ')} holidays (${Object.values(DATA.counts.holidays).reduce((a, b) => a + b, 0)} entries), ${TAX_COUNTRIES.length} tax-year countries, ${DST_COUNTRIES.length} DST countries, ${YEARS.join('/')}, verified ${DATA.verifiedDate}`,
      },
      mcp: 'Remote MCP server — tools calendar_facts, next_holiday (public holidays, tax years and daylight saving from the official lists and statutes, monthly snapshot).',
    }),
  },

  facts: null, // publishes no Verified Facts (/f/<key>); see api/_areas/README.md "facts"

  verify: [
    { label: 'call-calendar-uk-2027', kind: 'tool', tool: 'calendar_facts', args: { country: 'uk', kind: 'holidays', year: 2027 }, assert: "d['region']=='england-and-wales' and d['count']==8 and d['holidays'][1]['date']=='2027-03-26' and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/calendar?country=uk&kind=holidays&year=2027'" },
    { label: 'call-next-holiday-by', kind: 'tool', tool: 'next_holiday', args: { country: 'de', from: '2026-12-27', region: 'BY' }, assert: "d['next']['date']=='2027-01-01' and d['following'][0]['key']=='heilige-drei-koenige' and d['region']=='BY'" },
    { label: 'call-calendar-nearmiss', kind: 'tool', tool: 'calendar_facts', args: { country: 'spain', kind: 'holidays' }, assert: "d['covered']==False and 'uk' in d['coverage']" },
    { label: 'rest-calendar-fr-dst', kind: 'rest', path: 'calendar', query: 'country=fr&kind=dst&year=2027', assert: "d['observed']==True and d['transitions']['2027']['clocksForward']=='2027-03-28' and 'freshness' in d and d['cite']['url']=='https://databutler.dev/r/calendar?country=fr&kind=dst&year=2027'" },
    { label: 'rest-calendar-listing', kind: 'rest', path: 'calendar', query: '', assert: "'countries' in d and 'cite' in d" },
    { label: 'rest-calendar-next-400', kind: 'rest', path: 'calendar/next', query: '', assert: "'missing' in d['error']" },
  ],

  CADENCE_DAYS,
};
