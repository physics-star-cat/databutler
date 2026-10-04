/**
 * What is — and explicitly is not — covered, per area. Each area module's
 * coverage() supplies its block (with a notCovered list that mirrors the README
 * roadmap); this file only dispatches.
 */
const { AREAS, sourceList } = require('./_areas');
const { nearest } = require('./_text');
const { unreachableSources } = require('./_sources');
const SEEN = require('../data/sources.json');

/**
 * Each area's block, plus `unreachableSources` (derived, never written by hand) when the watcher
 * cannot read one of its source pages — so an agent knows that page is re-checked by hand only.
 */
const BLOCKED = unreachableSources(sourceList(), SEEN);
const withUnreachable = (area, fn) => () => {
  const block = fn();
  const mine = BLOCKED.filter((u) => u.area === area).map(({ url, reason }) => ({ url, reason }));
  return mine.length ? { ...block, unreachableSources: mine } : block;
};
const AREAS_BY_KEY = Object.fromEntries(AREAS.map((a) => [a.area, withUnreachable(a.area, a.coverage)]));

function coverageFor(area) {
  const key = String(area || 'all').toLowerCase().trim();
  if (key === 'all') {
    const out = { areas: Object.keys(AREAS_BY_KEY) };
    for (const [k, fn] of Object.entries(AREAS_BY_KEY)) out[k] = fn();
    return out;
  }
  if (!AREAS_BY_KEY[key]) {
    return { covered: false, requested: area, nearest: nearest(key, Object.keys(AREAS_BY_KEY)), coverage: Object.keys(AREAS_BY_KEY) };
  }
  return { area: key, ...AREAS_BY_KEY[key]() };
}

module.exports = { coverageFor, AREAS: AREAS_BY_KEY };
