/** Tiny string-similarity helpers shared by provenance and near-miss answers. */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/** Closest candidates to needle: substring matches first, then by edit distance. */
function nearest(needle, candidates, max = 3) {
  const q = String(needle || '').toLowerCase().trim();
  if (!q) return [];
  const scored = candidates.map((c) => {
    const s = String(c).toLowerCase();
    const sub = s.includes(q) || q.includes(s) ? 0 : 1;
    return { c, sub, d: levenshtein(q, s) };
  });
  scored.sort((x, y) => x.sub - y.sub || x.d - y.d || String(x.c).localeCompare(String(y.c)));
  return scored.slice(0, max).map((x) => x.c);
}

module.exports = { levenshtein, nearest };
