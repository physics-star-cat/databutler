/**
 * Freshness block for the response envelope. Datasets declare verifiedDate
 * and nextScheduledRefresh in their JSON (see docs/CURATION.md calendar).
 */
const { RATES, AQA_GCSE } = require('./_lib');
const FR_RECALLS = require('../data/vehicles/fr-recalls.json');
const JP_RECALLS = require('../data/vehicles/jp-recalls.json');
const UK_RECALLS = require('../data/vehicles/uk-recalls.json');
const SOFTWARE_EOL = require('../data/software-eol.json');

const DUE_WINDOW_DAYS = 14;
const DATASETS = {
  'uk-rates': RATES,
  'uk-exams': AQA_GCSE,
  'fr-recalls': FR_RECALLS,
  'jp-recalls': JP_RECALLS,
  'uk-recalls': UK_RECALLS,
  'software-eol': SOFTWARE_EOL, // nextScheduledRefresh = verifiedDate + 35 days (scripts/software-eol.js), so `due` begins 35 days after the fetch
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
