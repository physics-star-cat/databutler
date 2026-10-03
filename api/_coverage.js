/**
 * What is — and explicitly is not — covered, per area. The notCovered lists
 * mirror the README roadmap/expansion queue; keep them in sync when scope grows.
 */
const { RATES, findSpecs } = require('./_lib');
const { SERVERS } = require('./_registry');
const { nearest } = require('./_text');
const { vehiclesCoverage } = require('./_vehicles');
const TAX = require('./_tax');
const { policyRatesCoverage } = require('./_policy_rates');

const AREAS = {
  'uk-rates': () => ({
    taxYears: [RATES.taxYear],
    categories: Object.keys(RATES.categories),
    scope: 'England, Wales and Northern Ireland unless a category says otherwise; each category names its gov.uk source',
    notCovered: ['Scottish income tax bands', 'Welsh rates of income tax', 'benefits and Universal Credit', 'prior tax years (planned: one file per year)'],
  }),
  'uk-exams': () => {
    const boards = {};
    for (const sp of findSpecs({})) {
      const b = sp.board.toLowerCase(), l = sp.level.toLowerCase();
      boards[b] = boards[b] || {};
      boards[b][l] = boards[b][l] || [];
      boards[b][l].push(sp.subject);
    }
    return {
      boards,
      notCovered: ['Edexcel', 'OCR', 'WJEC/Eduqas', 'SQA', 'A-level (any board)', 'English Language/Literature set-text mapping', 'IB and AP'],
      queue: 'Edexcel GCSE sciences/maths → OCR → A-level sciences/maths → English set texts (docs/CURATION.md)',
    };
  },
  provenance: () => ({
    domains: 'any registrable domain (live RDAP via rdap.org; registries may redact or rate-limit)',
    packageEcosystems: ['npm', 'pypi'],
    notCovered: ['crates.io', 'RubyGems', 'Go modules', 'Docker Hub', 'GitHub Actions', 'browser extensions', 'MCP-server listings'],
  }),
  stats: () => ({
    tools: SERVERS.stats.tools.map((t) => t.name),
    distributions: ['normal', 't', 'chi2', 'binomial', 'poisson'],
    tests: ['one-sample-t', 'two-sample-t', 'one-proportion-z', 'two-proportion-z', 'chi2-gof', 'chi2-independence'],
    notCovered: ['ANOVA', 'non-parametric tests (Mann-Whitney, Wilcoxon)', 'multiple regression', 'power analysis'],
  }),
  vehicles: vehiclesCoverage,
  tax: () => ({
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
  'policy-rates': policyRatesCoverage,
};

function coverageFor(area) {
  const key = String(area || 'all').toLowerCase().trim();
  if (key === 'all') {
    const out = { areas: Object.keys(AREAS) };
    for (const [k, fn] of Object.entries(AREAS)) out[k] = fn();
    return out;
  }
  if (!AREAS[key]) {
    return { covered: false, requested: area, nearest: nearest(key, Object.keys(AREAS)), coverage: Object.keys(AREAS) };
  }
  return { area: key, ...AREAS[key]() };
}

module.exports = { coverageFor, AREAS };
