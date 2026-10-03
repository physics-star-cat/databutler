/**
 * Area: us-rates — US federal rates and thresholds for one tax year, read from
 * the IRS revenue procedures and notices (Rev. Proc. 2025-32, Notice 2025-67,
 * Rev. Proc. 2025-19), SSA's Federal Register COLA notice, Publication 15 and
 * the irs.gov pages named in each figure's `source`; every figure keeps the
 * sentence or table row it was read from as `quote`, and its prior-year value
 * as `previous`. Rate schedules are one figure whose value is the bracket rows
 * exactly as the Rev. Proc. prints them. Data: data/us-rates.json. Refreshed
 * once a year when the IRS publishes the next tax year's inflation adjustments
 * (October), the retirement-plan limits (November) and SSA its COLA notice;
 * `nextScheduledRefresh` is set by hand to that window and diffed by
 * `node scripts/changelog.js`. Contract: api/_areas/README.md.
 * Playbook: docs/ADDING_AN_AREA.md.
 */
const DATA = require('../../data/us-rates.json');
const { nearest } = require('../_text');
const { BASE, diffCategories, slug } = require('../_area_kit');

const AREA = 'us-rates';
const TOOL = 'us_rates_lookup';
const CATEGORIES = Object.keys(DATA.categories);
const TAX_YEAR = DATA.taxYear;

/**
 * Pages the Monday watcher re-fetches: one per category, chosen as the page
 * where the next tax year's figure appears first (docs/CURATION.md). ssa.gov
 * returns 403 to automated fetches, so the Federal Register — SSA's own legally
 * required publication of the same determinations — stands in for it.
 */
const WATCH = [
  { url: 'https://www.irs.gov/newsroom/news-releases-for-current-month', label: 'IRS news releases for the current month — the tax-year inflation-adjustment release (income tax, estate and gift) appears here first and names the Rev. Proc.' },
  { url: 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Bagencies%5D%5B%5D=social-security-administration&conditions%5Bterm%5D=%22Cost-of-Living+Increase+and+Other+Determinations%22&order=newest', label: 'Federal Register API — SSA "Cost-of-Living Increase and Other Determinations" notices (wage base, COLA, quarter of coverage); a new document_number is the next year\'s notice' },
  { url: 'https://www.irs.gov/taxtopics/tc751', label: 'IRS Tax Topic 751 — Social Security and Medicare withholding rates and wage base' },
  { url: 'https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions', label: 'IRS COLA increases for dollar limitations on benefits and contributions — the year-by-year retirement-plan limits table' },
  { url: 'https://www.irs.gov/publications/p969', label: 'IRS Publication 969 — Health Savings Accounts: current-year HSA and HDHP limits' },
];

const header = () => ({
  area: AREA, taxYear: TAX_YEAR, taxYearRuns: DATA.taxYearRuns, jurisdiction: DATA.jurisdiction, currency: DATA.currency, verifiedDate: DATA.verifiedDate,
});

/**
 * { category } → that category's figures (value, unit, effectiveFrom, source, quote, verifiedDate,
 * previous) with the category's title, scope and source; nothing → the listing; an input that is
 * not a key resolves like uk_rates_lookup (a key or title containing it), else covered:false.
 */
function lookup({ category } = {}) {
  if (category === undefined || category === null || String(category).trim() === '') {
    return { ...header(), categories: Object.fromEntries(CATEGORIES.map((k) => [k, DATA.categories[k].title])), usage: 'pass category=<key> for figures' };
  }
  const key = String(category).toLowerCase().trim();
  const hit = CATEGORIES.find((k) => k === key) || CATEGORIES.find((k) => k.includes(key) || DATA.categories[k].title.toLowerCase().includes(key));
  if (!hit) {
    return { covered: false, requested: category, message: `unknown category "${category}"`, nearest: nearest(key, CATEGORIES), coverage: CATEGORIES };
  }
  return { ...header(), category: hit, ...DATA.categories[hit] };
}

/** A figure that applies from a later year than the file's tax year (none in the US file yet) is logged under that year. */
const taxYearOf = (n, f) => ((f.effectiveFrom || '').slice(0, 4) > String(n.taxYear) ? f.effectiveFrom.slice(0, 4) : n.taxYear);

/** The upper bounds of a schedule's brackets (every row but the open-ended top one). */
const upperBounds = (rows) => rows.filter((r) => typeof r.notOver === 'number').map((r) => r.notOver);

/**
 * A rate schedule's `previous` block holds the prior year's bracket upper bounds rather than a
 * `value` (the Rev. Proc. tables are not reproduced twice), so on its first appearance in the file
 * the schedule is logged as bounds → bounds. Once the schedule is in the file, diffCategories
 * compares the rows themselves on each refresh.
 */
function scheduleArrivals(prev, next) {
  const out = [];
  for (const [cat, c] of Object.entries(next.categories || {})) {
    const before = new Set((((prev && prev.categories && prev.categories[cat]) || {}).figures || []).map((f) => f.key));
    for (const f of c.figures || []) {
      if (before.has(f.key) || !f.previous || !Array.isArray(f.previous.bracketUpperBounds) || !Array.isArray(f.value)) continue;
      out.push({
        area: AREA, key: `${cat}/${f.key}`, label: `${f.label} — bracket upper bounds`,
        from: f.previous.bracketUpperBounds, to: upperBounds(f.value),
        unit: 'USD taxable income (upper bound of each bracket below the top rate)',
        taxYear: taxYearOf(next, f), effectiveFrom: f.effectiveFrom || `${next.taxYear}-01-01`, source: f.source || c.source, verifiedDate: next.verifiedDate, note: '',
      });
    }
  }
  return out;
}

module.exports = {
  area: AREA,
  order: 90,
  title: 'US federal rates & thresholds',
  short: 'US federal tax thresholds',

  server: {
    serverName: 'databutler-us-rates',
    url: `${BASE}/api/mcp/us-rates`,
    instructions:
      `Verified US federal rates and thresholds from databutler.dev — tax year ${TAX_YEAR}, each figure read from the IRS revenue ` +
      'procedure, IRS notice, SSA Federal Register notice or irs.gov page named in its source, with the quoted sentence or table row ' +
      'and verifiedDate. Use us_rates_lookup instead of quoting US federal figures from memory: the IRS re-indexes most of them every ' +
      'October and November, so training data is stale by the first release after the cutoff. Present taxYear, source and verifiedDate ' +
      'with any figure; rate schedules are bracket rows (over, notOver, rate, taxAtLowerBound) exactly as the Rev. Proc. prints them, ' +
      'and each figure\'s previous block holds the prior-year value. Federal only — state income taxes, AMT, EITC and capital-gains ' +
      'brackets are not covered (coverage lists them). Cite https://databutler.dev/ and the source.',
    tools: [
      {
        name: TOOL,
        title: 'US federal rates lookup',
        description:
          `Current US federal (tax year ${TAX_YEAR}) rates and thresholds read from the IRS revenue procedures and notices, SSA's Federal ` +
          'Register notice and irs.gov pages, each figure with its source URL, the quoted sentence or table row, verifiedDate and the ' +
          'prior-year value where one exists. Categories: income-tax (rate schedules for Single, Married filing jointly, Head of ' +
          'household and Married filing separately as bracket rows, standard deduction by filing status, additional and dependent ' +
          'standard deduction, top rate), social-security (OASDI wage base, employee and employer rates, COLA, quarter of coverage), ' +
          'medicare (rate, Additional Medicare Tax rate and thresholds by filing status, employer withholding threshold), retirement ' +
          '(401(k)/403(b)/457(b)/TSP deferral limit, age-50 and age-60–63 catch-ups, Roth catch-up wage threshold, § 415(c) and ' +
          'compensation limits, IRA and IRA catch-up, SIMPLE, highly compensated employee), hsa (contribution limits, HDHP minimum ' +
          'deductible and out-of-pocket maximum, excepted-benefit HRA), estate-gift (basic exclusion, GST exemption, annual gift ' +
          'exclusions). Federal only: state income taxes, AMT, EITC and capital-gains brackets are not covered. An unknown category ' +
          'answers covered:false with the nearest keys.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: `one of: ${CATEGORIES.join(', ')} (omit to list all)` },
          },
        },
        run: (a) => lookup(a),
        freshness: AREA,
        cite: (a) => ({ path: 'us/rates', query: { category: a.category } }),
      },
    ],
  },

  coverage: () => ({
    taxYears: [TAX_YEAR],
    categories: CATEGORIES,
    verifiedDate: DATA.verifiedDate,
    scope: `${DATA.jurisdiction} Each figure names the IRS or SSA document it was read from and keeps the quoted sentence.`,
    notCovered: [
      'state income taxes, state unemployment insurance and local taxes',
      'alternative minimum tax (AMT) exemption and phase-out amounts',
      'earned income tax credit (EITC) amounts and phase-outs',
      'long-term capital-gains and qualified-dividend rate brackets',
      'self-employment tax beyond the FICA rates and wage base (SECA mechanics, the deduction of half)',
      'the OBBBA senior deduction ($6,000, tax years 2025–2028; income-limited, not in the inflation release)',
      `prior tax years (the ${Number(TAX_YEAR) - 1} value is kept only as each figure's previous)`,
    ],
  }),

  // Calendar-driven: the IRS publishes the next tax year's figures each October/November, so nextScheduledRefresh
  // is set by hand in the file to that window (2026-11-01 for tax year 2027); freshness turns `due` from that day.
  freshness: { dataFile: 'data/us-rates.json', cadenceDays: null, data: DATA },

  changelog: {
    // Figures carry a stable `key`, their own `source`, `effectiveFrom` and a `previous` (prior-year) block, so a
    // figure's first appearance records prior year → current rather than null → current; rate schedules arrive
    // as bracket bounds → bounds (scheduleArrivals).
    diff: (prev, next) => [
      ...diffCategories(AREA, prev, next, {
        key: (f) => f.key || slug(f.label),
        previous: true,
        effectiveFrom: (n, f) => f.effectiveFrom || `${n.taxYear}-01-01`,
        extra: (n, cat, f) => ({ taxYear: taxYearOf(n, f) }),
      }),
      ...scheduleArrivals(prev, next),
    ],
    files: ['data/us-rates.json'],
    context: (e) => (e.taxYear ? `tax year ${e.taxYear}` : ''),
  },
  discovery: {
    description: 'US federal rates and thresholds read from the IRS revenue procedures and notices and SSA\'s Federal Register notice: income-tax rate schedules and standard deduction, Social Security wage base and rates, Medicare, retirement-plan and IRA limits, HSA limits, estate and gift exclusions.',
    cadence: 'Annual: after the IRS tax-year inflation adjustments (October), the retirement-plan limits (November) and the SSA Federal Register notice (October/November); every source page re-fetched weekly.',
  },

  sources: () => WATCH,

  rest: [
    { path: 'us/rates', tool: TOOL, args: (q) => ({ category: q.category }) },
  ],

  hub: {
    changed: 'US federal tax thresholds (IRS inflation adjustments, Social Security wage base, retirement and HSA limits)',
    coverage: 'US federal rate categories and tax year',
    catalogue: 'US federal rates and thresholds (us_rates_lookup: income tax, Social Security, Medicare, retirement, HSA, estate and gift)',
    call: 'us_rates_lookup (US federal rates and thresholds for the current tax year: income-tax, social-security, medicare, retirement, hsa, estate-gift)',
    frontDoor: 'US federal figures (IRS brackets and standard deduction, Social Security wage base, 401(k)/IRA/HSA limits, estate and gift exclusions) come from us_rates_lookup via call rather than memory.',
  },

  docs: {
    readme: {
      roadmapRow: `| 12 | **US federal rates & thresholds** — \`us_rates_lookup\`: tax year ${TAX_YEAR} income-tax schedules and standard deduction, Social Security wage base, Medicare, retirement-plan/IRA, HSA and estate-gift figures read from the IRS revenue procedures, notices and SSA's Federal Register notice, each with the quoted sentence and prior-year value (wishlist #12, "Rates, country #2 = US"); first country after the UK on the "is this still true?" layer | \`/api/mcp/us-rates\` | **v1 — built 2026-10-03** |`,
      catalogueRow: `| \`/api/mcp/us-rates\` | \`us_rates_lookup\` — category ∈ {${CATEGORIES.join(', ')}} (omit to list) | \`data/us-rates.json\` (tax year ${TAX_YEAR}, ${Object.values(DATA.categories).reduce((n, c) => n + c.figures.length, 0)} figures): read from Rev. Proc. 2025-32, Notice 2025-67, Rev. Proc. 2025-19, SSA's Federal Register notice 2025-19763, Publication 15 and Tax Topic 751; every figure carries \`quote\` (the sentence or table row) and \`previous\` (the prior-year value). Rate schedules are bracket rows. **Committed data, not a live proxy**; freshness turns \`due\` at the IRS release window set by hand in \`nextScheduledRefresh\`. Refresh annually: edit against the new Rev. Proc./Notice, \`node scripts/changelog.js\` (docs/CURATION.md) |`,
    },
    llms: {
      rest: [
        `- \`GET https://databutler.dev/api/us/rates?category=income-tax\` — current US federal (tax year ${TAX_YEAR}) rates and thresholds (income-tax rate schedules and standard deduction, Social Security wage base and rates, Medicare and Additional Medicare Tax, 401(k)/IRA/SIMPLE and other retirement limits, HSA and HDHP limits, estate and gift exclusions), each figure read from the IRS revenue procedure, notice or SSA Federal Register notice named as its source, with the quoted sentence, verifiedDate and the prior-year value. Omit category to list the categories.`,
      ],
      server: `- \`POST https://databutler.dev/api/mcp/us-rates\` — tool \`us_rates_lookup\` (category = ${CATEGORIES.join(' | ')}, or omit to list): current US federal (tax year ${TAX_YEAR}) rates and thresholds read from the IRS revenue procedures and notices and SSA's Federal Register notice, each figure with its source, the quoted sentence or table row, verifiedDate and the prior-year value; rate schedules as bracket rows. Federal only — state taxes, AMT, EITC and capital-gains brackets answer covered:false. Committed data verified against the documents, not a live proxy; freshness turns \`due\` when the IRS release window for the next tax year opens. REST mirror: \`GET https://databutler.dev/api/us/rates?category=…\`.`,
    },
    curation: [
      '| `data/us-rates.json` | Annual, calendar-driven (`cadenceDays: null`; `nextScheduledRefresh` set by hand to the IRS release window, 2026-11-01 for tax year 2027): the IRS tax-year inflation adjustments (Rev. Proc., mid/late October, announced on the newsroom page), the retirement-plan limits (Notice, early/mid November), SSA\'s COLA/wage-base Federal Register notice (late October/November), the HSA Rev. Proc. (May). The weekly watcher hashes the five pages in `sources()` (newsroom, Federal Register API, Tax Topic 751, COLA limits table, Pub 969). | Fetch the new Rev. Proc./Notice PDF from `/pub/irs-drop/`; for each figure move `value` into `previous` (with its source), write the new `value`, `effectiveFrom`, `source`, `quote`, `verifiedDate`; bump the file\'s `taxYear`, `taxYearRuns`, `verifiedDate` and set `nextScheduledRefresh` to the next release window; then `node scripts/changelog.js` (one `us-rates` entry per figure that moved, from → to; refreshes `data/sources.json`); fill each `note` with the Rev. Proc./Notice number. ssa.gov blocks curl — read the Federal Register notice instead. |',
    ],
    index: { blurb: `US federal tax year ${TAX_YEAR}: IRS brackets and standard deduction, Social Security wage base, Medicare, 401(k)/IRA/HSA limits, estate and gift exclusions, read from the IRS and SSA documents` },
    api: () => ({
      endpoints: {
        'GET /api/us/rates': {
          description:
            `US federal rates and thresholds for tax year ${TAX_YEAR}, verified ${DATA.verifiedDate} against the IRS revenue procedures and notices ` +
            'and SSA\'s Federal Register notice: income-tax rate schedules (bracket rows) and standard deduction, Social Security wage base and rates, ' +
            'Medicare and Additional Medicare Tax, retirement-plan and IRA limits, HSA/HDHP limits, estate and gift exclusions — each figure with ' +
            'source, quote, verifiedDate and the prior-year value. Committed data (not a live proxy), refreshed annually at the IRS release window.',
          params: { category: `one of ${CATEGORIES.join(', ')} (omit to list)` },
          example: 'https://databutler.dev/api/us/rates?category=income-tax',
        },
      },
      coverage: { usRates: `tax year ${TAX_YEAR}, ${CATEGORIES.length} categories, verified ${DATA.verifiedDate}; federal only` },
      mcp: `Remote MCP server — tool us_rates_lookup (US federal rates and thresholds, tax year ${TAX_YEAR}; committed data read from the IRS and SSA documents).`,
    }),
  },

  verify: [
    { label: 'us-rates-listing', kind: 'tool', tool: TOOL, args: {}, assert: `'categories' in d and 'freshness' in d and d['taxYear']=='${TAX_YEAR}' and 'income-tax' in d['categories']` },
    { label: 'call-us-rates-income-tax', kind: 'tool', tool: TOOL, args: { category: 'income-tax' }, assert: "d['category']=='income-tax' and d['source'].startswith('https://www.irs.gov/') and len(d['figures'])>=10 and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/us/rates?category=income-tax'" },
    { label: 'call-us-rates-nearmiss', kind: 'tool', tool: TOOL, args: { category: 'incme' }, assert: "d['covered']==False and 'income-tax' in d['nearest'] and 'social-security' in d['coverage']" },
    { label: 'rest-us-rates', kind: 'rest', path: 'us/rates', query: 'category=social-security', assert: "d['category']=='social-security' and 'freshness' in d and d['cite']['url']=='https://databutler.dev/r/us/rates?category=social-security'" },
  ],
};
