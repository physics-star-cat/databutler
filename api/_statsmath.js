/**
 * Pure-JS numerical special functions and distribution CDFs behind the
 * stats vertical. Correctness is the whole product, so every function here
 * is validated against known reference values in the local test harness
 * (see verification in docs/CURATION.md). No external calls.
 *
 * References: Lanczos gamma; Numerical Recipes incomplete gamma (gammp) and
 * incomplete beta (betai) continued-fraction algorithms.
 */

const SQRT2 = Math.sqrt(2);

/* ---- gamma / log-gamma (Lanczos) ---- */
const G = 7;
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
function logGamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = LANCZOS[0];
  for (let i = 1; i < G + 2; i++) x += LANCZOS[i] / (z + i);
  const t = z + G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function logBeta(a, b) {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/* ---- error function ---- */
function erf(x) {
  // Abramowitz & Stegun 7.1.26, ~1e-7 accuracy
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/* ---- regularised lower incomplete gamma P(a,x) ---- */
function gammp(a, x) {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 0;
  if (x < a + 1) {
    // series
    let ap = a, sum = 1 / a, del = 1 / a;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // continued fraction for Q, then 1-Q
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  const Q = Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  return 1 - Q;
}

/* ---- regularised incomplete beta I_x(a,b) ---- */
function betacf(a, b, x) {
  const FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}
function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/* ---- standard distribution CDFs ---- */
const normalCdf = (z) => 0.5 * (1 + erf(z / SQRT2));
const normalPdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
// Student t, df v, cdf at t
function tCdf(t, v) {
  const x = v / (v + t * t);
  const ib = 0.5 * betai(v / 2, 0.5, x);
  return t > 0 ? 1 - ib : ib;
}
// chi-square cdf, df k
const chi2Cdf = (x, k) => (x <= 0 ? 0 : gammp(k / 2, x / 2));
// F distribution cdf
const fCdf = (x, d1, d2) => (x <= 0 ? 0 : betai(d1 / 2, d2 / 2, (d1 * x) / (d1 * x + d2)));

/* ---- inverse normal (Acklam) for quantiles/CIs ---- */
function normalInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/* ---- discrete pmfs ---- */
function logFactorial(n) { return logGamma(n + 1); }
function binomPmf(k, n, p) {
  if (k < 0 || k > n) return 0;
  return Math.exp(logFactorial(n) - logFactorial(k) - logFactorial(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}
function binomCdf(k, n, p) { let s = 0; for (let i = 0; i <= Math.floor(k); i++) s += binomPmf(i, n, p); return s; }
function poissonPmf(k, lam) { if (k < 0) return 0; return Math.exp(-lam + k * Math.log(lam) - logFactorial(k)); }
function poissonCdf(k, lam) { let s = 0; for (let i = 0; i <= Math.floor(k); i++) s += poissonPmf(i, lam); return s; }

module.exports = {
  logGamma, erf, gammp, betai, normalCdf, normalPdf, normalInv,
  tCdf, chi2Cdf, fCdf, binomPmf, binomCdf, poissonPmf, poissonCdf, round: (x, d = 6) => {
    if (!Number.isFinite(x)) return x;
    const f = 10 ** d;
    return Math.round(x * f) / f;
  },
};
