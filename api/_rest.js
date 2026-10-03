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
    sendJson(res, 200, withEnvelope(tool, args, decorate ? decorate(result) : result));
  };
}

module.exports = { restMirror };
