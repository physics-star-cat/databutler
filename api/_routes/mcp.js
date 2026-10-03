/**
 * The front door: one MCP URL for the whole estate.
 * Lists the high-frequency tools directly; everything else via catalogue/call.
 * The per-vertical servers under /api/mcp/* stay live unchanged (api/router.js
 * builds one per area module).
 */
const { makeMcpHandler } = require('../_mcp');
const { FRONT_DOOR_TOOLS, FRONT_DOOR_INSTRUCTIONS } = require('../_hub');

module.exports = makeMcpHandler({
  serverName: 'databutler',
  instructions: FRONT_DOOR_INSTRUCTIONS,
  tools: FRONT_DOOR_TOOLS,
});
