/**
 * Anonymous GA4 Measurement Protocol usage tracking (event name + caller).
 * Env-gated: no-ops until GA4_MEASUREMENT_ID and GA4_MP_API_SECRET are set
 * in the Vercel project (see docs/SPEC.md §5 — GA4 property is a launch
 * checklist item). Never throws, waits at most ~600ms.
 *
 * GA4's Measurement Protocol discards user_agent and ip_override, so the
 * caller travels as event params instead: agent_client (a low-cardinality
 * label, the one worth charting) and agent_ua (the raw header, cut to GA4's
 * 100-char param limit). Both need registering as event-scoped custom
 * dimensions in GA4 Admin before they surface outside DebugView.
 *
 * agent_owner separates the owner's own calls from everyone else's, so usage
 * can be read honestly. The owner's MCP configs and scripts send the header
 * below. It is not a secret and grants nothing: it changes one label on one
 * analytics event, and all a stranger can do by sending it is leave their own
 * calls out of our counts. "unmarked" means no marker, not "proven third party".
 */
const OWNER_HEADER = 'x-databutler-owner';

// Ordered: named clients and registry crawlers first, generic HTTP libraries
// last, so "python-httpx" only wins when nothing more specific matched.
const CLIENTS = [
  [/verifymcp/, 'verifymcp'],
  [/smithery/, 'smithery'],
  [/pulsemcp/, 'pulsemcp'],
  [/claude|anthropic/, 'claude'],
  [/cursor/, 'cursor'],
  [/windsurf/, 'windsurf'],
  [/cline/, 'cline'],
  [/vscode|visual studio code/, 'vscode'],
  [/openai|chatgpt/, 'openai'],
  [/mcp/, 'mcp-other'],
  [/bot|crawler|spider/, 'bot'],
  [/curl|wget/, 'curl'],
  [/python|httpx|aiohttp|requests/, 'python'],
  [/node|undici|axios/, 'node'],
  [/go-http-client/, 'go'],
  [/mozilla/, 'browser'],
];

function classifyClient(ua) {
  if (!ua) return '(none)';
  const s = ua.toLowerCase();
  for (const [pattern, label] of CLIENTS) if (pattern.test(s)) return label;
  return 'other';
}

function callerParams(req) {
  const ua = String((req && req.headers && req.headers['user-agent']) || '');
  const marked = String((req && req.headers && req.headers[OWNER_HEADER]) || '') === '1';
  return {
    agent_client: classifyClient(ua),
    agent_ua: ua.slice(0, 100) || '(none)',
    agent_owner: marked ? 'owner' : 'unmarked',
  };
}

async function send(events) {
  const id = process.env.GA4_MEASUREMENT_ID;
  const secret = process.env.GA4_MP_API_SECRET;
  if (!id || !secret || !events.length) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600);
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${id}&api_secret=${secret}`,
      {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ client_id: `agent.${Math.floor(Math.random() * 1e10)}`, events }),
      },
    );
    clearTimeout(timer);
  } catch {
    /* tracking must never break the API */
  }
}

async function trackEvent(name, req) {
  await send([{ name, params: callerParams(req) }]);
}

// Fact-demand tracking: which facts agents ask for, and which we do not have. Privacy rule
// (public/privacy.html): only key-shaped strings are ever recorded — a canonical key from our own
// index, or a requested key that matches the key grammar. Free text (resolve questions, loose keys)
// is never sent; for those we record only the key we matched it to.
const KEY_SHAPE = /^[a-z]{2}(?:\/[a-z0-9][a-z0-9-]{0,47}){1,4}$/;
function keyShaped(k) {
  const s = String(k || '').trim().toLowerCase();
  return s.length <= 100 && KEY_SHAPE.test(s) && !/\d{5,}/.test(s) ? s : '';
}

/** One {fact_key, fact_result, fact_nearest} per lookup, from a facts get/batch/resolve result. */
function factLookups(kind, r) {
  if (!r || typeof r !== 'object') return [];
  if (kind === 'resolve') {
    const top = (r.best && r.best.key) || ((r.candidates || [])[0] || {}).key || '';
    return [{ fact_key: top || '(none)', fact_result: r.best ? 'resolve_best' : top ? 'resolve_ambiguous' : 'resolve_none', fact_nearest: '' }];
  }
  if (Array.isArray(r.results)) return r.results.slice(0, 20).flatMap((x) => factLookups('get', x));
  if (r.covered === false) {
    const nearest = ((r.candidates || [])[0] || {}).key || '';
    return [{ fact_key: keyShaped(r.requestedKey) || '(free-text)', fact_result: 'miss', fact_nearest: nearest }];
  }
  if (!r.key) return [];
  const result = r.requestedKey ? 'resolved' : r.status === 'stale' ? 'stale' : 'hit';
  return [{ fact_key: r.key, fact_result: result, fact_nearest: '' }];
}

/** Sends one `fact_lookup` event per lookup (GA4 accepts up to 25 per request). */
async function trackFacts(req, channel, kind, result) {
  const caller = callerParams(req);
  const events = factLookups(kind, result).slice(0, 25).map((l) => ({
    name: 'fact_lookup',
    params: { ...caller, fact_channel: channel, ...l },
  }));
  await send(events);
}

module.exports = { trackEvent, trackFacts, factLookups, keyShaped, classifyClient, callerParams };
