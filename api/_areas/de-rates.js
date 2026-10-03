/**
 * Area: de-rates — German federal tax and social-insurance figures for one
 * Veranlagungszeitraum, read from the consolidated statutes on
 * gesetze-im-internet.de (EStG, SolzG, SGB III/IV/V/VI/XI, MiLoV5, PBAV), the
 * Bundesgesetzblatt (SV-Rechengrößen-Verordnung, SteFeG, StÄndG 2025) and the
 * BMG, DRV, BMAS, BMFSFJ and Minijob-Zentrale pages named in each figure's
 * `source`. Every figure carries the German `term` and an English `label`, the
 * sentence it was read from as `quote`, and its prior value as `previous`;
 * figures already fixed for the following year (Mindestlohn, Geringfügigkeits-
 * grenze 2027) carry their own effectiveFrom. Data: data/de-rates.json.
 * Refreshed once a year when the Sozialversicherungsrechengrößen-Verordnung is
 * promulgated and the Zusatzbeitrag announced (November) and after any
 * Steuergesetz that rewrites § 32a EStG; `nextScheduledRefresh` is set by hand
 * and the file diffed by `node scripts/changelog.js`.
 * Contract: api/_areas/README.md. Playbook: docs/ADDING_AN_AREA.md.
 */
const DATA = require('../../data/de-rates.json');
const { BASE, diffCategories, slug, categoriesLookup } = require('../_area_kit');

const AREA = 'de-rates';
const TOOL = 'de_rates_lookup';
const CATEGORIES = Object.keys(DATA.categories);
const TAX_YEAR = DATA.taxYear;
/** Header (area, taxYear, taxYearRuns, jurisdiction, currency, verifiedDate) + listing / category / near-miss, house style (api/_area_kit.js). */
const lookup = categoriesLookup(DATA, AREA);

/**
 * Pages the Monday watcher re-fetches (docs/CURATION.md): the consolidated statute
 * text for every figure that lives in a statute (it cannot lag the BGBl by more than
 * days), the BMAS Verordnung page whose "Umsetzungsstand" flips when the next
 * SV-Rechengrößen-VO is promulgated, the BMG contributions table (Zusatzbeitrag,
 * which no statute prints), the DRV values page (RV rate, Geringfügigkeitsgrenze
 * history) and the Minijob-Zentrale limit page. bundesfinanzministerium.de serves
 * a CAPTCHA to automated fetches, so no BMF page is watched.
 */
const WATCH = [
  { url: 'https://www.gesetze-im-internet.de/estg/__32a.html', label: '§ 32a EStG — Einkommensteuertarif (Grundfreibetrag, Tarifzonen, Steuersätze)' },
  { url: 'https://www.gesetze-im-internet.de/solzg_1995/__3.html', label: '§ 3 SolzG — Solidaritätszuschlag Freigrenzen' },
  { url: 'https://www.bmas.de/DE/Service/Gesetze-und-Gesetzesvorhaben/sozialversicherungs-rechengroessenverordnung-2027.html', label: 'BMAS — Sozialversicherungsrechengrößen-Verordnung 2027 (Umsetzungsstand flips from "Noch nicht veröffentlicht" to the BGBl date)' },
  { url: 'https://www.bundesgesundheitsministerium.de/beitraege', label: 'BMG — Beitragssätze und Beitragsbemessungsgrenzen (allgemeiner, ermäßigter und durchschnittlicher Zusatzbeitragssatz)' },
  { url: 'https://www.deutsche-rentenversicherung.de/DRV/DE/Experten/Zahlen-und-Fakten/Werte-der-Rentenversicherung/werte-der-rentenversicherung_node.html', label: 'DRV — Werte der Rentenversicherung (Beitragssätze, BBG, Bezugsgröße, Geringfügigkeitsgrenze history)' },
  { url: 'https://www.bmas.de/DE/Arbeit/Arbeitsrecht/Mindestlohn/Einfuehrung-und-Anpassungen-Mindestlohn/einfuehrung-und-anpassung-mindestlohn.html', label: 'BMAS — Einführung und Anpassung des Mindestlohns (history table with the Verordnung per step)' },
  { url: 'https://www.minijob-zentrale.de/DE/die-minijobs/minijob-mit-verdienstgrenze', label: 'Minijob-Zentrale — Minijob mit Verdienstgrenze (monthly and annual limit)' },
  { url: 'https://www.gesetze-im-internet.de/estg/__66.html', label: '§ 66 EStG — Kindergeld' },
  { url: 'https://www.gesetze-im-internet.de/estg/__32.html', label: '§ 32 EStG — Kinderfreibetrag und BEA-Freibetrag' },
  { url: 'https://www.gesetze-im-internet.de/estg/__20.html', label: '§ 20 EStG — Sparer-Pauschbetrag' },
  { url: 'https://www.gesetze-im-internet.de/estg/__9a.html', label: '§ 9a EStG — Arbeitnehmer-Pauschbetrag' },
  { url: 'https://www.gesetze-im-internet.de/estg/__9.html', label: '§ 9 EStG — Entfernungspauschale' },
];

/** A figure already fixed for a later year (Mindestlohn 2027, Geringfügigkeitsgrenze 2027) is logged under that year. */
const taxYearOf = (n, f) => ((f.effectiveFrom || '').slice(0, 4) > String(n.taxYear) ? f.effectiveFrom.slice(0, 4) : n.taxYear);

module.exports = {
  area: AREA,
  order: 100,
  title: 'German rates & thresholds',
  short: 'German tax and social-insurance thresholds',

  server: {
    serverName: 'databutler-de-rates',
    description: "Current German tax and social-insurance figures — Grundfreibetrag and § 32a tariff, Solidaritätszuschlag, Beitragsbemessungsgrenzen and Beitragssätze, Zusatzbeitrag, Mindestlohn, Minijob limit, Kindergeld, Kinderfreibetrag, Pauschbeträge, Entfernungspauschale — read from the consolidated statutes and the Bundesgesetzblatt, with German term, English label, source URL, quoted sentence, verification date and prior value on every figure.",
    url: `${BASE}/api/mcp/de-rates`,
    instructions:
      `Verified German tax and social-insurance figures from databutler.dev — Veranlagungszeitraum ${TAX_YEAR}, each figure read from ` +
      'the consolidated statute on gesetze-im-internet.de, the Bundesgesetzblatt or the BMG/DRV/BMAS/Minijob-Zentrale page named in its ' +
      'source, with the German term, an English label, the quoted sentence and verifiedDate. Use de_rates_lookup instead of quoting ' +
      'German figures from memory: the Beitragsbemessungsgrenzen, Bezugsgröße and Zusatzbeitrag move every January and the ' +
      'Grundfreibetrag, Kindergeld and Kinderfreibetrag with each Steuergesetz, so training data is stale by the first change after ' +
      'the cutoff. Present taxYear, source and verifiedDate with any figure; social-insurance rates carry employeeShare and ' +
      'employerShare, and the Zusatzbeitrag served is the statutory average (each Krankenkasse sets its own). Figures already fixed ' +
      'for the following year (Mindestlohn, Geringfügigkeitsgrenze) carry their own effectiveFrom — present it. Kirchensteuer, ' +
      'Lohnsteuerklassen and Gewerbesteuer are not covered (coverage lists them). Cite https://databutler.dev/ and the source.',
    tools: [
      {
        name: TOOL,
        title: 'German rates lookup',
        description:
          `Current German (Veranlagungszeitraum ${TAX_YEAR}) tax and social-insurance figures read from the consolidated statutes on ` +
          'gesetze-im-internet.de, the Bundesgesetzblatt and the BMG, DRV, BMAS, BMFSFJ and Minijob-Zentrale pages named in each ' +
          'figure\'s source — each with the German term and an English label, the quoted sentence, verifiedDate and the prior value ' +
          'where one exists. Categories: income-tax (Grundfreibetrag, § 32a tariff zones with their coefficients, Eingangssteuersatz, ' +
          'Spitzensteuersatz and Reichensteuer thresholds, Solidaritätszuschlag rate, Freigrenzen and Milderungszone), social-insurance ' +
          '(Beitragsbemessungsgrenzen RV/AV and KV/PV annual and monthly, Jahresarbeitsentgeltgrenze, Bezugsgröße, vorläufiges ' +
          'Durchschnittsentgelt, KV/RV/AV/PV Beitragssätze with employee and employer shares, durchschnittlicher Zusatzbeitrag, ' +
          'Kinderlosenzuschlag and Kinderabschlag, Sachsen split), minimum-wage (Mindestlohn 2026 and the fixed 2027 step), minijob ' +
          '(Geringfügigkeitsgrenze 2026 and 2027, Midijob upper limit), kindergeld, kinderfreibetrag (Kinderfreibetrag, BEA-Freibetrag, ' +
          'total per child), sparer-pauschbetrag, arbeitnehmer-pauschbetrag, entfernungspauschale. Federal law only: Kirchensteuer by ' +
          'Land, Lohnsteuerklassen mechanics and Gewerbesteuer are not covered, and 2027 draft figures are not served. An unknown ' +
          'category answers covered:false with the nearest keys.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: `one of: ${CATEGORIES.join(', ')} (omit to list all)` },
          },
        },
        run: (a) => lookup(a),
        freshness: AREA,
        cite: (a) => ({ path: 'de/rates', query: { category: a.category } }),
      },
    ],
  },

  coverage: () => ({
    taxYears: [TAX_YEAR],
    categories: CATEGORIES,
    verifiedDate: DATA.verifiedDate,
    scope: `${DATA.jurisdiction} Each figure names the statute, Bundesgesetzblatt or ministry page it was read from and keeps the quoted sentence; German term and English label on every figure.`,
    notCovered: [
      'Kirchensteuer rates by Land (8 % in Bayern and Baden-Württemberg, 9 % elsewhere) and the Kirchensteuer cap rules',
      'Lohnsteuerklassen mechanics (§ 39b EStG withholding procedure, Steuerklasse III/V/VI effects, Faktorverfahren)',
      'Gewerbesteuer (Messzahl and municipal Hebesätze)',
      'the Zusatzbeitrag of an individual Krankenkasse (only the statutory average durchschnittlicher Zusatzbeitragssatz is served)',
      'Umlagen U1/U2 and Insolvenzgeldumlage (employer-side, Krankenkasse-specific)',
      '2027 draft figures — the Sozialversicherungsrechengrößen-Verordnung 2027 (Referentenentwurf of 21 September 2026: Bezugsgröße, Beitragsbemessungsgrenzen, Jahresarbeitsentgeltgrenze) and the 2027 Zusatzbeitrag: draft, not served; only the enacted Mindestlohn 14,60 € and Geringfügigkeitsgrenze 633 € for 2027 are included',
      `prior years (the ${Number(TAX_YEAR) - 1} value is kept only as each figure's previous)`,
    ],
  }),

  // Calendar-driven: the SV-Rechengrößen-VO and the Zusatzbeitrag for the next year are normally final by mid-December,
  // so nextScheduledRefresh is set by hand in the file (2026-12-15 for 2027); freshness turns `due` from that day.
  freshness: { dataFile: 'data/de-rates.json', cadenceDays: null, data: DATA },

  changelog: {
    // Figures carry a stable `key`, their own `source`, `effectiveFrom` and a `previous` block, so a figure's first
    // appearance records previous → current (the 2027 Mindestlohn and Geringfügigkeitsgrenze record 2026 → 2027).
    diff: (prev, next) => diffCategories(AREA, prev, next, {
      key: (f) => f.key || slug(f.label),
      previous: true,
      effectiveFrom: (n, f) => f.effectiveFrom || `${n.taxYear}-01-01`,
      // Entries read "German term / English label" so /changes and feeds carry both names.
      extra: (n, cat, f) => ({ taxYear: taxYearOf(n, f), ...(f.term ? { term: f.term, label: `${f.term} / ${f.label}` } : {}) }),
    }),
    files: ['data/de-rates.json'],
    context: (e) => (e.taxYear ? `Veranlagungszeitraum ${e.taxYear}` : ''),
  },
  discovery: {
    description: 'German tax and social-insurance figures read from the consolidated statutes, the Bundesgesetzblatt and the BMG/DRV/BMAS pages: Grundfreibetrag and § 32a tariff, Solidaritätszuschlag, Beitragsbemessungsgrenzen and Beitragssätze, Zusatzbeitrag, Mindestlohn, Geringfügigkeitsgrenze, Kindergeld, Kinderfreibetrag, Pauschbeträge, Entfernungspauschale.',
    cadence: 'Annual: after the Sozialversicherungsrechengrößen-Verordnung and the Zusatzbeitrag announcement (November), and any Steuergesetz changing § 32a EStG for the next Veranlagungszeitraum; every source page re-fetched weekly.',
  },

  sources: () => WATCH,

  rest: [
    { path: 'de/rates', tool: TOOL, args: (q) => ({ category: q.category }) },
  ],

  hub: {
    changed: 'German tax and social-insurance thresholds (Grundfreibetrag, Beitragsbemessungsgrenzen, Zusatzbeitrag, Mindestlohn, Kindergeld)',
    coverage: 'German rate categories and Veranlagungszeitraum',
    catalogue: 'German tax and social-insurance figures (de_rates_lookup: Einkommensteuertarif, Sozialversicherung, Mindestlohn, Minijob, Kindergeld, Kinderfreibetrag, Pauschbeträge, Entfernungspauschale)',
    call: 'de_rates_lookup (German tax and social-insurance figures for the current Veranlagungszeitraum: income-tax, social-insurance, minimum-wage, minijob, kindergeld, kinderfreibetrag, sparer-pauschbetrag, arbeitnehmer-pauschbetrag, entfernungspauschale)',
    frontDoor: 'German figures (Grundfreibetrag and tariff, Beitragsbemessungsgrenzen and Beitragssätze, Mindestlohn, Minijob limit, Kindergeld, Pauschbeträge) come from de_rates_lookup via call rather than memory.',
  },

  docs: {
    readme: {
      roadmapRow: `| **German rates & thresholds** — \`de_rates_lookup\`: Veranlagungszeitraum ${TAX_YEAR} Einkommensteuertarif (§ 32a) and Solidaritätszuschlag, Sozialversicherung Beitragsbemessungsgrenzen, Rechengrößen and Beitragssätze, Mindestlohn (2026 and the fixed 2027 step), Geringfügigkeitsgrenze, Kindergeld, Kinderfreibetrag, Pauschbeträge and Entfernungspauschale, read from the consolidated statutes and the Bundesgesetzblatt with German term + English label, quoted sentence and prior value; country #3 on the "is this still true?" layer | \`/api/mcp/de-rates\` | **v1 — built 2026-10-03** |`,
      catalogueRow: `| \`/api/mcp/de-rates\` | \`de_rates_lookup\` — category ∈ {${CATEGORIES.join(', ')}} (omit to list) | \`data/de-rates.json\` (Veranlagungszeitraum ${TAX_YEAR}, ${Object.values(DATA.categories).reduce((n, c) => n + c.figures.length, 0)} figures): read from § 32a/§ 9/§ 9a/§ 20/§ 32/§ 66 EStG, §§ 3–4 SolzG, SV-Rechengrößen-VO 2026 (BGBl. 2025 I Nr. 278), § 241 SGB V, § 341 SGB III, § 55 SGB XI + PBAV 2025, § 8 SGB IV, MiLoV5 and the BMG/DRV/BMAS/BMFSFJ/Minijob-Zentrale pages; every figure carries \`term\` (German), \`label\` (English), \`quote\` and \`previous\`; social-insurance rates carry \`employeeShare\`/\`employerShare\`. **Committed data, not a live proxy**; freshness turns \`due\` at the hand-set \`nextScheduledRefresh\` (mid-December, when the next year's Verordnung and Zusatzbeitrag are final). Refresh: edit against the BGBl/statutes, \`node scripts/changelog.js\` (docs/CURATION.md) |`,
    },
    llms: {
      rest: [
        `- \`GET https://databutler.dev/api/de/rates?category=social-insurance\` — current German (Veranlagungszeitraum ${TAX_YEAR}) tax and social-insurance figures (Grundfreibetrag and § 32a tariff zones, Solidaritätszuschlag, Beitragsbemessungsgrenzen RV/AV and KV/PV, Jahresarbeitsentgeltgrenze, Bezugsgröße, KV/RV/AV/PV Beitragssätze with employee and employer shares, durchschnittlicher Zusatzbeitrag, Mindestlohn 2026/2027, Geringfügigkeitsgrenze, Kindergeld, Kinderfreibetrag, Sparer- and Arbeitnehmer-Pauschbetrag, Entfernungspauschale), each figure read from the statute, Bundesgesetzblatt or ministry page named as its source, with German term + English label, the quoted sentence, verifiedDate and the prior value. Omit category to list the categories.`,
      ],
      server: `- \`POST https://databutler.dev/api/mcp/de-rates\` — tool \`de_rates_lookup\` (category = ${CATEGORIES.join(' | ')}, or omit to list): current German (Veranlagungszeitraum ${TAX_YEAR}) tax and social-insurance figures read from the consolidated statutes on gesetze-im-internet.de, the Bundesgesetzblatt and the BMG/DRV/BMAS/Minijob-Zentrale pages, each with German term and English label, source, the quoted sentence, verifiedDate and the prior value; social-insurance rates carry employee and employer shares; the Mindestlohn and Geringfügigkeitsgrenze already fixed for 2027 carry their own effectiveFrom. Kirchensteuer, Lohnsteuerklassen and Gewerbesteuer answer covered:false; 2027 draft Rechengrößen are not served. Committed data, not a live proxy; freshness turns \`due\` in mid-December when the next year's Verordnung is final. REST mirror: \`GET https://databutler.dev/api/de/rates?category=…\`.`,
    },
    curation: [
      '| `data/de-rates.json` | Annual, calendar-driven (`cadenceDays: null`; `nextScheduledRefresh` set by hand, 2026-12-15 for 2027): the Sozialversicherungsrechengrößen-Verordnung in the BGBl (late November; the BMAS Verordnung page\'s "Umsetzungsstand" flips first), the durchschnittlicher Zusatzbeitragssatz in the Bundesanzeiger (by 1 November; BMG `/beitraege` table), any Steuergesetz rewriting § 32a/§ 32/§ 66 EStG (consolidated text on gesetze-im-internet.de within days), the Mindestlohnkommission decision (by 30 June of the year before). The weekly watcher hashes the twelve pages in `sources()`. | Open the BGBl PDF on recht.bund.de and the consolidated § pages; for each figure move `value` into `previous` (with its source and quote), write the new `value`, `effectiveFrom`, `source`, `quote`, `verifiedDate`; promote the already-fixed next-year figures (Mindestlohn, Geringfügigkeitsgrenze) and add the following year\'s if enacted; bump `taxYear`, `taxYearRuns`, `verifiedDate`, set `nextScheduledRefresh`; then `node scripts/changelog.js` (one `de-rates` entry per figure that moved; refreshes `data/sources.json`); fill each `note` with the Verordnung/Gesetz and BGBl citation. bundesfinanzministerium.de serves a CAPTCHA to curl — the statutes and BGBl are the primary sources anyway. |',
    ],
    index: { blurb: `German Veranlagungszeitraum ${TAX_YEAR}: Grundfreibetrag and tariff, Beitragsbemessungsgrenzen and Beitragssätze, Mindestlohn, Minijob, Kindergeld, Pauschbeträge, read from the statutes and the Bundesgesetzblatt` },
    api: () => ({
      endpoints: {
        'GET /api/de/rates': {
          description:
            `German tax and social-insurance figures for Veranlagungszeitraum ${TAX_YEAR}, verified ${DATA.verifiedDate} against the consolidated statutes, ` +
            'the Bundesgesetzblatt and the BMG/DRV/BMAS pages: Grundfreibetrag and § 32a tariff zones, Solidaritätszuschlag, Beitragsbemessungsgrenzen, ' +
            'Bezugsgröße, Beitragssätze with employee/employer shares, Zusatzbeitrag, Mindestlohn (2026 and fixed 2027), Geringfügigkeitsgrenze, Kindergeld, ' +
            'Kinderfreibetrag, Pauschbeträge, Entfernungspauschale — each figure with German term, English label, source, quote, verifiedDate and prior value. ' +
            'Committed data (not a live proxy), refreshed annually when the next year\'s Verordnung is final.',
          params: { category: `one of ${CATEGORIES.join(', ')} (omit to list)` },
          example: 'https://databutler.dev/api/de/rates?category=social-insurance',
        },
      },
      coverage: { deRates: `Veranlagungszeitraum ${TAX_YEAR}, ${CATEGORIES.length} categories, verified ${DATA.verifiedDate}; federal law only (no Kirchensteuer, Lohnsteuerklassen, Gewerbesteuer)` },
      mcp: `Remote MCP server — tool de_rates_lookup (German tax and social-insurance figures, Veranlagungszeitraum ${TAX_YEAR}; committed data read from the statutes and the Bundesgesetzblatt).`,
    }),
  },

  verify: [
    { label: 'de-rates-listing', kind: 'tool', tool: TOOL, args: {}, assert: `'categories' in d and 'freshness' in d and d['taxYear']=='${TAX_YEAR}' and 'social-insurance' in d['categories']` },
    { label: 'call-de-rates-income-tax', kind: 'tool', tool: TOOL, args: { category: 'income-tax' }, assert: "d['category']=='income-tax' and d['source'].startswith('https://www.gesetze-im-internet.de/') and all(f['term'] for f in d['figures']) and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/de/rates?category=income-tax'" },
    { label: 'call-de-rates-nearmiss', kind: 'tool', tool: TOOL, args: { category: 'kirchensteuer' }, assert: "d['covered']==False and 'income-tax' in d['coverage'] and len(d['nearest'])>0" },
    { label: 'rest-de-rates', kind: 'rest', path: 'de/rates', query: 'category=minimum-wage', assert: "d['category']=='minimum-wage' and 'freshness' in d and d['cite']['url']=='https://databutler.dev/r/de/rates?category=minimum-wage'" },
  ],
};
