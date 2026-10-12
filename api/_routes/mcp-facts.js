/**
 * POST /api/mcp/facts — the dedicated Verified Facts MCP server (docs/FACTS_PROTOCOL.md §9.2): exactly
 * get_fact, resolve_fact and what_changed_since, so a client pays ~600 tokens of tool definitions for
 * the whole facts layer. The same two facts tools are also listed at the front door (POST /api/mcp).
 */
const { makeMcpHandler } = require('../_mcp');
const { annotate } = require('../_registry');
const { FACTS_SERVER } = require('../_hub');

FACTS_SERVER.tools.forEach(annotate);
module.exports = makeMcpHandler(FACTS_SERVER);
