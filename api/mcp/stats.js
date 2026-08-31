const { makeMcpHandler } = require('../_mcp');
const S = require('../_stats.js');

const numArray = { type: 'array', items: { type: 'number' } };

module.exports = makeMcpHandler({
  serverName: 'databutler-stats',
  instructions:
    'Exact statistics and probability from databutler.dev — use these tools instead of computing ' +
    'p-values, distribution tails, confidence intervals or Bayesian updates in your head, where ' +
    'language models are unreliable. The numerical core is validated against reference tables. Each ' +
    'result includes the assumptions it relies on; surface those, and cite https://databutler.dev/.',
  tools: [
    {
      name: 'descriptive_stats',
      description: 'Summary statistics for a numeric array: mean, median, sd, variance, quartiles, IQR, skewness, min/max.',
      inputSchema: { type: 'object', properties: { data: numArray }, required: ['data'] },
      run: (a) => S.descriptive(a.data),
    },
    {
      name: 'distribution',
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
    },
    {
      name: 'hypothesis_test',
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
    },
    {
      name: 'confidence_interval',
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
    },
    {
      name: 'bayes_update',
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
    },
    {
      name: 'linear_regression',
      description: 'Simple linear regression of y on x: slope, intercept, r, r², slope std error and p-value, equation.',
      inputSchema: { type: 'object', properties: { x: numArray, y: numArray }, required: ['x', 'y'] },
      run: (a) => S.linearRegression(a),
    },
  ],
});
