/**
 * Area: uk-rates — UK tax-year rates and thresholds, verified against gov.uk.
 * Committed data: data/uk/rates/<taxYear>.json (one file per tax year; the one
 * the API serves is the one api/_lib.js loads as RATES).
 */
const { ratesLookup, RATES } = require('../_lib');
const { BASE, slug, same, noteTemplate } = require('../_area_kit');

const AREA = 'uk-rates';
const taxYearStart = (taxYear) => `${String(taxYear).slice(0, 4)}-04-06`;
/** The day a figure's value applies: its own effectiveFrom/from (minimum wage 1 April, SMP 5 April), else 6 April. */
const effectiveFrom = (f, taxYear) => f.effectiveFrom || f.from || taxYearStart(taxYear);
/** A figure's comparable prior value (`previous.value`), or undefined when it carries none. */
const NOTE = noteTemplate('{label}: {from} → {to} {unit} from {effectiveFrom} — "{document}" (was: {previousDocument})', { key: (f) => slug(f.label) });
/** The minimum-wage table's prior-year row is a figure of its own; it carries no date of this tax year. */
const PRIOR_YEAR_FIGURE = (f) => /^previous year\b/i.test(f.label);
const previousValue = (f) => (f.previous && typeof f.previous === 'object' && f.previous.value !== undefined && f.previous.value !== null ? f.previous.value : undefined);

/**
 * Changelog diff: one entry per figure whose value or band moved, was added, or
 * was removed (a figure or a whole category dropped from `next`). A figure's
 * first appearance with a `previous.value` (the 2025-26 figure read from the
 * same page, the DWP rates table or a National Archives capture) records
 * previous.value → value, and nothing when the two are equal; without one it
 * records null → value. Per-figure `source` and `effectiveFrom` win over the
 * category's source and 6 April. A label
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
      const prior = was ? undefined : previousValue(f);
      if (prior !== undefined && same(prior, f.value)) continue;
      out.push({
        area: AREA,
        key: `${cat}/${slug(f.label)}`,
        label: f.label,
        from: was ? was.value : (prior !== undefined ? prior : null),
        to: f.value,
        unit: f.unit || null,
        ...(f.band ? { band: f.band } : {}),
        ...(was && !same(was.band, f.band) ? { fromBand: was.band || null } : {}),
        taxYear: next.taxYear,
        effectiveFrom: effectiveFrom(f, next.taxYear),
        source: f.source || c.source,
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
          source: f.source || (c && c.source) || p.source,
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
      'Current UK tax-year rates and thresholds from databutler.dev, each verified against gov.uk and returned with ' +
      'its taxYear, source URL and verification date. The figures change every April; every result names the tax year ' +
      'it applies to and carries cite.url, a databutler.dev permalink to the answer with its source.',
    tools: [
      {
        name: 'uk_rates_lookup',
        title: 'UK rates lookup',
        description:
          `Current UK (${RATES.taxYear}) rates and thresholds, verified against gov.uk with source ` +
          'URLs and verification dates. Categories: ' +
          Object.keys(RATES.categories).join(', ') +
          '. Covers UK income tax, National Insurance, minimum wage, ' +
          'student loans, VAT, ISAs, pensions, stamp duty, capital gains, dividends, savings, the State Pension ' +
          'and State Pension age, statutory sick/maternity/paternity pay and Child Benefit.',
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
    notCovered: ['Scottish income tax bands', 'Welsh rates of income tax', 'means-tested benefits, disability benefits and Universal Credit', 'Inheritance Tax', 'prior tax years as their own files (each figure carries its 2025-26 value in `previous` where a source gave it)'],
  }),

  // Calendar-driven (6 April / Budgets): nextScheduledRefresh is set by hand in the file.
  freshness: { dataFile: `data/uk/rates/${RATES.taxYear}.json`, cadenceDays: null, data: RATES },

  changelog: {
    diff: diffRates,
    files: ['data/uk/rates/'],
    previousSibling: true, // a brand-new tax-year file diffs against the previous year's file
    previous: true, // a figure's first appearance diffs previous.value → value
    note: (entry, prev, next) => NOTE(entry, prev, next).replace(/ \(was: \)$/, ''),
    context: (e) => (e.taxYear ? `tax year ${e.taxYear}` : ''),
  },
  discovery: {
    description: 'UK tax-year rates and thresholds verified against gov.uk: income tax, National Insurance, minimum wage, student loans, VAT, ISA, pensions, stamp duty, capital gains, dividends, savings and marriage allowances, State Pension and State Pension age, statutory sick/maternity/paternity pay, Child Benefit.',
    cadence: 'Every 6 April (new tax year) and after each Budget or Autumn Statement; minimum wage on 1 April; every source page re-fetched weekly.',
  },

  // every category source, then every figure source that differs from its category's, each URL once
  sources: () => {
    const seen = new Set(), out = [];
    const add = (url, label) => { if (url && !seen.has(url)) { seen.add(url); out.push({ url, label }); } };
    for (const [k, c] of Object.entries(RATES.categories)) add(c.source, c.title || k);
    for (const [k, c] of Object.entries(RATES.categories)) for (const f of c.figures || []) add(f.source, `${c.title || k}: ${f.label}`);
    return out;
  },

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
        '- `GET https://databutler.dev/api/uk/rates?category=income-tax` — current UK tax-year rates & thresholds (income tax, National Insurance, minimum wage, student loans, VAT, ISA, pensions, stamp duty, capital gains, dividends, savings, marriage allowance, State Pension and State Pension age, statutory sick/maternity/paternity pay, Child Benefit), each figure verified against gov.uk with source + verifiedDate.',
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

  // Verified Facts: /f/uk/<category>/<slug(label)> — the changelog key with `uk/` in front (api/_areas/README.md "facts").
  facts: {
    namespace: 'uk',
    key: (f) => slug(f.label),
    // A figure that is itself last year's rate ("Previous year 21+ …") is not dated by this file's tax year.
    period: (d, f) => (PRIOR_YEAR_FIGURE(f) ? null : d.taxYear),
    effectiveFrom: (d, f) => (PRIOR_YEAR_FIGURE(f) ? null : effectiveFrom(f, d.taxYear)),
    periodStart: taxYearStart,
    // Reviewed short forms for the keys whose labels carry a parenthetical.
    aliases: {
      'uk/national-insurance/primary-threshold': 'uk/national-insurance/primary-threshold-employee-pays-above-this',
      'uk/national-insurance/secondary-threshold': 'uk/national-insurance/secondary-threshold-employer-pays-above-this',
      'uk/minimum-wage/national-living-wage': 'uk/minimum-wage/21-and-over-national-living-wage',
    },
    synonyms: { ni: 'national-insurance', pa: 'personal-allowance', nlw: 'national-living-wage', nmw: 'minimum-wage', cgt: 'capital-gains', sdlt: 'stamp-duty', ssp: 'statutory-sick-pay', smp: 'statutory-parental-pay' },
  },

  verify: [
    { label: 'rates', kind: 'tool', tool: 'uk_rates_lookup', args: { category: 'income-tax' }, assert: "d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/uk/rates?category=income-tax'" },
    { label: 'call-nearmiss-rates', kind: 'tool', tool: 'uk_rates_lookup', args: { category: 'incme' }, assert: "d['covered']==False and 'income-tax' in d['nearest']" },
    { label: 'rest-rates-envelope', kind: 'rest', path: 'uk/rates', query: 'category=vat', assert: "'freshness' in d and 'cite' in d" },
  ],
};
