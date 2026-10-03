const { sendJson, handleOptions, ATTRIBUTION, coverageSummary, RATES } = require('./_lib');
const { FR, JP, UK } = require('./_vehicles');
const TAX = require('./_tax');
const EOL = require('./_software_eol');

module.exports = (req, res) => {
  if (handleOptions(req, res)) return;
  sendJson(res, 200, {
    name: 'Data Butler',
    description:
      'Verified reference data for AI agents. Every figure carries an official source URL and a ' +
      'verifiedDate — built for the questions agents misquote from memory. No auth, CORS-open. ' +
      'Country-prefixed: /api/uk/*; more countries later.',
    endpoints: {
      'POST /api/mcp': {
        description:
          'THE FRONT DOOR — one remote MCP server for the whole estate. Lists uk_rates_lookup, ' +
          'exam_topic_paper, domain_provenance, package_provenance, take_home_pay directly, plus what_changed_since ' +
          '(changes since your training cutoff), coverage, catalogue and call (run any tool by name). ' +
          'Every result carries freshness + a cite.url permalink.',
        example: 'add https://databutler.dev/api/mcp to any MCP client',
      },
      'GET /api/changes': {
        description: 'What changed in the verified datasets since a date (REST mirror of what_changed_since). format=html|rss|atom serves the /changes page or feeds instead of JSON.',
        params: { since: 'YYYY-MM-DD', area: 'uk-rates | uk-exams | vehicles | software-eol | all', format: 'json (default) | html | rss | atom' },
        example: 'https://databutler.dev/api/changes?since=2026-06-01',
      },
      'GET /changes': {
        description:
          'The changelog as a page: every verified change to UK tax/NI thresholds, exam specs, official vehicle datasets and software ' +
          'end-of-life dates, newest first by month — area, from → to, effectiveFrom, official source, maintainer note, verifiedDate. Indexable, cached 1 h at the edge.',
        params: { area: 'optional: uk-rates | uk-exams | vehicles | software-eol', since: 'optional YYYY-MM-DD' },
        example: 'https://databutler.dev/changes?area=vehicles',
      },
      'GET /changes.rss': {
        description: 'RSS 2.0 feed of the changelog (?area= optional). guid = permalink on /changes, link = official source, pubDate = verifiedDate.',
        example: 'https://databutler.dev/changes.rss',
      },
      'GET /changes.atom': {
        description: 'Atom feed of the changelog (?area= optional); same entries as /changes.rss.',
        example: 'https://databutler.dev/changes.atom?area=uk-rates',
      },
      'GET /r/<route>?…': {
        description: 'Citation permalinks (human-readable answer + official source + verified date). Every API/MCP result includes one as cite.url.',
        example: 'https://databutler.dev/r/uk/rates?category=income-tax',
      },
      'GET /api/uk/rates': {
        description: `UK tax-year rates & thresholds (${RATES.taxYear}), verified against gov.uk.`,
        params: { category: `one of ${Object.keys(RATES.categories).join(', ')} (omit to list)` },
        example: 'https://databutler.dev/api/uk/rates?category=income-tax',
      },
      'GET /api/uk/exams/topic': {
        description:
          'Which paper is a topic on? Built for queries like "is electricity paper 2 AQA".',
        params: { board: 'e.g. aqa', subject: 'e.g. physics', level: 'e.g. gcse', topic: 'e.g. electricity' },
        example: 'https://databutler.dev/api/uk/exams/topic?board=aqa&subject=physics&level=gcse&topic=electricity',
      },
      'GET /api/uk/exams/specs': {
        description: 'Spec metadata: codes, paper structure, durations, tiers, official links.',
        params: { board: 'optional', subject: 'optional', level: 'optional' },
      },
      'GET /api/uk/exams/papers': {
        description:
          'Past-paper index: official assessment-resources links per spec (links only — papers are board copyright).',
        params: { board: 'optional', subject: 'optional', level: 'optional' },
      },
      'GET /api/provenance/domain': {
        description:
          'Who runs this domain? Live RDAP: age, registrar, nameservers, typosquat resemblance. Descriptive signals, not a verdict.',
        params: { domain: 'e.g. example.com' },
        example: 'https://databutler.dev/api/provenance/domain?domain=databutler.dev',
      },
      'GET /api/provenance/package': {
        description: 'Who publishes this package, and is it a typosquat? Live npm/PyPI metadata.',
        params: { ecosystem: 'npm | pypi', name: 'e.g. express' },
        example: 'https://databutler.dev/api/provenance/package?ecosystem=npm&name=express',
      },
      'GET|POST /api/stats': {
        description:
          'Exact statistics & probability — for the maths agents get wrong in their head. ?op= one of: ' +
          'descriptive, distribution, hypothesis-test, confidence-interval, bayes-update, regression. ' +
          'Array/table inputs via POST JSON body. Numerical core validated against reference tables.',
        example: 'https://databutler.dev/api/stats?op=distribution&dist=normal&at=1.96',
      },
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
          `Official UK vehicle safety recalls (DVSA open data, OGL v3.0; ${UK.count} recalls launched ${UK.filter.launchDateFrom} → ${UK.dateRange.to}) ` +
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
          `Official French vehicle recalls (RappelConso / DGCCRF open data, ${FR.count} automobile fiches ${FR.dateRange.from} → ${FR.dateRange.to}) ` +
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
          `Official Japanese recall filings (国土交通省 MLIT; ${JP.counts.recallFilings} filings across ${JP.counts.models} popular JDM models): ` +
          'notification number, date, device, affected vehicles, situation/remedy, official PDF. English or Japanese names.',
        params: { make: 'e.g. toyota', model: 'e.g. prius, N-BOX' },
        example: 'https://databutler.dev/api/vehicles/jp/recalls?make=toyota&model=prius',
      },
      'GET /api/vehicles/jp/complaints': {
        description: `MLIT owner defect reports (${JP.counts.complaints} across ${JP.counts.models} models): total per model + breakdown by defective device.`,
        params: { make: 'e.g. honda', model: 'e.g. n-box' },
        example: 'https://databutler.dev/api/vehicles/jp/complaints?make=honda&model=n-box',
      },
      'GET /api/vehicles/eu/safety-gate': 'STUB — EU Safety Gate vehicle alerts are being added; returns covered:false with the official URL for now.',
      'GET /api/tax/take-home': {
        description:
          `Take-home pay after income tax and social contributions for ${TAX.COUNTRY_CODES.join(', ')}: gross, net and total ` +
          'deductions (annual + monthly), typed breakdown, effectiveRate, taxYear, currency, assumptions. Live proxy to the ' +
          'LifeByNumbers salary calculators (same operator). Spain (es) returns covered:false — no backend calculator.',
        params: {
          country: TAX.COUNTRY_CODES.join(' | '), gross: 'salary in local currency (annual unless period=monthly)', period: 'annual | monthly (optional)',
          state: 'US only, e.g. TX (default CA)', filingStatus: 'US only: single | married_joint | head_of_household', province: 'Canada only, e.g. BC (default ON)',
          region: 'UK only: england | scotland',
        },
        example: 'https://databutler.dev/api/tax/take-home?country=uk&gross=50000',
      },
      'GET /api/software-eol/status': {
        description:
          `Is this version still supported, and until when? ${EOL.PRODUCT_IDS.join(', ')} — a monthly snapshot of endoflife.date ` +
          `open data (MIT; ${EOL.DATA.cycleCount} release cycles, verified ${EOL.DATA.verifiedDate}). A version resolves to its release cycle ` +
          '("18.19.0" → 18, "3.11.4" → 3.11, "22.04.3" → 22.04, "bookworm" → 12); returns supported true|false as of today, eol date, days ' +
          'remaining or since, active/extended-support ends, LTS, latest release, the newest supported cycle, a plain-statement recommendation and the endoflife.date page as source.',
        params: { product: `one of ${EOL.PRODUCT_IDS.join(', ')} (aliases: node, java, jdk, postgres, golang, osx, win)`, version: 'e.g. 18, 18.19.0, 3.11, 22.04, bookworm, 11-24h2-w' },
        example: 'https://databutler.dev/api/software-eol/status?product=nodejs&version=18.19.0',
      },
      'GET /api/software-eol/timeline': {
        description: 'Every release cycle of a product, newest first, with release date, supported true|false, eol, LTS, latest release and support-end dates; same snapshot as /status.',
        params: { product: `one of ${EOL.PRODUCT_IDS.join(', ')}` },
        example: 'https://databutler.dev/api/software-eol/timeline?product=python',
      },
      'POST /api/mcp/uk-rates': 'Remote MCP server — tool uk_rates_lookup.',
      'POST /api/mcp/uk-exams': 'Remote MCP server — tools exam_topic_paper, exam_spec_lookup, exam_paper_index.',
      'POST /api/mcp/provenance': 'Remote MCP server — tools domain_provenance, package_provenance.',
      'POST /api/mcp/stats':
        'Remote MCP server — descriptive_stats, distribution, hypothesis_test, confidence_interval, bayes_update, linear_regression.',
      'POST /api/mcp/vehicles':
        'Remote MCP server — uk_mot_reliability, uk_mot_vehicle_search (live via whatbreaks.uk), uk_recalls_for_model, ' +
        'uk_recalls_search (DVSA), fr_recalls_for_model, fr_recalls_search, jp_recalls_for_model, jp_complaints_summary, ' +
        'eu_safety_gate_recalls (stub).',
      'POST /api/mcp/tax': 'Remote MCP server — tool take_home_pay (live via the LifeByNumbers salary calculators).',
      'POST /api/mcp/software-eol': 'Remote MCP server — tools support_status, support_timeline (monthly snapshot of endoflife.date open data for 14 runtimes, operating systems, PostgreSQL and React).',
    },
    coverage: {
      exams: coverageSummary(),
      rates: `tax year ${RATES.taxYear}`,
      vehicles: {
        ukMot: '530 UK model generations (live proxy to whatbreaks.uk)',
        ukRecalls: `${UK.count} DVSA safety recalls launched since ${UK.filter.launchDateFrom}, verified ${UK.verifiedDate}`,
        frRecalls: `${FR.count} RappelConso automobile fiches, verified ${FR.verifiedDate}`,
        jpRecalls: `${JP.counts.recallFilings} MLIT filings + ${JP.counts.complaints} owner complaints across ${JP.counts.models} models, verified ${JP.verifiedDate}`,
        euSafetyGate: 'stub',
      },
      tax: Object.fromEntries(Object.entries(TAX.COUNTRIES).map(([k, c]) => [k, c.calculatorId ? `${c.currency}, tax year ${c.taxYear} (live via lifebynumbers.net)` : 'not computed upstream — covered:false'])),
      softwareEol: `${EOL.PRODUCT_IDS.join(', ')}: ${EOL.DATA.cycleCount} release cycles from endoflife.date (MIT), verified ${EOL.DATA.verifiedDate}`,
    },
    privacy: 'https://databutler.dev/privacy',
    ...ATTRIBUTION,
  });
};
