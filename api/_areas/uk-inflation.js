/**
 * Area: uk-inflation — UK consumer price inflation as the Office for National Statistics publishes it:
 * the CPI and CPIH 12-month rates for the latest month (with the prior month as `previous`), the CPI
 * index (2015=100) and the CPI annual rate for each calendar year from 2021. Read from three ONS time
 * series (D7G7, L55O, D7BT; dataset MM23) by `node scripts/uk-inflation.js`, which writes
 * data/uk-inflation.json in the categories → figures shape; the standard per-figure diff then logs each
 * monthly release (`node scripts/changelog.js --only uk-inflation`). Refreshed on each ONS CPI release
 * day (the series' own nextRelease, stored as nextScheduledRefresh).
 * Contract: api/_areas/README.md. Playbook: docs/ADDING_AN_AREA.md.
 */
const DATA = require('../../data/uk-inflation.json');
const { BASE, diffCategories, categoriesLookup, categorySources, figureKey, noteTemplate } = require('../_area_kit');

const AREA = 'uk-inflation';
const TOOL = 'uk_inflation_lookup';
const REST_PATH = 'uk-inflation'; // GET /api/<REST_PATH> and the /r/<REST_PATH> citation page
/** The tool's arguments: the first names the category; each further one narrows its figures by the figure field of that name. */
const PARAMS = ['category'];
const CADENCE_DAYS = null; // calendar-driven: nextScheduledRefresh = the ONS nextRelease, written by scripts/uk-inflation.js
const CATEGORIES = Object.keys(DATA.categories);
/**
 * The monthly figures carry `previous` (the prior month): a figure's first appearance records
 * previous.value → value; the annual averages carry none and record nothing on arrival. Afterwards
 * every release diffs value against the committed file — one entry per figure that moved.
 */
const PREVIOUS = true;
/** A figure's id: its own `key` (every figure carries one). The diff, the note template and the fact key share it. */
const KEY = figureKey;
const MONTHLY = /\/(annual-rate|index-level)$/;

const lookup = categoriesLookup(DATA, AREA, { param: PARAMS[0], filters: PARAMS.slice(1) });
const pick = (q) => Object.fromEntries(PARAMS.map((p) => [p, q[p]]));
const fig = (cat, key) => DATA.categories[cat].figures.find((f) => f.key === key);
const CPI = fig('cpi', 'annual-rate');
const CPIH = fig('cpih', 'annual-rate');
const INDEX = fig('cpi', 'index-level');
const YEARS = DATA.categories.cpi.figures.filter((f) => f.key.startsWith('annual-average-')).map((f) => f.period);

module.exports = {
  area: AREA,
  order: 180,
  title: 'UK inflation (CPI, CPIH)',
  short: 'UK CPI and CPIH inflation',

  server: {
    serverName: 'databutler-uk-inflation',
    url: `${BASE}/api/mcp/uk-inflation`,
    description: 'UK CPI and CPIH inflation rates, the CPI index and annual averages, read from ONS series.',
    instructions:
      'UK consumer price inflation from the Office for National Statistics (ONS): the CPI and CPIH 12-month rates for the latest ' +
      'month with the prior month, the CPI index (2015=100) and the CPI annual rate for each calendar year from 2021. Each figure ' +
      'names its reference period (YYYY-MM or YYYY), the ONS release day it was published (effectiveFrom), the ONS time-series page ' +
      'it was read from and the series line as the ONS states it (quote). The file also states the next ONS release (nextRelease); ' +
      'figures are re-read on that day. Every result carries verifiedDate, freshness and cite.url, a databutler.dev permalink.',
    tools: [
      {
        name: TOOL,
        title: 'UK inflation (CPI, CPIH) lookup',
        description:
          'UK consumer price inflation as published by the ONS, by category: cpi (CPI 12-month rate for the latest month with the ' +
          'prior month, CPI index 2015=100, CPI annual rate for each calendar year from 2021) and cpih (CPIH 12-month rate with the ' +
          'prior month). Each figure has its reference period, the ONS release day, the ONS series page and the series line quoted; ' +
          'the answer states the next ONS release. No category returns the listing; an unknown category answers covered:false with ' +
          'the nearest keys.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: `one of: ${CATEGORIES.join(', ')} (omit to list all)` },
          },
        },
        run: (a) => {
          const r = lookup(a);
          return r && r.covered !== false ? { ...r, referenceMonth: DATA.referenceMonth, releaseDate: DATA.releaseDate, nextRelease: DATA.nextRelease } : r;
        },
        freshness: AREA,
        cite: (a) => ({ path: REST_PATH, query: pick(a) }),
      },
    ],
  },

  coverage: () => ({
    categories: CATEGORIES,
    verifiedDate: DATA.verifiedDate,
    referenceMonth: DATA.referenceMonth,
    releaseDate: DATA.releaseDate,
    nextRelease: DATA.nextRelease,
    annualAverageYears: YEARS,
    scope: 'United Kingdom, all-items indices only, as the ONS publishes them in dataset MM23 (series D7G7 CPI 12-month rate, D7BT CPI index 2015=100, L55O CPIH 12-month rate).',
    notCovered: [
      'RPI and RPIJ (retail prices index)',
      'CPI or CPIH components and divisions (food, energy, services, goods), core CPI',
      'the CPIH index level and CPIH annual averages',
      'monthly (1-month) rates and months before the prior month',
      'forecasts (Bank of England, OBR) and inflation outside the UK',
      'regional or household-group inflation',
    ],
  }),

  freshness: { dataFile: 'data/uk-inflation.json', cadenceDays: CADENCE_DAYS, data: DATA },

  changelog: {
    diff: (prev, next) => diffCategories(AREA, prev, next, {
      key: KEY,
      previous: PREVIOUS,
      effectiveFrom: (n, f) => f.effectiveFrom || n.releaseDate || n.verifiedDate,
      extra: (n, cat, f) => ({ period: f.period }),
    }),
    files: ['data/uk-inflation.json'],
    previous: PREVIOUS,
    note: noteTemplate('{label}: {from} → {to} {unit}, ONS release of {effectiveFrom} ({title}; series line "{quote}")', { key: KEY }),
    context: (e) => (e.period ? `reference period ${e.period}` : ''),
  },
  discovery: {
    description: 'UK consumer price inflation read from the ONS time series: CPI and CPIH 12-month rates for the latest month, the CPI index (2015=100) and CPI annual rates per calendar year, each with its reference period and ONS release day.',
    cadence: 'Monthly, on the ONS CPI release day (stated as nextRelease in the series); every source page re-fetched weekly',
  },

  // The category pages (D7G7, L55O) and the index's own page (D7BT), each once.
  sources: () => categorySources(DATA),

  rest: [
    { path: REST_PATH, tool: TOOL, args: pick },
  ],

  hub: {
    changed: 'UK CPI and CPIH inflation rates (ONS, monthly)',
    coverage: 'UK inflation categories (cpi, cpih)',
    catalogue: 'UK inflation: CPI and CPIH 12-month rates, CPI index and annual averages (ONS)',
    call: 'uk_inflation_lookup (UK CPI and CPIH inflation from the ONS)',
  },

  docs: {
    readme: {
      roadmapRow: '| **UK inflation (CPI, CPIH)** — the current ONS CPI and CPIH 12-month rates, CPI index and annual averages, each with its reference month, release day and series page | `/api/mcp/uk-inflation` | **v1 — built 2026-10-31** |',
      catalogueRow: '| `/api/mcp/uk-inflation` | `uk_inflation_lookup` {category: cpi\\|cpih} | `data/uk-inflation.json`, written by `node scripts/uk-inflation.js` from the ONS time series D7G7, L55O, D7BT (Open Government Licence v3.0) |',
    },
    llms: {
      rest: ['- `GET https://databutler.dev/api/uk-inflation?category=cpi` — UK CPI 12-month rate (latest month and prior month), CPI index and annual averages from the ONS; `category=cpih` for CPIH.'],
      server: '- `POST https://databutler.dev/api/mcp/uk-inflation` — tool `uk_inflation_lookup`: UK CPI and CPIH inflation from the ONS time series, with reference period and release day.',
    },
    curation: ['| `data/uk-inflation.json` | Monthly, on the ONS CPI release day (`nextScheduledRefresh` = the series\' `nextRelease`, written by the script; calendar-driven: `cadenceDays: null`); also in the monthly refresh PR; every source page re-fetched weekly | `node scripts/uk-inflation.js` (fetches D7G7, L55O, D7BT from the ONS, rewrites the file); `node scripts/changelog.js --only uk-inflation` (one entry per figure that moved, re-hashes this area\'s sources); review the notes; `node scripts/sign-facts.js`. |'],
    index: { blurb: 'UK CPI and CPIH inflation rates from the ONS' },
    api: () => ({
      endpoints: {
        [`GET /api/${REST_PATH}`]: {
          description: `UK consumer price inflation from the ONS (reference month ${DATA.referenceMonth}, released ${DATA.releaseDate}, next release ${DATA.nextRelease}), verified ${DATA.verifiedDate}.`,
          params: {
            category: `one of ${CATEGORIES.join(', ')} (omit to list)`,
          },
          example: `https://databutler.dev/api/${REST_PATH}?category=cpi`,
        },
      },
      coverage: { ukInflation: `CPI ${CPI.value}% and CPIH ${CPIH.value}% (12 months to ${CPI.period}), CPI index ${INDEX.value}; annual CPI rates ${YEARS[0]}–${YEARS[YEARS.length - 1]}; verified ${DATA.verifiedDate}` },
    }),
  },

  // Verified Facts: uk/<category>/<figure key> — uk/cpi/annual-rate, uk/cpi/index-level, uk/cpi/annual-average-<year>, uk/cpih/annual-rate.
  facts: {
    namespace: 'uk',
    key: KEY,
    period: (d, f) => f.period,
    previousPeriod: (d, f, p) => p.period ?? null,
    effectiveFrom: (d, f) => f.effectiveFrom || null,
    // v0.3: the monthly figures move on the next ONS CPI release day, read from the series' own nextRelease. A completed
    // calendar year's average is not scheduled to change (the ONS does not normally revise CPI), so it names no date.
    expected: (r) => (MONTHLY.test(r.key) ? { changeCadence: 'scheduled', dates: [DATA.nextRelease] } : { changeCadence: 'irregular', dates: [] }),
    aliases: {
      'uk/inflation/cpi': 'uk/cpi/annual-rate',
      'uk/inflation/cpih': 'uk/cpih/annual-rate',
      'uk/inflation/rate': 'uk/cpi/annual-rate',
    },
    synonyms: {
      inflation: 'cpi annual-rate',
      cpi: 'cpi',
      cpih: 'cpih',
      'consumer prices': 'cpi',
      'cost of living': 'cpi annual-rate',
      'price index': 'cpi index',
    },
  },

  verify: [
    { label: 'uk-inflation-listing', kind: 'tool', tool: TOOL, args: {}, assert: "'categories' in d and 'freshness' in d" },
    { label: 'uk-inflation-rest-listing', kind: 'rest', path: REST_PATH, query: '', assert: "'categories' in d and 'cite' in d" },
    { label: 'uk-inflation-cpi', kind: 'tool', tool: TOOL, args: { category: 'cpi' }, assert: "d['category']=='cpi' and d['figures'][0]['key']=='annual-rate' and d['source'].startswith('https://www.ons.gov.uk/') and d['nextRelease'] and d['cite']['url']=='https://databutler.dev/r/uk-inflation?category=cpi'" },
    { label: 'uk-inflation-rest-cpih', kind: 'rest', path: REST_PATH, query: 'category=cpih', assert: "d['category']=='cpih' and d['figures'][0]['unit']=='%' and 'freshness' in d" },
  ],
};
