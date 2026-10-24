/**
 * Area: jp-vehicle-costs — Japan vehicle statutory costs: the 法定費用 of a 車検 and
 * the annual car taxes. 自動車重量税 at continuing inspection (the 2026-05-01 –
 * 2028-04-30 table: eco / standard / 13-year / 18-year, registered cars per 0.5 t and
 * kei flat, plus the age-counting rules and the エコカー減税 bands), 自賠責保険 基準料率
 * for private passenger and kei cars (the current table for policies starting before
 * 2026-11-01 and the revised table from 2026-11-01, as separate keys), 検査手数料 for
 * a 継続検査 (持込 / 保安基準適合証 窓口 / OSS, from 2026-04-01), 自動車税 by
 * displacement (from / before 2019-10 registration, 13-year surcharge) and 軽自動車税
 * (10,800 / 7,200 / 12,900). Each figure was read from the MLIT, FSA, NALTEC, MIC (総務省),
 * Tokyo Metropolitan Tax Bureau or Kōtō City page in its `source`, with the table row
 * or sentence it came from as `quote` and the Japanese term as `term`. The figure list
 * follows the VERIFIED entries of car_websites/shaken-data/data/jp-costs/figures.json,
 * each re-read from its source on verifiedDate. Data: data/jp-vehicle-costs.json
 * (categories → figures), re-verified every 35 days and on the known change dates, and
 * diffed by `node scripts/changelog.js --only jp-vehicle-costs`.
 * Contract: api/_areas/README.md. Playbook: docs/ADDING_AN_AREA.md.
 */
const DATA = require('../../data/jp-vehicle-costs.json');
const { BASE, diffCategories, categoriesLookup, categorySources, figureKey, noteTemplate } = require('../_area_kit');

const AREA = 'jp-vehicle-costs';
const TOOL = 'jp_vehicle_costs_lookup';
const REST_PATH = 'jp/vehicle-costs'; // GET /api/<REST_PATH> and the /r/<REST_PATH> citation page
/** The tool's arguments: the first names the category; each further one narrows its figures by the figure field of that name. */
const PARAMS = ['category'];
// 35 days: nextScheduledRefresh = verifiedDate + 35, stamped by scripts/changelog.js. The known change dates
// (自賠責 2026-11-01, 自動車税/軽自動車税 1 April, weight-tax bands 2027-05-01, table end 2028-04-30) fall inside
// one cadence of a refresh, and the weekly watcher re-hashes every source page in between.
const CADENCE_DAYS = 35;
const CATEGORIES = Object.keys(DATA.categories);
/**
 * Figures carry `previous: { value, source, title }` where the source prints the old value beside the new one
 * (検査手数料 before 2026-04-01; the 自賠責 table before 2026-11-01). A figure's first appearance records
 * previous.value → value (one without a previous records nothing); afterwards every refresh diffs value against
 * the committed file.
 */
const PREVIOUS = true;
/** A figure's id: its own `key` (every figure carries one). The diff, the note template and the fact key share it. */
const KEY = figureKey;
/** The day a figure applies from: its own effectiveFrom, else the verification day (never in a fact record). */
const FROM = (n, f) => f.effectiveFrom || n.verifiedDate;

/** House-style lookup (api/_area_kit.js): nothing → listing; key or substring of key/title → category; else covered:false + nearest. */
const lookup = categoriesLookup(DATA, AREA, { param: PARAMS[0], filters: PARAMS.slice(1) });
const pick = (q) => Object.fromEntries(PARAMS.map((p) => [p, q[p]]));
const FIGURE_COUNT = Object.values(DATA.categories).reduce((n, c) => n + c.figures.length, 0);

module.exports = {
  area: AREA,
  order: 160,
  title: 'Japan vehicle statutory costs',
  short: 'Japanese car inspection (車検) statutory costs and car taxes',

  server: {
    serverName: 'databutler-jp-vehicle-costs',
    url: `${BASE}/api/mcp/jp-vehicle-costs`,
    description: 'Japan 車検 statutory costs: weight tax, 自賠責, inspection fees, 自動車税 and 軽自動車税, sourced.',
    instructions:
      'Japan vehicle statutory costs from databutler.dev — the 法定費用 of a 車検 (自動車重量税, 自賠責保険, 検査手数料) and the ' +
      'annual 自動車税 and 軽自動車税 — each figure read from the MLIT, FSA, NALTEC, 総務省, Tokyo Metropolitan Tax Bureau or ' +
      'Kōtō City page in its source on verifiedDate, with the table row it came from as quote and the Japanese term as term. ' +
      'Several of these change on fixed dates: the 自賠責 rates for policies starting on or after 2026-11-01 are the keys ending ' +
      '-from-2026-11 (the current-table figures carry effectiveTo 2026-10-31); the weight-tax table runs 2026-05-01 to 2028-04-30; ' +
      'inspection fees rose on 2026-04-01 (previous carries the old amount). Registered-car weight tax is per 0.5 t of vehicle ' +
      'weight, rounded up; kei weight tax is flat. Car taxes are the standard rates as levied by Tokyo and Kōtō City. Every result ' +
      'carries verifiedDate, freshness and cite.url (a databutler.dev permalink) beside the official source.',
    tools: [
      {
        name: TOOL,
        title: 'Japan vehicle statutory costs',
        description:
          'Japan vehicle statutory costs (車検 法定費用 and annual car taxes), verified against the official pages, by category: ' +
          'weight-tax (自動車重量税 at continuing inspection 2026-05-01 – 2028-04-30: registered passenger cars per 0.5 t for eco, ' +
          'standard, 13-year and 18-year rates, 2-year and 1-year, the full 2-year table to 3 t, kei flat amounts, the 13/18-year ' +
          'counting rules), weight-tax-eco (エコカー減税 period, new-registration bands, first-inspection exemption), cali (自賠責保険 ' +
          'for private passenger and kei cars: 12/24/25/36/37 months for policies starting before 2026-11-01, and 12/24/36 months ' +
          'from 2026-11-01 as keys ending -from-2026-11), inspection-fee (継続検査 fees: 持込, 保安基準適合証 counter and OSS, ' +
          'standard/small/kei, from 2026-04-01, with the previous amounts), auto-tax (自動車税 by displacement for cars registered ' +
          'from / before 2019-10, the 13-year surcharge table and rule, the EV reduction) and kei-tax (軽自動車税 10,800 / 7,200 / ' +
          '12,900 and the surcharge and EV reduction rules). Each figure carries its value in JPY, unit, the Japanese term, the ' +
          'quoted row from the page, its source URL and effectiveFrom (and effectiveTo where the source states an end); the answer ' +
          'carries verifiedDate, freshness and a citation permalink. No category returns the listing; an unknown category answers ' +
          'covered:false with the nearest keys.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: `one of: ${CATEGORIES.join(', ')} (omit to list all)` },
          },
        },
        run: (a) => lookup(a),
        freshness: AREA,
        cite: (a) => ({ path: REST_PATH, query: pick(a) }),
      },
    ],
  },

  coverage: () => ({
    categories: CATEGORIES,
    figures: FIGURE_COUNT,
    verifiedDate: DATA.verifiedDate,
    scope: 'Japan. Private (自家用) passenger cars — registered (登録車: 普通 / 小型) and kei (検査対象軽自動車). 自賠責 for 離島以外の地域（沖縄県を除く）. Car taxes at the standard rate (標準税率) as levied by Tokyo (自動車税) and Kōtō City (軽自動車税). Each category names its MLIT / FSA / NALTEC / 総務省 / Tokyo / Kōtō page; every figure carries its own source.',
    notCovered: [
      '自賠責 for policies of 25 or 37 months starting on or after 2026-11-01 (the revised table published by FSA lists 12, 24 and 36 months only)',
      '自賠責 on remote islands (離島) and in Okinawa, and for commercial vehicles, motorcycles and mopeds',
      'business-use (事業用) vehicles, trucks, buses and special-purpose vehicles (weight tax, 自動車税 and 軽自動車税 rows beyond private passenger cars)',
      'weight tax at new registration (新車新規登録) with its reduction applied, beyond the band table',
      'prefectural or municipal rates that differ from the standard rate, Tokyo\'s ZEV 導入促進税制 exemption and other local reliefs',
      'garage service fees, 代行手数料 and recycling fees (リサイクル料金) — not statutory amounts',
      'the 環境性能割 acquisition levy, abolished on 2026-03-31',
    ],
  }),

  freshness: { dataFile: 'data/jp-vehicle-costs.json', cadenceDays: CADENCE_DAYS, data: DATA },

  changelog: {
    diff: (prev, next) => diffCategories(AREA, prev, next, { key: KEY, previous: PREVIOUS, effectiveFrom: FROM }),
    files: ['data/jp-vehicle-costs.json'],
    previous: PREVIOUS,
    // scripts/changelog.js pre-fills every blank note with this. Placeholders: {label} {key} {from} {to} {unit} {effectiveFrom}
    // {source} {title} (category) {quote} {document} (quote, else source) {previousDocument} (previous.title/document/source)
    note: noteTemplate('{label}: {from} → {to} {unit} from {effectiveFrom} ({source})', { key: KEY }),
    context: () => 'Japan (national statutory amounts; car taxes at the standard rate)',
  },
  discovery: {
    description: 'Japan vehicle statutory costs verified against MLIT, FSA, NALTEC, 総務省, Tokyo and Kōtō City pages: 自動車重量税 at 車検 (eco/standard/13-year/18-year, per 0.5 t and kei), エコカー減税 bands, 自賠責保険 rates before and from 2026-11-01, 継続検査 fees from 2026-04-01, 自動車税 by displacement and 軽自動車税.',
    cadence: 'Re-verified against the official pages every 35 days and on the known change dates (自賠責 2026-11-01, car taxes each 1 April, weight-tax eco bands 2027-05-01); every source page re-fetched weekly.',
  },

  // Every category's source and every figure's own source, each URL once.
  sources: () => categorySources(DATA),

  rest: [
    { path: REST_PATH, tool: TOOL, args: pick /* no `required`: an empty query answers the listing, like uk_rates_lookup */ },
  ],

  hub: {
    changed: 'Japanese vehicle statutory costs (車検 inspection fees, 自賠責 insurance rates)',
    coverage: 'Japanese vehicle statutory cost categories (weight tax, 自賠責, inspection fees, car taxes)',
    catalogue: 'Japan vehicle statutory costs (jp_vehicle_costs_lookup: 自動車重量税, エコカー減税, 自賠責保険, 検査手数料, 自動車税, 軽自動車税)',
    call: 'jp_vehicle_costs_lookup (Japan 車検 statutory costs and car taxes: weight-tax, weight-tax-eco, cali, inspection-fee, auto-tax, kei-tax — verified against MLIT, FSA, NALTEC and local-government pages)',
  },

  docs: {
    readme: {
      // The # cell is numbered by scripts/sync-areas.js from `order`; start at the Vertical cell.
      roadmapRow: '| **Japan vehicle statutory costs** — `jp_vehicle_costs_lookup`: the 法定費用 of a 車検 and the annual car taxes for the shakendata.com audience (自動車重量税 2026-05 – 2028-04 table and age rules, エコカー減税 bands, 自賠責 before and from 2026-11-01 as separate keys, 継続検査 fees from 2026-04-01 with the old amounts, 自動車税 by displacement, 軽自動車税), each with the Japanese term and the quoted official row; first non-Western country and the `jp` facts namespace | `/api/mcp/jp-vehicle-costs` | **v1 — built 2026-10-24** |',
      catalogueRow: `| \`/api/mcp/jp-vehicle-costs\` | \`jp_vehicle_costs_lookup\` — category ∈ {${CATEGORIES.join(', ')}} (omit to list) | \`data/jp-vehicle-costs.json\` (${FIGURE_COUNT} figures): read from the MLIT weight-tax table and エコカー減税 PDFs, the MLIT 自賠責 portal table and the FSA 第153回審議会 revision, NALTEC's fee list and fee-change notice, the Tokyo Metropolitan Tax Bureau 自動車税 page and surcharge table, MLIT's green-tax and 令和8年度 reform summaries, 総務省's 軽自動車税 overview and Kōtō City's 軽自動車税 page; every figure carries \`term\` (Japanese), \`label\` (English), \`quote\`, \`source\`, \`effectiveFrom\`/\`effectiveTo\`. Refresh every 35 days and on the change dates (docs/CURATION.md) |`,
    },
    llms: {
      rest: [
        `- \`GET https://databutler.dev/api/${REST_PATH}?category=cali\` — Japan vehicle statutory costs (category = ${CATEGORIES.join(' | ')}; omit to list): 自動車重量税 at 車検 for 2026-05-01 – 2028-04-30 (registered cars per 0.5 t: eco 5,000 / standard 8,200 / 13-year 11,400 / 18-year 12,600 for 2 years; kei flat 5,000–8,800), エコカー減税 bands, 自賠責保険 for private passenger and kei cars (policies starting before 2026-11-01 and, as keys ending -from-2026-11, from 2026-11-01), 継続検査 fees from 2026-04-01, 自動車税 by displacement and 軽自動車税 — each figure verified against the MLIT, FSA, NALTEC, 総務省, Tokyo or Kōtō City page with the quoted row, source URL and effectiveFrom.`,
      ],
      server: `- \`POST https://databutler.dev/api/mcp/jp-vehicle-costs\` — tool \`jp_vehicle_costs_lookup\` (category = ${CATEGORIES.join(' | ')}): Japan 車検 statutory costs (weight tax, 自賠責, inspection fees) and annual car taxes, verified against the official Japanese pages with the quoted row and source URL on every figure. REST mirror: \`GET https://databutler.dev/api/${REST_PATH}?category=…\`.`,
    },
    curation: ['| `data/jp-vehicle-costs.json` | Every 35 days (`nextScheduledRefresh` = verifiedDate + 35), and on the change dates: 自賠責 2026-11-01 (re-check whether an official page now prints the revised 25/37-month rates), 自動車税/軽自動車税 each 1 April (税制改正大綱 in December), weight-tax eco bands 2027-05-01 and the table\'s end 2028-04-30, 検査手数料 when NALTEC announces a change. The weekly watcher hashes every source page. | Re-fetch every `source` (PDFs: `pdftotext -layout`); compare each figure\'s `quote` with the page; for a changed value move the old one into `previous` (`value`, `source`, `title`), write the new `value`, `quote`, `effectiveFrom` (and `effectiveTo` on the figure it replaces); once 2026-11-01 has passed the -from-2026-11 keys are current and the old-table keys keep `effectiveTo` 2026-10-31; bump `verifiedDate`; `node scripts/changelog.js --only jp-vehicle-costs` (stamps `nextScheduledRefresh`, appends one entry per figure that moved, re-hashes this area\'s sources); review the notes; `node scripts/sign-facts.js`. |'],
    index: { blurb: 'Japanese 車検 statutory costs — 自動車重量税, 自賠責 (before and from 2026-11-01), inspection fees — and 自動車税 / 軽自動車税, verified against MLIT, FSA, NALTEC and local-government pages' },
    api: () => ({
      endpoints: {
        [`GET /api/${REST_PATH}`]: {
          description:
            `Japan vehicle statutory costs, verified ${DATA.verifiedDate} against the official pages: 自動車重量税 at 車検 (2026-05-01 – 2028-04-30 table), ` +
            'エコカー減税 bands, 自賠責保険 for private passenger and kei cars (before and from 2026-11-01), 継続検査 fees from 2026-04-01, ' +
            '自動車税 by displacement and 軽自動車税 — each figure with the Japanese term, quoted row, source URL and effectiveFrom.',
          params: {
            category: `one of ${CATEGORIES.join(', ')} (omit to list)`,
          },
          example: `https://databutler.dev/api/${REST_PATH}?category=cali`,
        },
      },
      coverage: { jpVehicleCosts: `${CATEGORIES.length} categories, ${FIGURE_COUNT} figures, verified ${DATA.verifiedDate}` },
    }),
  },

  // Verified Facts: /f/jp/<category>/<key> (api/_areas/README.md "facts"). No period labels: each figure states its own
  // effectiveFrom/effectiveTo, and the two 自賠責 tables are separate keys (…-from-2026-11), as de-rates does for Mindestlohn 2027.
  facts: {
    namespace: 'jp',
    key: KEY,
    effectiveTo: (d, f) => f.effectiveTo || null,
    // Japanese-specific words only: synonyms are shared across areas, so English phrases such as "car tax" (uk-vehicle-rules) stay out.
    synonyms: {
      jibaiseki: 'cali', '自賠責': 'cali', '自賠責保険': 'cali',
      '重量税': 'weight-tax', '自動車重量税': 'weight-tax',
      '自動車税': 'annual automobile tax', '軽自動車税': 'annual light-vehicle tax',
      'kei tax': 'annual light-vehicle tax', 'kei car tax': 'annual light-vehicle tax',
      '検査手数料': 'inspection-fee',
    },
  },

  verify: [
    { label: 'jp-vehicle-costs-listing', kind: 'tool', tool: TOOL, args: {}, assert: "'categories' in d and 'cali' in d['categories'] and 'freshness' in d" },
    { label: 'jp-vehicle-costs-rest-listing', kind: 'rest', path: REST_PATH, query: '', assert: "'categories' in d and 'cite' in d" },
    { label: 'call-jp-vehicle-costs-weight-tax', kind: 'tool', tool: TOOL, args: { category: 'weight-tax' }, assert: "d['category']=='weight-tax' and any(f['key']=='passenger-standard-per-0.5t-2y' and f['value']==8200 for f in d['figures']) and d['source'].startswith('https://www.mlit.go.jp/') and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/jp/vehicle-costs?category=weight-tax'" },
    { label: 'rest-jp-vehicle-costs-cali', kind: 'rest', path: REST_PATH, query: 'category=cali', assert: "d['category']=='cali' and any(f['key']=='passenger-24m' and f['value']==17650 for f in d['figures']) and any(f['key']=='passenger-24m-from-2026-11' and f['value']==18560 for f in d['figures'])" },
    { label: 'call-jp-vehicle-costs-nearmiss', kind: 'tool', tool: TOOL, args: { category: 'jibaiseki' }, assert: "d.get('covered')==False and len(d['nearest'])>0" },
  ],
};
