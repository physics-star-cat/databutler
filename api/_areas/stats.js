/**
 * Area: stats — exact statistics and probability (api/_stats.js over
 * api/_statsmath.js). Pure computation: no dataset, no changelog, no sources.
 * REST is bespoke (one endpoint, ?op= selects the tool, arrays via POST body),
 * so it keeps a hand-written handler at api/_routes/stats.js.
 */
const S = require('../_stats.js');
const { BASE } = require('../_area_kit');
const { parseJsonValues } = require('../_lib');

const AREA = 'stats';
const numArray = { type: 'array', items: { type: 'number' } };

/** ?op= values on /api/stats and /r/stats → tool names. */
const OPS = {
  descriptive: 'descriptive_stats',
  distribution: 'distribution',
  'hypothesis-test': 'hypothesis_test',
  'confidence-interval': 'confidence_interval',
  'bayes-update': 'bayes_update',
  regression: 'linear_regression',
};

module.exports = {
  area: AREA,
  order: 40,
  title: 'Stats toolkit',
  short: 'exact statistics',

  server: {
    serverName: 'databutler-stats',
    description: "Exact statistics & probability: distributions, hypothesis tests, CIs, Bayesian updates, regression.",
    url: `${BASE}/api/mcp/stats`,
    instructions:
      'Exact statistics and probability from databutler.dev — use these tools instead of computing ' +
      'p-values, distribution tails, confidence intervals or Bayesian updates in your head, where ' +
      'language models are unreliable. The numerical core is validated against reference tables. Each ' +
      'result includes the assumptions it relies on; surface those, and cite https://databutler.dev/.',
    tools: [
      {
        name: 'descriptive_stats',
        title: 'Descriptive statistics',
        description: 'Summary statistics for a numeric array: mean, median, sd, variance, quartiles, IQR, skewness, min/max.',
        inputSchema: { type: 'object', properties: { data: numArray }, required: ['data'] },
        run: (a) => S.descriptive(a.data),
        freshness: 'live',
        cite: (a) => ({ path: 'stats', query: { op: 'descriptive', ...a } }),
      },
      {
        name: 'distribution',
        title: 'Probability distribution',
        description:
          'Evaluate a probability distribution (normal, t, chi2, binomial, poisson): pdf/pmf and cdf at a ' +
          'value, and/or the quantile at a probability, plus mean & variance. Params per dist: normal ' +
          '{mean,sd}, t {df}, chi2 {df}, binomial {n,p}, poisson {lambda}.',
        inputSchema: {
          type: 'object',
          properties: {
            dist: { type: 'string', enum: ['normal', 't', 'chi2', 'binomial', 'poisson'] },
            params: { type: 'object' },
            at: { type: 'number', description: 'value to evaluate pdf/pmf and cdf at' },
            p: { type: 'number', description: 'probability to get the quantile for (0-1)' },
          },
          required: ['dist'],
        },
        run: (a) => S.distribution(a),
        freshness: 'live',
        cite: (a) => ({ path: 'stats', query: { op: 'distribution', ...a } }),
      },
      {
        name: 'hypothesis_test',
        title: 'Hypothesis test',
        description:
          'Run a significance test and get the statistic, p-value, and a plain-language interpretation with ' +
          'assumptions. test = one-sample-t {data, mu0}, two-sample-t {data1, data2}, one-proportion-z ' +
          '{successes, n, p0}, two-proportion-z {successes1,n1,successes2,n2}, chi2-gof {observed, expected?}, ' +
          'chi2-independence {table}. Optional tail: two-sided (default) | greater | less; alpha default 0.05.',
        inputSchema: {
          type: 'object',
          properties: {
            test: { type: 'string' }, data: numArray, data1: numArray, data2: numArray,
            mu0: { type: 'number' }, successes: { type: 'number' }, n: { type: 'number' }, p0: { type: 'number' },
            successes1: { type: 'number' }, n1: { type: 'number' }, successes2: { type: 'number' }, n2: { type: 'number' },
            observed: numArray, expected: numArray, table: { type: 'array' },
            tail: { type: 'string' }, alpha: { type: 'number' },
          },
          required: ['test'],
        },
        run: (a) => S.hypothesisTest(a),
        freshness: 'live',
        cite: (a) => ({ path: 'stats', query: { op: 'hypothesis-test', ...a } }),
      },
      {
        name: 'confidence_interval',
        title: 'Confidence interval',
        description:
          'Confidence interval for a mean (t-based; from data, or n/mean/sd) or a proportion (Wilson; ' +
          'successes/n). kind = mean | proportion; confidence default 0.95.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['mean', 'proportion'] }, confidence: { type: 'number' },
            data: numArray, n: { type: 'number' }, mean: { type: 'number' }, sd: { type: 'number' }, successes: { type: 'number' },
          },
        },
        run: (a) => S.confidenceInterval(a),
        freshness: 'live',
        cite: (a) => ({ path: 'stats', query: { op: 'confidence-interval', ...a } }),
      },
      {
        name: 'bayes_update',
        title: 'Bayesian update',
        description:
          'Discrete Bayesian update: given competing hypotheses each with a prior and the likelihood of the ' +
          'observed evidence, return normalised posteriors. Priors are renormalised to sum to 1.',
        inputSchema: {
          type: 'object',
          properties: {
            hypotheses: {
              type: 'array',
              items: { type: 'object', properties: { name: { type: 'string' }, prior: { type: 'number' }, likelihood: { type: 'number' } }, required: ['prior', 'likelihood'] },
            },
          },
          required: ['hypotheses'],
        },
        run: (a) => S.bayesUpdate(a),
        freshness: 'live',
        cite: (a) => ({ path: 'stats', query: { op: 'bayes-update', ...a } }),
      },
      {
        name: 'linear_regression',
        title: 'Linear regression',
        description: 'Simple linear regression of y on x: slope, intercept, r, r², slope std error and p-value, equation.',
        inputSchema: { type: 'object', properties: { x: numArray, y: numArray }, required: ['x', 'y'] },
        run: (a) => S.linearRegression(a),
        freshness: 'live',
        cite: (a) => ({ path: 'stats', query: { op: 'regression', ...a } }),
      },
    ],
  },

  coverage: () => ({
    tools: Object.values(OPS),
    distributions: ['normal', 't', 'chi2', 'binomial', 'poisson'],
    tests: ['one-sample-t', 'two-sample-t', 'one-proportion-z', 'two-proportion-z', 'chi2-gof', 'chi2-independence'],
    notCovered: ['ANOVA', 'non-parametric tests (Mann-Whitney, Wilcoxon)', 'multiple regression', 'power analysis'],
  }),

  freshness: 'live',
  changelog: null,
  discovery: null,
  sources: () => [],

  // Bespoke REST: api/_routes/stats.js (op dispatch, JSON body for arrays).
  rest: [{ path: 'stats', handler: 'stats' }],
  // The citation page picks the tool from ?op= and JSON-decodes array/number values.
  cite: {
    stats: {
      tool: (q) => OPS[q.op],
      args: (q) => { const { op, ...rest } = parseJsonValues(q); return rest; },
      hint: `needs a valid op: ${Object.keys(OPS).join(', ')}`,
    },
  },

  hub: {
    coverage: 'stats operations',
    catalogue: 'exact statistics',
    call: 'exact statistics (distribution, hypothesis_test, confidence_interval, bayes_update, linear_regression, descriptive_stats)',
  },

  docs: {
    readme: {
      roadmapRow: '| **Stats toolkit** — exact statistics & probability (Claude\'s maths pick) — distributions, hypothesis tests, CIs, Bayes, regression; reference-validated | `/api/mcp/stats` | **v1 — LIVE** |',
      catalogueRow: '| `/api/mcp/stats` | `descriptive_stats`, `distribution`, `hypothesis_test`, `confidence_interval`, `bayes_update`, `linear_regression` | pure computation, reference-validated |',
    },
    llms: {
      rest: [],
      server: '- `POST https://databutler.dev/api/mcp/stats` — exact statistics & probability (the maths agents get wrong in their head): `descriptive_stats`, `distribution` (normal/t/chi2/binomial/poisson pdf-cdf-quantile), `hypothesis_test` (t/z/proportion/chi-square with p-value + assumptions), `confidence_interval`, `bayes_update`, `linear_regression`. Numerical core validated against reference tables. REST mirror: `GET https://databutler.dev/api/stats?op=…`.',
    },
    curation: [],
    index: { blurb: null },
    api: () => ({
      endpoints: {
        'GET|POST /api/stats': {
          description:
            'Exact statistics & probability — for the maths agents get wrong in their head. ?op= one of: ' +
            'descriptive, distribution, hypothesis-test, confidence-interval, bayes-update, regression. ' +
            'Array/table inputs via POST JSON body. Numerical core validated against reference tables.',
          example: 'https://databutler.dev/api/stats?op=distribution&dist=normal&at=1.96',
        },
      },
      mcp: 'Remote MCP server — descriptive_stats, distribution, hypothesis_test, confidence_interval, bayes_update, linear_regression.',
    }),
  },

  facts: null, // publishes no Verified Facts (/f/<key>); see api/_areas/README.md "facts"

  verify: [
    { label: 'call-stats', kind: 'tool', tool: 'distribution', args: { dist: 'normal', at: 1.96 }, assert: "abs(d['cdf']-0.975)<0.001 and d['cite']['url'].startswith('https://databutler.dev/r/stats?op=distribution')" },
  ],

  OPS,
};
