/**
 * Area: software-eol — "is this version still supported, and until when" for 14
 * runtimes and operating systems, from the committed monthly snapshot
 * data/software-eol.json (endoflife.date open data, MIT) built by
 * scripts/software-eol.js, which also writes the changelog entries.
 */
const EOL = require('../_software_eol');
const { BASE } = require('../_area_kit');

const AREA = 'software-eol';
const REFRESH_DAYS = 35;

module.exports = {
  area: AREA,
  order: 70,
  title: 'Software end-of-life',
  short: 'software end-of-life dates',

  server: {
    serverName: 'databutler-software-eol',
    description: "Is this version still supported, and until when: support status and end-of-life timelines for Node.js, Python, Ubuntu, Debian, Android, iOS, macOS, Windows, Oracle JDK, Go, Ruby, PHP, PostgreSQL and React — a monthly snapshot of endoflife.date open data (MIT) with the snapshot date and source on every answer.",
    url: `${BASE}/api/mcp/software-eol`,
    instructions:
      'Software support lifecycles from databutler.dev: is this version still supported, and until when — for ' +
      EOL.PRODUCT_IDS.join(', ') + '. A committed monthly snapshot of endoflife.date open data (MIT), with the snapshot date on every ' +
      'answer, used in place of recalling end-of-life dates from memory, which drift every few months. support_status resolves a ' +
      'version string to its release cycle and states supported true/false with the eol date and days remaining or elapsed; ' +
      'support_timeline lists every cycle. Dates are as endoflife.date publishes them from vendor lifecycle pages; the ' +
      'recommendation is a plain statement, not advice about any one deployment. Cite https://databutler.dev/ and the ' +
      'endoflife.date product page in source.',
    tools: [
      {
        name: 'support_status',
        title: 'Software support status',
        description:
          `Whether a version of ${EOL.PRODUCT_IDS.join(', ')} is still supported, from a monthly snapshot of endoflife.date ` +
          `(${EOL.DATA.cycleCount} release cycles, verified ${EOL.DATA.verifiedDate}). A version string resolves to its release cycle ` +
          '("18", "18.19.0" and "v18" → Node.js 18; "3.11.4" → Python 3.11; "22.04.3" → Ubuntu 22.04; "bookworm" → Debian 12; ' +
          '"1.8.0_392" → Java 8; "11-24h2-w" → Windows 11 24H2 consumer). Returns supported true|false as of today, the eol date, ' +
          'days remaining or since end of life, active-support and extended-support end dates, LTS status, the latest release in ' +
          'the cycle, the newest supported (LTS) cycle, a plain-statement recommendation, and the endoflife.date page as source. ' +
          '"java" and "jdk" resolve to oracle-jdk; a version that fits several Windows editions comes back as candidates with ' +
          'each one\'s status; unknown products and versions answer with the nearest matches.',
        inputSchema: {
          type: 'object',
          properties: {
            product: { type: 'string', description: `one of ${EOL.PRODUCT_IDS.join(', ')} (aliases: node, java, jdk, postgres, golang, osx, win)` },
            version: { type: 'string', description: 'a cycle ("18", "3.11", "22.04"), a full release ("18.19.0", "3.11.4"), a codename ("bookworm", "sonoma") or a Windows cycle id ("11-24h2-w")' },
          },
          required: ['product', 'version'],
        },
        run: (a) => EOL.supportStatus(a),
        freshness: AREA,
        cite: (a) => ({ path: 'software-eol/status', query: { product: a.product, version: a.version } }),
      },
      {
        name: 'support_timeline',
        title: 'Software support timeline',
        description:
          `Every release cycle of one of ${EOL.PRODUCT_IDS.join(', ')}, newest first, each with release date, supported true|false ` +
          'as of today, eol date, LTS status, latest release and active/extended-support end dates, plus the list of currently ' +
          'supported cycles and the newest supported LTS. From the same monthly endoflife.date snapshot as support_status, with ' +
          'the product page as source.',
        inputSchema: {
          type: 'object',
          properties: { product: { type: 'string', description: `one of ${EOL.PRODUCT_IDS.join(', ')} (aliases accepted, e.g. node, java, postgres)` } },
          required: ['product'],
        },
        run: (a) => EOL.supportTimeline(a),
        freshness: AREA,
        cite: (a) => ({ path: 'software-eol/timeline', query: { product: a.product } }),
      },
    ],
  },

  coverage: EOL.softwareEolCoverage,

  // nextScheduledRefresh = verifiedDate + 35 days, stamped by scripts/software-eol.js.
  freshness: { dataFile: 'data/software-eol.json', cadenceDays: REFRESH_DAYS, data: EOL.DATA },

  // Entries are written by the snapshot script, not by scripts/changelog.js.
  // datasetKeys: the entries the script's first derivation wrote (one per product) — tests/changes-page.test.js checks them.
  changelog: { diff: null, script: 'scripts/software-eol.js', datasetKeys: () => Object.keys(EOL.DATA.products).map((p) => `${p}/dataset`) },
  discovery: {
    description: 'Support and end-of-life dates for 14 runtimes and operating systems (endoflife.date snapshot): dataset additions, new cycles, moved or reached end-of-life dates',
    cadence: 'monthly',
  },

  sources: () => [],

  rest: [
    { path: 'software-eol/status', tool: 'support_status', args: (q) => ({ product: q.product, version: q.version }), required: ['product', 'version'] },
    { path: 'software-eol/timeline', tool: 'support_timeline', args: (q) => ({ product: q.product }), required: ['product'] },
  ],

  hub: {
    changed: 'software end-of-life dates (Node.js, Python, Ubuntu, Debian, Android, iOS, macOS, Windows, Java, Go, Ruby, PHP, PostgreSQL, React — cycles that reached end of life or whose dates moved)',
    coverage: 'the 14 software products with end-of-life data',
    catalogue: 'software support status and end-of-life timelines for 14 runtimes and operating systems',
    call: 'software end-of-life (support_status {product, version}, support_timeline {product} for ' + EOL.PRODUCT_IDS.join(', ') + ')',
  },

  docs: {
    readme: {
      roadmapRow: '| **Software end-of-life** — "is this version still supported, and until when" for the 14 runtimes/OSes agents are asked about most (Node.js, Python, Ubuntu, Debian, Android, iOS, macOS, Windows, Oracle JDK, Go, Ruby, PHP, PostgreSQL, React): committed monthly snapshot of endoflife.date open data (MIT, 340 cycles), version → cycle resolution, days remaining/since, changelog entries when a cycle reaches EOL or a date moves | `/api/mcp/software-eol` | **v1 — built 2026-10-03** |',
      catalogueRow: '| `/api/mcp/software-eol` | `support_status` {product, version} — resolves "18", "18.19.0", "3.11", "22.04", "bookworm", "1.8.0_392", "11-24h2-w" to its release cycle; supported true\\|false as of today, eol date, days remaining/since, active/extended-support ends, LTS, latest release, newest supported (LTS) cycle, plain-statement recommendation; `support_timeline` {product} — every cycle. Products: nodejs, python, ubuntu, debian, android, ios, macos, windows, oracle-jdk (java/jdk alias; the site has no "java" product — /java redirects to its java-distribution tag), go, ruby, php, postgresql, react | `data/software-eol.json` (65 KB, 340 cycles): monthly snapshot of endoflife.date `/api/<product>.json`, MIT License, `upstreamProvenance` on every result; regenerate with `node scripts/software-eol.js` (appends `software-eol` changelog entries: first derivation → `<product>/dataset`; afterwards `<product>/<cycle>` when an eol date moves, a cycle reaches end of life between snapshots, or a new cycle appears) |',
    },
    llms: {
      rest: [
        '- `GET https://databutler.dev/api/software-eol/status?product=nodejs&version=18.19.0` — is this version still supported, and until when: support status for Node.js, Python, Ubuntu, Debian, Android, iOS, macOS, Windows, Oracle JDK (Java), Go, Ruby, PHP, PostgreSQL and React from a monthly snapshot of endoflife.date open data (MIT). A version resolves to its release cycle (18.19.0 → 18, 3.11.4 → 3.11, 22.04.3 → 22.04, bookworm → Debian 12); returns supported true|false as of today, the eol date, days remaining or since, LTS status, latest release, the newest supported cycle, a plain-statement recommendation and the endoflife.date page as source. `GET /api/software-eol/timeline?product=python` lists every cycle.',
      ],
      server: '- `POST https://databutler.dev/api/mcp/software-eol` — tools `support_status` {product, version} and `support_timeline` {product}: is this version still supported, and until when, for nodejs, python, ubuntu, debian, android, ios, macos, windows, oracle-jdk (java), go, ruby, php, postgresql, react. A committed monthly snapshot of endoflife.date open data (MIT), not a live lookup: every answer carries the snapshot date (verifiedDate), the eol date as endoflife.date records it from the vendor, and the product page as source. REST mirror: `GET https://databutler.dev/api/software-eol/status?product=…&version=…`.',
    },
    curation: [
      '| `data/software-eol.json` | Monthly (endoflife.date changes continuously; freshness says `due` from 35 days after the fetch) | `node scripts/software-eol.js` — 14 requests to `https://endoflife.date/api/<product>.json` (500 ms apart, UA names databutler.dev), normalises each cycle, bumps `verifiedDate`/`nextScheduledRefresh` (+35 days), appends `software-eol` changelog entries: `<product>/<cycle>` when an eol date moved (from → to, effectiveFrom = new date), when a cycle reached end of life between the two snapshots (supported → end of life, effectiveFrom = eol date) or when a cycle is new (null → released). Fill the blank notes, commit `data/` together. `EOL_DIR=path` builds from saved copies. |',
    ],
    index: { blurb: 'is this version still supported, and until when — Node.js, Python, Ubuntu, Windows and ten more, from endoflife.date' },
    api: () => ({
      endpoints: {
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
      },
      coverage: {
        softwareEol: `${EOL.PRODUCT_IDS.join(', ')}: ${EOL.DATA.cycleCount} release cycles from endoflife.date (MIT), verified ${EOL.DATA.verifiedDate}`,
      },
      mcp: 'Remote MCP server — tools support_status, support_timeline (monthly snapshot of endoflife.date open data for 14 runtimes, operating systems, PostgreSQL and React).',
    }),
  },

  verify: [
    { label: 'call-support-status', kind: 'tool', tool: 'support_status', args: { product: 'nodejs', version: '18.19.0' }, assert: "d['cycle']=='18' and d['supported']==False and d['eol']=='2025-04-30' and d['upstreamProvenance']['attribution']=='endoflife.date' and d['freshness']['staleness'] in ('fresh','due','overdue') and d['cite']['url']=='https://databutler.dev/r/software-eol/status?product=nodejs&version=18.19.0'" },
    { label: 'rest-software-eol-timeline', kind: 'rest', path: 'software-eol/timeline', query: 'product=python', assert: "d['product']=='python' and d['cycleCount']>10 and 'freshness' in d" },
    { label: 'rest-software-eol-400', kind: 'rest', path: 'software-eol/status', query: 'product=nodejs', assert: "'missing' in d['error']" },
  ],

  REFRESH_DAYS,
};
