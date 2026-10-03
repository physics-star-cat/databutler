/**
 * Freshness block for the response envelope. Every committed dataset declares
 * verifiedDate and nextScheduledRefresh in its JSON (see docs/CURATION.md
 * calendar); the datasets themselves come from the area modules' `freshness`
 * (api/_areas.js datasets()), keyed by dataset key — an area's slug, or the
 * per-dataset keys of a multi-dataset area such as vehicles.
 */
const { datasets } = require('./_areas');

const DUE_WINDOW_DAYS = 14;
const DATASETS = Object.fromEntries(datasets().map((d) => [d.key, d.data]));

function freshnessFor(dataset, now = new Date()) {
  if (dataset === 'live') {
    return { verifiedDate: now.toISOString().slice(0, 10), nextScheduledRefresh: null, staleness: 'live' };
  }
  const d = DATASETS[dataset];
  if (!d) return null;
  const { verifiedDate, nextScheduledRefresh } = d;
  const next = new Date(`${nextScheduledRefresh}T00:00:00Z`);
  const daysPast = Math.floor((now - next) / 86400000);
  const staleness = daysPast < 0 ? 'fresh' : daysPast <= DUE_WINDOW_DAYS ? 'due' : 'overdue';
  return { verifiedDate, nextScheduledRefresh, staleness };
}

module.exports = { freshnessFor, DUE_WINDOW_DAYS, DATASETS };
