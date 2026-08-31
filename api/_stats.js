/**
 * Statistics toolkit — the reasoning layer over _statsmath.js. Returns
 * structured results plus a plain-language interpretation and the
 * assumptions each method relies on. Numerical core is reference-validated.
 */
const M = require('./_statsmath.js');
const { round } = M;

const NOTE =
  'Computed from exact formulae (numerical core validated against reference tables). ' +
  'The interpretation is a guide, not a substitute for statistical judgement on ' +
  'high-stakes decisions — check the assumptions field.';

function nums(arr) {
  if (!Array.isArray(arr)) throw new Error('expected an array of numbers');
  const out = arr.map(Number);
  if (out.some((x) => !Number.isFinite(x))) throw new Error('array contains non-numbers');
  if (!out.length) throw new Error('array is empty');
  return out;
}

/* ---- descriptive ---- */
function descriptive(data) {
  const x = nums(data).slice().sort((a, b) => a - b);
  const n = x.length;
  const mean = x.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? x.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const q = (p) => {
    const idx = (n - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return x[lo] + (idx - lo) * (x[hi] - x[lo]);
  };
  const median = q(0.5);
  const skew = n > 2 && sd > 0
    ? (n / ((n - 1) * (n - 2))) * x.reduce((s, v) => s + ((v - mean) / sd) ** 3, 0)
    : 0;
  return {
    n, mean: round(mean), median: round(median), sd: round(sd), variance: round(variance),
    min: x[0], max: x[n - 1], q1: round(q(0.25)), q3: round(q(0.75)), iqr: round(q(0.75) - q(0.25)),
    skewness: round(skew), sum: round(x.reduce((s, v) => s + v, 0)),
    note: NOTE,
  };
}

/* ---- distributions ---- */
function distribution({ dist, params = {}, at, p }) {
  const d = String(dist || '').toLowerCase();
  const out = { dist: d, params };
  const contWith = (pdf, cdf, quant, mean, variance) => {
    if (at !== undefined) { out.pdf = round(pdf(Number(at))); out.cdf = round(cdf(Number(at))); }
    if (p !== undefined) out.quantile = round(quant(Number(p)));
    out.mean = round(mean); out.variance = round(variance);
  };
  const discreteWith = (pmf, cdf, quant, mean, variance) => {
    if (at !== undefined) { out.pmf = round(pmf(Number(at))); out.cdf = round(cdf(Number(at))); }
    if (p !== undefined) out.quantile = quant(Number(p));
    out.mean = round(mean); out.variance = round(variance);
  };
  if (d === 'normal') {
    const mu = Number(params.mean ?? 0), sd = Number(params.sd ?? 1);
    contWith(
      (v) => M.normalPdf((v - mu) / sd) / sd,
      (v) => M.normalCdf((v - mu) / sd),
      (pp) => mu + sd * M.normalInv(pp), mu, sd * sd);
  } else if (d === 't') {
    const v = Number(params.df); if (!(v > 0)) throw new Error('t needs df>0');
    contWith(
      () => { throw new Error('pdf not provided for t; use cdf/quantile'); },
      (x) => M.tCdf(x, v),
      (pp) => { let lo = -100, hi = 100; for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; M.tCdf(mid, v) < pp ? (lo = mid) : (hi = mid); } return (lo + hi) / 2; },
      0, v > 2 ? v / (v - 2) : Infinity);
    if (at !== undefined) delete out.pdf;
  } else if (d === 'chi2' || d === 'chisquare') {
    const k = Number(params.df); if (!(k > 0)) throw new Error('chi2 needs df>0');
    if (at !== undefined) out.cdf = round(M.chi2Cdf(Number(at), k));
    if (p !== undefined) { let lo = 0, hi = 1e5; for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; M.chi2Cdf(mid, k) < Number(p) ? (lo = mid) : (hi = mid); } out.quantile = round((lo + hi) / 2); }
    out.mean = k; out.variance = 2 * k;
  } else if (d === 'binomial') {
    const n = Number(params.n), pr = Number(params.p);
    if (!(n >= 0) || !(pr >= 0 && pr <= 1)) throw new Error('binomial needs n>=0, 0<=p<=1');
    discreteWith((x) => M.binomPmf(x, n, pr), (x) => M.binomCdf(x, n, pr),
      (pp) => { let k = 0; while (M.binomCdf(k, n, pr) < pp && k <= n) k++; return k; }, n * pr, n * pr * (1 - pr));
  } else if (d === 'poisson') {
    const lam = Number(params.lambda ?? params.mean);
    if (!(lam >= 0)) throw new Error('poisson needs lambda>=0');
    discreteWith((x) => M.poissonPmf(x, lam), (x) => M.poissonCdf(x, lam),
      (pp) => { let k = 0; while (M.poissonCdf(k, lam) < pp && k < 1e6) k++; return k; }, lam, lam);
  } else {
    throw new Error('dist must be one of: normal, t, chi2, binomial, poisson');
  }
  out.note = NOTE;
  return out;
}

/* ---- hypothesis tests ---- */
function twoTail(cdf, stat) { return round(2 * Math.min(cdf, 1 - cdf), 6); }
function verdict(pv, alpha = 0.05) {
  return pv < alpha
    ? `p=${pv} < ${alpha}: reject the null hypothesis (statistically significant at the ${alpha} level).`
    : `p=${pv} ≥ ${alpha}: do not reject the null (not statistically significant at the ${alpha} level).`;
}

function hypothesisTest(args) {
  const t = String(args.test || '').toLowerCase();
  const alpha = Number(args.alpha ?? 0.05);
  const tail = args.tail || 'two-sided'; // 'two-sided'|'greater'|'less'

  const pFromCdf = (cdf) =>
    tail === 'greater' ? round(1 - cdf, 6) : tail === 'less' ? round(cdf, 6) : twoTail(cdf);

  if (t === 'one-sample-t' || t === 't') {
    const x = nums(args.data);
    const n = x.length, mu0 = Number(args.mu0 ?? 0);
    const mean = x.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(x.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
    const se = sd / Math.sqrt(n), stat = (mean - mu0) / se, df = n - 1;
    const pv = pFromCdf(M.tCdf(stat, df));
    return { test: 'one-sample t-test', statistic: round(stat), df, pValue: pv, sampleMean: round(mean), mu0, tail,
      interpretation: verdict(pv, alpha), assumptions: ['data approximately normal or n large', 'observations independent'], note: NOTE };
  }
  if (t === 'two-sample-t' || t === 'welch') {
    const a = nums(args.data1), b = nums(args.data2);
    const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
    const va = a.reduce((s, v) => s + (v - ma) ** 2, 0) / (a.length - 1);
    const vb = b.reduce((s, v) => s + (v - mb) ** 2, 0) / (b.length - 1);
    const se = Math.sqrt(va / a.length + vb / b.length);
    const stat = (ma - mb) / se;
    const df = (va / a.length + vb / b.length) ** 2 /
      ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1));
    const pv = pFromCdf(M.tCdf(stat, df));
    return { test: "Welch's two-sample t-test", statistic: round(stat), df: round(df, 2), pValue: pv,
      mean1: round(ma), mean2: round(mb), tail, interpretation: verdict(pv, alpha),
      assumptions: ['each group approximately normal or large', 'independent samples (unequal variances allowed)'], note: NOTE };
  }
  if (t === 'one-proportion-z' || t === 'proportion') {
    const x = Number(args.successes), n = Number(args.n), p0 = Number(args.p0);
    const phat = x / n, se = Math.sqrt((p0 * (1 - p0)) / n), stat = (phat - p0) / se;
    const pv = pFromCdf(M.normalCdf(stat));
    return { test: 'one-proportion z-test', statistic: round(stat), pValue: pv, sampleProportion: round(phat), p0, tail,
      interpretation: verdict(pv, alpha), assumptions: ['n·p0 ≥ 10 and n·(1−p0) ≥ 10', 'independent trials'], note: NOTE };
  }
  if (t === 'two-proportion-z') {
    const x1 = Number(args.successes1), n1 = Number(args.n1), x2 = Number(args.successes2), n2 = Number(args.n2);
    const p1 = x1 / n1, p2 = x2 / n2, ppool = (x1 + x2) / (n1 + n2);
    const se = Math.sqrt(ppool * (1 - ppool) * (1 / n1 + 1 / n2)), stat = (p1 - p2) / se;
    const pv = pFromCdf(M.normalCdf(stat));
    return { test: 'two-proportion z-test', statistic: round(stat), pValue: pv, p1: round(p1), p2: round(p2), tail,
      interpretation: verdict(pv, alpha), assumptions: ['each group ≥ ~10 successes and failures', 'independent samples'], note: NOTE };
  }
  if (t === 'chi2-gof' || t === 'goodness-of-fit') {
    const obs = nums(args.observed);
    const total = obs.reduce((s, v) => s + v, 0);
    const exp = args.expected ? nums(args.expected) : obs.map(() => total / obs.length);
    const stat = obs.reduce((s, o, i) => s + (o - exp[i]) ** 2 / exp[i], 0);
    const df = obs.length - 1, pv = round(1 - M.chi2Cdf(stat, df), 6);
    return { test: 'chi-square goodness-of-fit', statistic: round(stat), df, pValue: pv,
      interpretation: verdict(pv, alpha), assumptions: ['expected counts ≥ ~5 in each cell', 'independent observations'], note: NOTE };
  }
  if (t === 'chi2-independence' || t === 'contingency') {
    const table = args.table; // 2D array of counts
    if (!Array.isArray(table) || !Array.isArray(table[0])) throw new Error('table must be a 2D array of counts');
    const rows = table.length, cols = table[0].length;
    const rowSums = table.map((r) => r.reduce((s, v) => s + Number(v), 0));
    const colSums = table[0].map((_, j) => table.reduce((s, r) => s + Number(r[j]), 0));
    const grand = rowSums.reduce((s, v) => s + v, 0);
    let stat = 0;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const e = (rowSums[i] * colSums[j]) / grand;
      stat += (Number(table[i][j]) - e) ** 2 / e;
    }
    const df = (rows - 1) * (cols - 1), pv = round(1 - M.chi2Cdf(stat, df), 6);
    return { test: 'chi-square test of independence', statistic: round(stat), df, pValue: pv,
      interpretation: verdict(pv, alpha), assumptions: ['expected counts ≥ ~5 in most cells', 'independent observations'], note: NOTE };
  }
  throw new Error('test must be one of: one-sample-t, two-sample-t, one-proportion-z, two-proportion-z, chi2-gof, chi2-independence');
}

/* ---- confidence intervals ---- */
function confidenceInterval(args) {
  const conf = Number(args.confidence ?? 0.95);
  const kind = String(args.kind || (args.data ? 'mean' : 'proportion')).toLowerCase();
  if (kind === 'mean') {
    let n, mean, sd;
    if (args.data) { const x = nums(args.data); n = x.length; mean = x.reduce((s, v) => s + v, 0) / n; sd = Math.sqrt(x.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)); }
    else { n = Number(args.n); mean = Number(args.mean); sd = Number(args.sd); }
    // t critical
    const alpha = 1 - conf, df = n - 1;
    let lo = 0, hi = 100; for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; M.tCdf(mid, df) < 1 - alpha / 2 ? (lo = mid) : (hi = mid); }
    const tcrit = (lo + hi) / 2, me = tcrit * (sd / Math.sqrt(n));
    return { kind: 'mean', confidence: conf, estimate: round(mean), lower: round(mean - me), upper: round(mean + me), marginOfError: round(me), df, note: NOTE };
  }
  // proportion (Wilson)
  const x = Number(args.successes), n = Number(args.n), phat = x / n;
  const z = M.normalInv(1 - (1 - conf) / 2);
  const denom = 1 + (z * z) / n;
  const centre = (phat + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n))) / denom;
  return { kind: 'proportion (Wilson)', confidence: conf, estimate: round(phat), lower: round(Math.max(0, centre - half)), upper: round(Math.min(1, centre + half)), note: NOTE };
}

/* ---- Bayesian update (discrete) ---- */
function bayesUpdate(args) {
  const hyp = args.hypotheses;
  if (!Array.isArray(hyp) || !hyp.length) throw new Error('hypotheses must be a non-empty array of {name, prior, likelihood}');
  const priorSum = hyp.reduce((s, h) => s + Number(h.prior), 0);
  const joint = hyp.map((h) => (Number(h.prior) / priorSum) * Number(h.likelihood));
  const evidence = joint.reduce((s, v) => s + v, 0);
  if (evidence <= 0) throw new Error('total evidence is zero — check likelihoods');
  return {
    evidence: round(evidence),
    posteriors: hyp.map((h, i) => ({ name: h.name ?? `H${i + 1}`, prior: round(Number(h.prior) / priorSum), posterior: round(joint[i] / evidence) })),
    note: 'Discrete Bayes: posterior ∝ prior × likelihood, normalised. Priors renormalised to sum to 1. ' + NOTE,
  };
}

/* ---- simple linear regression ---- */
function linearRegression(args) {
  const x = nums(args.x), y = nums(args.y);
  if (x.length !== y.length) throw new Error('x and y must be the same length');
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2; }
  const slope = sxy / sxx, intercept = my - slope * mx;
  const r = sxy / Math.sqrt(sxx * syy), r2 = r * r;
  const sse = syy - slope * sxy, seSlope = Math.sqrt(sse / (n - 2) / sxx);
  const tstat = slope / seSlope, pv = twoTail(M.tCdf(tstat, n - 2));
  return { n, slope: round(slope), intercept: round(intercept), r: round(r), rSquared: round(r2),
    slopeStdError: round(seSlope), slopePValue: pv, equation: `y = ${round(slope, 4)}·x + ${round(intercept, 4)}`,
    interpretation: `r²=${round(r2, 4)} — the model explains ${round(r2 * 100, 1)}% of the variance in y. Slope p=${pv}.`, note: NOTE };
}

module.exports = { descriptive, distribution, hypothesisTest, confidenceInterval, bayesUpdate, linearRegression };
