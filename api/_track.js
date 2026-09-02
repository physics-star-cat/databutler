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
 */

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

async function trackEvent(name, req) {
  const id = process.env.GA4_MEASUREMENT_ID;
  const secret = process.env.GA4_MP_API_SECRET;
  if (!id || !secret) return;
  const ua = String((req && req.headers && req.headers['user-agent']) || '');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600);
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${id}&api_secret=${secret}`,
      {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          client_id: `agent.${Math.floor(Math.random() * 1e10)}`,
          events: [{
            name,
            params: {
              agent_client: classifyClient(ua),
              agent_ua: ua.slice(0, 100) || '(none)',
            },
          }],
        }),
      },
    );
    clearTimeout(timer);
  } catch {
    /* tracking must never break the API */
  }
}

module.exports = { trackEvent, classifyClient };
