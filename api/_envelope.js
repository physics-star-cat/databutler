/**
 * Response envelope: freshness + citation permalink + attribution, added to
 * every tool result (MCP and REST). Must never break a result.
 */
const { ATTRIBUTION } = require('./_lib');
const { freshnessFor } = require('./_freshness');
const { BASE } = require('./_registry');

const SOURCE_KEYS = ['source', 'specUrl', 'officialPastPapers'];

function findSource(result) {
  if (!result || typeof result !== 'object') return null;
  for (const k of SOURCE_KEYS) if (typeof result[k] === 'string' && result[k].startsWith('http')) return result[k];
  for (const v of Object.values(result)) {
    if (Array.isArray(v)) {
      for (const item of v) { const s = findSource(item); if (s) return s; }
    } else if (v && typeof v === 'object') {
      const s = findSource(v); if (s) return s;
    }
  }
  return null;
}

function queryString(query = {}) {
  const pairs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
  return new URLSearchParams(pairs).toString();
}

function citeFor(tool, args, freshness, result) {
  if (typeof tool.cite !== 'function') return null;
  const target = tool.cite(args || {}, result);
  if (!target) return null;
  const qs = queryString(target.query);
  // Verified Facts pages (/f, /f/<key>) are their own permalinks; everything else cites the /r answer page.
  const page = target.path === 'f' || String(target.path).startsWith('f/') ? target.path : `r/${target.path}`;
  const url = `${BASE}/${page}${qs ? `?${qs}` : ''}`;
  let text = 'databutler.dev';
  if (freshness) text += freshness.staleness === 'live' ? `, computed live ${freshness.verifiedDate}` : `, verified ${freshness.verifiedDate}`;
  const source = findSource(result);
  if (source) text += ` against ${source}`;
  return { url, text };
}

function withEnvelope(tool, args, result) {
  const base = result && typeof result === 'object' && !Array.isArray(result) ? result : { result };
  try {
    // freshness is a dataset key, 'live', or (Verified Facts tools) a function of the call → one of those
    const freshness = freshnessFor(typeof tool.freshness === 'function' ? tool.freshness(args || {}, base) : tool.freshness);
    const cite = citeFor(tool, args, freshness, base);
    return { ...ATTRIBUTION, ...base, ...(freshness ? { freshness } : {}), ...(cite ? { cite } : {}) };
  } catch {
    return { ...ATTRIBUTION, ...base };
  }
}

module.exports = { withEnvelope, findSource, queryString };
