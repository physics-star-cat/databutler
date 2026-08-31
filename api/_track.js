/**
 * Anonymous GA4 Measurement Protocol usage tracking (event name only).
 * Env-gated: no-ops until GA4_MEASUREMENT_ID and GA4_MP_API_SECRET are set
 * in the Vercel project (see docs/SPEC.md §5 — GA4 property is a launch
 * checklist item). Never throws, waits at most ~600ms.
 */
async function trackEvent(name) {
  const id = process.env.GA4_MEASUREMENT_ID;
  const secret = process.env.GA4_MP_API_SECRET;
  if (!id || !secret) return;
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
          events: [{ name }],
        }),
      },
    );
    clearTimeout(timer);
  } catch {
    /* tracking must never break the API */
  }
}

module.exports = { trackEvent };
