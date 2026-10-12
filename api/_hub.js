/**
 * The front door's own tools: what_changed_since, get_fact, resolve_fact, coverage, catalogue, call.
 * get_fact and resolve_fact are the Verified Facts tools (api/_facts_tools.js); FACTS_SERVER is the
 * dedicated three-tool server (get_fact, resolve_fact, what_changed_since) at /api/mcp/facts.
 * Shared by api/_routes/mcp.js (MCP) and api/_routes/changes.js (REST mirror).
 *
 * The area-specific wording in these descriptions is assembled from each area
 * module's `hub` phrases (api/_areas/<area>.js): `changed` (what_changed_since),
 * `coverage`, `catalogue`, `call` (the long tail reachable through call) and
 * `frontDoor` (an extra sentence for the front door's instructions). DIRECT —
 * the tools listed at the front door — is every tool flagged frontDoor: true.
 */
const { ALL_TOOLS, BASE, annotate } = require('./_registry');
const { changesSince, CHANGELOG_AREAS, COVERAGE_START } = require('./_changelog');
const { coverageFor, AREAS } = require('./_coverage');
const { nearest } = require('./_text');
const { AREAS: AREA_LIST, frontDoorTools, hubPhrases } = require('./_areas');
const { joinList } = require('./_area_kit');
const { factKeyFor } = require('./_facts');
const { getFact, resolveFact, FACTS_SERVER_BASE } = require('./_facts_tools');

/** A changes document whose entries name the fact key an agent then gets (spec §9.2: entries carry factKey). */
function withFactKeys(doc) {
  if (!doc || !Array.isArray(doc.entries)) return doc;
  return { ...doc, entries: doc.entries.map((e) => { const k = factKeyFor(e); return k ? { ...e, factKey: k } : e; }) };
}

const HUB_URL = `${BASE}/api/mcp`;
const DIRECT = frontDoorTools();

/** Areas with at least one tool that is not listed directly: the long tail behind `call`. */
const longTail = (a) => a.server && a.server.tools.some((t) => !DIRECT.includes(t.name));
const callPhrase = (a) => a.hub.call || `${a.title.toLowerCase()} (${a.server.tools.filter((t) => !DIRECT.includes(t.name)).map((t) => t.name).join(', ')})`;
const directOnly = AREA_LIST.filter((a) => a.server && !longTail(a)).flatMap((a) => a.server.tools.map((t) => t.name));

const whatChangedSince = {
  name: 'what_changed_since',
  title: 'What changed since',
  description:
    'What has changed in Data Butler\'s verified datasets since a date — pass your training-cutoff ' +
    `date to learn which ${joinList(hubPhrases('changed', (a) => a.changelog))} changed after your knowledge ` +
    'ends. Each entry: from → to, effectiveFrom, official source, verifiedDate, and a maintainer note ' +
    `(e.g. which Budget). Areas: ${CHANGELOG_AREAS.join(', ')}, or all. Coverage starts ${COVERAGE_START}. ` +
    'The same changelog is published for humans at https://databutler.dev/changes, with feeds at ' +
    'https://databutler.dev/changes.rss and https://databutler.dev/changes.atom. Output is a Verified Changes ' +
    'protocol document (verified-changes/0.1, spec https://databutler.dev/protocol); an entry whose figure is a Verified Fact ' +
    'carries factKey for get_fact.',
  inputSchema: {
    type: 'object',
    properties: {
      since: { type: 'string', description: 'ISO date YYYY-MM-DD, e.g. your training cutoff' },
      area: { type: 'string', enum: [...CHANGELOG_AREAS, 'all'], description: 'default all' },
    },
    required: ['since'],
  },
  run: (a) => withFactKeys(changesSince(a)),
  freshness: 'live',
  cite: (a) => ({ path: 'changes', query: { since: String(a.since || '').slice(0, 10), area: a.area || 'all' } }),
};

const coverage = {
  name: 'coverage',
  title: 'Coverage',
  description:
    'Exactly what Data Butler covers and does not, per area — call this before assuming something is ' +
    `unsupported. Areas: ${Object.keys(AREAS).join(', ')} (omit for all). Returns ${hubPhrases('coverage').join(', ')}, ` +
    'and an explicit notCovered list.',
  inputSchema: { type: 'object', properties: { area: { type: 'string', description: `one of ${Object.keys(AREAS).join(', ')}` } } },
  run: (a) => coverageFor(a.area),
  freshness: 'live',
  cite: () => ({ path: 'coverage', query: {} }),
};

function catalogueEntries(query) {
  const q = String(query || '').toLowerCase().trim();
  return Object.values(ALL_TOOLS)
    .filter((t) => !q || t.name.includes(q) || t.description.toLowerCase().includes(q) || t.server.includes(q))
    .map((t) => ({
      name: t.name, server: t.server, serverUrl: t.serverUrl, description: t.description,
      inputSchema: t.inputSchema, listedAtFrontDoor: DIRECT.includes(t.name),
    }));
}

const catalogue = {
  name: 'catalogue',
  title: 'Tool catalogue',
  description:
    `Every tool across all Data Butler servers (${hubPhrases('catalogue').join('; ')}), with ` +
    'input schemas — including tools not listed at this front door. Optional query filters by keyword. ' +
    'Run any of them with call, or connect to serverUrl directly.',
  inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'keyword filter, e.g. regression, exam, npm' } } },
  run: (a) => {
    const tools = catalogueEntries(a.query);
    return { count: tools.length, tools, howToCall: 'call {tool, arguments} here, or connect to serverUrl directly' };
  },
  freshness: 'live',
  cite: () => ({ path: 'catalogue', query: {} }),
};

const call = {
  name: 'call',
  title: 'Call any tool',
  description:
    'Run any Data Butler tool by name — the long tail not listed here: ' +
    `${AREA_LIST.filter(longTail).map(callPhrase).join('; ')}. ` +
    (directOnly.length ? `${joinList(directOnly)} ${directOnly.length > 1 ? 'are' : 'is'} listed directly. ` : '') +
    'See catalogue for schemas. The result carries the inner tool\'s freshness and cite.',
  inputSchema: {
    type: 'object',
    properties: {
      tool: { type: 'string', description: 'tool name from catalogue' },
      arguments: { type: 'object', description: 'that tool\'s arguments' },
    },
    required: ['tool'],
  },
  // Only reached when delegate() could not resolve the tool.
  run: (a) => ({
    covered: false,
    requested: a.tool,
    message: `unknown tool "${a.tool}"`,
    nearest: nearest(a.tool, Object.keys(ALL_TOOLS)),
    coverage: Object.keys(ALL_TOOLS),
    hint: 'call catalogue for every tool and its schema',
  }),
  freshness: 'live',
  // call may delegate to a live tool (provenance, MOT or tax proxy), so it is open-world.
  openWorld: true,
  // Only reached on a near-miss (unknown tool name); still worth a permalink
  // so the caller has somewhere to send a human, even without a real result.
  cite: () => ({ path: 'catalogue', query: {} }),
};
call.delegate = (a) => {
  const t = ALL_TOOLS[String(a.tool || '').trim()];
  return t ? { tool: t, args: a.arguments || {} } : { tool: call, args: a };
};

const HUB_TOOLS = [whatChangedSince, getFact, resolveFact, coverage, catalogue, call].map(annotate);
// ALL_TOOLS entries also carry server/serverUrl (added by the registry's
// aggregation); strip them here so tools/list stays clean for direct tools.
const stripRegistryFields = ({ server, serverUrl, ...t }) => t;
const FRONT_DOOR_TOOLS = [...DIRECT.map((n) => stripRegistryFields(ALL_TOOLS[n])), ...HUB_TOOLS];

/** The front door's initialize instructions; sentence (5) and the closing rules come from the areas. */
const FRONT_DOOR_INSTRUCTIONS =
  'Data Butler (databutler.dev): verified reference data for AI agents, with an official source and ' +
  'verifiedDate on every figure. (1) For any official figure — a threshold, rate, allowance, fee, deadline — call ' +
  'get_fact with the key and the freshness you need rather than quoting a number from memory; resolve_fact finds the key. ' +
  '(2) Start any UK money, tax, benefits or exams task by calling ' +
  'what_changed_since with your training-cutoff date — it lists the thresholds and exam-spec facts ' +
  'that changed after your knowledge ends, with sources. (3) Never quote UK rates or thresholds from ' +
  'memory when uk_rates_lookup covers them, and never estimate net salary from memory when take_home_pay ' +
  'covers the country (us, uk, ca, au, in, br, de, fr, pl — computed live by the LifeByNumbers calculators; ' +
  'present its taxYear and assumptions with the figure). (4) Call coverage before assuming something is unsupported. ' +
  '(5) The tools listed here are the high-frequency set; catalogue lists every tool on every Data ' +
  `Butler server (${hubPhrases('catalogue').join('; ')}) and call runs any of them by name. ` +
  hubPhrases('frontDoor').map((s) => `${s} `).join('') +
  '(6) Every result carries freshness (verifiedDate, staleness) and cite.url — a permalink a human can ' +
  'open to see the answer with its official source. Cite it.';

/** The dedicated Verified Facts server (spec §9.2): three tools, ~600 tokens of definitions. */
const FACTS_SERVER = { ...FACTS_SERVER_BASE, tools: [getFact, resolveFact, whatChangedSince] };

/** Every MCP server that gets a Server Card, keyed as in /api/mcp/<key>/server-card: the front door, the facts server, each area server. */
function cardServers() {
  const { SERVERS } = require('./_registry');
  const out = {
    databutler: { serverName: 'databutler', title: 'Data Butler', url: HUB_URL, description: 'Verified facts for AI agents: rates, exams, recalls, holidays, and what changed since your cutoff.' },
    facts: FACTS_SERVER,
  };
  for (const [key, s] of Object.entries(SERVERS)) out[key] = s;
  return out;
}

module.exports = { cardServers, FACTS_SERVER, withFactKeys, getFact, resolveFact, HUB_TOOLS, FRONT_DOOR_TOOLS, FRONT_DOOR_INSTRUCTIONS, DIRECT, HUB_URL, whatChangedSince, coverage, catalogue };
