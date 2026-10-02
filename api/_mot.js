/**
 * UK MOT reliability — a live proxy to whatbreaks.uk's agent API (same
 * operator, real DfT MOT outcomes). Proxy, don't copy: the data stays on
 * whatbreaks.uk, its attribution passes through, databutler adds the
 * envelope. 8 s timeout; any failure returns a clean result object (never a
 * throw) so the envelope and isError:false contract hold.
 */
const UPSTREAM = 'https://whatbreaks.uk';
const UA = 'databutler-hub/1.0 (+https://databutler.dev)';
const TIMEOUT_MS = 8000;

// Injectable for tests (offline). Production uses the global fetch.
const deps = { fetch: (...a) => globalThis.fetch(...a) };

const DATA_ORIGIN =
  'UK Department for Transport anonymised MOT test results, aggregated per model generation by whatbreaks.uk ' +
  '(real recorded test outcomes, not estimates) — see https://whatbreaks.uk/api for its provenance block.';

async function upstreamGet(path, params) {
  const url = new URL(path, UPSTREAM);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await deps.fetch(url.toString(), { signal: controller.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { url: url.toString(), status: r.status, ok: r.ok, body };
  } catch (e) {
    return { url: url.toString(), status: 0, ok: false, body: null, failure: e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Shape any upstream outcome into one result object. */
function shape(res, { notFoundIsNearMiss } = {}) {
  const upstream = { attribution: 'whatbreaks.uk', link: `${UPSTREAM}/`, docs: `${UPSTREAM}/api`, requested: res.url };
  if (res.failure || res.status === 0) {
    return {
      error: 'upstream unavailable', upstream: 'whatbreaks.uk', reason: res.failure || 'no response',
      retry: true, message: `whatbreaks.uk did not answer within ${TIMEOUT_MS / 1000}s — retry shortly, or query ${upstream.docs} directly.`,
      source: upstream.docs, upstreamProvenance: upstream,
    };
  }
  if (!res.ok || !res.body || typeof res.body !== 'object') {
    const upstreamError = (res.body && res.body.error) || null;
    if (notFoundIsNearMiss && res.status === 404) {
      return {
        covered: false, upstreamStatus: 404, message: upstreamError || 'no matching vehicle',
        hint: 'use uk_mot_vehicle_search {q} to see covered model generations, then retry with the exact model name and a year',
        source: upstream.docs, upstreamProvenance: upstream,
      };
    }
    return {
      error: `upstream HTTP ${res.status}`, upstream: 'whatbreaks.uk', ...(upstreamError ? { upstreamError } : {}),
      retry: res.status >= 500 || res.status === 429, source: upstream.docs, upstreamProvenance: upstream,
    };
  }
  // Pass the data through untouched; move whatbreaks' own attribution keys
  // into upstreamProvenance so databutler's envelope keys do not collide.
  const { attribution, link, docs, ...data } = res.body;
  return {
    ...data,
    source: res.url,
    dataOrigin: DATA_ORIGIN,
    upstreamProvenance: { ...upstream, ...(attribution ? { attribution } : {}), ...(link ? { link } : {}), ...(docs ? { docs } : {}) },
  };
}

async function motReliability({ make, model, year, mileage } = {}) {
  if (!make || !model) {
    return { covered: false, requested: { make, model, year, mileage }, message: 'pass make and model (plus optional year, mileage)', example: { make: 'Volkswagen', model: 'Golf', year: 2018, mileage: 80000 } };
  }
  return shape(await upstreamGet('/api/mot', { make, model, year, mileage }), { notFoundIsNearMiss: true });
}

async function motVehicleSearch({ q } = {}) {
  if (!q || !String(q).trim()) {
    return { covered: false, requested: { q }, message: 'pass q, a free-text vehicle query', example: { q: 'golf' } };
  }
  return shape(await upstreamGet('/api/vehicles', { q }));
}

module.exports = { motReliability, motVehicleSearch, deps, UPSTREAM, UA, TIMEOUT_MS };
