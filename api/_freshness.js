/**
 * Freshness block for the response envelope. Datasets declare verifiedDate
 * and nextScheduledRefresh in their JSON (see docs/CURATION.md calendar).
 */
const { RATES, AQA_GCSE } = require('./_lib');

const DUE_WINDOW_DAYS = 14;
const DATASETS = {
  'uk-rates': RATES,
  'uk-exams': AQA_GCSE,
};

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
