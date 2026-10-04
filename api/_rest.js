/**
 * REST mirror factory: GET /api/<route> → one registry tool, with the same
 * envelope as MCP. Missing required params → 400 (REST convention; the MCP
 * tool itself answers covered:false instead). Built by api/router.js from each
 * area module's `rest` entries:
 *   { path, tool, args(q), required?, numeric?, event?, missing?, decorate? }
 *   missing  — the 400 message (default names the missing params)
 *   decorate — result → result, for a note the REST surface adds (exam papers' copyright line)
 */
const { sendJson, handleOptions, queryParams, ATTRIBUTION } = require('./_lib');
const { ALL_TOOLS } = require('./_registry');
const { withEnvelope } = require('./_envelope');
const { trackEvent } = require('./_track');
const { coerceNumeric } = require('./_area_kit');

/**
 * Edge caching for successful GET answers (added 2026-10-04). Curated data
 * changes at most daily, so Vercel's CDN can answer repeats without running the
 * function: 1 h fresh, then served stale for a day while one request
 * revalidates. Live tools (openWorld: RDAP/npm/PyPI/whatbreaks/LBN proxies)
 * get 5 minutes. Errors are never cached. MCP is POST and is not cacheable.
 * Trade-off: a CDN hit does not run trackEvent, so GA4 counts unique-ish REST
 * calls, not every repeat.
 */
function cacheHeaders(tool) {
  const live = tool.openWorld === true || tool.freshness === 'live';
  return live
    ? { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600' }
    : { 'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' };
}

function restMirror({ tool: toolName, event, args: pick, required = [], numeric = [], missing, decorate }) {
  return async (req, res) => {
    if (handleOptions(req, res)) return;
    await trackEvent(event, req);
    const q = queryParams(req);
    const args = coerceNumeric(pick(q), numeric);
    const absent = required.filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
    if (absent.length) {
      return sendJson(res, 400, { error: missing || `missing ?${absent.join('= and ?')}=. See /api for usage.`, ...ATTRIBUTION });
    }
    const tool = ALL_TOOLS[toolName];
    const result = await tool.run(args);
    const body = withEnvelope(tool, args, decorate ? decorate(result) : result);
    const ok = req.method === 'GET' && body && body.covered !== false && !body.error;
    sendJson(res, 200, body, ok ? cacheHeaders(tool) : { 'Cache-Control': 'no-store' });
  };
}

module.exports = { restMirror, cacheHeaders };
