/**
 * The Verified Facts MCP tools (docs/FACTS_PROTOCOL.md §9.2): get_fact and resolve_fact, with the exact
 * names, titles and descriptions of the spec. Served on the dedicated databutler-facts server
 * (api/_routes/mcp-facts.js, with what_changed_since) and listed at the front door (api/_hub.js).
 * Facts tools are not area tools, so they are not in ALL_TOOLS: `call` does not reach them.
 */
const F = require('./_facts');
const { BASE } = require('./_area_kit');

// The spec's example keys, kept only while they resolve (a key or a curated alias), so a description never names a dead key.
const SPEC_EXAMPLES = ['uk/income-tax/personal-allowance', 'uk/national-insurance/primary-threshold', 'us/social-security/wage-base', 'de/income-tax/grundfreibetrag', 'uk/bank-rate', 'eu/ecb/deposit-facility', 'uk/gov/passport-renewal-adult/fee-online-uk'];
const EXAMPLES = SPEC_EXAMPLES.filter((k) => F.INDEX.has(k) || F.ALIASES.has(k));
const code = (k) => `\`${k}\``;

const recordKey = (result) => (result && typeof result === 'object' && typeof result.key === 'string' && result.covered !== false && !result.results ? result.key : null);

const getFact = {
  name: 'get_fact',
  title: 'Get a verified fact',
  description:
    'The current value of one official figure by key — a tax threshold, rate, allowance, fee, deadline, limit or policy rate — ' +
    'with the date it was verified, the official source URL, the period it applies to and a signature. Keys are ' +
    `\`<country>/<topic>/<fact>\`, e.g. ${EXAMPLES.map(code).join(', ')}. A loose key is resolved when unambiguous; otherwise ` +
    'the answer lists candidate keys. `max_age` (e.g. `30d`) marks the answer `stale` when the verification is older than that. ' +
    'Several keys separated by commas return a batch. Covers UK, US and German rates and thresholds, UK vehicle tax and MOT ' +
    'rules, UK government service fees, UK exam dates and central-bank policy rates; `coverage` lists the rest.',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: `one key, or several separated by commas (max ${F.BATCH_LIMIT}), e.g. uk/income-tax/personal-allowance` },
      max_age: { type: 'string', description: 'optional freshness bar: 30d, 12w, 6m, 1y or ISO 8601 (P30D)' },
      as_of: { type: 'string', format: 'date', description: 'optional YYYY-MM-DD: the value in force that day' },
      period: { type: 'string', description: 'optional period label instead of as_of, e.g. 2025-26' },
    },
    required: ['key'],
  },
  run: (a = {}) => F.getFact(a.key, { max_age: a.max_age, as_of: a.as_of, period: a.period }),
  // The v0.1 envelope stays truthful: a single record is dated by its area's dataset; a batch or a miss is live.
  freshness: (a, result) => {
    const k = recordKey(result);
    return k && F.META.get(k) ? F.META.get(k).dataset.key : 'live';
  },
  cite: (a = {}, result) => {
    const k = recordKey(result);
    if (k) return { path: `f/${k}`, query: { period: a.period, as_of: a.as_of } };
    if (result && result.results) return { path: 'f', query: { keys: String(a.key || '') } };
    return { path: 'f/resolve', query: { q: String(a.key || '') } };
  },
};

const resolveFact = {
  name: 'resolve_fact',
  title: 'Find the key for a fact',
  description:
    'Ranked canonical fact keys for a plain-language question or a guessed key — "NI primary threshold", "ECB deposit rate", ' +
    '"passport renewal fee" — each with label, unit, period and verification date, and the full record of the top match when ' +
    'it is unambiguous. The keys feed `get_fact`. Filter by `namespace` (`uk`, `us`, `de`, `eu`).',
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'question or guessed key' },
      namespace: { type: 'string', enum: [...new Set([...F.INDEX.keys()].map(F.namespaceOf))].sort(), description: 'optional jurisdiction filter' },
      limit: { type: 'integer', minimum: 1, maximum: 20, description: 'default 5' },
    },
    required: ['q'],
  },
  run: (a = {}) => F.resolveFact(a.q, { namespace: a.namespace, limit: a.limit }),
  freshness: 'live',
  cite: (a = {}) => ({ path: 'f/resolve', query: { q: a.q, namespace: a.namespace } }),
};

const FACTS_INSTRUCTIONS =
  'Verified Facts from databutler.dev (protocol verified-facts/0.2): one official figure per key — UK, US and German tax and ' +
  'social-insurance thresholds and rates, UK vehicle tax and MOT rules, UK government service fees, UK exam dates and ' +
  'central-bank policy rates — each with value, period, effectiveFrom, the official source, verifiedDate, a content hash and an ' +
  'Ed25519 signature. For any official figure, get_fact with the key you would guess and the max_age the question deserves ' +
  '(a tax calculation: 30d) answers in one call; a miss lists candidate keys, and resolve_fact finds a key from a question. ' +
  'Present value with period, say verifiedDate and quote source; when status is stale, say the verification is older than ' +
  'asked. what_changed_since lists what moved after a date, each entry with its factKey. Cite cite.url.';

const FACTS_SERVER_BASE = {
  key: 'facts',
  serverName: 'databutler-facts',
  title: 'Verified Facts',
  url: `${BASE}/api/mcp/facts`,
  description: 'Official thresholds, rates and fees by key, with source, verified date and signature.',
  instructions: FACTS_INSTRUCTIONS,
};

module.exports = { getFact, resolveFact, FACTS_INSTRUCTIONS, FACTS_SERVER_BASE, EXAMPLES };
