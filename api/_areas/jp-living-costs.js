/**
 * Area: jp-living-costs — Japan daily-life official figures: the regional minimum wage
 * (地域別最低賃金, FY2026, all 47 prefectures with their own 発効日 and the FY2025 amount
 * as `previous`), 協会けんぽ health insurance rates by prefecture plus the 介護保険料率 and
 * the new 子ども・子育て支援金率, pensions (厚生年金保険料率, 国民年金保険料 FY2026 and FY2027,
 * 老齢基礎年金 満額), 雇用保険料率, benefits (児童手当, 出産育児一時金, 高額療養費 before and
 * after the August 2026 and August 2027 revisions), the 2027 national holidays, 消費税 rates,
 * the 所得税 基礎控除 / 給与所得控除 tables and the 住民税 均等割. Each figure was read from the
 * MHLW, NTA, 総務省, 内閣府, こども家庭庁, 日本年金機構 or 協会けんぽ page, PDF or CSV in its
 * `source`, with the row or sentence it came from as `quote` and the Japanese term as `term`.
 * The proposed 1% food consumption-tax rate (2027-04 – 2029-03) is left out until its bill
 * passes. Data: data/jp-living-costs.json (categories → figures), re-verified every 35 days
 * and on the known change dates, and diffed by `node scripts/changelog.js --only jp-living-costs`.
 * Contract: api/_areas/README.md. Playbook: docs/ADDING_AN_AREA.md.
 */
const DATA = require('../../data/jp-living-costs.json');
const { BASE, diffCategories, categoriesLookup, categorySources, figureKey, noteTemplate } = require('../_area_kit');

const AREA = 'jp-living-costs';
const TOOL = 'jp_living_costs_lookup';
const REST_PATH = 'jp/living-costs'; // GET /api/<REST_PATH> and the /r/<REST_PATH> citation page
/** The tool's arguments: the first names the category; each further one narrows its figures by the figure field of that name. */
const PARAMS = ['category'];
// 35 days: nextScheduledRefresh = verifiedDate + 35, stamped by scripts/changelog.js. The known change dates (the
// prefecture minimum-wage 発効日 to 2026-12-02, the 2026-12-01 deduction change, each April's insurance rates, the
// 高額療養費 revisions on 2027-08-01) fall inside one cadence of a refresh; the weekly watcher re-hashes every source page.
const CADENCE_DAYS = 35;
const CATEGORIES = Object.keys(DATA.categories);
/**
 * Figures carry `previous: { value, period, source, title }` where the same official document prints the prior amount
 * beside the new one (the FY2025 minimum wages in parentheses, the FY2025 協会けんぽ and 雇用保険 rates, the 2025 deduction
 * columns). A figure's first appearance records previous.value → value (an unchanged rate or a figure without a previous
 * records nothing); afterwards every refresh diffs value against the committed file.
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
const PREFECTURES = DATA.categories['minimum-wage'].figures.filter((f) => !f.key.startsWith('national')).length;

module.exports = {
  area: AREA,
  order: 170,
  title: 'Japan daily-life official figures',
  short: 'Japanese minimum wages, social-insurance rates, pensions, benefits, holidays and tax thresholds',

  server: {
    serverName: 'databutler-jp-living-costs',
    url: `${BASE}/api/mcp/jp-living-costs`,
    description: 'Japan minimum wage by prefecture, 協会けんぽ rates, pensions, benefits, holidays, tax figures, sourced.',
    instructions:
      'Japan daily-life official figures from databutler.dev — 地域別最低賃金 by prefecture, 協会けんぽ health insurance rates by ' +
      'prefecture with 介護保険料率 and 子ども・子育て支援金率, 厚生年金保険料率, 国民年金保険料, 老齢基礎年金 満額, 雇用保険料率, 児童手当, ' +
      '出産育児一時金, 高額療養費, the 2027 national holidays, 消費税 rates, 所得税 基礎控除 / 給与所得控除 and 住民税 均等割 — each read from ' +
      'the MHLW, NTA, 総務省, 内閣府, こども家庭庁, 日本年金機構 or 協会けんぽ page in its source on verifiedDate, with the row it came from ' +
      'as quote and the Japanese term as term. The FY2026 minimum wages take effect on a different day in each prefecture ' +
      '(2026-10-01 to 2026-12-02): before a figure\'s effectiveFrom, its previous (FY2025) amount still applies. Health insurance ' +
      'rates are employer + employee combined and apply to 協会けんぽ members only. The 2026 deduction amounts take effect from ' +
      '2026-12-01 for the 2026 tax year. Every result carries verifiedDate, freshness and cite.url (a databutler.dev permalink) ' +
      'beside the official source.',
    tools: [
      {
        name: TOOL,
        title: 'Japan daily-life official figures',
        description:
          'Japan daily-life official figures, verified against the official pages, by category: minimum-wage (地域別最低賃金 FY2026, ' +
          `hourly, ${PREFECTURES} prefectures by romanised key such as tokyo or osaka plus national-weighted-average, each with its own ` +
          'effectiveFrom between 2026-10-01 and 2026-12-02 and the FY2025 amount as previous), health-insurance (協会けんぽ ' +
          '都道府県単位保険料率 FY2026 by prefecture, employer + employee combined, with the FY2025 rate as previous; long-term-care ' +
          '介護保険料率 for ages 40–64; child-rearing-levy 子ども・子育て支援金率 from April 2026), pension (kosei-nenkin-rate 厚生年金保険料率, ' +
          'kokumin-nenkin-premium 国民年金保険料 FY2026 and FY2027, kiso-nenkin-full-monthly 老齢基礎年金 満額), employment-insurance (雇用保険料率 FY2026, employee / employer / total per ' +
          '1,000, three business types), benefits (児童手当 monthly amounts, 出産育児一時金, 高額療養費 ceilings for under-70s before ' +
          'August 2026, August 2026 – July 2027 and from August 2027), holidays (国民の祝日 2027), consumption-tax (10% and 8%, ' +
          'national and local portions), income-tax (基礎控除 table for 2024 to 2028+, 給与所得控除 tables for 2025 and 2026) and ' +
          'resident-tax (均等割 and 森林環境税). Each figure carries its value, unit, the Japanese term, the quoted row from the page, ' +
          'its source URL and effectiveFrom (and effectiveTo where the source states an end); the answer carries verifiedDate, ' +
          'freshness and a citation permalink. No category returns the listing; an unknown category answers covered:false with the ' +
          'nearest keys.',
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
    scope: 'Japan. National figures from MHLW (厚生労働省), NTA (国税庁), 総務省, 内閣府, こども家庭庁 and 日本年金機構; health insurance rates are those of 全国健康保険協会（協会けんぽ）. Minimum wages and 協会けんぽ rates by prefecture (47 each). Each category names its official page; every figure carries its own source.',
    notCovered: [
      'the proposed 1% consumption-tax rate on food from 2027-04-01 to 2029-03-31 (pending legislation: the bill has not passed)',
      'health insurance rates of 組合健保, 共済組合 and 国民健康保険 (only 協会けんぽ), and 協会けんぽ 任意継続 premiums or per-prefecture 保険料額表',
      'industry-specific minimum wages (特定最低賃金) and minimum wages before FY2025',
      'income tax rates (所得税の税率表), other deductions (配偶者控除, 扶養控除 …), 住民税 所得割 and local surcharges (超過課税)',
      '高額療養費 tables for people aged 70 and over, and the 外来特例',
      '老齢厚生年金 amounts, 年金生活者支援給付金 and 在職老齢年金 thresholds',
      'national holidays other than 2027 (the 2028 list is published by 内閣府 in February 2027)',
    ],
  }),

  freshness: { dataFile: 'data/jp-living-costs.json', cadenceDays: CADENCE_DAYS, data: DATA },

  changelog: {
    diff: (prev, next) => diffCategories(AREA, prev, next, { key: KEY, previous: PREVIOUS, effectiveFrom: FROM }),
    files: ['data/jp-living-costs.json'],
    previous: PREVIOUS,
    // scripts/changelog.js pre-fills every blank note with this. Placeholders: {label} {key} {from} {to} {unit} {effectiveFrom}
    // {source} {title} (category) {quote} {document} (quote, else source) {previousDocument} (previous.title/document/source)
    note: noteTemplate('{label}: {from} → {to} {unit} from {effectiveFrom} ({source})', { key: KEY }),
    context: () => 'Japan (national figures; health insurance rates are 協会けんぽ)',
  },
  discovery: {
    description: 'Japan daily-life official figures verified against MHLW, NTA, 総務省, 内閣府, こども家庭庁, 日本年金機構 and 協会けんぽ pages: 地域別最低賃金 FY2026 by prefecture with effective dates, 協会けんぽ health insurance rates by prefecture, 介護 and 子ども・子育て支援金 rates, 厚生年金 and 国民年金, 雇用保険料率, 児童手当, 出産育児一時金, 高額療養費, the 2027 holidays, 消費税, 基礎控除, 給与所得控除 and 住民税 均等割.',
    cadence: 'Re-verified against the official pages every 35 days and on the known change dates (prefecture minimum wages 2026-10-01 to 2026-12-02 and each autumn, deductions 2026-12-01, insurance and pension rates each March/April, 高額療養費 2027-08-01, the 2028 holidays in February 2027); every source page re-fetched weekly.',
  },

  // Every category's source and every figure's own source, each URL once.
  sources: () => categorySources(DATA),

  rest: [
    { path: REST_PATH, tool: TOOL, args: pick /* no `required`: an empty query answers the listing, like uk_rates_lookup */ },
  ],

  hub: {
    changed: 'Japanese minimum wages by prefecture, 協会けんぽ health insurance rates, 雇用保険料率 and income-tax deductions',
    coverage: 'Japanese daily-life figure categories (minimum wage, health insurance, pension, employment insurance, benefits, holidays, consumption tax, income tax, resident tax)',
    catalogue: 'Japan daily-life official figures (jp_living_costs_lookup: 最低賃金, 健康保険料率, 年金, 雇用保険, 児童手当, 高額療養費, 祝日, 消費税, 基礎控除, 住民税)',
    call: 'jp_living_costs_lookup (Japan minimum wage by prefecture, 協会けんぽ rates, pensions, employment insurance, benefits, 2027 holidays, consumption tax, income-tax deductions, resident tax — verified against MHLW, NTA, 総務省, 内閣府, こども家庭庁, 日本年金機構 and 協会けんぽ pages)',
  },

  docs: {
    readme: {
      // The # cell is numbered by scripts/sync-areas.js from `order`; start at the Vertical cell.
      roadmapRow: '| **Japan daily-life official figures** — `jp_living_costs_lookup`: the figures a resident or employer in Japan looks up (地域別最低賃金 FY2026 for all 47 prefectures with their staggered 発効日 and FY2025 amounts, 協会けんぽ rates by prefecture with 介護 and 子ども・子育て支援金, 厚生年金 / 国民年金, 雇用保険料率, 児童手当, 出産育児一時金, 高額療養費 through the 2026 and 2027 revisions, 2027 祝日, 消費税, 基礎控除 / 給与所得控除, 住民税 均等割), each with the Japanese term and the quoted official row; prefecture figures are individual facts (`jp/minimum-wage/tokyo`) | `/api/mcp/jp-living-costs` | **v1 — built 2026-10-24** |',
      catalogueRow: `| \`/api/mcp/jp-living-costs\` | \`jp_living_costs_lookup\` — category ∈ {${CATEGORIES.join(', ')}} (omit to list) | \`data/jp-living-costs.json\` (${FIGURE_COUNT} figures): read from MHLW's 令和8年度 地域別最低賃金 全国一覧 PDF, 協会けんぽ's 令和8年度 都道府県単位保険料率 table and 介護 / 支援金 pages, 日本年金機構's 保険料 pages, MHLW's 年金額改定, 雇用保険料率, 出産育児一時金 and 高額療養費 documents, こども家庭庁's 児童手当 page, 内閣府's 祝日 CSV, NTA タックスアンサー No.6303 / 1199 / 1410 and 総務省's 個人住民税 page; every figure carries \`term\` (Japanese), \`label\` (English), \`quote\`, \`source\`, \`effectiveFrom\`/\`effectiveTo\`. Refresh every 35 days and on the change dates (docs/CURATION.md) |`,
    },
    llms: {
      rest: [
        `- \`GET https://databutler.dev/api/${REST_PATH}?category=minimum-wage\` — Japan daily-life official figures (category = ${CATEGORIES.join(' | ')}; omit to list): 地域別最低賃金 FY2026 for all 47 prefectures (Tokyo 1,280 yen/hour from 2026-10-01; national weighted average 1,177; each prefecture's own effectiveFrom and the FY2025 amount as previous), 協会けんぽ health insurance rates by prefecture, 介護保険料率 and 子ども・子育て支援金率, 厚生年金 and 国民年金, 雇用保険料率, 児童手当, 出産育児一時金, 高額療養費, the 2027 national holidays, 消費税, 基礎控除 / 給与所得控除 and 住民税 均等割 — each figure verified against the MHLW, NTA, 総務省, 内閣府, こども家庭庁, 日本年金機構 or 協会けんぽ page with the quoted row, source URL and effectiveFrom.`,
      ],
      server: `- \`POST https://databutler.dev/api/mcp/jp-living-costs\` — tool \`jp_living_costs_lookup\` (category = ${CATEGORIES.join(' | ')}): Japan minimum wages by prefecture, social-insurance and pension rates, benefits, holidays and tax thresholds, verified against the official Japanese pages with the quoted row and source URL on every figure. REST mirror: \`GET https://databutler.dev/api/${REST_PATH}?category=…\`.`,
    },
    curation: ['| `data/jp-living-costs.json` | Every 35 days (`nextScheduledRefresh` = verifiedDate + 35), and on the change dates: each autumn\'s 地域別最低賃金 (答申 in August, 発効 October–December; MHLW 全国一覧 PDF), 協会けんぽ rates, 介護保険料率 and 子ども・子育て支援金率 each March, 雇用保険料率, 国民年金保険料 and 年金額 each April (announced January–March), 高額療養費 2027-08-01, the 2026 deductions from 2026-12-01 and each December\'s 税制改正大綱, the 2028 holidays (内閣府, February 2027), and the 1% food consumption-tax rate once its bill passes. The weekly watcher hashes every source page. | Re-fetch every `source` (PDFs: `pdftotext -layout`; the 祝日 CSV is Shift_JIS); compare each figure\'s `quote` with the page; for a changed value move the old one into `previous` (`value`, `period`, `source`, `title`) and write the new `value`, `quote`, `effectiveFrom`, `period`; for a new fiscal year\'s minimum wages update all 47 prefectures with their new 発効日; bump `verifiedDate`; `node scripts/changelog.js --only jp-living-costs` (stamps `nextScheduledRefresh`, appends one entry per figure that moved, re-hashes this area\'s sources); review the notes; `node scripts/sign-facts.js`. |'],
    index: { blurb: 'Japanese minimum wages by prefecture, 協会けんぽ health insurance rates, pensions, 雇用保険, 児童手当, 高額療養費, 2027 holidays, 消費税 and income-tax deductions, verified against MHLW, NTA and other official pages' },
    api: () => ({
      endpoints: {
        [`GET /api/${REST_PATH}`]: {
          description:
            `Japan daily-life official figures, verified ${DATA.verifiedDate} against the official pages: 地域別最低賃金 FY2026 by prefecture ` +
            '(with each 発効日 and the FY2025 amount), 協会けんぽ health insurance rates by prefecture, 介護 and 子ども・子育て支援金 rates, ' +
            '厚生年金 / 国民年金, 雇用保険料率, 児童手当, 出産育児一時金, 高額療養費, 2027 national holidays, 消費税, 基礎控除 / 給与所得控除 ' +
            'and 住民税 均等割 — each figure with the Japanese term, quoted row, source URL and effectiveFrom.',
          params: {
            category: `one of ${CATEGORIES.join(', ')} (omit to list)`,
          },
          example: `https://databutler.dev/api/${REST_PATH}?category=minimum-wage`,
        },
      },
      coverage: { jpLivingCosts: `${CATEGORIES.length} categories, ${FIGURE_COUNT} figures, verified ${DATA.verifiedDate}` },
    }),
  },

  // Verified Facts: /f/jp/<category>/<key> (api/_areas/README.md "facts"); the categories do not overlap jp-vehicle-costs'
  // (weight-tax, cali, inspection-fee, auto-tax, kei-tax …), so no prefix is needed. Period labels are Japanese fiscal or
  // tax years where the source states one (minimum wage FY2026 = '2026'); the previous block, when it carries a source and
  // a period, is served as its own period (?period=2025), ending the day before the new figure's effectiveFrom.
  facts: {
    namespace: 'jp',
    key: KEY,
    period: (d, f) => f.period ?? null,
    previousPeriod: (d, f, p) => p.period ?? null,
    effectiveTo: (d, f) => f.effectiveTo || null,
    // Synonyms are shared across areas: each Japanese term maps to words only this area's labels carry (nenkin, kenpo,
    // "regional minimum wage" …), so 最低賃金 finds the Japanese figures and English queries for the UK, US and German
    // figures rank as before. Pension keys are romanised (kosei-nenkin, kokumin-nenkin, kiso-nenkin) for the same reason.
    synonyms: {
      '最低賃金': 'regional minimum wage', '地域別最低賃金': 'regional minimum wage',
      '健康保険料率': 'kenpo health insurance', '健康保険': 'kenpo health insurance', '協会けんぽ': 'kenpo',
      '介護保険料率': 'kenpo long-term-care', '子育て支援金': 'child-rearing levy',
      '年金': 'nenkin', '厚生年金': 'kosei nenkin', '国民年金': 'kokumin nenkin', '基礎年金': 'kiso nenkin', '老齢基礎年金': 'kiso nenkin',
      '雇用保険': 'employment insurance contribution', '雇用保険料率': 'employment insurance contribution',
      '児童手当': 'child allowance', '出産育児一時金': 'childbirth lump-sum', '高額療養費': 'high-cost medical',
      '祝日': 'holidays', '国民の祝日': 'holidays', 'public holiday': 'holidays',
      '消費税': 'consumption tax', '基礎控除': 'basic deduction', '給与所得控除': 'employment income deduction',
      '住民税': 'resident tax per-capita levy', '均等割': 'per-capita levy',
    },
  },

  verify: [
    { label: 'jp-living-costs-listing', kind: 'tool', tool: TOOL, args: {}, assert: "'categories' in d and 'minimum-wage' in d['categories'] and 'freshness' in d" },
    { label: 'jp-living-costs-rest-listing', kind: 'rest', path: REST_PATH, query: '', assert: "'categories' in d and 'cite' in d" },
    { label: 'call-jp-living-costs-minimum-wage', kind: 'tool', tool: TOOL, args: { category: 'minimum-wage' }, assert: "d['category']=='minimum-wage' and any(f['key']=='tokyo' and f['value']==1280 and f['effectiveFrom']=='2026-10-01' for f in d['figures']) and d['source'].startswith('https://www.mhlw.go.jp/') and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/jp/living-costs?category=minimum-wage'" },
    { label: 'rest-jp-living-costs-health-insurance', kind: 'rest', path: REST_PATH, query: 'category=health-insurance', assert: "d['category']=='health-insurance' and any(f['key']=='tokyo' and f['value']==9.85 for f in d['figures']) and any(f['key']=='child-rearing-levy' and f['value']==0.23 for f in d['figures'])" },
    { label: 'call-jp-living-costs-nearmiss', kind: 'tool', tool: TOOL, args: { category: 'saiteichingin' }, assert: "d.get('covered')==False and len(d['nearest'])>0" },
  ],
};
