/**
 * Area: policy-rates — central-bank policy rates (Bank of England Bank Rate,
 * Fed federal funds target range, ECB key rates) as committed, changelogged,
 * source-watched data: data/policy-rates.json, logic in api/_policy_rates.js.
 * The template for a hand-curated area: edit the file against the banks' pages,
 * run `node scripts/changelog.js`, fill in the notes.
 */
const { policyRate, policyRatesCoverage, POLICY, BANKS } = require('../_policy_rates');
const { BASE, same, plusDays } = require('../_area_kit');

const AREA = 'policy-rates';
const REFRESH_DAYS = 45; // re-verified within 45 days of verifiedDate (docs/CURATION.md)

/**
 * Changelog diff: one entry per bank figure whose value moved. prev === null
 * (first commit) or a bank new to the file → the bank's own `previous` block
 * supplies the from side, so a bank's arrival records its last real change
 * (previous → current) rather than null → current. The entry's source is the
 * decision press release, not the rates page.
 */
function diffPolicyRates(prev, next) {
  const out = [];
  const entry = (bank, b, f, from, to) => ({
    area: AREA,
    key: `${bank}/${f.key}`,
    label: `${b.name}: ${f.label}`,
    from,
    to,
    unit: f.unit || '%',
    bank,
    bankName: b.name,
    decisionDate: b.decisionDate || null,
    effectiveFrom: b.effectiveFrom || null,
    source: b.decisionSource || b.source,
    verifiedDate: b.verifiedDate || next.verifiedDate,
    note: '',
  });
  for (const [bank, b] of Object.entries(next.banks || {})) {
    const p = prev && prev.banks ? prev.banks[bank] : null;
    const baseline = p ? p.figures : b.previous && b.previous.figures;
    const before = new Map((baseline || []).map((f) => [f.key, f]));
    for (const f of b.figures || []) {
      const was = before.get(f.key);
      if (was && same(was.value, f.value)) continue;
      out.push(entry(bank, b, f, was ? was.value : null, f.value));
    }
    if (p) for (const f of p.figures || []) {
      if ((b.figures || []).some((x) => x.key === f.key)) continue;
      out.push(entry(bank, b, f, f.value, null));
    }
  }
  if (prev && prev.banks) {
    for (const [bank, p] of Object.entries(prev.banks)) {
      if ((next.banks || {})[bank]) continue;
      for (const f of p.figures || []) out.push(entry(bank, { ...p, verifiedDate: next.verifiedDate }, f, f.value, null));
    }
  }
  return out;
}

/** Fact key per bank figure: the changelog key is `<bank>/<figure key>`; the fact key names the jurisdiction. */
const FACT_KEYS = {
  boe: { 'bank-rate': 'uk/bank-rate' },
  fed: { 'target-range-lower': 'us/fed-funds/lower', 'target-range-upper': 'us/fed-funds/upper' },
  ecb: { 'deposit-facility': 'eu/ecb/deposit-facility', 'main-refinancing': 'eu/ecb/main-refinancing', 'marginal-lending': 'eu/ecb/marginal-lending' },
};

/**
 * The six policy-rate facts. The current level comes from the bank's `source` page; the previous level, served
 * as its own dated record (effectiveFrom → the day before the current level took effect), was checked against
 * the bank's history table (`historySource`, else the same page) — data/policy-rates.json verificationMethod.
 */
function factEntries() {
  return BANKS.flatMap((bank) => {
    const b = POLICY.banks[bank];
    const before = new Map(((b.previous && b.previous.figures) || []).map((f) => [f.key, f]));
    return b.figures.map((f) => {
      const key = FACT_KEYS[bank][f.key];
      if (!key) throw new Error(`api/_areas/policy-rates.js: no fact key for ${bank}/${f.key} — add it to FACT_KEYS`);
      const base = { key, label: `${b.name}: ${f.label}`, unit: '% per annum', period: null };
      const verifiedDate = b.verifiedDate || POLICY.verifiedDate;
      const was = before.get(f.key);
      const historySource = b.historySource || b.source;
      const record = {
        ...base, value: f.value, effectiveFrom: b.effectiveFrom || null, effectiveTo: null, source: b.source,
        verifiedDate, nextScheduledRefresh: POLICY.nextScheduledRefresh,
        ...(was ? { previous: { value: was.value, period: null, effectiveFrom: b.previous.effectiveFrom, source: historySource } } : {}),
        scope: `${b.jurisdiction}; ${b.rateName}, set by the ${b.committee}`,
      };
      const previous = was && b.previous.effectiveFrom ? {
        ...base, value: was.value, effectiveFrom: b.previous.effectiveFrom, effectiveTo: b.effectiveFrom ? plusDays(b.effectiveFrom, -1) : null,
        source: historySource, verifiedDate, nextScheduledRefresh: POLICY.nextScheduledRefresh, scope: record.scope,
      } : null;
      return { record, previous, changelogKey: `${bank}/${f.key}`, topic: `${b.name} ${b.rateName}` };
    });
  });
}

module.exports = {
  area: AREA,
  order: 80,
  title: 'Policy rates',
  short: 'central-bank policy rates',

  server: {
    serverName: 'databutler-policy-rates',
    description: "Bank of England, Fed and ECB policy rates, read from the banks' own pages, with dates.",
    url: `${BASE}/api/mcp/policy-rates`,
    instructions:
      'Current central-bank policy rates from databutler.dev — Bank of England Bank Rate, US Federal Reserve ' +
      'federal funds target range and the ECB key interest rates — each read from the bank\'s own page on ' +
      'verifiedDate, with effectiveFrom, decisionDate, the previous level and the next scheduled decision. Use ' +
      'policy_rate instead of quoting these from memory: they move up to eight times a year and training data is ' +
      'stale by the first decision after the cutoff. Present effectiveFrom and verifiedDate with the figure, and ' +
      'check nextDecision — a result whose nextDecision has passed may have been superseded, so say so. Other ' +
      'central banks are not covered (coverage lists them). Cite https://databutler.dev/ and the source.',
    tools: [
      {
        name: 'policy_rate',
        title: 'Central-bank policy rate',
        description:
          'Current policy rate of one of three central banks, as published on the bank\'s own page: boe = Bank of ' +
          'England Bank Rate; fed = US Federal Reserve federal funds target range (lower and upper bound); ecb = ' +
          'European Central Bank deposit facility, main refinancing operations and marginal lending facility rates. ' +
          'Returns the figure(s) in % per annum, effectiveFrom, decisionDate and the meeting that set the level, the ' +
          'previous level with its effective date, the latest decision (which may be a hold), the next scheduled ' +
          'decision date, the official source page, the decision press release and verifiedDate. all: true returns ' +
          'every bank. Other central banks answer covered:false.',
        inputSchema: {
          type: 'object',
          properties: {
            bank: { type: 'string', enum: BANKS, description: 'boe | fed | ecb (common names such as "Bank of England", "FOMC" or "ECB" resolve too)' },
            all: { type: 'boolean', description: 'true returns every bank (bank may be omitted)' },
          },
        },
        run: (a) => policyRate(a),
        freshness: AREA,
        cite: (a) => ({ path: 'policy-rates', query: { bank: a.bank, all: a.all } }),
      },
    ],
  },

  coverage: policyRatesCoverage,

  // nextScheduledRefresh = verifiedDate + 45 days, stamped by scripts/changelog.js.
  freshness: { dataFile: 'data/policy-rates.json', cadenceDays: REFRESH_DAYS, data: POLICY },

  changelog: {
    diff: diffPolicyRates,
    files: ['data/policy-rates.json'],
    context: (e) => [e.bankName, e.decisionDate ? `decision ${e.decisionDate}` : ''].filter(Boolean).join(', '),
  },
  discovery: {
    description: 'Central-bank policy rates verified against the banks\' own pages: Bank of England Bank Rate, US Federal Reserve federal funds target range, ECB key interest rates (deposit facility, main refinancing, marginal lending).',
    cadence: 'After each scheduled decision (eight a year per bank); re-verified within 45 days of verifiedDate; every source page re-fetched weekly.',
  },

  sources: () => BANKS.map((k) => ({ url: POLICY.banks[k].source, label: `${POLICY.banks[k].name} — ${POLICY.banks[k].rateName}` })),

  rest: [
    // GET /api/policy-rates?bank=boe|fed|ecb|all (bank=all mirrors the tool's all: true)
    { path: 'policy-rates', tool: 'policy_rate', args: (q) => ({ bank: q.bank, ...(q.all !== undefined ? { all: q.all === 'true' || q.all === '1' } : {}) }), required: ['bank'] },
  ],

  hub: {
    changed: 'central-bank policy rates (Bank of England, Fed, ECB)',
    coverage: 'central-bank policy rates (boe, fed, ecb)',
    catalogue: 'central-bank policy rates: Bank of England, Fed, ECB',
    call: 'policy_rate (Bank of England Bank Rate, Fed federal funds target range, ECB key rates — committed data verified against the banks\' own pages)',
    frontDoor: 'Never quote a central-bank rate from memory when policy_rate covers the bank.',
  },

  docs: {
    readme: {
      roadmapRow: '| **Policy rates** — `policy_rate`: the three most-asked central-bank rates (BoE Bank Rate, Fed federal funds target range, ECB key rates) as committed, changelogged, source-watched data; the first global step of the "is this still true?" layer (#9, #12). Freshness `due` after 45 days; eight decisions a year each | `/api/mcp/policy-rates` | **v1 — built 2026-10-03** |',
      catalogueRow: '| `/api/mcp/policy-rates` | `policy_rate` — bank ∈ {boe, fed, ecb}, optional `all: true` | `data/policy-rates.json`: Bank of England Bank Rate, Fed federal funds target range (lower/upper bound), ECB deposit facility / main refinancing / marginal lending — current level, effectiveFrom, decisionDate + meeting, previous level, latest decision (may be a hold), next scheduled decision, the bank\'s own page as `source` and the decision press release. **Committed data, not a live proxy**, verified against the banks\' pages; freshness turns `due` 45 days after verifiedDate; the three source pages sit in `data/sources.json` for the weekly watcher. Refresh: edit the file against the pages, `node scripts/changelog.js` (docs/CURATION.md) |',
    },
    llms: {
      rest: [
        '- `GET https://databutler.dev/api/policy-rates?bank=boe` — current central-bank policy rates (bank = boe | fed | ecb | all): the Bank of England Bank Rate, the US Federal Reserve federal funds target range (lower and upper bound) and the ECB deposit facility, main refinancing and marginal lending rates, each with effectiveFrom, decisionDate and the meeting that set it, the previous level, the latest decision (which may be a hold), the next scheduled decision date, the bank\'s own page as source and the decision press release, and verifiedDate. Committed data verified against the banks\' pages (not a live proxy), re-verified within 45 days and after each decision.',
      ],
      server: '- `POST https://databutler.dev/api/mcp/policy-rates` — tool `policy_rate` (bank = boe | fed | ecb, or all: true): the Bank of England Bank Rate, the US Federal Reserve federal funds target range (lower and upper bound) and the ECB deposit facility, main refinancing and marginal lending rates, each with effectiveFrom, decisionDate and the meeting that set it, the previous level, the latest decision (which may be a hold), the next scheduled decision date, the bank\'s own page as source and the decision press release. Committed data verified against the banks\' pages, not a live proxy; freshness turns `due` 45 days after verifiedDate. Other central banks answer covered:false. REST mirror: `GET https://databutler.dev/api/policy-rates?bank=…`.',
    },
    curation: [
      '| `data/policy-rates.json` | Within 45 days of `verifiedDate` (freshness flips to `due`) and after every scheduled decision — BoE MPC ("Next due" on the Bank Rate page), FOMC (fomccalendars.htm), ECB Governing Council (mgcgc calendar); each decides eight times a year. The weekly watcher hashes the three bank source pages. | Open the bank\'s `source` page and the decision press release; edit `figures`, move the replaced level into `previous`, update `effectiveFrom`, `decisionDate`, `decisionMeeting`, `latestDecision`, `nextDecision`, `decisionSource` and both `verifiedDate`s; then `node scripts/changelog.js` (sets `nextScheduledRefresh` = verifiedDate + 45 days, appends one `policy-rates` entry per figure that moved, refreshes `data/sources.json`). A hold moves no figure: update `latestDecision`/`nextDecision`/`verifiedDate` only, no entry. |',
    ],
    index: { blurb: 'Bank of England, Fed and ECB policy rates, verified against the banks\' own pages' },
    api: () => ({
      endpoints: {
        'GET /api/policy-rates': {
          description:
            `Central-bank policy rates, verified ${POLICY.verifiedDate} against the banks' own pages: Bank of England Bank Rate, ` +
            'US Federal Reserve federal funds target range (lower/upper bound), ECB deposit facility, main refinancing and marginal ' +
            'lending rates — each with effectiveFrom, decisionDate and meeting, previous level, latest decision, next scheduled ' +
            'decision and the decision press release. Committed data (not a live proxy), re-verified within 45 days and after each decision.',
          params: { bank: 'boe | fed | ecb | all' },
          example: 'https://databutler.dev/api/policy-rates?bank=boe',
        },
      },
      coverage: {
        policyRates: Object.fromEntries(Object.entries(POLICY.banks).map(([k, b]) => [k, `${b.name} ${b.rateName}: ${b.figures.map((f) => f.value).join(' / ')}% from ${b.effectiveFrom}, verified ${b.verifiedDate}, next decision ${b.nextDecision}`])),
      },
      mcp: 'Remote MCP server — tool policy_rate (Bank of England, Fed, ECB; committed data verified against the banks\' own pages).',
    }),
  },

  // Verified Facts: one key per figure, namespaced by the bank's jurisdiction (api/_areas/README.md "facts").
  facts: {
    namespace: ['uk', 'us', 'eu'],
    list: factEntries,
    synonyms: { 'base rate': 'bank-rate', 'interest rate': 'bank-rate', fomc: 'fed-funds', 'federal funds': 'fed-funds', 'fed rate': 'fed-funds', refi: 'main-refinancing', 'deposit rate': 'deposit-facility' },
  },

  verify: [
    { label: 'call-policy-boe', kind: 'tool', tool: 'policy_rate', args: { bank: 'boe' }, assert: "d['bank']=='boe' and d['figures'][0]['key']=='bank-rate' and d['source'].startswith('https://www.bankofengland.co.uk/') and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/policy-rates?bank=boe'" },
    { label: 'call-policy-all', kind: 'tool', tool: 'policy_rate', args: { all: true }, assert: "d['count']==3 and [b['bank'] for b in d['banks']]==['boe','fed','ecb'] and all(b['source'] and b['effectiveFrom'] and b['nextDecision'] for b in d['banks'])" },
    { label: 'call-policy-bad', kind: 'tool', tool: 'policy_rate', args: { bank: 'boj' }, assert: "d['covered']==False and 'boe' in d['coverage']" },
    { label: 'rest-policy-rates', kind: 'rest', path: 'policy-rates', query: 'bank=ecb', assert: "d['bank']=='ecb' and len(d['figures'])==3 and 'freshness' in d and d['cite']['url']=='https://databutler.dev/r/policy-rates?bank=ecb'" },
    { label: 'rest-policy-rates-400', kind: 'rest', path: 'policy-rates', query: '', assert: "'missing' in d['error']" },
  ],

  REFRESH_DAYS,
};
