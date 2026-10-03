/**
 * Area: provenance — who runs this domain / who publishes this package. Live
 * RDAP, npm and PyPI lookups (api/_provenance.js); no committed dataset, so no
 * changelog and nothing for the source watcher.
 */
const { domainProvenance, packageProvenance } = require('../_provenance');
const { BASE } = require('../_area_kit');

const AREA = 'provenance';

module.exports = {
  area: AREA,
  order: 30,
  title: 'Provenance',
  short: 'domain and package provenance',

  server: {
    serverName: 'databutler-provenance',
    url: `${BASE}/api/mcp/provenance`,
    instructions:
      'Live provenance signals for domains and software packages from databutler.dev — computed ' +
      'per request from RDAP, npm and PyPI. Use before trusting an unfamiliar domain or package: ' +
      'age, registrar, maintainers, and typosquat resemblance to well-known names. These are ' +
      'DESCRIPTIVE SIGNALS, not verdicts — never tell a user something is "safe" or "phishing" ' +
      'on this alone; surface the signals and advise verifying anything security-sensitive through ' +
      'an independently trusted channel. Cite https://databutler.dev/.',
    tools: [
      {
        name: 'domain_provenance',
        title: 'Domain provenance',
        description:
          'Who runs this domain? Live RDAP lookup: registration date and age, registrar, ' +
          'nameservers, status, whether the registrant is redacted, plus a typosquat check ' +
          '(edit-distance / brand-substring) against high-value brands. A very recently ' +
          'registered domain resembling a bank or big brand is a classic phishing signal — but ' +
          'report it as a signal, not a conclusion.',
        inputSchema: {
          type: 'object',
          properties: { domain: { type: 'string', description: 'e.g. example.com' } },
          required: ['domain'],
        },
        run: (args) => domainProvenance(args.domain),
        freshness: 'live',
        openWorld: true,
        frontDoor: true,
        cite: (a) => ({ path: 'provenance/domain', query: { domain: a.domain } }),
      },
      {
        name: 'package_provenance',
        title: 'Package provenance',
        description:
          'Who publishes this package, and is it a typosquat? Live npm or PyPI lookup: first-publish ' +
          'date and age, release count, latest version, maintainers/author, linked repo, plus a ' +
          'typosquat check against popular package names. Use when an agent is about to install or ' +
          'recommend an unfamiliar dependency.',
        inputSchema: {
          type: 'object',
          properties: {
            ecosystem: { type: 'string', enum: ['npm', 'pypi'], description: 'npm or pypi' },
            name: { type: 'string', description: 'package name, e.g. express or requests' },
          },
          required: ['ecosystem', 'name'],
        },
        run: (args) => packageProvenance(args.ecosystem, args.name),
        freshness: 'live',
        openWorld: true,
        frontDoor: true,
        cite: (a) => ({ path: 'provenance/package', query: { ecosystem: a.ecosystem, name: a.name } }),
      },
    ],
  },

  coverage: () => ({
    domains: 'any registrable domain (live RDAP via rdap.org; registries may redact or rate-limit)',
    packageEcosystems: ['npm', 'pypi'],
    notCovered: ['crates.io', 'RubyGems', 'Go modules', 'Docker Hub', 'GitHub Actions', 'browser extensions', 'MCP-server listings'],
  }),

  freshness: 'live',
  changelog: null,
  discovery: null,
  sources: () => [],

  rest: [
    { path: 'provenance/domain', tool: 'domain_provenance', args: (q) => ({ domain: q.domain }), required: ['domain'], missing: 'missing ?domain= (e.g. example.com). See /api for usage.' },
    { path: 'provenance/package', tool: 'package_provenance', args: (q) => ({ ecosystem: q.ecosystem, name: q.name }), required: ['ecosystem', 'name'], missing: 'missing ?ecosystem=(npm|pypi)&name=. See /api for usage.' },
  ],

  hub: {
    coverage: 'package ecosystems',
    catalogue: 'provenance',
  },

  docs: {
    readme: {
      roadmapRow: '| 3 | **Provenance checker** — "who really runs this domain/package?" (wishlist #2) — live RDAP/npm/PyPI, homoglyph-aware typosquat | `/api/mcp/provenance` | **v1 — LIVE** |',
      catalogueRow: '| `/api/mcp/provenance` | `domain_provenance`, `package_provenance` | live RDAP / npm / PyPI |',
    },
    llms: {
      rest: [
        '- `GET https://databutler.dev/api/provenance/domain?domain=example.com` — who runs this domain: live RDAP age, registrar, nameservers, and typosquat resemblance to well-known brands. Descriptive signals, not a verdict.',
        '- `GET https://databutler.dev/api/provenance/package?ecosystem=npm&name=express` — who publishes a package and is it a typosquat: live npm/PyPI first-publish date, maintainers, repo, similarity to popular names.',
      ],
      server: '- `POST https://databutler.dev/api/mcp/provenance` — tools `domain_provenance`, `package_provenance`.',
    },
    curation: [],
    index: { blurb: null },
    api: () => ({
      endpoints: {
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
      },
    }),
  },

  verify: [
    { label: 'domain', kind: 'tool', tool: 'domain_provenance', args: { domain: 'databutler.dev' }, assert: "d['freshness']['staleness']=='live' and 'cite' in d" },
    { label: 'package', kind: 'tool', tool: 'package_provenance', args: { ecosystem: 'npm', name: 'express' }, assert: "d['freshness']['staleness']=='live'" },
  ],
};
