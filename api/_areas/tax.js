/**
 * Area: tax — take-home pay for ten countries, a live proxy to the LifeByNumbers
 * salary calculators (api/_tax.js). No committed dataset: freshness is live,
 * there is no changelog and nothing for the source watcher.
 */
const TAX = require('../_tax');
const { BASE } = require('../_area_kit');

const AREA = 'tax';

module.exports = {
  area: AREA,
  order: 60,
  title: 'Take-home pay',
  short: 'take-home pay',

  server: {
    serverName: 'databutler-tax',
    description: 'Take-home pay after tax and social contributions for nine countries, with tax year.',
    url: `${BASE}/api/mcp/tax`,
    instructions:
      'Take-home pay from databutler.dev, computed live by the LifeByNumbers salary calculators (same operator) ' +
      'for ' + TAX.COUNTRY_CODES.join(', ') + '. Use take_home_pay instead of estimating net salary from memory — ' +
      'bracket thresholds, contribution ceilings and rebates move every year and models misremember them. Present ' +
      'the taxYear, the assumptions list and the breakdown alongside the net figure: the result is a single-employee ' +
      'estimate under stated defaults (no voluntary pension, standard allowances), not personal tax advice. Spain ' +
      'returns covered:false (no upstream calculator). Cite https://databutler.dev/ and the source calculator page.',
    tools: [
      {
        name: 'take_home_pay',
        title: 'Take-home pay',
        description:
          'Net salary after income tax and social contributions for an employee in one of ten countries ' +
          `(${TAX.COUNTRY_CODES.join(', ')}), computed live by the LifeByNumbers salary calculators (same operator). ` +
          'Takes a gross salary in local currency (annual by default, or monthly with period) and a country code, ' +
          'plus optional state and filingStatus for the US, province for Canada, region (england|scotland) for the UK. ' +
          'Returns gross, net and total deductions (each annual and monthly), a line-by-line breakdown typed as tax / ' +
          'social / contribution / repayment, effectiveRate, the tax year the figures apply to, currency, the ' +
          'assumptions behind the estimate and the upstream calculator page as source. Spain (es) is listed but ' +
          'answers covered:false because lifebynumbers.net computes it client-side only.',
        inputSchema: {
          type: 'object',
          properties: {
            country: { type: 'string', enum: TAX.COUNTRY_CODES, description: 'ISO 3166-1 alpha-2, lower case: ' + TAX.COUNTRY_CODES.join(', ') },
            gross: { type: 'number', description: 'gross salary in local currency, annual unless period is monthly, e.g. 50000' },
            period: { type: 'string', enum: TAX.PERIODS, description: 'period of gross (default annual); results always give both annual and monthly' },
            state: { type: 'string', description: 'US only: two-letter state code, e.g. TX (default CA)' },
            filingStatus: { type: 'string', enum: TAX.US_FILING, description: 'US only (default single)' },
            province: { type: 'string', description: 'Canada only: two-letter province/territory code, e.g. BC (default ON)' },
            region: { type: 'string', enum: ['england', 'scotland', 'wales', 'northern-ireland'], description: 'UK only: scotland applies Scottish income tax bands (default england)' },
          },
          required: ['country', 'gross'],
        },
        run: (a) => TAX.takeHomePay(a),
        freshness: 'live',
        openWorld: true,
        frontDoor: true,
        cite: (a) => ({ path: 'tax/take-home', query: { country: a.country, gross: a.gross, period: a.period, state: a.state, filingStatus: a.filingStatus, province: a.province, region: a.region } }),
      },
    ],
  },

  coverage: () => ({
    tool: 'take_home_pay',
    countries: Object.fromEntries(
      Object.entries(TAX.COUNTRIES).map(([k, c]) => [k, { name: c.name, currency: c.currency, taxYear: c.taxYear, computed: Boolean(c.calculatorId), calculator: c.page }]),
    ),
    options: { us: ['state', 'filingStatus'], ca: ['province'], uk: ['region'] },
    scope: 'single employee on employment income; live proxy to the LifeByNumbers salary calculators (same operator); defaults fix voluntary pensions at zero and standard allowances — see each result\'s assumptions',
    notCovered: [
      'Spain (es): lifebynumbers.net computes it client-side, no backend calculator — returns covered:false',
      'self-employment, dividends, capital gains, benefits in kind',
      'UK student loans, NHS/Teachers pensions, tax codes other than 1257L (available on the calculator page, not exposed here)',
      'US local/city taxes and state standard deductions (state tax is a simplified flat rate)',
      'Canadian provinces other than Ontario use a single simplified rate',
      'Indian old regime, German tax classes 2-6 / church tax, French quotient familial above 1 part, Polish youth relief / PPK, Brazilian dependents / 13th salary',
    ],
  }),

  freshness: 'live',
  changelog: null,
  discovery: null,
  sources: () => [],

  rest: [
    {
      path: 'tax/take-home', tool: 'take_home_pay',
      args: (q) => ({ country: q.country, gross: q.gross, period: q.period, state: q.state, filingStatus: q.filingStatus, province: q.province, region: q.region }),
      required: ['country', 'gross'], numeric: ['gross'],
    },
  ],

  hub: {
    coverage: 'take-home-pay countries',
    catalogue: 'take-home pay for ten countries',
  },

  docs: {
    readme: {
      roadmapRow: '| **Take-home pay** — `take_home_pay` for us, uk, ca, au, in, br, de, fr, pl (+ es listed, covered:false): live proxy to the LifeByNumbers salary calculators (same operator), uniform shape (gross/net/deductions annual + monthly, typed breakdown, taxYear, assumptions). Listed at the front door — the highest-frequency money question after rates | `/api/mcp/tax` | **v1 — built 2026-10-03** |',
      catalogueRow: '| `/api/mcp/tax` | `take_home_pay` — country ∈ {us, uk, ca, au, in, br, de, es, fr, pl}, gross (annual, or monthly with `period`), optional `state`/`filingStatus` (US), `province` (CA), `region` (UK) | live proxy → LifeByNumbers Lambda `POST /calculate {calculatorId:\'<cc>-salary\', input}` (8 s timeout, UA `databutler-hub/1.0`); contract + per-country fields + tax years documented in `api/_tax.js`. **Spain returns `covered:false`** — lifebynumbers.net computes it client-side, no backend calculator. Tax years are hard-coded upstream and mirrored in `_tax.js` `COUNTRIES[].taxYear`: re-check when LBN updates rates |',
    },
    llms: {
      rest: [
        '- `GET https://databutler.dev/api/tax/take-home?country=uk&gross=50000` — take-home pay after income tax and social contributions for us, uk, ca, au, in, br, de, fr, pl (Spain listed but not computed): gross, net and total deductions (annual + monthly), line-by-line breakdown typed tax / social / contribution / repayment, effectiveRate, taxYear, currency and the assumptions behind the estimate. Live proxy to the LifeByNumbers salary calculators (same operator). Optional `period=monthly`, `state`/`filingStatus` (US), `province` (CA), `region=scotland` (UK).',
      ],
      server: '- `POST https://databutler.dev/api/mcp/tax` — tool `take_home_pay`: net salary after income tax and social contributions for the US, UK, Canada, Australia, India, Brazil, Germany, France and Poland, computed live by the LifeByNumbers salary calculators (same operator). Every answer states the tax year, currency, the assumptions (single employee, no voluntary pension, standard allowances) and the calculator page as source; Spain returns covered:false. REST mirror: `GET https://databutler.dev/api/tax/take-home?country=…&gross=…`.',
    },
    curation: [],
    index: { blurb: 'net salary for ten countries, live from lifebynumbers.net' },
    api: () => ({
      endpoints: {
        'GET /api/tax/take-home': {
          description:
            `Take-home pay after income tax and social contributions for ${TAX.COUNTRY_CODES.join(', ')}: gross, net and total ` +
            'deductions (annual + monthly), typed breakdown, effectiveRate, taxYear, currency, assumptions. Live proxy to the ' +
            'LifeByNumbers salary calculators (same operator). Spain (es) returns covered:false — no backend calculator.',
          params: {
            country: TAX.COUNTRY_CODES.join(' | '), gross: 'salary in local currency (annual unless period=monthly)', period: 'annual | monthly (optional)',
            state: 'US only, e.g. TX (default CA)', filingStatus: 'US only: single | married_joint | head_of_household', province: 'Canada only, e.g. BC (default ON)',
            region: 'UK only: england | scotland',
          },
          example: 'https://databutler.dev/api/tax/take-home?country=uk&gross=50000',
        },
      },
      coverage: {
        tax: Object.fromEntries(Object.entries(TAX.COUNTRIES).map(([k, c]) => [k, c.calculatorId ? `${c.currency}, tax year ${c.taxYear} (live via lifebynumbers.net)` : 'not computed upstream — covered:false'])),
      },
      mcp: 'Remote MCP server — tool take_home_pay (live via the LifeByNumbers salary calculators).',
    }),
  },

  verify: [
    { label: 'take-home-uk', kind: 'tool', tool: 'take_home_pay', args: { country: 'uk', gross: 50000 }, assert: "(d['currency']=='GBP' and d['taxYear'] and d['net']['annual']<50000 and d['upstreamProvenance']['attribution']=='lifebynumbers.net' and d['cite']['url'].startswith('https://databutler.dev/r/tax/take-home?country=uk')) or d.get('error')=='upstream unavailable'" },
    { label: 'take-home-es', kind: 'tool', tool: 'take_home_pay', args: { country: 'es', gross: 40000 }, assert: "d['covered']==False and 'lifebynumbers.net/es/' in d['source']" },
    { label: 'take-home-bad', kind: 'tool', tool: 'take_home_pay', args: { country: 'zz', gross: 1 }, assert: "d['covered']==False and 'uk' in d['coverage']" },
    { label: 'rest-take-home', kind: 'rest', path: 'tax/take-home', query: 'country=de&gross=48000', assert: "'freshness' in d and (d.get('currency')=='EUR' or d.get('error')=='upstream unavailable')" },
    { label: 'rest-take-home-400', kind: 'rest', path: 'tax/take-home', query: 'country=uk', assert: "'missing' in d['error']" },
  ],
};
