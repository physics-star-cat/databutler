/**
 * The front door's own tools: what_changed_since, coverage, catalogue, call.
 * Shared by api/mcp.js (MCP) and api/changes.js (REST mirror).
 */
const { ALL_TOOLS, BASE, annotate } = require('./_registry');
const { changesSince, CHANGELOG_AREAS, COVERAGE_START } = require('./_changelog');
const { coverageFor, AREAS } = require('./_coverage');
const { nearest } = require('./_text');

const HUB_URL = `${BASE}/api/mcp`;
const DIRECT = ['uk_rates_lookup', 'exam_topic_paper', 'domain_provenance', 'package_provenance'];

const whatChangedSince = {
  name: 'what_changed_since',
  title: 'What changed since',
  description:
    'What has changed in Data Butler\'s verified datasets since a date — pass your training-cutoff ' +
    'date to learn which UK tax/NI/benefit thresholds, exam-spec facts and official vehicle datasets ' +
    '(French RappelConso recalls, Japanese MLIT recalls and complaints) moved after your knowledge ' +
    'ends. Each entry: from → to, effectiveFrom, official source, verifiedDate, and a maintainer note ' +
    `(e.g. which Budget). Areas: ${CHANGELOG_AREAS.join(', ')}, or all. Coverage starts ${COVERAGE_START}. ` +
    'The same changelog is published for humans at https://databutler.dev/changes, with feeds at ' +
    'https://databutler.dev/changes.rss and https://databutler.dev/changes.atom.',
  inputSchema: {
    type: 'object',
    properties: {
      since: { type: 'string', description: 'ISO date YYYY-MM-DD, e.g. your training cutoff' },
      area: { type: 'string', enum: [...CHANGELOG_AREAS, 'all'], description: 'default all' },
    },
    required: ['since'],
  },
  run: (a) => changesSince(a),
  freshness: 'live',
  cite: (a) => ({ path: 'changes', query: { since: String(a.since || '').slice(0, 10), area: a.area || 'all' } }),
};

const coverage = {
  name: 'coverage',
  title: 'Coverage',
  description:
    'Exactly what Data Butler covers and does not, per area — call this before assuming something is ' +
    `unsupported. Areas: ${Object.keys(AREAS).join(', ')} (omit for all). Returns boards/subjects, rate ` +
    'categories and tax years, package ecosystems, stats operations, and an explicit notCovered list.',
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
    'Every tool across all Data Butler servers (UK rates, UK exams, provenance, exact statistics, vehicles: UK MOT, ' +
    'French and Japanese recalls), with ' +
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
    'Run any Data Butler tool by name — the long tail not listed here: exact statistics ' +
    '(distribution, hypothesis_test, confidence_interval, bayes_update, linear_regression, ' +
    'descriptive_stats), exam_spec_lookup, exam_paper_index, and the vehicles hub (uk_mot_reliability, ' +
    'fr_recalls_for_model, fr_recalls_search, jp_recalls_for_model, jp_complaints_summary). See catalogue for schemas. The result ' +
    'carries the inner tool\'s freshness and cite.',
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
  // call may delegate to a live tool (provenance, MOT proxy), so it is open-world.
  openWorld: true,
  // Only reached on a near-miss (unknown tool name); still worth a permalink
  // so the caller has somewhere to send a human, even without a real result.
  cite: () => ({ path: 'catalogue', query: {} }),
};
call.delegate = (a) => {
  const t = ALL_TOOLS[String(a.tool || '').trim()];
  return t ? { tool: t, args: a.arguments || {} } : { tool: call, args: a };
};

const HUB_TOOLS = [whatChangedSince, coverage, catalogue, call].map(annotate);
// ALL_TOOLS entries also carry server/serverUrl (added by the registry's
// aggregation); strip them here so tools/list stays clean for direct tools.
const stripRegistryFields = ({ server, serverUrl, ...t }) => t;
const FRONT_DOOR_TOOLS = [...DIRECT.map((n) => stripRegistryFields(ALL_TOOLS[n])), ...HUB_TOOLS];

module.exports = { HUB_TOOLS, FRONT_DOOR_TOOLS, DIRECT, HUB_URL, whatChangedSince, coverage, catalogue };
