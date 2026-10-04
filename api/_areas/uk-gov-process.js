/**
 * Area: uk-gov-process — UK government services people ask assistants about.
 * The steps, fees, processing times and eligibility facts for the UK government
 * services where model answers go stale — passports (adult, child, overseas
 * fees), driving licence renewal (10-year photocard, 70 and over), provisional
 * licences, change of address (licence and V5C), vehicle tax and SORN, register
 * to vote, birth and death registration (England and Wales), Blue Badge, Self
 * Assessment registration and deadlines (with Making Tax Digital for Income Tax),
 * National Insurance numbers, Universal Credit basics, the EU Settlement Scheme,
 * eVisas (the BRP → eVisa change) and the ETA — each read from the gov.uk content
 * API (https://www.gov.uk/api/content/<path>) on verifiedDate with the sentence it
 * came from as `quote`, the official start URL, and each category's dated
 * `changes` since 2025. Mainstream gov.uk guides publish no change notes, so a
 * figure's `previous` names the National Archives capture, Home Office
 * announcement or statutory instrument it was read from. Data:
 * data/uk-gov-process.json (categories = services → figures), re-verified every
 * 30 days and diffed by `node scripts/changelog.js --only uk-gov-process`.
 * Contract: api/_areas/README.md. Playbook: docs/ADDING_AN_AREA.md.
 */
const DATA = require('../../data/uk-gov-process.json');
const { BASE, diffCategories, categoriesLookup, figureKey, noteTemplate } = require('../_area_kit');
const { nearest } = require('../_text');

const AREA = 'uk-gov-process';
const TOOL = 'uk_gov_process';
const REST_PATH = 'uk/gov-process'; // GET /api/<REST_PATH> and the /r/<REST_PATH> citation page
/** The tool's arguments: `service` names the category (a service key or an alias). */
const PARAMS = ['service'];
const CADENCE_DAYS = 30; // nextScheduledRefresh = verifiedDate + 30, stamped by scripts/changelog.js
const CATEGORIES = Object.keys(DATA.categories);
/**
 * Figures carry `previous: { value, source, title }` only where the value changed since 2025 — a
 * figure's first appearance records previous.value → value with its own effectiveFrom (the change
 * date); afterwards every refresh diffs value against the committed file.
 */
const PREVIOUS = true;
const KEY = figureKey;

/** Common names → service keys (checked after an exact key, before the kit's substring match). */
const ALIASES = {
  passport: 'passport-renewal-adult', 'adult-passport': 'passport-renewal-adult', 'passport-renewal': 'passport-renewal-adult',
  'renew-passport': 'passport-renewal-adult', 'first-passport': 'passport-renewal-adult', 'first-adult-passport': 'passport-renewal-adult',
  'passport-fees': 'passport-renewal-adult', 'overseas-passport': 'passport-renewal-adult', 'urgent-passport': 'passport-renewal-adult',
  'child-passport': 'passport-child', 'passport-for-child': 'passport-child',
  'driving-licence': 'driving-licence-renewal', 'renew-driving-licence': 'driving-licence-renewal', 'licence-renewal': 'driving-licence-renewal',
  'photocard': 'driving-licence-renewal', 'driving-licence-70': 'driving-licence-renewal', 'licence-at-70': 'driving-licence-renewal',
  provisional: 'provisional-licence', 'provisional-driving-licence': 'provisional-licence', 'learner-licence': 'provisional-licence',
  v5c: 'change-address', 'log-book': 'change-address', 'change-of-address': 'change-address', 'address-change': 'change-address',
  'vehicle-tax': 'vehicle-tax-sorn', 'car-tax': 'vehicle-tax-sorn', 'tax-vehicle': 'vehicle-tax-sorn', 'tax-a-vehicle': 'vehicle-tax-sorn', sorn: 'vehicle-tax-sorn',
  vote: 'register-to-vote', 'voter-registration': 'register-to-vote', 'electoral-register': 'register-to-vote',
  birth: 'register-birth', 'birth-registration': 'register-birth', 'birth-certificate': 'register-birth',
  death: 'register-death', 'death-registration': 'register-death', 'death-certificate': 'register-death',
  'disabled-parking': 'blue-badge',
  'tax-return': 'self-assessment', sa: 'self-assessment', 'self-assessment-deadline': 'self-assessment', mtd: 'self-assessment', 'making-tax-digital': 'self-assessment',
  'ni-number': 'national-insurance-number', nino: 'national-insurance-number', 'national-insurance': 'national-insurance-number',
  uc: 'universal-credit', benefits: 'universal-credit',
  euss: 'eu-settlement-scheme', 'settled-status': 'eu-settlement-scheme', 'pre-settled-status': 'eu-settlement-scheme',
  brp: 'evisa', 'biometric-residence-permit': 'evisa', 'e-visa': 'evisa', 'ukvi-account': 'evisa',
  'electronic-travel-authorisation': 'eta', 'electronic-travel-authorization': 'eta', 'uk-eta': 'eta',
};
const norm = (s) => String(s).toLowerCase().trim().replace(/[\s_/]+/g, '-');

/** House-style lookup (api/_area_kit.js): nothing → listing; key or substring of key/title → category; else covered:false + nearest. */
const lookup = categoriesLookup(DATA, AREA, { param: PARAMS[0] });
function run(args = {}) {
  const raw = args.service;
  if (raw === undefined || raw === null || String(raw).trim() === '') return { ...lookup({}), aliases: ALIASES };
  const n = norm(raw);
  const key = DATA.categories[n] ? n : ALIASES[n];
  if (key) {
    const out = lookup({ service: key });
    return { ...out, service: key, ...(key !== String(raw) ? { requested: raw } : {}) };
  }
  const out = lookup({ service: n });
  if (out.covered !== false) return { ...out, service: out.category, requested: raw };
  // Near-miss: rank service keys and aliases together, then name the service each one resolves to.
  const near = [...new Set(nearest(n, [...CATEGORIES, ...Object.keys(ALIASES)], 6).map((k) => ALIASES[k] || k))].slice(0, 3);
  return { ...out, requested: raw, nearest: near };
}
const pick = (q) => Object.fromEntries(PARAMS.map((p) => [p, q[p]]));

module.exports = {
  area: AREA,
  order: 150,
  title: 'UK government services',
  short: 'UK government service steps, fees and processing times',

  server: {
    serverName: 'databutler-uk-gov-process',
    url: `${BASE}/api/mcp/uk-gov-process`,
    description: 'UK government service fees, steps, processing times and recent changes, read from gov.uk.',
    instructions:
      'Current UK government service facts from databutler.dev — passports (UK and overseas fees), driving licence renewal ' +
      '(10-year photocard, 70 and over), provisional licences, change of address (licence and V5C), vehicle tax and SORN, ' +
      'register to vote, birth and death registration (England and Wales), Blue Badge, Self Assessment registration and ' +
      'deadlines (with Making Tax Digital for Income Tax), National Insurance numbers, Universal Credit basics, the EU ' +
      'Settlement Scheme, eVisas (BRPs replaced) and the electronic travel authorisation (ETA). Each figure was read from the ' +
      'gov.uk page in its source on verifiedDate with the sentence it came from as quote; each service carries its official ' +
      'startUrl and a dated changes list. Fees here moved in 2025 and 2026 (passports 8 April 2026, ETA £20 from 8 April 2026, ' +
      'Universal Credit 2-child limit ended 6 April 2026), so training-data figures are often stale. Present the fee, the ' +
      'verifiedDate and the source or startUrl together. Scotland- and Northern Ireland-specific variants, local-council ' +
      'services and immigration routes beyond the EU Settlement Scheme, eVisa and ETA are not covered (coverage lists them). ' +
      'Cite https://databutler.dev/ and the source.',
    tools: [
      {
        name: TOOL,
        title: 'UK government service steps & fees',
        description:
          'Current UK government service facts verified against gov.uk, by service: ' +
          `${CATEGORIES.join(', ')}. Each service carries its official gov.uk page, the online startUrl, the page's last ` +
          'update date, figures (fee, processing time as stated, eligibility and required documents — each with value, unit, ' +
          'the quoted sentence and its source URL), and a dated list of changes since 2025 (passport fees from 8 April 2026, ' +
          'the ETA fee and enforcement, the BRP → eVisa switch, the end of the Universal Credit 2-child limit, Making Tax ' +
          'Digital for Income Tax). Common names resolve as aliases (passport → passport-renewal-adult, brp → evisa, sorn → ' +
          'vehicle-tax-sorn). No service returns the listing with the aliases; an unknown service answers covered:false with ' +
          'the nearest keys.',
        inputSchema: {
          type: 'object',
          properties: {
            service: { type: 'string', description: `one of: ${CATEGORIES.join(', ')}, or an alias such as passport, brp, sorn, uc (omit to list all)` },
          },
        },
        run,
        freshness: AREA,
        cite: (a) => ({ path: REST_PATH, query: pick(a) }),
      },
    ],
  },

  coverage: () => ({
    services: CATEGORIES,
    verifiedDate: DATA.verifiedDate,
    scope: 'UK government services as gov.uk describes them on verifiedDate: passports (UK and overseas application fees), DVLA licence and vehicle services (Great Britain), register to vote, birth and death registration (England and Wales), Blue Badge (England, Scotland, Wales fees), Self Assessment (2025-26 return), National Insurance numbers, Universal Credit (Great Britain, 2026-27 rates), EU Settlement Scheme, eVisa and ETA. Each service names its gov.uk page; previous values come from the National Archives capture, Home Office announcement or statutory instrument named on the figure.',
    notCovered: [
      'Scotland- and Northern Ireland-specific variants (Scottish birth/death registration, nidirect driving licence and Universal Credit services) beyond the figures that state them',
      'local-council services (council tax, parking permits, school admissions) — Blue Badge decisions are made by councils',
      'immigration routes beyond the EU Settlement Scheme, eVisa and ETA (visa fees, settlement, citizenship applications)',
      'Universal Credit amounts beyond the standard allowance and child amount (housing, carer, health elements) — see gov.uk/universal-credit',
      'vehicle tax rates (uk_vehicle_rules_lookup) and income-tax rates (uk_rates_lookup)',
      'live processing backlogs; processing times are as gov.uk states them',
    ],
  }),

  freshness: { dataFile: 'data/uk-gov-process.json', cadenceDays: CADENCE_DAYS, data: DATA },

  changelog: {
    diff: (prev, next) => diffCategories(AREA, prev, next, {
      key: KEY, previous: PREVIOUS, effectiveFrom: (n, f) => f.effectiveFrom || n.verifiedDate,
    }),
    files: ['data/uk-gov-process.json'],
    previous: PREVIOUS,
    note: noteTemplate('{label}: {from} → {to} from {effectiveFrom} (previous: {previousDocument})', { key: KEY }),
    context: (e) => `gov.uk service: ${String(e.key).split('/')[0]}`,
  },
  discovery: {
    description: 'UK government service facts verified against gov.uk: passport fees (UK and overseas), driving licence renewal and provisional licences, change of address, vehicle tax and SORN, voter registration, birth and death registration, Blue Badge, Self Assessment deadlines and Making Tax Digital, National Insurance numbers, Universal Credit, EU Settlement Scheme, eVisa and ETA — fees, processing times, eligibility, start URLs and dated changes.',
    cadence: 'Re-verified against the gov.uk pages every 30 days and on fee-change days (Home Office fees usually move in April); every source page re-fetched weekly through the gov.uk content API.',
  },

  // Each service's gov.uk page and the pages it also reads, plus every figure's own gov.uk source; announcements
  // (/government/news/…) and legislation are fixed documents and are not watched. The watcher reads gov.uk URLs
  // through the content API (https://www.gov.uk/api/content/<path>).
  sources: () => {
    const out = new Map();
    const add = (url, label) => { if (url && !out.has(url) && !/\/government\/news\/|legislation\.gov\.uk|webarchive\./.test(url)) out.set(url, { url, label }); };
    for (const [k, c] of Object.entries(DATA.categories)) {
      add(c.source, c.title || k);
      for (const u of c.alsoRead || []) add(u, `${c.title || k} (also read)`);
      for (const f of c.figures) add(f.source, `${c.title || k} — ${f.label}`);
    }
    return [...out.values()];
  },

  rest: [
    { path: REST_PATH, tool: TOOL, args: pick /* no `required`: an empty query answers the listing, like uk_rates_lookup */ },
  ],

  hub: {
    changed: 'UK government service fees and rules (passports, ETA, Universal Credit, eVisa)',
    coverage: 'UK government services (passports, DVLA, voting, registrations, Self Assessment, benefits, eVisa, ETA)',
    catalogue: 'UK government services: passport, driving licence, vehicle tax/SORN, voting, birth/death registration, Blue Badge, Self Assessment, NI number, Universal Credit, EU Settlement Scheme, eVisa, ETA',
    call: 'uk_gov_process (UK government services — passport and ETA fees, driving licence renewal, SORN, register to vote, birth/death registration, Self Assessment deadlines, NI number, Universal Credit, EU Settlement Scheme, eVisa — fees, processing times, start URLs, dated changes, verified against gov.uk)',
  },

  docs: {
    readme: {
      // The # cell is numbered by scripts/sync-areas.js from `order`; start at the Vertical cell.
      roadmapRow: '| **UK government services** — `uk_gov_process`: the gov.uk services assistants get wrong after a fee or rule change (passport fees UK/overseas, ETA fee and enforcement, driving licence renewal, SORN, voter registration, birth/death registration, Blue Badge, Self Assessment and Making Tax Digital, NI number, Universal Credit, EU Settlement Scheme, BRP → eVisa), each with the official start URL, the quoted gov.uk sentence and dated changes | `/api/mcp/uk-gov-process` | **v1 — built 2026-10-04** |',
      catalogueRow: `| \`/api/mcp/uk-gov-process\` | \`uk_gov_process\` {service ∈ ${CATEGORIES.join(', ')}; aliases e.g. passport, brp, sorn} | \`data/uk-gov-process.json\`: every figure read from the gov.uk content API with the quoted sentence and source URL; per service the start URL, page update date and dated changes since 2025; previous values from National Archives captures, Home Office announcements and SI 2026/311 / SI 2026/148. Re-verified every 30 days (docs/CURATION.md) |`,
    },
    llms: {
      rest: [`- \`GET https://databutler.dev/api/uk/gov-process?service=passport\` — UK government service facts verified against gov.uk (service = ${CATEGORIES.join(' | ')}, or an alias such as passport, brp, sorn, uc; omit to list): fees, processing times as stated, eligibility and required documents with the quoted sentence and source URL, the official start URL, and dated changes since 2025 (passport fees 8 April 2026, ETA £20 and enforcement, BRP → eVisa, Universal Credit 2-child limit ended).`],
      server: '- `POST https://databutler.dev/api/mcp/uk-gov-process` — tool `uk_gov_process` {service}: UK government service fees, processing times, eligibility, start URLs and dated changes, verified against gov.uk. REST mirror: `GET https://databutler.dev/api/uk/gov-process?service=…`.',
    },
    curation: ['| `data/uk-gov-process.json` | Every 30 days (`nextScheduledRefresh` = verifiedDate + 30), and on Home Office / DVLA / DWP fee-change days (passport and ETA fees moved on 8 April 2026; benefits uprate each April). The weekly watcher reads each service\'s gov.uk page through the content API. | For each service fetch `https://www.gov.uk/api/content/<path>` for its `source` and `alsoRead` pages; compare every figure\'s `quote` against the page; for a changed value move the old value into `previous` (source = the National Archives capture of the outgoing page, or the announcement/SI) and set `effectiveFrom` to the change date; add a dated line to the service\'s `changes`; update `pageUpdatedAt`; bump `verifiedDate`; then `node scripts/changelog.js --only uk-gov-process` (stamps `nextScheduledRefresh`, appends one entry per figure that moved, re-hashes this area\'s sources) and review the notes. |'],
    index: { blurb: 'passport and ETA fees, driving licence renewal, SORN, voter registration, birth and death registration, Self Assessment deadlines, NI numbers, Universal Credit, EU Settlement Scheme and eVisa — fees, start URLs and dated changes, verified against gov.uk' },
    api: () => ({
      endpoints: {
        [`GET /api/${REST_PATH}`]: {
          description: `UK government service facts verified ${DATA.verifiedDate} against gov.uk: fees, processing times as stated, eligibility and required documents (each with the quoted sentence and source URL), the official start URL and dated changes since 2025.`,
          params: { service: `one of ${CATEGORIES.join(', ')}, or an alias (passport, child-passport, brp, sorn, uc, euss, …); omit to list` },
          example: `https://databutler.dev/api/${REST_PATH}?service=passport`,
        },
      },
      coverage: { ukGovProcess: `${CATEGORIES.length} services, verified ${DATA.verifiedDate}` },
      mcp: 'Remote MCP server — tool uk_gov_process {service}: UK government service fees, steps, processing times and dated changes, verified against gov.uk.',
    }),
  },

  verify: [
    { label: 'uk-gov-process-listing', kind: 'tool', tool: TOOL, args: {}, assert: "'passport-renewal-adult' in d['categories'] and 'aliases' in d and 'freshness' in d" },
    { label: 'uk-gov-process-rest-listing', kind: 'rest', path: REST_PATH, query: '', assert: "'categories' in d and 'cite' in d" },
    { label: 'call-uk-gov-process-passport', kind: 'tool', tool: TOOL, args: { service: 'passport' }, assert: "d['service']=='passport-renewal-adult' and any(f['key']=='fee-online-uk' and f['value']==102 for f in d['figures']) and d['source'].startswith('https://www.gov.uk/') and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/uk/gov-process?service=passport'" },
    { label: 'rest-uk-gov-process-eta', kind: 'rest', path: REST_PATH, query: 'service=eta', assert: "d['service']=='eta' and any(f['key']=='fee' and f['value']==20 for f in d['figures']) and 'freshness' in d" },
    { label: 'call-uk-gov-process-nearmiss', kind: 'tool', tool: TOOL, args: { service: 'zzz-passprt' }, assert: "d.get('covered')==False and len(d['nearest'])>0" },
  ],
};
