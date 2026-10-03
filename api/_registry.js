/**
 * The single list of every tool Data Butler serves, derived from the area
 * modules (api/_areas/*.js via api/_areas.js). Per-vertical MCP servers and the
 * front door (api/_routes/mcp.js) both build from here. Beyond the MCP tool
 * shape, each tool carries:
 *   title: short human label (MCP `title`)
 *   freshness: dataset key for the freshness block (an area's dataset key, or 'live')
 *   cite(args): { path, query } for the /r permalink, or null
 *   openWorld: true when the tool fetches live external data on the caller's
 *     behalf (RDAP, npm, PyPI, whatbreaks.uk, lifebynumbers.net); drives annotations.openWorldHint
 *   frontDoor: true when the front door lists the tool directly (see _hub.js DIRECT)
 *
 * annotate() stamps the MCP tool annotations every Data Butler tool shares:
 * all tools are read-only and non-destructive, so a directory reviewer (and
 * an agent) can see that at tools/list without reading the descriptions.
 */
const { servers } = require('./_areas');
const { BASE } = require('./_area_kit');

const SERVERS = servers();

/** MCP tool annotations (2025-06-18): every Data Butler tool is read-only. */
function annotate(tool) {
  tool.title = tool.title || tool.name.replace(/_/g, ' ');
  tool.annotations = {
    title: tool.title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: tool.openWorld === true,
  };
  return tool;
}

const ALL_TOOLS = {};
for (const [server, s] of Object.entries(SERVERS)) {
  for (const t of s.tools) {
    if (ALL_TOOLS[t.name]) throw new Error(`api/_areas: tool name "${t.name}" is declared by two areas (${ALL_TOOLS[t.name].server}, ${server})`);
    ALL_TOOLS[t.name] = { ...annotate(t), server, serverUrl: s.url };
  }
}

module.exports = { SERVERS, ALL_TOOLS, BASE, annotate };
