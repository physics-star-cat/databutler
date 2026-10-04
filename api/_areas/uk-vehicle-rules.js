/**
 * Area: uk-vehicle-rules — UK vehicle tax (VED) and MOT rules.
 * The car-tax and MOT facts the four car sites' users (and their assistants)
 * ask about and that change every April: VED first-year rates by CO2 band and
 * the standard rate for cars registered on or after 1 April 2017, the expensive
 * car supplement (threshold and amount), the band rates for cars registered
 * 1 March 2001 – 31 March 2017, the engine-size rates for pre-2001 cars, the
 * electric-vehicle rules in force since 1 April 2025, the historic-vehicle
 * (40-year rolling) exemptions, MOT due dates, maximum fees, early renewal,
 * retests and exemptions, and the penalties for no MOT or no tax — each read
 * from the gov.uk page named in its `source` (vehicle-tax-rate-tables,
 * getting-an-mot, historic-vehicles, vehicle-tax-direct-debit,
 * vehicle-exempt-from-vehicle-tax and the HMRC expensive-car-supplement
 * policy paper) with the table row or sentence it came from as `quote`, and
 * its 2025-26 value as `previous` read from the National Archives capture of
 * the same page. Data: data/uk-vehicle-rules/<taxYear>.json (categories →
 * figures; one file per tax year from 1 April, old years kept), edited against
 * the source pages and diffed by `node scripts/changelog.js --only uk-vehicle-rules`.
 * Contract: api/_areas/README.md. Playbook: docs/ADDING_AN_AREA.md.
 */
const DATA = require('../../data/uk-vehicle-rules/2026-27.json');
const { BASE, diffCategories, categoriesLookup, noteTemplate } = require('../_area_kit');

const AREA = 'uk-vehicle-rules';
const CADENCE_DAYS = null; // calendar-driven: VED rates change on 1 April; nextScheduledRefresh is set by hand in the data file (2027-04-01 first); freshness turns due from that day
const CATEGORIES = Object.keys(DATA.categories);
const TAX_YEAR = DATA.taxYear;
/** The VED year starts on 1 April: "2026-27" → 2026-04-01 (per-figure effectiveFrom wins). */
const vedYearStart = (taxYear) => `${String(taxYear).slice(0, 4)}-04-01`;
/**
 * Figures carry `previous: { value, taxYear, source, quote? }` — a figure's first appearance in the
 * file records previous.value → value (one without a previous, or whose previous equals its value —
 * the MOT fees, unchanged since 2010 — records nothing); afterwards every refresh diffs value
 * against the committed file, and a new tax-year file against the previous year's file.
 */
const PREVIOUS = true;

/** House-style lookup (api/_area_kit.js): nothing → listing; key or substring of key/title → category; else covered:false + nearest. */
const lookup = categoriesLookup(DATA, AREA);

/** Watched pages: one per distinct category source plus the Direct Debit and historic-tax parts figures cite. */
const WATCH_EXTRA = [
  { url: 'https://www.gov.uk/vehicle-tax-direct-debit', label: 'Pay vehicle tax by Direct Debit — the 5% monthly / 6-monthly surcharge and the £80 untaxed-vehicle penalty' },
  { url: 'https://www.gov.uk/government/publications/vehicle-excise-duty-for-expensive-car-supplement-threshold-increase-for-zero-emission-vehicles/increase-in-the-vehicle-excise-duty-expensive-car-supplement-threshold-for-zero-emission-cars', label: 'HMRC policy paper — expensive car supplement threshold for zero-emission cars (£50,000 from 1 April 2026)' },
];

module.exports = {
  area: AREA,
  order: 110,
  title: 'UK vehicle tax (VED) and MOT rules',
  short: 'UK car tax (VED) and MOT rules',

  server: {
    serverName: 'databutler-uk-vehicle-rules',
    url: `${BASE}/api/mcp/uk-vehicle-rules`,
    description: 'UK vehicle tax (VED) rates and MOT rules for the current tax year — first-year CO2 bands, standard rate, expensive car supplement, 2001–2017 bands, pre-2001 engine-size rates, electric-vehicle rules, historic-vehicle exemptions, MOT due dates, maximum fees, retests and penalties — verified against gov.uk with the source URL, the quoted line and the previous year\'s value on every figure.',
    instructions:
      `UK vehicle tax (VED) and MOT rules for ${TAX_YEAR} from databutler.dev, each figure read from the gov.uk page ` +
      'in its source on verifiedDate with the table row or sentence it came from as quote and its 2025-26 value as previous. ' +
      'VED rates change every 1 April and the historic-vehicle exemption date rolls forward with them, so training-data ' +
      'figures for car tax are stale by the first April after the cutoff. Present the taxYear, the figure\'s unit and the ' +
      'source URL with any figure; a first-year rate depends on the CO2 band and on whether a diesel meets RDE2; the ' +
      'expensive car supplement threshold is £40,000 for most cars and £50,000 for zero-emission cars registered on or ' +
      'after 1 April 2025. MOT figures are Great Britain only; Northern Ireland, vans and HGV tax beyond the listed ' +
      'rows and company-car benefit in kind are not covered (coverage lists them). Cite https://databutler.dev/ and the source.',
    tools: [
      {
        name: 'uk_vehicle_rules_lookup',
        title: 'UK vehicle tax (VED) & MOT rules',
        description:
          `UK vehicle tax (VED) and MOT rules for ${TAX_YEAR}, verified against gov.uk, by category: ` +
          'ved-first-year (first-year rate by CO2 band for cars registered on or after 1 April 2017, petrol/RDE2-diesel and ' +
          'other-diesel columns), ved-standard (the flat rate from the second year and the Direct Debit surcharges), ' +
          'ved-expensive-car (list price threshold, annual supplement, years applied), ved-2001-2017 (bands A–M), ' +
          'ved-pre-2001 (engine size), ved-electric (zero-emission cars taxable since 1 April 2025), historic (40-year MOT ' +
          'exemption and the vehicle-tax exemption build date), mot (first MOT at 3 years, maximum fees by class, early ' +
          'renewal, retests, exemptions) and penalties (no MOT, dangerous vehicle, untaxed vehicle). Each figure carries its ' +
          'value, unit, the quoted line from the page, its source URL, effectiveFrom and the previous year\'s value; the ' +
          'answer carries verifiedDate, freshness and a citation permalink. No category returns the listing; an unknown ' +
          'category answers covered:false with the nearest keys.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: `one of: ${CATEGORIES.join(', ')} (omit to list all)` },
          },
        },
        run: (a) => lookup(a),
        freshness: AREA,
        cite: (a) => ({ path: 'uk/vehicle-rules', query: { category: a.category } }),
      },
    ],
  },

  coverage: () => ({
    taxYears: [TAX_YEAR],
    categories: CATEGORIES,
    verifiedDate: DATA.verifiedDate,
    scope: 'United Kingdom for vehicle tax (DVLA); MOT figures are Great Britain (England, Scotland, Wales). Cars and motorhomes; each category names its gov.uk page; previous values from the National Archives capture of the same page for 2025-26.',
    notCovered: [
      'vans, light goods vehicles, motorcycles and HGV vehicle tax beyond the rows included (gov.uk/vehicle-tax-rate-tables "Other vehicle tax rates")',
      'Northern Ireland MOT (DVA) rules, fees and processes',
      'company-car benefit in kind (BIK) and fuel benefit charges',
      'motorhome rates for vehicles registered 1 April 2017 – 11 March 2020 (M1SP)',
      'trade licences',
      'prior tax years before 2026-27 (the file layout is per year; 2025-26 appears only as each figure\'s previous value)',
    ],
  }),

  freshness: { dataFile: 'data/uk-vehicle-rules/2026-27.json', cadenceDays: CADENCE_DAYS, data: DATA },

  changelog: {
    diff: (prev, next) => diffCategories(AREA, prev, next, {
      previous: PREVIOUS,
      key: (f) => f.key,
      effectiveFrom: (n, f) => f.effectiveFrom || vedYearStart(n.taxYear),
      extra: (n) => ({ taxYear: n.taxYear }),
    }),
    files: ['data/uk-vehicle-rules/'],
    previousSibling: true, // a brand-new tax-year file diffs against the previous year's file in data/uk-vehicle-rules/
    previous: PREVIOUS,
    // scripts/changelog.js pre-fills every blank note with this; placeholders: {label} {key} {from} {to} {unit} {source} {quote} {document}
    note: noteTemplate('{label}: {from} → {to} from {effectiveFrom} ({document})', { key: (f) => f.key }),
    context: (e) => (e.taxYear ? `tax year ${e.taxYear} (VED year from 1 April)` : ''),
  },
  discovery: {
    description: 'UK vehicle tax (VED) and MOT rules verified against gov.uk: first-year rates by CO2 band, the standard rate, the expensive car supplement, 2001–2017 bands, pre-2001 engine-size rates, electric-vehicle rules since April 2025, historic-vehicle exemptions, MOT due dates, maximum fees, early renewal, retests, exemptions and penalties.',
    cadence: 'Every 1 April (VED rates and the historic-vehicle exemption date move with the Finance Act) and after each Budget; MOT fees and rules when DVSA changes them; every source page re-fetched weekly.',
  },

  sources: () => {
    const seen = new Set();
    const out = [];
    for (const [k, c] of Object.entries(DATA.categories)) {
      if (seen.has(c.source)) continue;
      seen.add(c.source);
      out.push({ url: c.source, label: c.title || k });
    }
    for (const w of WATCH_EXTRA) if (!seen.has(w.url)) { seen.add(w.url); out.push(w); }
    return out;
  },

  rest: [
    { path: 'uk/vehicle-rules', tool: 'uk_vehicle_rules_lookup', args: (q) => ({ category: q.category }) /* no `required`: an empty query answers the listing, like uk_rates_lookup */ },
  ],

  hub: {
    changed: 'UK vehicle tax (VED) rates and MOT rules',
    coverage: 'UK vehicle tax (VED) and MOT rule categories',
    catalogue: 'UK vehicle tax (VED) and MOT rules',
    call: 'uk_vehicle_rules_lookup (UK car tax: first-year CO2 bands, standard rate, expensive car supplement, 2001–2017 bands, pre-2001 rates, electric cars, historic vehicles; MOT due dates, fees, retests, penalties — verified against gov.uk)',
  },

  docs: {
    readme: {
      // The # cell is numbered by scripts/sync-areas.js from `order`; start at the Vertical cell.
      roadmapRow: `| **UK vehicle tax (VED) and MOT rules** — \`uk_vehicle_rules_lookup\`: the car-tax and MOT numbers the four car sites' users ask about and that change every 1 April (first-year CO2 bands, standard rate, expensive car supplement incl. the £50,000 EV threshold, 2001–2017 bands, pre-2001 rates, electric-car rules, historic 40-year exemptions, MOT fees/retests/penalties), each with the quoted gov.uk line and its 2025-26 value; calendar-driven refresh | \`/api/mcp/uk-vehicle-rules\` | **v1 — built 2026-10-04** |`,
      catalogueRow: `| \`/api/mcp/uk-vehicle-rules\` | \`uk_vehicle_rules_lookup\` — category ∈ {${CATEGORIES.join(', ')}} | \`data/uk-vehicle-rules/<taxYear>.json\` (one file per VED year from 1 April; ${TAX_YEAR} now): every figure verified against the gov.uk page in its \`source\` (vehicle-tax-rate-tables, getting-an-mot, historic-vehicles, vehicle-tax-direct-debit, vehicle-exempt-from-vehicle-tax, HMRC ECS policy paper) with the quoted row/sentence, \`effectiveFrom\` and the previous year's value read from the National Archives capture of the same page. Refresh each 1 April: new file, \`node scripts/changelog.js --only uk-vehicle-rules\` (docs/CURATION.md) |`,
    },
    llms: {
      rest: [
        `- \`GET https://databutler.dev/api/uk/vehicle-rules?category=ved-first-year\` — UK vehicle tax (VED) and MOT rules for ${TAX_YEAR} (category = ${CATEGORIES.join(' | ')}; omit to list): first-year VED by CO2 band for cars registered on or after 1 April 2017 (petrol/RDE2-diesel and other-diesel columns), the standard rate and Direct Debit surcharges, the expensive car supplement (£40,000 threshold, £50,000 for zero-emission cars registered from 1 April 2025, annual amount, 5 years), bands A–M for cars registered 1 March 2001 – 31 March 2017, pre-2001 engine-size rates, electric-car rules since 1 April 2025, historic-vehicle 40-year MOT exemption and the vehicle-tax exemption build date, MOT due dates, maximum fees by class, early renewal (a month minus a day), retests, exemptions and the penalties for no MOT or no tax — each figure verified against gov.uk with the quoted line, source URL, effectiveFrom and the previous year's value.`,
      ],
      server: `- \`POST https://databutler.dev/api/mcp/uk-vehicle-rules\` — tool \`uk_vehicle_rules_lookup\` (category = ${CATEGORIES.join(' | ')}): UK vehicle tax (VED) rates and MOT rules for ${TAX_YEAR}, verified against gov.uk with the quoted line, source URL and previous year's value on every figure; VED changes every 1 April. REST mirror: \`GET https://databutler.dev/api/uk/vehicle-rules?category=…\`.`,
    },
    curation: [
      '| `data/uk-vehicle-rules/<year>.json` | Every 1 April, calendar-driven (`cadenceDays: null`; `nextScheduledRefresh` set by hand to the next 1 April, 2027-04-01 for 2027-28): VED rates and the historic-vehicle exemption date are uprated by the Finance Act (announced at the Autumn Budget — HMRC tax information and impact notes on gov.uk on Budget day; the rate-tables page is rewritten shortly before 1 April). MOT maximum fees have not changed since 2010. The weekly watcher hashes the gov.uk pages in `sources()`. | Fetch gov.uk/vehicle-tax-rate-tables (all parts), gov.uk/getting-an-mot, gov.uk/historic-vehicles, gov.uk/vehicle-tax-direct-debit and gov.uk/vehicle-exempt-from-vehicle-tax (content API `https://www.gov.uk/api/content/<path>` gives every part as HTML); write a NEW `data/uk-vehicle-rules/<year>.json` (keep old years), moving each `value` into `previous` (with the National Archives capture URL of the outgoing page as previous.source), writing the new `value`, `quote`, `effectiveFrom` (1 April) and `verifiedDate`; bump `taxYear`, `taxYearRuns`, set `nextScheduledRefresh`; update the file the module requires; then `node scripts/changelog.js --only uk-vehicle-rules` (one entry per figure that moved, from → to, effectiveFrom 1 April; refreshes `data/sources.json`); review the pre-filled notes. |',
    ],
    index: { blurb: 'UK car tax (VED) rates and MOT rules — first-year CO2 bands, standard rate, expensive car supplement, electric cars, historic exemptions, MOT fees and penalties — verified against gov.uk' },
    api: () => ({
      endpoints: {
        'GET /api/uk/vehicle-rules': {
          description:
            `UK vehicle tax (VED) and MOT rules for ${TAX_YEAR}, verified ${DATA.verifiedDate} against gov.uk: first-year VED by CO2 band ` +
            '(cars registered on or after 1 April 2017), the standard rate and Direct Debit surcharges, the expensive car supplement ' +
            '(£40,000 / £50,000 zero-emission threshold, annual amount, years), bands A–M for 2001–2017 cars, pre-2001 engine-size rates, ' +
            'electric-car rules since 1 April 2025, historic-vehicle exemptions, MOT due dates, maximum fees, early renewal, retests, ' +
            'exemptions and penalties — each figure with the quoted gov.uk line, source URL, effectiveFrom and its previous-year value.',
          params: { category: `one of ${CATEGORIES.join(', ')} (omit to list)` },
          example: 'https://databutler.dev/api/uk/vehicle-rules?category=ved-first-year',
        },
      },
      coverage: { ukVehicleRules: `tax year ${TAX_YEAR}: ${CATEGORIES.length} categories, verified ${DATA.verifiedDate}` },
    }),
  },

  verify: [
    { label: 'uk-vehicle-rules-listing', kind: 'tool', tool: 'uk_vehicle_rules_lookup', args: {}, assert: "'categories' in d and 'ved-first-year' in d['categories'] and 'freshness' in d" },
    { label: 'uk-vehicle-rules-rest-listing', kind: 'rest', path: 'uk/vehicle-rules', query: '', assert: "'categories' in d and 'cite' in d" },
    { label: 'call-uk-vehicle-rules-standard', kind: 'tool', tool: 'uk_vehicle_rules_lookup', args: { category: 'ved-standard' }, assert: "d['category']=='ved-standard' and d['figures'][0]['value']==200 and d['source'].startswith('https://www.gov.uk/') and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/uk/vehicle-rules?category=ved-standard'" },
    { label: 'call-uk-vehicle-rules-nearmiss', kind: 'tool', tool: 'uk_vehicle_rules_lookup', args: { category: 'mot-fees' }, assert: "(d.get('covered')==False and 'mot' in d['nearest']) or d.get('category')=='mot'" },
    { label: 'rest-uk-vehicle-rules-mot', kind: 'rest', path: 'uk/vehicle-rules', query: 'category=mot', assert: "d['category']=='mot' and any(f['key']=='max-fee-car' and f['value']==54.85 for f in d['figures']) and 'freshness' in d and d['cite']['url']=='https://databutler.dev/r/uk/vehicle-rules?category=mot'" },
  ],
};
