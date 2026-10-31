#!/usr/bin/env node
/**
 * Regenerate the static public files and docs that list the curated areas, from
 * the area modules (api/_areas/*.js). Hand-written prose stays; only the text
 * between a file's start/end markers is replaced:
 *
 *   public/llms.txt                 <!-- sync-areas:rest -->, <!-- sync-areas:servers -->
 *   public/sitemap.xml              whole file (one <url> per changelog area between the fixed pages)
 *   public/.well-known/changes.json areas[] (whole file rewritten; `updated` moves only when areas change)
 *   docs/CHANGES_PROTOCOL.md        the ```json discovery example = the file above
 *   README.md                       <!-- sync-areas:roadmap -->, <!-- sync-areas:catalogue -->
 *   docs/CURATION.md                <!-- sync-areas:calendar -->, <!-- sync-areas:unreachable --> (sources the
 *                                   watcher cannot read: data/sources.json `unreachable` + module declarations)
 *   public/index.html               <!-- sync-areas:humans -->, <!-- sync-areas:agents -->
 *   scripts/verify-hub.sh           # sync-areas:checks start / end
 *   server-<key>.json               whole file (MCP registry manifest, one per focused server, from server.description)
 *   Verified Facts (docs/FACTS_PROTOCOL.md), from the facts blocks via api/_facts.js:
 *   public/.well-known/facts.json   whole file (`updated` moves only when the rest changes)
 *   public/.well-known/ai-catalog.json  whole file (one MCP Server Card entry per server)
 *   public/openapi.json             whole file (getFact, getFacts, resolveFact, whatChangedSince — from the tool schemas)
 *   docs/FACTS_PROTOCOL.md          the ```json discovery example (an object with namespaces) = facts.json
 *   public/llms.txt                 <!-- sync-areas:facts --> (the two lines of spec §10.3)
 *   public/sitemap.xml              also /facts, /protocol/facts, /protocol/publish, /facts/publishers and one
 *                                   /facts/<key> per fact (v0.3: the page URLs, never the negotiating /f/<key>)
 *
 * The README roadmap rows are numbered 1..N in `order`; a module's docs.readme.retires
 * names a row of the hand-maintained "planned" table below it, which is then removed.
 *
 *   node scripts/sync-areas.js            # rewrite whatever is stale
 *   node scripts/sync-areas.js --check    # exit 1 and name the stale files (tests/areas.test.js runs this)
 */
const fs = require('node:fs');
const path = require('node:path');
const { AREAS, discovery, restRoutes, changelogAreas, sourceList } = require('../api/_areas');
const { unreachableSources } = require('../api/_sources');
const { SERVERS, ALL_TOOLS } = require('../api/_registry');
const { DIRECT, HUB_TOOLS } = require('../api/_hub');
const { joinList } = require('../api/_area_kit');
const F = require('../api/_facts');
const { getFact, resolveFact, EXAMPLES } = require('../api/_facts_tools');
const { FACTS_SERVER, cardServers, whatChangedSince } = require('../api/_hub');
const { aiCatalog: buildAiCatalog, cardUrl } = require('../api/_server_card');
const {
  FACTS_PROTOCOL, FACTS_WELL_KNOWN_URL, FACTS_SPEC_URL, FACT_SCHEMA_URL, JWKS_URL, WELL_KNOWN_URL, SCHEMA_URL, PUBLISHER,
} = require('../api/_changelog');
const { LICENCE: FACTS_LICENCE } = require('../api/_facts_render');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const today = () => new Date().toISOString().slice(0, 10);
const code = (s) => `<code>${s}</code>`;
/**
 * The focused MCP servers the Vercel firewall answers 403 for since 2026-10-31 — every one except the front door,
 * /api/mcp/facts and /api/mcp/uk-rates. The generated docs point at the front door's `call` for their tools and
 * scripts/verify-hub.sh expects 403 from them. A new area's server is not on this list (the firewall rule names
 * paths), so it is documented and checked as a server of its own until someone adds it here and to the rule.
 */
const FIREWALLED_SERVERS = ['uk-exams', 'provenance', 'stats', 'vehicles', 'tax', 'software-eol', 'policy-rates', 'us-rates', 'de-rates', 'uk-vehicle-rules', 'uk-exam-dates', 'calendar', 'uk-gov-process', 'jp-vehicle-costs', 'jp-living-costs'];
const firewalled = (a) => FIREWALLED_SERVERS.includes(a.server.key || a.area);
const words = (n) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n);

/** Replace the lines between two marker lines (markers kept). Throws when a marker is missing. */
function replaceBlock(text, file, name, content, { open, close } = { open: `<!-- sync-areas:${name} start -->`, close: `<!-- sync-areas:${name} end -->` }) {
  const a = text.indexOf(open), b = text.indexOf(close);
  if (a === -1 || b === -1 || b < a) throw new Error(`${file}: markers "${open}" … "${close}" not found — add them around the block scripts/sync-areas.js should own`);
  const start = a + open.length;
  return `${text.slice(0, start)}\n${content}\n${text.slice(b)}`;
}
const bashMarkers = (name) => ({ open: `# sync-areas:${name} start`, close: `# sync-areas:${name} end` });

/* ---------------- generators ---------------- */

/** The two llms.txt lines of spec §10.3 — the first is an example URL a model can complete from. */
const FACTS_LLMS = [
  '- `GET https://databutler.dev/f/uk/income-tax/personal-allowance?max_age=30d` — one verified official figure by key (value, period, effectiveFrom, source, verifiedDate, nextExpectedChange, signature). Pattern: /f/<country>/<topic>/<fact>; index at /f; /f/resolve?q= finds a key; the page for people is /facts/<country>/<topic>/<fact>.',
  `- \`GET https://databutler.dev/.well-known/facts.json\` — Verified Facts protocol discovery (${FACTS_PROTOCOL}): namespaces, endpoints, keys, digest, OpenAPI, MCP.`,
];

function llms(text) {
  let t = replaceBlock(text, 'public/llms.txt', 'rest', AREAS.flatMap((a) => a.docs.llms.rest).join('\n'));
  const kept = AREAS.filter((a) => a.server && !firewalled(a));
  const viaCall = AREAS.filter((a) => a.server && firewalled(a)).flatMap((a) => a.server.tools.map((x) => `\`${x.name}\``));
  t = replaceBlock(t, 'public/llms.txt', 'servers', [
    ...kept.map((a) => a.docs.llms.server),
    `- Every other area's tools (${viaCall.join(', ')}) are reached through the front door: \`catalogue\` lists them and \`call\` runs any by name.`,
  ].join('\n'));
  t = replaceBlock(t, 'public/llms.txt', 'facts', FACTS_LLMS.join('\n'));
  return t;
}

/** The sitemap has no prose to keep, so the whole file is generated (and stays comment-free for strict XML readers). */
function sitemap() {
  const url = (p) => `<url><loc>https://databutler.dev${p}</loc></url>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url('/'), url('/changes'),
    ...changelogAreas().map((a) => url(`/changes?area=${a}`)),
    url('/protocol'), url('/privacy'), url('/api'),
    url('/facts'), url('/protocol/facts'), url('/protocol/publish'), url('/facts/publishers'),
    ...[...F.INDEX.keys()].map((k) => url(`/facts/${k}`)),
    '</urlset>',
    '',
  ].join('\n');
}

function wellKnown(text) {
  const current = JSON.parse(text);
  const areas = discovery();
  // verified-facts/0.2 §10.2: changes.json names facts.json, so a consumer that finds either finds both
  const changed = JSON.stringify(current.areas) !== JSON.stringify(areas) || current.facts !== FACTS_WELL_KNOWN_URL;
  const next = { ...current, updated: changed ? today() : current.updated, areas, facts: FACTS_WELL_KNOWN_URL };
  return JSON.stringify(next, null, 2) + '\n';
}

/**
 * A spec's discovery example is the served file, verbatim (tests/protocol.test.js, tests/facts-discovery.test.js):
 * the first ```json fence whose object has every one of `has` is replaced.
 */
function protocolDoc(text, wellKnownJson, { file = 'docs/CHANGES_PROTOCOL.md', has = ['areas', 'endpoints'] } = {}) {
  const fence = /```json\n([\s\S]*?)\n```/g;
  let hit = false;
  const out = text.replace(fence, (m, body) => {
    let obj;
    try { obj = JSON.parse(body); } catch { return m; }
    if (!obj || has.some((k) => !obj[k]) || hit) return m;
    hit = true;
    return `\`\`\`json\n${wellKnownJson.trimEnd()}\n\`\`\``;
  });
  if (!hit) throw new Error(`${file}: no \`\`\`json discovery example (an object with ${has.join(' + ')}) found`);
  return out;
}

/* ---------------- Verified Facts discovery (docs/FACTS_PROTOCOL.md §9.3, §10) ---------------- */

const hostOf = (u) => new URL(u).hostname;

/** /.well-known/facts.json from the index; `updated` moves only when anything else changes. */
function factsWellKnown(text) {
  const byNs = new Map();
  for (const [key, r] of F.INDEX) {
    const ns = F.namespaceOf(key);
    if (!byNs.has(ns)) byNs.set(ns, { count: 0, hosts: new Set(), areas: new Set() });
    const g = byNs.get(ns);
    g.count += 1;
    for (const p of F.PERIODS.get(key)) g.hosts.add(hostOf(p.source));
    g.areas.add(F.META.get(key).area);
  }
  const areaOf = (name) => AREAS.find((a) => a.area === name);
  const NS_ORDER = ['uk', 'us', 'de', 'eu'];
  const nsRank = (n) => (NS_ORDER.includes(n) ? NS_ORDER.indexOf(n) : NS_ORDER.length);
  const namespaces = [...byNs].sort(([x], [y]) => nsRank(x) - nsRank(y) || x.localeCompare(y)).map(([name, g]) => {
    const areas = [...g.areas].map(areaOf).sort((x, y) => x.order - y.order);
    return {
      name,
      description: joinList(areas.map((a) => (a.area === 'policy-rates' ? `${{ uk: 'Bank of England Bank Rate', us: 'Federal Reserve federal funds target range', eu: 'ECB key interest rates' }[name] || a.short}` : a.short))),
      count: g.count,
      cadence: areas.map((a) => `${a.area}: ${a.discovery ? a.discovery.cadence : 'see /.well-known/changes.json'}`).join(' '),
      authorities: [...g.hosts].sort(),
      digest: F.digestFor(name),
    };
  });
  const body = {
    protocol: FACTS_PROTOCOL,
    publisher: PUBLISHER,
    conformance: 'L3',
    updated: null,
    facts: {
      count: F.FACT_COUNT,
      get: 'https://databutler.dev/f/{key}',
      page: 'https://databutler.dev/facts/{key}',
      batch: 'https://databutler.dev/f?keys={keys}',
      resolve: 'https://databutler.dev/f/resolve?q={q}',
      index: 'https://databutler.dev/f',
      digest: F.DIGEST,
      filtering: 'server',
      examples: ['uk/income-tax/personal-allowance', 'us/social-security/wage-base', 'de/income-tax/grundfreibetrag', 'uk/bank-rate'].filter((k) => F.INDEX.has(k)),
    },
    namespaces,
    hash: 'sha256/jcs',
    signature: 'EdDSA/jws-detached',
    keys: JWKS_URL,
    changes: WELL_KNOWN_URL,
    openapi: 'https://databutler.dev/openapi.json',
    mcp: { url: FACTS_SERVER.url, tools: FACTS_SERVER.tools.map((t) => t.name), serverCard: cardUrl(FACTS_SERVER) },
    schema: FACT_SCHEMA_URL,
    specification: FACTS_SPEC_URL,
    licence: FACTS_LICENCE,
    contact: 'https://github.com/physics-star-cat/databutler/issues',
  };
  let current = null;
  try { current = JSON.parse(text); } catch { /* first run */ }
  const same = current && JSON.stringify({ ...current, updated: null }) === JSON.stringify(body);
  return `${JSON.stringify({ ...body, updated: same ? current.updated : today() }, null, 2)}\n`;
}

/** /.well-known/ai-catalog.json: every MCP Server Card (SEP-2127; api/_server_card.js pins the shapes). */
const aiCatalogJson = () => `${JSON.stringify(buildAiCatalog(Object.values(cardServers())), null, 2)}\n`;

/** OpenAPI 3.1 built from the facts tools' and what_changed_since's input schemas, so the two never drift (spec §9.3). */
function openapi() {
  const param = (name, schema, where = 'query', extra = {}) => ({ name, in: where, required: where === 'path', description: schema.description, schema: { type: schema.type, ...(schema.enum ? { enum: schema.enum } : {}), ...(schema.format ? { format: schema.format } : {}) }, ...extra });
  const g = getFact.inputSchema.properties;
  const r = resolveFact.inputSchema.properties;
  const w = whatChangedSince.inputSchema.properties;
  const json = (ref) => ({ 'application/json': { schema: { $ref: ref } } });
  const miss = { description: 'Unknown key: candidates and the index URL (spec §5.4); not cached', content: json(`${FACT_SCHEMA_URL}#/$defs/miss`) };
  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'Data Butler — Verified Facts and Verified Changes',
      version: '0.3.0',
      summary: 'Official figures by key, each with its source, verified date, hash and signature; and what changed since a date.',
      description: `${getFact.description}\n\nSpecification: ${FACTS_SPEC_URL}. No authentication.`,
      license: { name: 'Free to reuse with attribution to databutler.dev; each figure stays under its official source\'s terms', url: 'https://databutler.dev/terms' },
      contact: { url: 'https://github.com/physics-star-cat/databutler/issues' },
    },
    servers: [{ url: 'https://databutler.dev' }],
    'x-verified-facts': FACTS_PROTOCOL.split('/')[1],
    paths: {
      '/f/{key}': {
        get: {
          operationId: 'getFact',
          summary: getFact.title,
          description: getFact.description,
          parameters: [
            param('key', g.key, 'path', { allowReserved: true, example: 'uk/income-tax/personal-allowance' }),
            param('max_age', g.max_age), param('as_of', g.as_of), param('period', g.period),
            { name: 'format', in: 'query', required: false, description: 'json (default) | txt (one line) | html (the indexable page)', schema: { type: 'string', enum: ['json', 'txt', 'html'] } },
          ],
          responses: {
            200: { description: 'The fact record (spec §4); a period not held answers covered:false with periodsHeld', content: { ...json(FACT_SCHEMA_URL), 'text/plain': { schema: { type: 'string' } }, 'text/html': { schema: { type: 'string' } } } },
            400: { description: 'Bad max_age, as_of or format', content: json(`${FACT_SCHEMA_URL}#/$defs/miss`) },
            404: miss,
          },
        },
      },
      '/f': {
        get: {
          operationId: 'getFacts',
          summary: 'Get several verified facts',
          description: `A batch of up to ${F.BATCH_LIMIT} keys, results in request order; a miss inside the batch does not fail it (spec §7). Without keys, the index of every key (spec §5.5). POST /f with {"keys": [...]} is the same batch.`,
          parameters: [
            { name: 'keys', in: 'query', required: false, description: `comma-separated keys (max ${F.BATCH_LIMIT}); omit for the index`, schema: { type: 'string' }, example: 'uk/income-tax/personal-allowance,us/social-security/wage-base' },
            param('max_age', g.max_age), param('as_of', g.as_of), param('period', g.period),
            { name: 'namespace', in: 'query', required: false, description: 'index only: one namespace (uk, us, de, eu)', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'A batch (with keys) or the index (without; it carries `digest` and an ETag equal to it)', content: json(`${FACT_SCHEMA_URL}#/$defs/batch`) },
            304: { description: 'Index only: If-None-Match matched the digest — no fact claim has changed (spec §5.6)' },
            400: { description: 'Too many keys or a bad option', content: json(`${FACT_SCHEMA_URL}#/$defs/miss`) },
          },
        },
      },
      '/f/resolve': {
        get: {
          operationId: 'resolveFact',
          summary: resolveFact.title,
          description: resolveFact.description,
          parameters: [{ ...param('q', r.q), required: true }, param('namespace', r.namespace), param('limit', r.limit)],
          responses: { 200: { description: 'Ranked candidates, with best when unambiguous (spec §6)', content: json(`${FACT_SCHEMA_URL}#/$defs/resolve`) } },
        },
      },
      '/api/changes': {
        get: {
          operationId: 'whatChangedSince',
          summary: whatChangedSince.title,
          description: whatChangedSince.description,
          parameters: [{ ...param('since', w.since), required: true }, param('area', w.area)],
          responses: { 200: { description: 'A Verified Changes document (verified-changes/0.1); entries carry factKey', content: json(SCHEMA_URL) } },
        },
      },
    },
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Drop the planned-table rows (between the roadmap block and the catalogue block) whose
 * `#` cell an area module retires, so building an area removes its own "planned" row.
 */
function retirePlanned(text, ids) {
  if (!ids.length) return text;
  const a = text.indexOf('<!-- sync-areas:roadmap end -->'), b = text.indexOf('<!-- sync-areas:catalogue start -->');
  if (a === -1 || b === -1 || b < a) return text;
  const middle = text.slice(a, b).split('\n').filter((line) => !ids.some((id) => new RegExp(`^\\|\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|`).test(line))).join('\n');
  return text.slice(0, a) + middle + text.slice(b);
}

function readme(text) {
  const roadmap = [
    '| # | Vertical (wishlist item it serves) | Endpoint | Status |',
    '|---|---|---|---|',
    ...AREAS.map((a, i) => {
      const k = a.server ? a.server.key || a.area : null;
      const row = k && firewalled(a) ? a.docs.readme.roadmapRow.replace(`| \`/api/mcp/${k}\` |`, `| front door \`call\` (\`/api/mcp/${k}\`: 403 since 2026-10-31) |`) : a.docs.readme.roadmapRow;
      return `| ${i + 1} ${row}`;
    }),
  ].join('\n');
  const hub = HUB_TOOLS.map((t) => `\`${t.name}\``).join(', ');
  const catalogue = [
    `## Tool catalogue (${Object.keys(ALL_TOOLS).length} tools: the front door, \`/api/mcp/facts\` and ${AREAS.filter((a) => a.server && !firewalled(a)).map((a) => `\`/api/mcp/${a.server.key || a.area}\``).join(', ')})`,
    '',
    `Every tool is reached through the front door \`POST /api/mcp\`: listed there, or by name through \`call\` (\`catalogue\` lists them all). The other ${FIREWALLED_SERVERS.length} focused \`/api/mcp/<area>\` servers answer 403 at the Vercel firewall since 2026-10-31.`,
    '',
    '| Area (how to reach it) | Tools | Data |',
    '|---|---|---|',
    ...AREAS.filter((a) => a.server).map((a) => {
      const k = a.server.key || a.area;
      const reach = firewalled(a) ? 'front door (`call`)' : `front door; also \`/api/mcp/${k}\``;
      return a.docs.readme.catalogueRow.replace(/^\| `\/api\/mcp\/[a-z0-9-]+` \|/, `| ${a.title} — ${reach} |`);
    }),
    `| Verified Facts — \`/api/mcp/facts\` | ${FACTS_SERVER.tools.map((t) => `\`${t.name}\``).join(', ')} — Verified Facts (${FACTS_PROTOCOL}): one official figure by key, signed | ${F.FACT_COUNT} facts from the ${F.FACT_COUNT ? new Set([...F.META.values()].map((m) => m.area)).size : 0} facts areas (\`facts\` blocks); also \`GET /f/<key>\` (JSON) and \`/facts/<key>\` (the page) |`,
    `| Front door — \`/api/mcp\` | the ${words(DIRECT.length)} high-frequency tools above (${DIRECT.map((n) => `\`${n}\``).join(', ')}) + ${hub} | — |`,
    '',
    `REST mirrors: ${restRoutes().map((r) => `\`/api/${r.path}\``).join(', ')}.`,
  ].join('\n');
  let t = replaceBlock(text, 'README.md', 'roadmap', roadmap);
  t = replaceBlock(t, 'README.md', 'catalogue', catalogue);
  return retirePlanned(t, AREAS.map((a) => a.docs.readme.retires).filter(Boolean));
}

/** The MCP registry manifest for one focused server (the shape every server-*.json already has). */
function manifest(key, s) {
  const j = (v) => JSON.stringify(v);
  return [
    '{',
    `  "$schema": ${j('https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json')},`,
    `  "name": ${j(`io.github.physics-star-cat/${s.serverName}`)},`,
    `  "description": ${j(s.description)},`,
    `  "repository": { "url": ${j('https://github.com/physics-star-cat/databutler')}, "source": "github" },`,
    `  "version": ${j(s.version || '1.0.0')},`,
    `  "websiteUrl": ${j('https://databutler.dev/api')},`,
    `  "remotes": [{ "type": "streamable-http", "url": ${j(s.url)} }]`,
    '}',
    '',
  ].join('\n');
}

const CALENDAR_TAIL = [
  '| `data/sources.json` | After every data refresh (automatic via `scripts/changelog.js`) | `node scripts/sources.js` re-checks every source URL (gov.uk content API / page hash); a page it cannot fetch is recorded `unreachable` and listed under "Sources the watcher cannot read". |',
  '| `data/source-checks.json` | Mondays, automatic (`.github/workflows/watch-sources.yml`, committed by the bot) | `node scripts/check-sources.js` fetches every watched source page and records `checkedAt` (served as `sourceCheckedAt`) and `changedAt` (the page differs from `data/sources.json`; such records are served stale with `staleReason: "source-changed"` until re-verified). Never edited by hand. |',
  '| Expected changes passed | Daily for policy rates, Mondays for every area (the same workflow and the Vercel cron) | `node scripts/expected-changes.js` lists every record whose `nextExpectedChange` passed unverified and keeps the one issue "Re-verify: expected change passed" current; re-verify those records the same day. |',
  '| `data/facts-signatures.json` | After every data change to a facts area, before commit | `node scripts/sign-facts.js` with the key in `~/.config/databutler/` (never on Vercel); `tests/facts-sign.test.js` fails while a served fact is unsigned. See "Signing and key rotation". |',
  '| `data/changelog.json` | With every data refresh | `node scripts/changelog.js` (areas with a `changelog.diff`) or the dataset\'s own script (`changelog.script`); fill in `note` lines. See "Changelog & source watcher" and docs/ADDING_AN_AREA.md. |',
];

function curation(text) {
  const rows = ['| Dataset | Refresh trigger | How |', '|---|---|---|', ...AREAS.flatMap((a) => a.docs.curation), ...CALENDAR_TAIL];
  const seen = JSON.parse(readOr('data/sources.json') || '[]');
  const blocked = unreachableSources(sourceList(), seen);
  const unreachable = blocked.length
    ? ['| Area | Page | Why the watcher skips it |', '|---|---|---|', ...blocked.map((u) => `| ${u.area} | ${u.url} | ${String(u.reason).replace(/\|/g, '\\|')}${u.checkedAt ? ` (recorded ${u.checkedAt})` : ''} |`)]
    : ['None — the watcher reads every source page.'];
  const t = replaceBlock(text, 'docs/CURATION.md', 'calendar', rows.join('\n'));
  return replaceBlock(t, 'docs/CURATION.md', 'unreachable', unreachable.join('\n'));
}

function indexHtml(text) {
  const humans = `(${AREAS.filter((a) => a.changelog).map((a) => a.short).join(', ')})`;
  const rest = AREAS.filter((a) => a.rest.length).map((a) => code(`/api/${a.rest[0].path}`));
  const blurbs = AREAS.filter((a) => a.server && firewalled(a) && a.docs.index && a.docs.index.blurb).map((a) => a.docs.index.blurb);
  const own = AREAS.filter((a) => a.server && !firewalled(a)).map((a) => code(a.server.url.replace('https://databutler.dev', '')));
  const agents = `One verified official figure per URL at ${code('/f/&lt;country&gt;/&lt;topic&gt;/&lt;fact&gt;')} (JSON) and ${code('/facts/&lt;country&gt;/&lt;topic&gt;/&lt;fact&gt;')} (the page) — e.g. <a href="/facts/uk/income-tax/personal-allowance">/facts/uk/income-tax/personal-allowance</a> (${F.FACT_COUNT} keys at <a href="/facts">/facts</a>, signed; MCP ${code('/api/mcp/facts')}). <a href="/protocol/publish">Publish your own figures</a> the same way. REST at ${[...rest, code('/api/changes')].join(', ')}. Every other tool — \n${joinList(blurbs, { sep: ';\n', last: '; and\n' })} — is reached through the front door's ${code('call')}; ${joinList(own)} ${own.length === 1 ? 'also stays a server of its own' : 'also stay servers of their own'}.`;
  let t = replaceBlock(text, 'public/index.html', 'humans', humans);
  t = replaceBlock(t, 'public/index.html', 'agents', agents);
  return t;
}

function verifyHub(text) {
  const frontDoorNames = [...DIRECT, ...HUB_TOOLS.map((t) => t.name)];
  const json = (v) => {
    const s = JSON.stringify(v);
    if (s.includes("'")) throw new Error(`verify check argument contains a single quote: ${s}`);
    return s;
  };
  const lines = [
    'check tools/list "$(rpc \'{"jsonrpc":"2.0","id":2,"method":"tools/list"}\')" \\',
    `  "[t['name'] for t in d['result']['tools']]==[${frontDoorNames.map((n) => `'${n}'`).join(',')}]"`,
    `check catalogue "$(inner "$(tool catalogue '{}')")" "d['count']==${Object.keys(ALL_TOOLS).length}"`,
  ];
  for (const a of AREAS) {
    if (!a.verify.length) continue;
    lines.push(`# ${a.area}`);
    for (const v of a.verify) {
      if (v.kind === 'tool') {
        const call = frontDoorNames.includes(v.tool) ? `tool ${v.tool} '${json(v.args)}'` : `tool call '${json({ tool: v.tool, arguments: v.args })}'`;
        lines.push(`check ${v.label} "$(inner "$(${call})")" \\`, `  "${v.assert}"`);
      } else {
        const url = v.query ? `$BASE/api/${v.path}?${v.query}` : `$BASE/api/${v.path}`;
        lines.push(`check ${v.label} "$(curl -sS "${url}")" "${v.assert}"`);
      }
    }
  }
  // The Vercel firewall answers 403 for FIREWALLED_SERVERS; the front door, /api/mcp/facts and every other server
  // must still answer tools/list.
  const blocked = Object.keys(SERVERS).filter((k) => FIREWALLED_SERVERS.includes(k));
  const open = Object.keys(SERVERS).filter((k) => !FIREWALLED_SERVERS.includes(k));
  lines.push(
    `for name in ${blocked.join(' ')}; do`,
    '  CODE="$(curl -s -o /dev/null -w \'%{http_code}\' -X POST "$BASE/api/mcp/$name" -H \'Content-Type: application/json\' -d \'{"jsonrpc":"2.0","id":2,"method":"tools/list"}\')"',
    '  if [ "$CODE" = "403" ]; then echo "PASS legacy $name 403"; else echo "FAIL legacy $name expected 403, got $CODE"; FAILED=1; fi',
    'done',
    `for path in mcp mcp/facts ${open.map((k) => `mcp/${k}`).join(' ')}; do`,
    '  check "kept /api/$path tools/list" "$(curl -sS -X POST "$BASE/api/$path" -H \'Content-Type: application/json\' -d \'{"jsonrpc":"2.0","id":2,"method":"tools/list"}\')" "len(d[\'result\'][\'tools\'])>0"',
    'done',
  );
  return replaceBlock(text, 'scripts/verify-hub.sh', 'checks', lines.join('\n'), bashMarkers('checks'));
}

/* ---------------- driver ---------------- */

const readOr = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? read(rel) : '');

function plan() {
  const wk = wellKnown(read('public/.well-known/changes.json'));
  const fwk = factsWellKnown(readOr('public/.well-known/facts.json'));
  return [
    ...Object.entries(SERVERS).map(([key, s]) => [`server-${key}.json`, manifest(key, s)]),
    ['public/llms.txt', llms(read('public/llms.txt'))],
    ['public/sitemap.xml', sitemap()],
    ['public/.well-known/changes.json', wk],
    ['docs/CHANGES_PROTOCOL.md', protocolDoc(read('docs/CHANGES_PROTOCOL.md'), wk)],
    ['public/.well-known/facts.json', fwk],
    ['docs/FACTS_PROTOCOL.md', protocolDoc(read('docs/FACTS_PROTOCOL.md'), fwk, { file: 'docs/FACTS_PROTOCOL.md', has: ['namespaces', 'facts'] })],
    ['public/.well-known/ai-catalog.json', aiCatalogJson()],
    ['public/openapi.json', openapi()],
    ['README.md', readme(read('README.md'))],
    ['docs/CURATION.md', curation(read('docs/CURATION.md'))],
    ['public/index.html', indexHtml(read('public/index.html'))],
    ['scripts/verify-hub.sh', verifyHub(read('scripts/verify-hub.sh'))],
  ];
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const stale = plan().filter(([rel, next]) => readOr(rel) !== next);
  if (check) {
    if (stale.length) {
      console.error(`sync-areas: stale — run \`node scripts/sync-areas.js\`:\n  ${stale.map(([r]) => r).join('\n  ')}`);
      return 1;
    }
    console.log('sync-areas: everything derived from api/_areas/*.js is up to date');
    return 0;
  }
  for (const [rel, next] of stale) {
    fs.writeFileSync(path.join(ROOT, rel), next);
    console.log(`sync-areas: wrote ${rel}`);
  }
  if (!stale.length) console.log('sync-areas: nothing to do');
  return 0;
}

if (require.main === module) process.exit(main());

/** Every file this script owns — scripts/changelog.js lets these be dirty while a new area is being added. */
const GENERATED = () => plan().map(([rel]) => rel);

module.exports = { main, plan, replaceBlock, retirePlanned, manifest, GENERATED, FACTS_LLMS, openapi, factsWellKnown, FIREWALLED_SERVERS };
