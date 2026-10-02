const { sendJson, handleOptions, ATTRIBUTION, coverageSummary, RATES } = require('./_lib');
const { FR, JP } = require('./_vehicles');

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
          'exam_topic_paper, domain_provenance, package_provenance directly, plus what_changed_since ' +
          '(changes since your training cutoff), coverage, catalogue and call (run any tool by name). ' +
          'Every result carries freshness + a cite.url permalink.',
        example: 'add https://databutler.dev/api/mcp to any MCP client',
      },
      'GET /api/changes': {
        description: 'What changed in the verified datasets since a date (REST mirror of what_changed_since).',
        params: { since: 'YYYY-MM-DD', area: 'uk-rates | uk-exams | all' },
        example: 'https://databutler.dev/api/changes?since=2026-06-01',
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
      'POST /api/mcp/uk-rates': 'Remote MCP server — tool uk_rates_lookup.',
      'POST /api/mcp/uk-exams': 'Remote MCP server — tools exam_topic_paper, exam_spec_lookup, exam_paper_index.',
      'POST /api/mcp/provenance': 'Remote MCP server — tools domain_provenance, package_provenance.',
      'POST /api/mcp/stats':
        'Remote MCP server — descriptive_stats, distribution, hypothesis_test, confidence_interval, bayes_update, linear_regression.',
      'POST /api/mcp/vehicles':
        'Remote MCP server — uk_mot_reliability, uk_mot_vehicle_search (live via whatbreaks.uk), fr_recalls_for_model, ' +
        'fr_recalls_search, jp_recalls_for_model, jp_complaints_summary, eu_safety_gate_recalls (stub).',
    },
    coverage: {
      exams: coverageSummary(),
      rates: `tax year ${RATES.taxYear}`,
      vehicles: {
        ukMot: '530 UK model generations (live proxy to whatbreaks.uk)',
        frRecalls: `${FR.count} RappelConso automobile fiches, verified ${FR.verifiedDate}`,
        jpRecalls: `${JP.counts.recallFilings} MLIT filings + ${JP.counts.complaints} owner complaints across ${JP.counts.models} models, verified ${JP.verifiedDate}`,
        euSafetyGate: 'stub',
      },
    },
    privacy: 'https://databutler.dev/privacy',
    ...ATTRIBUTION,
  });
};
