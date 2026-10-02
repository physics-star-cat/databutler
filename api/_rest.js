/**
 * REST mirror factory: GET /api/<route> → one registry tool, with the same
 * envelope as MCP. Missing required params → 400 (REST convention; the MCP
 * tool itself answers covered:false instead).
 */
const { sendJson, handleOptions, queryParams, ATTRIBUTION } = require('./_lib');
const { ALL_TOOLS } = require('./_registry');
const { withEnvelope } = require('./_envelope');
const { trackEvent } = require('./_track');

function restMirror({ tool: toolName, event, args: pick, required = [], numeric = [] }) {
  return async (req, res) => {
    if (handleOptions(req, res)) return;
    await trackEvent(event, req);
    const q = queryParams(req);
    const args = pick(q);
    for (const k of numeric) if (typeof args[k] === 'string' && args[k] !== '' && !Number.isNaN(Number(args[k]))) args[k] = Number(args[k]);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
    if (missing.length) {
      return sendJson(res, 400, { error: `missing ?${missing.join('= and ?')}=. See /api for usage.`, ...ATTRIBUTION });
    }
    const tool = ALL_TOOLS[toolName];
    const result = await tool.run(args);
    sendJson(res, 200, withEnvelope(tool, args, result));
  };
}

module.exports = { restMirror };
