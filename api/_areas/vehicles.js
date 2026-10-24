/**
 * Area: vehicles — one hub for official vehicle datasets: UK MOT failure data
 * (live proxy to whatbreaks.uk, api/_mot.js), UK recalls (DVSA), French
 * recalls (RappelConso) and Japanese recalls + complaints (MLIT), all served
 * from committed files built by scripts/vehicles.js (api/_vehicles.js). EU
 * Safety Gate is a stub. Three datasets → three freshness keys.
 */
const V = require('../_vehicles');
const { motReliability, motVehicleSearch } = require('../_mot');
const { BASE } = require('../_area_kit');

const AREA = 'vehicles';

module.exports = {
  area: AREA,
  order: 50,
  title: 'Vehicles hub',
  short: 'official vehicle datasets',

  server: {
    serverName: 'databutler-vehicles',
    description: 'UK MOT failure data and official UK, French, Japanese and EU vehicle recalls.',
    url: `${BASE}/api/mcp/vehicles`,
    instructions:
      'Official vehicle datasets from databutler.dev, one hub: UK MOT failure data (live from whatbreaks.uk — real ' +
      'DfT test outcomes), UK safety recalls (DVSA open data), French recalls (RappelConso / DGCCRF open data) and ' +
      'Japanese recalls + owner complaints (MLIT). ' +
      'Every result names its official source and verifiedDate; recall texts are the official ' +
      'English/French/Japanese originals — translate for the user but keep the recall/fiche/notification number and ' +
      'link. Counts are not reliability rankings (sales volume, multi-model campaigns). EU Safety Gate is a stub for ' +
      'now. Every result carries cite.url (a databutler.dev permalink) and its official source.',
    tools: [
      {
        name: 'uk_mot_reliability',
        title: 'UK MOT reliability',
        description:
          'Real UK MOT failure data for a used car: per-category failure rates (overall and interpolated at a given ' +
          'mileage) and the riskiest components with typical failure mileages, for one model generation. Live proxy ' +
          'to whatbreaks.uk (same operator; aggregated from DfT anonymised MOT results). Use when a user is buying, ' +
          'comparing or maintaining a car sold in the UK. If several generations match, the result lists candidates — ' +
          'retry with year or the exact model name.',
        inputSchema: {
          type: 'object',
          properties: {
            make: { type: 'string', description: 'e.g. Volkswagen' },
            model: { type: 'string', description: 'e.g. Golf — generation resolved via year' },
            year: { type: 'number', description: 'optional registration year' },
            mileage: { type: 'number', description: 'optional current mileage in miles' },
          },
          required: ['make', 'model'],
        },
        run: (a) => motReliability(a),
        freshness: 'live',
        openWorld: true,
        cite: (a) => ({ path: 'vehicles/uk/mot', query: { make: a.make, model: a.model, year: a.year, mileage: a.mileage } }),
      },
      {
        name: 'uk_mot_vehicle_search',
        title: 'UK MOT vehicle search',
        description:
          'Search the 530 UK model generations covered by the MOT dataset by free text (e.g. "focus", "golf"). Use to ' +
          'check coverage or disambiguate a generation before uk_mot_reliability. Live proxy to whatbreaks.uk.',
        inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'free-text query' } }, required: ['q'] },
        run: (a) => motVehicleSearch(a),
        freshness: 'live',
        openWorld: true,
        cite: (a) => ({ path: 'vehicles/uk/search', query: { q: a.q } }),
      },
      {
        name: 'uk_recalls_for_model',
        title: 'UK recalls for a model',
        description:
          `Official UK vehicle safety recalls (DVSA, Open Government Licence; ${V.UK.count} recalls launched ` +
          `${V.UK.filter.launchDateFrom} → ${V.UK.dateRange.to}, ${V.UK.makes} makes) for a make and model: recall ` +
          'number, launch date, concern, defect and remedy text (DVSA\'s English originals), build-date range, vehicles ' +
          'affected and a GOV.UK recall-checker link. Omitting model lists the make\'s recalls and model names. "Vauxhall ' +
          'Corsa", "vauxhall corsa" and "VAUXHALL CORSA" resolve identically; "Mercedes-Benz", "VW" and "Land Rover" are ' +
          'understood. Covers cars, vans, HGVs, buses, motorcycles, trailers and components, not individual VINs.',
        inputSchema: {
          type: 'object',
          properties: {
            make: { type: 'string', description: 'e.g. Vauxhall, Mercedes-Benz, VW, Land Rover' },
            model: { type: 'string', description: 'e.g. Corsa, A Class, Golf (optional: omit to list the make)' },
            since: { type: 'string', description: 'optional ISO date YYYY-MM-DD — only recalls launched on/after it' },
          },
          required: ['make'],
        },
        run: (a) => V.ukRecallsForModel(a),
        freshness: 'uk-recalls',
        cite: (a) => ({ path: 'vehicles/uk/recalls', query: { make: a.make, model: a.model, since: a.since } }),
      },
      {
        name: 'uk_recalls_search',
        title: 'UK recalls search',
        description:
          'Keyword search across all served DVSA recalls (make, model names, concern, defect and remedy text), newest ' +
          'first, optionally since a date. Text is English ("airbag", "fire", "steering rack", "takata", "high voltage ' +
          'battery"); every word must appear. Suited to cross-make questions such as recent EV battery fire recalls in ' +
          'the UK.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'words that must all appear, e.g. "airbag takata"' },
            since: { type: 'string', description: 'optional ISO date YYYY-MM-DD — only recalls launched on/after it' },
          },
          required: ['text'],
        },
        run: (a) => V.ukRecallsSearch(a),
        freshness: 'uk-recalls',
        cite: (a) => ({ path: 'vehicles/uk/recalls-search', query: { text: a.text, since: a.since } }),
      },
      {
        name: 'fr_recalls_for_model',
        title: 'French recalls for a model',
        description:
          `Official French vehicle recall notices (RappelConso, DGCCRF open data; ${V.FR.count} automobile fiches ` +
          `${V.FR.dateRange.from} → ${V.FR.dateRange.to}) for a brand and model: fiche number, date, risks, defect ` +
          'description (motif, in French), commercialisation periods and the official fiche link. Omit model to list a ' +
          'brand. Matches by a reviewed alias table plus whole-word text match; each fiche says which.',
        inputSchema: {
          type: 'object',
          properties: {
            brand: { type: 'string', description: 'e.g. peugeot, Mercedes-Benz, VW' },
            model: { type: 'string', description: 'e.g. 208, Classe A, Golf (optional: omit to list the brand)' },
          },
          required: ['brand'],
        },
        run: (a) => V.frRecallsForModel(a),
        freshness: 'fr-recalls',
        cite: (a) => ({ path: 'vehicles/fr/recalls', query: { brand: a.brand, model: a.model } }),
      },
      {
        name: 'fr_recalls_search',
        title: 'French recalls search',
        description:
          'Keyword search across all RappelConso automobile fiches (brand, model text, label, defect description, ' +
          'risks), newest first, optionally since a date. Text is French and lowercase ("airbag", "incendie", ' +
          '"takata", "batterie haute tension"). Use for cross-brand questions ("recent EV battery fire recalls in France").',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'words that must all appear, e.g. "airbag takata"' },
            since: { type: 'string', description: 'optional ISO date YYYY-MM-DD — only fiches published on/after it' },
          },
          required: ['text'],
        },
        run: (a) => V.frRecallsSearch(a),
        freshness: 'fr-recalls',
        cite: (a) => ({ path: 'vehicles/fr/search', query: { text: a.text, since: a.since } }),
      },
      {
        name: 'jp_recalls_for_model',
        title: 'Japanese recalls for a model',
        description:
          `Official Japanese recall filings (国土交通省 MLIT; ${V.JP.counts.recallFilings} filings matched to ` +
          `${V.JP.counts.models} models sold in Japan, incl. Lexus and imports) for a make and model: notification number, date, defective device, ` +
          'affected vehicles, situation and remedy (Japanese originals) and the official filing PDF. Accepts English ' +
          '(Toyota Prius, Honda N-BOX) or Japanese (トヨタ プリウス) names.',
        inputSchema: {
          type: 'object',
          properties: {
            make: { type: 'string', description: 'e.g. toyota, Honda, スズキ' },
            model: { type: 'string', description: 'e.g. prius, N-BOX, ジムニー' },
          },
          required: ['make', 'model'],
        },
        run: (a) => V.jpRecallsForModel(a),
        freshness: 'jp-recalls',
        cite: (a) => ({ path: 'vehicles/jp/recalls', query: { make: a.make, model: a.model } }),
      },
      {
        name: 'jp_complaints_summary',
        title: 'Japanese owner complaints summary',
        description:
          `Owner defect reports filed with MLIT's 不具合情報ホットライン (${V.JP.counts.complaints} across ` +
          `${V.JP.counts.models} models): total reports for a model and the breakdown by defective device (brakes, ` +
          'lights, engine, body…) from the newest sample. Reports are unverified owner submissions — compare shapes, ' +
          'not raw counts. Accepts English or Japanese names.',
        inputSchema: {
          type: 'object',
          properties: { make: { type: 'string', description: 'e.g. honda' }, model: { type: 'string', description: 'e.g. n-box' } },
          required: ['make', 'model'],
        },
        run: (a) => V.jpComplaintsSummary(a),
        freshness: 'jp-recalls',
        cite: (a) => ({ path: 'vehicles/jp/complaints', query: { make: a.make, model: a.model } }),
      },
      {
        name: 'eu_safety_gate_recalls',
        title: 'EU Safety Gate recalls (stub)',
        description:
          'STUB — not yet live. EU Safety Gate (RAPEX) vehicle alerts are being added; until then this returns ' +
          'covered:false with the official Safety Gate URL and points to fr_recalls_* (RappelConso republishes the ' +
          'Safety Gate automobile alerts that concern France).',
        inputSchema: { type: 'object', properties: { brand: { type: 'string' }, model: { type: 'string' } } },
        run: (a) => V.euSafetyGateStub(a),
        freshness: 'live',
        cite: (a) => ({ path: 'vehicles/eu/safety-gate', query: { brand: a.brand, model: a.model } }),
      },
    ],
  },

  coverage: V.vehiclesCoverage,

  freshness: [
    { key: 'uk-recalls', dataFile: 'data/vehicles/uk-recalls.json', cadenceDays: null, data: V.UK, large: 'DVSA bulk CSV derivation, ten calendar years of recalls (≈2.6 MB)' },
    { key: 'fr-recalls', dataFile: 'data/vehicles/fr-recalls.json', cadenceDays: null, data: V.FR, large: 'RappelConso automobile fiches since 2018 (≈1.1 MB)' },
    { key: 'jp-recalls', dataFile: 'data/vehicles/jp-recalls.json', cadenceDays: null, data: V.JP, large: 'MLIT recall filings + owner complaint summaries for 264 models from 23 makers incl. Lexus and imports (≈2.3 MB)' },
  ],

  // Entries are written by the dataset script, not by scripts/changelog.js.
  // datasetKeys: the first-derivation entries in the changelog (uk-recalls predates the changelog's coverage start,
  // so it has none) — tests/changes-page.test.js checks them.
  changelog: { diff: null, script: 'scripts/vehicles.js', files: ['data/vehicles/'], datasetKeys: () => ['eu-safety-gate/dataset', 'fr-recalls/dataset', 'jp-recalls/dataset'] },
  discovery: {
    description: 'Official vehicle recall datasets: DVSA (UK), RappelConso (France) and MLIT (Japan) recalls and complaints; EU Safety Gate is a stub.',
    cadence: 'Monthly.',
  },

  sources: () => [],

  rest: [
    { path: 'vehicles/uk/mot', tool: 'uk_mot_reliability', args: (q) => ({ make: q.make, model: q.model, year: q.year, mileage: q.mileage }), required: ['make', 'model'], numeric: ['year', 'mileage'] },
    { path: 'vehicles/uk/search', tool: 'uk_mot_vehicle_search', args: (q) => ({ q: q.q }), required: ['q'] },
    { path: 'vehicles/uk/recalls', tool: 'uk_recalls_for_model', args: (q) => ({ make: q.make, model: q.model, since: q.since }), required: ['make'] },
    { path: 'vehicles/uk/recalls-search', tool: 'uk_recalls_search', args: (q) => ({ text: q.text, since: q.since }), required: ['text'] },
    { path: 'vehicles/fr/recalls', tool: 'fr_recalls_for_model', args: (q) => ({ brand: q.brand, model: q.model }), required: ['brand'] },
    { path: 'vehicles/fr/search', tool: 'fr_recalls_search', args: (q) => ({ text: q.text, since: q.since }), required: ['text'] },
    { path: 'vehicles/jp/recalls', tool: 'jp_recalls_for_model', args: (q) => ({ make: q.make, model: q.model }), required: ['make', 'model'] },
    { path: 'vehicles/jp/complaints', tool: 'jp_complaints_summary', args: (q) => ({ make: q.make, model: q.model }), required: ['make', 'model'] },
    { path: 'vehicles/eu/safety-gate', tool: 'eu_safety_gate_recalls', args: (q) => ({ brand: q.brand, model: q.model }) },
  ],

  hub: {
    changed: 'official vehicle datasets (UK DVSA, French RappelConso and Japanese MLIT recalls)',
    coverage: 'vehicle datasets',
    catalogue: 'vehicles: UK MOT, UK, French and Japanese recalls',
    call: 'the vehicles hub (uk_mot_reliability, uk_recalls_for_model, uk_recalls_search, fr_recalls_for_model, fr_recalls_search, jp_recalls_for_model, jp_complaints_summary)',
  },

  docs: {
    readme: {
      roadmapRow: '| **Vehicles hub** — UK MOT failure data (live proxy to whatbreaks.uk), UK safety recalls (DVSA, 4,876 recalls since 2016), French recalls (RappelConso, 1,663 fiches), Japanese recalls + owner complaints (MLIT, 75 models); EU Safety Gate stub | `/api/mcp/vehicles` | **v1 — built 2026-10-03** |',
      catalogueRow: '| `/api/mcp/vehicles` | `uk_mot_reliability`, `uk_mot_vehicle_search` (live proxy → whatbreaks.uk, 8 s timeout, UA `databutler-hub/1.0`); `uk_recalls_for_model`, `uk_recalls_search` (`data/vehicles/uk-recalls.json`, DVSA bulk CSV, Open Government Licence v3.0, recalls launched in the last ten calendar years); `fr_recalls_for_model`, `fr_recalls_search` (`data/vehicles/fr-recalls.json`, RappelConso V2 open data, Licence Ouverte 2.0); `jp_recalls_for_model`, `jp_complaints_summary` (`data/vehicles/jp-recalls.json`, MLIT); `eu_safety_gate_recalls` (**stub**) | regenerate with `node scripts/vehicles.js` — FR/JP from the sibling `car_websites/` repos after their fetchers run, UK straight from DVSA (`node scripts/vehicles.js uk`) |',
    },
    llms: {
      rest: [
        '- `GET https://databutler.dev/api/vehicles/uk/mot?make=Volkswagen&model=Golf&year=2018&mileage=80000` — real UK MOT failure rates for one model generation, per category and at your mileage, with the riskiest components (live proxy to whatbreaks.uk; DfT anonymised MOT results). `GET /api/vehicles/uk/search?q=golf` checks coverage (530 generations).',
        '- `GET https://databutler.dev/api/vehicles/uk/recalls?make=vauxhall&model=corsa` — official UK vehicle safety recalls (DVSA open data, Open Government Licence; 4,876 recalls launched since 2016): recall number, launch date, concern, defect and remedy text, build-date range, vehicles affected, GOV.UK recall-checker link. `GET /api/vehicles/uk/recalls-search?text=airbag%20takata&since=2025-01-01` searches all served recalls.',
        '- `GET https://databutler.dev/api/vehicles/fr/recalls?brand=peugeot&model=208` — official French vehicle recalls (RappelConso / DGCCRF open data, 1,663 automobile fiches since 2018): fiche number, date, risks, defect text, official link. `GET /api/vehicles/fr/search?text=airbag%20takata&since=2026-01-01` searches all fiches.',
        `- \`GET https://databutler.dev/api/vehicles/jp/recalls?make=toyota&model=prius\` — official Japanese recall filings (国土交通省 MLIT) for ${V.JP.counts.models} models sold in Japan (Japanese makers, Lexus and imports), with the filing PDF; \`GET /api/vehicles/jp/complaints?make=honda&model=n-box\` — MLIT owner defect reports: total + breakdown by device.`,
      ],
      server: '- `POST https://databutler.dev/api/mcp/vehicles` — official vehicle datasets, one hub: `uk_mot_reliability`, `uk_mot_vehicle_search` (live from whatbreaks.uk — real DfT MOT outcomes), `uk_recalls_for_model`, `uk_recalls_search` (DVSA), `fr_recalls_for_model`, `fr_recalls_search` (RappelConso), `jp_recalls_for_model`, `jp_complaints_summary` (MLIT), `eu_safety_gate_recalls` (stub). Recall texts are the official English/French/Japanese originals — translate for the user, keep the recall/fiche/notification number and link.',
    },
    curation: [
      '| `data/vehicles/fr-recalls.json` | Monthly (RappelConso publishes continuously) | In `../car_websites/controle-technique`: `node data/fetch-rappelconso.js`, commit; then here `node scripts/vehicles.js fr` (derives the compact file, bumps `verifiedDate`/`nextScheduledRefresh` from the fetch date, appends a `vehicles` changelog entry when counts move). |',
      '| `data/vehicles/jp-recalls.json` | Monthly (MLIT filings are newsworthy when fresh) | In `../car_websites/shaken-data`: `node data/fetch-mlit.js` (15–20 min, 700 ms politeness delay — do not hammer), commit; then here `node scripts/vehicles.js jp`. |',
      '| `data/vehicles/uk-recalls.json` | Monthly (DVSA regenerates the source CSV daily; new recalls land every week) | `node scripts/vehicles.js uk` — downloads DVSA\'s bulk `RecallsFile.csv` (one ~8 MB request, UA names databutler.dev), keeps recalls launched in the ten calendar years before the fetch year plus the fetch year, groups rows by recall number, bumps `verifiedDate`/`nextScheduledRefresh`, appends a `vehicles` changelog entry when counts move. `DVSA_RECALLS_CSV=path` builds from a saved copy. Each January the window rolls forward a year — say so in the changelog note. |',
      '| UK MOT (vehicles) | — | No dataset here: live proxy to whatbreaks.uk, which owns the DfT bulk-data refresh. |',
    ],
    index: { blurb: 'UK MOT failure data, French and Japanese official recalls' },
    api: () => ({
      endpoints: {
        'GET /api/vehicles/uk/mot': {
          description:
            'Real UK MOT failure data for one model generation: per-category failure rates (overall and at your mileage), ' +
            'riskiest components. Live proxy to whatbreaks.uk (same operator; DfT anonymised MOT results).',
          params: { make: 'e.g. Volkswagen', model: 'e.g. Golf', year: 'optional registration year', mileage: 'optional miles' },
          example: 'https://databutler.dev/api/vehicles/uk/mot?make=Volkswagen&model=Golf&year=2018&mileage=80000',
        },
        'GET /api/vehicles/uk/search': {
          description: 'Search the 530 UK model generations covered by the MOT dataset (live proxy to whatbreaks.uk).',
          params: { q: 'free text, e.g. golf' },
          example: 'https://databutler.dev/api/vehicles/uk/search?q=golf',
        },
        'GET /api/vehicles/uk/recalls': {
          description:
            `Official UK vehicle safety recalls (DVSA open data, OGL v3.0; ${V.UK.count} recalls launched ${V.UK.filter.launchDateFrom} → ${V.UK.dateRange.to}) ` +
            'for a make (+ model): recall number, launch date, concern, defect and remedy text, build-date range, vehicles affected, GOV.UK recall-checker link.',
          params: { make: 'e.g. Vauxhall, Mercedes-Benz, VW', model: 'optional, e.g. Corsa (omit to list the make and its model names)', since: 'optional YYYY-MM-DD' },
          example: 'https://databutler.dev/api/vehicles/uk/recalls?make=vauxhall&model=corsa',
        },
        'GET /api/vehicles/uk/recalls-search': {
          description: 'Keyword search across all served DVSA recalls (English text: make, model, concern, defect, remedy), newest first, optional since date.',
          params: { text: 'e.g. airbag takata', since: 'optional YYYY-MM-DD' },
          example: 'https://databutler.dev/api/vehicles/uk/recalls-search?text=airbag%20takata&since=2025-01-01',
        },
        'GET /api/vehicles/fr/recalls': {
          description:
            `Official French vehicle recalls (RappelConso / DGCCRF open data, ${V.FR.count} automobile fiches ${V.FR.dateRange.from} → ${V.FR.dateRange.to}) ` +
            'for a brand (+ model): fiche number, date, risks, defect text, official fiche link.',
          params: { brand: 'e.g. peugeot, Mercedes-Benz, VW', model: 'optional, e.g. 208' },
          example: 'https://databutler.dev/api/vehicles/fr/recalls?brand=peugeot&model=208',
        },
        'GET /api/vehicles/fr/search': {
          description: 'Keyword search across all RappelConso automobile fiches (French text), newest first, optional since date.',
          params: { text: 'e.g. airbag takata', since: 'optional YYYY-MM-DD' },
          example: 'https://databutler.dev/api/vehicles/fr/search?text=airbag%20takata&since=2026-01-01',
        },
        'GET /api/vehicles/jp/recalls': {
          description:
            `Official Japanese recall filings (国土交通省 MLIT; ${V.JP.counts.recallFilings} filings across ${V.JP.counts.models} models sold in Japan, incl. Lexus and imports): ` +
            'notification number, date, device, affected vehicles, situation/remedy, official PDF. English or Japanese names.',
          params: { make: 'e.g. toyota', model: 'e.g. prius, N-BOX' },
          example: 'https://databutler.dev/api/vehicles/jp/recalls?make=toyota&model=prius',
        },
        'GET /api/vehicles/jp/complaints': {
          description: `MLIT owner defect reports (${V.JP.counts.complaints} across ${V.JP.counts.models} models): total per model + breakdown by defective device.`,
          params: { make: 'e.g. honda', model: 'e.g. n-box' },
          example: 'https://databutler.dev/api/vehicles/jp/complaints?make=honda&model=n-box',
        },
        'GET /api/vehicles/eu/safety-gate': 'STUB — EU Safety Gate vehicle alerts are being added; returns covered:false with the official URL for now.',
      },
      coverage: {
        vehicles: {
          ukMot: '530 UK model generations (live proxy to whatbreaks.uk)',
          ukRecalls: `${V.UK.count} DVSA safety recalls launched since ${V.UK.filter.launchDateFrom}, verified ${V.UK.verifiedDate}`,
          frRecalls: `${V.FR.count} RappelConso automobile fiches, verified ${V.FR.verifiedDate}`,
          jpRecalls: `${V.JP.counts.recallFilings} MLIT filings + ${V.JP.counts.complaints} owner complaints across ${V.JP.counts.models} models, verified ${V.JP.verifiedDate}`,
          euSafetyGate: 'stub',
        },
      },
      mcp:
        'Remote MCP server — uk_mot_reliability, uk_mot_vehicle_search (live via whatbreaks.uk), uk_recalls_for_model, ' +
        'uk_recalls_search (DVSA), fr_recalls_for_model, fr_recalls_search, jp_recalls_for_model, jp_complaints_summary, ' +
        'eu_safety_gate_recalls (stub).',
    }),
  },

  facts: null, // publishes no Verified Facts (/f/<key>); see api/_areas/README.md "facts"

  verify: [
    { label: 'call-fr-recalls', kind: 'tool', tool: 'fr_recalls_for_model', args: { brand: 'peugeot', model: '208' }, assert: "d['count']>0 and d['recalls'][0]['link'].startswith('https://rappel.conso.gouv.fr/') and d['freshness']['verifiedDate']" },
    { label: 'call-uk-recalls', kind: 'tool', tool: 'uk_recalls_for_model', args: { make: 'Vauxhall', model: 'Corsa' }, assert: "d['count']>0 and d['recalls'][0]['link'].startswith('https://www.check-vehicle-recalls.service.gov.uk/') and d['freshness']['verifiedDate']" },
    { label: 'rest-uk-recalls-search', kind: 'rest', path: 'vehicles/uk/recalls-search', query: 'text=airbag&since=2025-01-01', assert: "'freshness' in d and d['cite']['url'].startswith('https://databutler.dev/r/vehicles/uk/recalls-search?')" },
    { label: 'call-jp-recalls', kind: 'tool', tool: 'jp_recalls_for_model', args: { make: 'toyota', model: 'prius' }, assert: "d['count']>0 and d['recalls'][0]['officialPdf'].startswith('https://renrakuda.mlit.go.jp/mt/recallpdf/')" },
    { label: 'call-mot-search', kind: 'tool', tool: 'uk_mot_vehicle_search', args: { q: 'golf' }, assert: "('vehicles' in d and d['upstreamProvenance']['attribution']=='whatbreaks.uk') or d.get('error')=='upstream unavailable'" },
    { label: 'rest-fr-recalls', kind: 'rest', path: 'vehicles/fr/recalls', query: 'brand=peugeot&model=208', assert: "'freshness' in d and d['cite']['url'].startswith('https://databutler.dev/r/vehicles/fr/recalls?')" },
  ],
};
