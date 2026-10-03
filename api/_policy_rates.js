/**
 * Central-bank policy rates: Bank of England Bank Rate, US Federal Reserve
 * federal funds target range, ECB key interest rates. Committed data
 * (data/policy-rates.json), not a live proxy — the uk-rates pattern: each
 * figure was read from the bank's own page on verifiedDate, the changelog
 * records every move, and the weekly watcher re-checks the source pages.
 */
const POLICY = require('../data/policy-rates.json');
const { nearest } = require('./_text');

const BANKS = Object.keys(POLICY.banks); // boe, fed, ecb

/** Common names an agent might pass instead of the key. All lower-case. */
const ALIASES = {
  boe: ['boe', 'bank of england', 'bankofengland', 'bank-of-england', 'uk', 'gb', 'gbp', 'bank rate', 'mpc', 'england', 'britain', 'united kingdom'],
  fed: ['fed', 'federal reserve', 'federalreserve', 'the fed', 'fomc', 'us', 'usa', 'usd', 'united states', 'federal funds', 'fed funds', 'us federal reserve'],
  ecb: ['ecb', 'european central bank', 'europeancentralbank', 'euro area', 'eurozone', 'euro', 'eur', 'eu', 'europe', 'deposit facility'],
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function resolveBank(input) {
  const q = norm(input);
  if (!q) return null;
  if (POLICY.banks[q]) return q;
  for (const [key, names] of Object.entries(ALIASES)) if (names.includes(q)) return key;
  return null;
}

/** Closest bank keys to an unknown input, via every alias, deduped to keys. */
function nearestBanks(input, max = 3) {
  const pairs = Object.entries(ALIASES).flatMap(([key, names]) => names.map((n) => [n, key]));
  const byAlias = new Map(pairs);
  const hits = nearest(norm(input), pairs.map(([n]) => n), pairs.length);
  const keys = [];
  for (const h of hits) {
    const k = byAlias.get(h);
    if (k && !keys.includes(k)) keys.push(k);
    if (keys.length === max) break;
  }
  return keys;
}

function bankResult(key) {
  const b = POLICY.banks[key];
  return { bank: key, ...b, unit: POLICY.unit };
}

function listing() {
  return {
    banks: Object.fromEntries(BANKS.map((k) => [k, `${POLICY.banks[k].name} — ${POLICY.banks[k].rateName}`])),
    verifiedDate: POLICY.verifiedDate,
    usage: 'pass bank=boe|fed|ecb for the figures, or all: true for every bank',
  };
}

/**
 * The tool. { bank } → one bank; { all: true } or bank "all" → every bank;
 * nothing → the listing; unknown bank → covered:false with nearest keys.
 */
function policyRate({ bank, all } = {}) {
  const wantAll = all === true || norm(all) === 'true' || norm(bank) === 'all';
  if (wantAll) {
    return {
      count: BANKS.length,
      banks: BANKS.map(bankResult),
      unit: POLICY.unit,
      verifiedDate: POLICY.verifiedDate,
      refreshRule: POLICY.refreshRule,
    };
  }
  if (norm(bank) === '') return listing();
  const key = resolveBank(bank);
  if (!key) {
    return {
      covered: false,
      requested: bank,
      message: `unknown bank "${bank}" — Data Butler serves ${BANKS.map((k) => `${k} (${POLICY.banks[k].name})`).join(', ')}`,
      nearest: nearestBanks(bank),
      coverage: BANKS,
      notCovered: NOT_COVERED,
    };
  }
  return bankResult(key);
}

const NOT_COVERED = [
  'other central banks: Bank of Japan, Swiss National Bank, Bank of Canada, Reserve Bank of Australia, Reserve Bank of New Zealand, Sveriges Riksbank, Norges Bank, People\'s Bank of China, Reserve Bank of India',
  'full historical rate series (only the current level and the previous one are served; each bank\'s history page is linked)',
  'Fed interest on reserve balances, discount rate and ON RRP rate; ECB TLTRO, APP/PEPP; BoE QT programme',
  'market-implied rate expectations and forecasts',
  'commercial lending, mortgage or savings rates',
];

function policyRatesCoverage() {
  return {
    tool: 'policy_rate',
    banks: Object.fromEntries(BANKS.map((k) => {
      const b = POLICY.banks[k];
      return [k, { name: b.name, rateName: b.rateName, figures: b.figures.map((f) => f.key), currency: b.currency, nextDecision: b.nextDecision, source: b.source }];
    })),
    verifiedDate: POLICY.verifiedDate,
    nextScheduledRefresh: POLICY.nextScheduledRefresh,
    scope: 'current level, effective date, decision date and meeting, previous level, latest decision and next scheduled decision — read from each bank\'s own page; ' + POLICY.refreshRule,
    notCovered: NOT_COVERED,
  };
}

module.exports = { POLICY, BANKS, ALIASES, resolveBank, nearestBanks, policyRate, policyRatesCoverage, NOT_COVERED };
