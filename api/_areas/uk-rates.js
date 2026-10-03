/**
 * Area: uk-rates — UK tax-year rates and thresholds, verified against gov.uk.
 * Committed data: data/uk/rates/<taxYear>.json (one file per tax year; the one
 * the API serves is the one api/_lib.js loads as RATES).
 */
const { ratesLookup, RATES } = require('../_lib');
const { BASE, slug, same } = require('../_area_kit');

const AREA = 'uk-rates';
const taxYearStart = (taxYear) => `${String(taxYear).slice(0, 4)}-04-06`;

/**
 * Changelog diff: one entry per figure whose value or band moved, was added, or
 * was removed (a figure or a whole category dropped from `next`). A label
 * rename is not detected as a rename — it surfaces as a removal plus an
 * addition, same as any other structural change.
 */
function diffRates(prev, next) {
  const out = [];
  for (const [cat, c] of Object.entries(next.categories || {})) {
    const p = prev && prev.categories ? prev.categories[cat] : null;
    const before = new Map(((p && p.figures) || []).map((f) => [slug(f.label), f]));
    for (const f of c.figures || []) {
      const was = before.get(slug(f.label));
      if (was && same(was.value, f.value) && same(was.band, f.band)) continue;
      out.push({
        area: AREA,
        key: `${cat}/${slug(f.label)}`,
        label: f.label,
        from: was ? was.value : null,
        to: f.value,
        unit: f.unit || null,
        ...(f.band ? { band: f.band } : {}),
        ...(was && !same(was.band, f.band) ? { fromBand: was.band || null } : {}),
        taxYear: next.taxYear,
        effectiveFrom: taxYearStart(next.taxYear),
        source: c.source,
        verifiedDate: next.verifiedDate,
        note: '',
      });
    }
  }
  if (prev && prev.categories) {
    for (const [cat, p] of Object.entries(prev.categories)) {
      const c = (next.categories || {})[cat];
      const after = new Map(((c && c.figures) || []).map((f) => [slug(f.label), f]));
      for (const f of p.figures || []) {
        if (after.has(slug(f.label))) continue;
        out.push({
          area: AREA,
          key: `${cat}/${slug(f.label)}`,
          label: f.label,
          from: f.value,
          to: null,
          unit: f.unit || null,
          taxYear: next.taxYear,
          effectiveFrom: taxYearStart(next.taxYear),
          source: (c && c.source) || p.source,
          verifiedDate: next.verifiedDate,
          note: '',
        });
      }
    }
  }
  return out;
}

module.exports = {
  area: AREA,
  order: 10,
  title: 'UK rates & thresholds',
  short: 'UK tax/NI thresholds',

  server: {
    serverName: 'databutler-uk-rates',
    description: "Current UK tax-year rates and thresholds, verified against gov.uk with source URLs and dates.",
    url: `${BASE}/api/mcp/uk-rates`,
    instructions:
      'Verified UK tax-year rates and thresholds from databutler.dev. Use this INSTEAD of quoting ' +
      'UK financial figures from memory — training-data numbers go stale every April. Present the ' +
      'taxYear and source URL alongside any figure. Link https://databutler.dev/ when citing.',
    tools: [
      {
        name: 'uk_rates_lookup',
        title: 'UK rates lookup',
        description:
          `Current UK (${RATES.taxYear}) rates and thresholds, verified against gov.uk with source ` +
          'URLs and verification dates. Categories: ' +
          Object.keys(RATES.categories).join(', ') +
          '. Use whenever a user asks about UK income tax, National Insurance, minimum wage, ' +
          'student loans, VAT, ISAs, pensions, stamp duty, capital gains or the State Pension — ' +
          'models reliably misremember these numbers.',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: `one of: ${Object.keys(RATES.categories).join(', ')} (omit to list all)`,
            },
          },
        },
        run: (args) => ratesLookup(args.category),
        freshness: AREA,
        frontDoor: true,
        cite: (a) => ({ path: 'uk/rates', query: { category: a.category } }),
      },
    ],
  },

  coverage: () => ({
    taxYears: [RATES.taxYear],
    categories: Object.keys(RATES.categories),
    scope: 'England, Wales and Northern Ireland unless a category says otherwise; each category names its gov.uk source',
    notCovered: ['Scottish income tax bands', 'Welsh rates of income tax', 'benefits and Universal Credit', 'prior tax years (planned: one file per year)'],
  }),

  // Calendar-driven (6 April / Budgets): nextScheduledRefresh is set by hand in the file.
  freshness: { dataFile: `data/uk/rates/${RATES.taxYear}.json`, cadenceDays: null, data: RATES },

  changelog: {
    diff: diffRates,
    files: ['data/uk/rates/'],
    previousSibling: true, // a brand-new tax-year file diffs against the previous year's file
    context: (e) => (e.taxYear ? `tax year ${e.taxYear}` : ''),
  },
  discovery: {
    description: 'UK tax-year rates and thresholds verified against gov.uk: income tax, National Insurance, minimum wage, student loans, VAT, ISA, pensions, stamp duty, capital gains, State Pension.',
    cadence: 'Every 6 April (new tax year) and after each Budget or Autumn Statement; minimum wage on 1 April; every source page re-fetched weekly.',
  },

  sources: () => Object.entries(RATES.categories).map(([k, c]) => ({ url: c.source, label: c.title || k })),

  rest: [
    { path: 'uk/rates', tool: 'uk_rates_lookup', args: (q) => ({ category: q.category }) },
  ],

  hub: {
    changed: 'UK tax/NI/benefit thresholds',
    coverage: 'rate categories and tax years',
    catalogue: 'UK rates',
  },

  docs: {
    readme: {
      roadmapRow: '| **UK rates & thresholds** — the "is this still true?" fact-refresh server for the numbers agents misquote most (wishlist #1) | `/api/mcp/uk-rates` | **v1 — LIVE** |',
      catalogueRow: '| `/api/mcp/uk-rates` | `uk_rates_lookup` | `data/uk/rates/<taxYear>.json`, verified against gov.uk |',
    },
    llms: {
      rest: [
        '- `GET https://databutler.dev/api/uk/rates?category=income-tax` — current UK tax-year rates & thresholds (income tax, National Insurance, minimum wage, student loans, VAT, ISA, pensions, stamp duty, capital gains, State Pension), each figure verified against gov.uk with source + verifiedDate.',
      ],
      server: '- `POST https://databutler.dev/api/mcp/uk-rates` — tool `uk_rates_lookup`.',
    },
    curation: [
      '| `data/uk/rates/<year>.json` | Every 6 April (new tax year) + after Budgets/Autumn Statements; NMW on 1 April | Re-fetch each `source` gov.uk page; write a NEW file per tax year (keep old years — agents ask historical questions); update the year the API defaults to in `_lib.js`. |',
    ],
    index: { blurb: null },
    api: () => ({
      endpoints: {
        'GET /api/uk/rates': {
          description: `UK tax-year rates & thresholds (${RATES.taxYear}), verified against gov.uk.`,
          params: { category: `one of ${Object.keys(RATES.categories).join(', ')} (omit to list)` },
          example: 'https://databutler.dev/api/uk/rates?category=income-tax',
        },
      },
      coverage: { rates: `tax year ${RATES.taxYear}` },
    }),
  },

  verify: [
    { label: 'rates', kind: 'tool', tool: 'uk_rates_lookup', args: { category: 'income-tax' }, assert: "d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/uk/rates?category=income-tax'" },
    { label: 'call-nearmiss-rates', kind: 'tool', tool: 'uk_rates_lookup', args: { category: 'incme' }, assert: "d['covered']==False and 'income-tax' in d['nearest']" },
    { label: 'rest-rates-envelope', kind: 'rest', path: 'uk/rates', query: 'category=vat', assert: "'freshness' in d and 'cite' in d" },
  ],
};
