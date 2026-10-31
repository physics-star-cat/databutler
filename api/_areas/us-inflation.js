/**
 * Area: us-inflation — US inflation as the BLS measures it: the Consumer Price Index for All Urban Consumers
 * (CPI-U), U.S. city average, all items, not seasonally adjusted (series CUUR0000SA0). Serves the latest
 * month's 12-month percent change and index level, each with the prior month's, and the annual averages
 * 2021 onward. Data: data/us-inflation.json, written by `node scripts/us-inflation.js` from the BLS Public
 * Data API, the CPI release archive (release day + the release's own 12-month sentence) and the CPI release
 * schedule; then `node scripts/changelog.js --only us-inflation` diffs the figures (one entry per figure
 * that moved). Refreshed on each monthly CPI release day (nextScheduledRefresh = the next release, read from
 * the schedule). Contract: api/_areas/README.md. Playbook: docs/ADDING_AN_AREA.md.
 */
const DATA = require('../../data/us-inflation.json');
const { BASE, diffCategories, categoriesLookup, categorySources, figureKey, findFigure } = require('../_area_kit');

const AREA = 'us-inflation';
const TOOL = 'us_inflation_lookup';
const REST_PATH = 'us/inflation'; // GET /api/us/inflation and /r/us/inflation, beside us/rates
/** The tool's arguments: the first names the category; each further one narrows its figures by the figure field of that name. */
const PARAMS = ['category'];
const CADENCE_DAYS = null; // calendar-driven: nextScheduledRefresh = the next BLS CPI release day, written by scripts/us-inflation.js
const CATEGORIES = Object.keys(DATA.categories);
/** annual-rate and index carry the prior month as previous: their first appearance records previous → value. */
const PREVIOUS = true;
const KEY = figureKey;
const SCHEDULE = DATA.nextRelease.source;
const FIGS = DATA.categories['cpi-u'].figures;
const fig = (k) => FIGS.find((f) => f.key === k);
const RATE = fig('annual-rate');
const INDEX = fig('index-level');
const AVERAGE_YEARS = FIGS.filter((f) => f.key.startsWith('annual-average-')).map((f) => f.period);
const HEADLINE = `${RATE.value}% over the 12 months to ${RATE.period} (index ${INDEX.value}, released ${RATE.effectiveFrom})`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-09" → "September 2026"; a year stays a year. */
const periodName = (p) => (/^\d{4}-\d{2}$/.test(String(p)) ? `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : String(p));

/**
 * Changelog note naming both reference months: "September 2026: 3.7% (August 2026: 3.4%), BLS CPI release 2026-10-14 — <quote>".
 * The from side's month is the committed file's figure period, else (first commit) the figure's previous.period.
 */
function note(e, prev, next) {
  const now = findFigure(next, e.key, KEY);
  const was = prev ? findFigure(prev, e.key, KEY) : null;
  const f = now ? now.figure : null;
  const fromPeriod = (was && was.figure.period) || (f && f.previous && f.previous.period) || null;
  const unit = e.unit === '%' ? '%' : '';
  const fmt = (v) => (v === null || v === undefined ? 'none' : `${v}${unit}`);
  const head = `${f ? f.label.replace(/ \(.*\)$/, '') : e.label}, ${periodName(e.period)}: ${fmt(e.to)}`;
  const from = e.from === null ? '' : ` (${fromPeriod ? `${periodName(fromPeriod)}: ` : 'was '}${fmt(e.from)})`;
  const base = e.unit && e.unit !== '%' ? ` ${e.unit}` : '';
  return `${head}${from}${base}; BLS CPI release ${e.effectiveFrom}${f && f.quote ? ` — ${f.quote}` : ''}`;
}

const lookup = categoriesLookup(DATA, AREA, { param: PARAMS[0], filters: PARAMS.slice(1) });
const pick = (q) => Object.fromEntries(PARAMS.map((p) => [p, q[p]]));

module.exports = {
  area: AREA,
  order: 190,
  title: 'US inflation (CPI-U)',
  short: 'US CPI-U inflation',

  server: {
    serverName: 'databutler-us-inflation',
    url: `${BASE}/api/mcp/us-inflation`,
    description: 'US CPI-U inflation from the BLS: 12-month rate, index level and annual averages, with dates.',
    instructions:
      'US inflation from databutler.dev — the BLS Consumer Price Index for All Urban Consumers (CPI-U), U.S. city average, ' +
      'all items, not seasonally adjusted (series CUUR0000SA0). us_inflation_lookup returns the latest month\'s 12-month percent ' +
      'change and index level (1982-84=100), each with its reference month (period), the BLS release day (effectiveFrom), the ' +
      'prior month\'s figure and the next scheduled release, plus the annual averages from 2021. The 12-month change is the ' +
      'figure the BLS release states, cross-checked against the two published index levels. A new month is released about ' +
      'once a month; a result whose nextRelease date has passed may have been superseded. Present period, effectiveFrom, ' +
      'verifiedDate and source with any figure. Seasonally adjusted series, core CPI, CPI-W, C-CPI-U, regional indexes and ' +
      'PCE are not covered (coverage lists them). Every result carries cite.url (a databutler.dev permalink) and its official source.',
    tools: [
      {
        name: TOOL,
        title: 'US inflation (CPI-U) lookup',
        description:
          'US inflation as published by the Bureau of Labor Statistics: CPI-U, all items, U.S. city average, not seasonally ' +
          'adjusted (series CUUR0000SA0). Category cpi-u returns annual-rate (the latest month\'s 12-month percent change, as the ' +
          'BLS release states it), index (the latest month\'s index level, 1982-84=100), and annual-average-<year> for each year ' +
          `from ${AVERAGE_YEARS[0]} to ${AVERAGE_YEARS[AVERAGE_YEARS.length - 1]}. Each figure carries its period (reference month ` +
          'as YYYY-MM, or the year), effectiveFrom (the BLS release day), source, the quoted API values or release sentence, and ' +
          'for the monthly figures the prior month as previous; the answer also gives the next scheduled release and verifiedDate. ' +
          'Omitting category lists the categories. An unknown category answers covered:false with the nearest keys.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: `one of: ${CATEGORIES.join(', ')} (omit to list all)` },
          },
        },
        run: (a) => {
          const r = lookup(a);
          return r && r.covered === false ? r : { ...r, latestRelease: DATA.latestRelease, nextRelease: DATA.nextRelease };
        },
        freshness: AREA,
        cite: (a) => ({ path: REST_PATH, query: pick(a) }),
      },
    ],
  },

  coverage: () => ({
    categories: CATEGORIES,
    series: DATA.series,
    latest: HEADLINE,
    annualAverages: AVERAGE_YEARS,
    nextRelease: DATA.nextRelease,
    verifiedDate: DATA.verifiedDate,
    scope: 'United States, U.S. city average: BLS CPI-U all items, not seasonally adjusted, 1982-84=100 (series CUUR0000SA0); the latest month and the prior one, and annual averages from 2021. Read from the BLS Public Data API and the BLS CPI release.',
    notCovered: [
      'seasonally adjusted CPI-U (CUSR0000SA0) and the month-over-month change',
      'core CPI (all items less food and energy) and component indexes (food, energy, shelter, …)',
      'CPI-W (used for the Social Security COLA — us_rates_lookup carries the COLA itself), chained CPI-U (C-CPI-U) and R-CPI-E',
      'regional, state and metropolitan-area indexes',
      'PCE price index (BEA), PPI, import/export prices',
      'monthly history before the prior month (annual averages are kept from 2021)',
      'inflation in other countries (UK CPI: ONS; euro area HICP: Eurostat)',
    ],
  }),

  freshness: { dataFile: 'data/us-inflation.json', cadenceDays: CADENCE_DAYS, data: DATA },

  changelog: {
    diff: (prev, next) => diffCategories(AREA, prev, next, {
      key: KEY,
      previous: PREVIOUS,
      effectiveFrom: (n, f) => f.effectiveFrom || n.verifiedDate,
      extra: (n, cat, f) => ({ period: f.period }),
    }),
    files: ['data/us-inflation.json'],
    previous: PREVIOUS,
    note,
    context: (e) => (e.period ? `CPI-U, reference period ${e.period}` : 'CPI-U'),
  },
  discovery: {
    description: 'US inflation from the Bureau of Labor Statistics: CPI-U (all items, U.S. city average, not seasonally adjusted) 12-month percent change, index level and annual averages, each with its reference month and BLS release day.',
    cadence: 'Monthly, on the BLS CPI release day; every source page re-fetched weekly',
  },

  // The series page, each figure's release, and the release schedule (which supplies nextScheduledRefresh).
  sources: () => categorySources(DATA, { extra: [{ url: SCHEDULE, label: 'BLS — Schedule of Releases for the Consumer Price Index (next release day)' }] }),

  rest: [
    { path: REST_PATH, tool: TOOL, args: pick /* no `required`: an empty query answers the listing, like uk_rates_lookup */ },
  ],

  hub: {
    changed: 'US inflation (BLS CPI-U 12-month rate and index, each monthly release)',
    coverage: 'US CPI-U inflation (latest month, prior month, annual averages)',
    catalogue: 'US inflation (us_inflation_lookup: BLS CPI-U 12-month rate, index level, annual averages)',
    call: 'us_inflation_lookup (US CPI-U from the BLS: 12-month percent change, index level 1982-84=100, annual averages from 2021, with release dates)',
  },

  docs: {
    readme: {
      roadmapRow: `| **US inflation (CPI-U)** — \`us_inflation_lookup\`: the BLS CPI-U 12-month percent change and index level for the latest month (with the prior month and the next release day) and the annual averages from 2021, fetched by \`scripts/us-inflation.js\` from the BLS API and release; Verified Facts \`us/cpi-u/*\` with a scheduled \`nextExpectedChange\` | \`/api/mcp/us-inflation\` | **v1 — built 2026-10-31** |`,
      catalogueRow: '| `/api/mcp/us-inflation` | `us_inflation_lookup` — category ∈ {cpi-u} (omit to list) | `data/us-inflation.json`: BLS series CUUR0000SA0 (CPI-U, all items, U.S. city average, NSA) — `annual-rate` (12-month % change as the release states it, cross-checked against the indexes), `index` (1982-84=100), `annual-average-<year>` from 2021; period = reference month, effectiveFrom = BLS release day, previous = prior month. **Committed data, not a live proxy**, written by `node scripts/us-inflation.js` (monthly workflow) and diffed by `node scripts/changelog.js --only us-inflation`; freshness turns `due` on the next CPI release day |',
    },
    llms: {
      rest: [`- \`GET https://databutler.dev/api/${REST_PATH}?category=cpi-u\` — US inflation from the BLS: the CPI-U (all items, U.S. city average, not seasonally adjusted) 12-month percent change and index level for the latest month, each with its reference month, release day and the prior month's figure, the annual averages from 2021, and the next scheduled CPI release. Omit category to list.`],
      server: `- \`POST https://databutler.dev/api/mcp/us-inflation\` — tool \`us_inflation_lookup\` (category = cpi-u, or omit to list): BLS CPI-U 12-month percent change, index level (1982-84=100) and annual averages, each with period, effectiveFrom (the release day), source and quote; committed data refreshed on each CPI release day, not a live proxy. REST mirror: \`GET https://databutler.dev/api/${REST_PATH}?category=…\`.`,
    },
    curation: ['| `data/us-inflation.json` | Monthly, on the BLS CPI release day (calendar-driven: `cadenceDays: null`; `nextScheduledRefresh` = the next release on bls.gov/schedule/news_release/cpi.htm, written by the script). The monthly refresh workflow runs the script; between releases the weekly watcher hashes the series page, the release and the schedule. | `node scripts/us-inflation.js` (fetches the BLS API, archive, the two newest releases and the schedule; stops on any disagreement between the API index, the release sentence and the computed 12-month change), then `node scripts/changelog.js --only us-inflation` (one entry per figure that moved) and `node scripts/sign-facts.js`. October 2025 was never published (2025 lapse in appropriations): the October 2026 12-month change is the release\'s own figure, quoted as such. |'],
    index: { blurb: 'US CPI-U inflation from the BLS: 12-month rate, index level and annual averages, with release dates' },
    api: () => ({
      endpoints: {
        [`GET /api/${REST_PATH}`]: {
          description: `US inflation (BLS CPI-U, all items, U.S. city average, NSA), verified ${DATA.verifiedDate}: ${HEADLINE}; annual averages ${AVERAGE_YEARS[0]}–${AVERAGE_YEARS[AVERAGE_YEARS.length - 1]}; next release ${DATA.nextRelease.date}.`,
          params: {
            category: `one of ${CATEGORIES.join(', ')} (omit to list)`,
          },
          example: `https://databutler.dev/api/${REST_PATH}?category=cpi-u`,
        },
      },
      coverage: { usInflation: `CPI-U ${HEADLINE}; verified ${DATA.verifiedDate}; next release ${DATA.nextRelease.date}` },
    }),
  },

  // Verified Facts: us/cpi-u/annual-rate, us/cpi-u/index-level, us/cpi-u/annual-average-<year> (api/_areas/README.md "facts").
  facts: {
    namespace: 'us',
    period: (d, f) => f.period,
    previousPeriod: (d, f, p) => p.period ?? null,
    effectiveFrom: (d, f) => f.effectiveFrom || null,
    // v0.3: the monthly figures move on the BLS release calendar. An annual average is final once published (BLS does not
    // revise the NSA CPI-U), so no day is named: irregular with nextExpectedChange null.
    expected: (r) => (/\/annual-average-\d{4}$/.test(r.key) ? { changeCadence: 'irregular', dates: [] } : { changeCadence: 'scheduled', dates: [DATA.nextRelease.date] }),
    aliases: {
      'us/inflation/cpi': 'us/cpi-u/annual-rate',
      'us/inflation/rate': 'us/cpi-u/annual-rate',
      'us/cpi/annual-rate': 'us/cpi-u/annual-rate',
    },
    synonyms: { inflation: 'cpi-u', cpi: 'cpi-u', 'cpi-u': 'cpi-u', 'consumer price index': 'cpi-u', 'cost of living': 'cpi-u' },
  },

  verify: [
    { label: 'us-inflation-listing', kind: 'tool', tool: TOOL, args: {}, assert: "'categories' in d and 'freshness' in d and 'cpi-u' in d['categories']" },
    { label: 'call-us-inflation-cpi-u', kind: 'tool', tool: TOOL, args: { category: 'cpi-u' }, assert: "d['category']=='cpi-u' and d['source'].startswith('https://data.bls.gov/') and [f['key'] for f in d['figures']][:2]==['annual-rate','index'] and d['nextRelease']['date']>=d['verifiedDate'] and d['cite']['url']=='https://databutler.dev/r/us/inflation?category=cpi-u'" },
    { label: 'us-inflation-rest-listing', kind: 'rest', path: REST_PATH, query: '', assert: "'categories' in d and 'cite' in d" },
    { label: 'rest-us-inflation-nearmiss', kind: 'rest', path: REST_PATH, query: 'category=cpi', assert: "d['category']=='cpi-u' or d.get('covered')==False" },
  ],
};
