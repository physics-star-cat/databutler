/**
 * GET /api/mcp/<server>/server-card (rewritten to ?route=server-card&server=<server>) — the MCP Server
 * Card of every Data Butler server: each area server, the facts server and the front door
 * (/api/mcp/server-card → server=databutler). Static JSON, cached a day, CORS open.
 */
const { CORS, handleOptions, queryParams, sendJson } = require('../_lib');
const { serverCard, CARD_TYPE } = require('../_server_card');
const { cardServers } = require('../_hub');

const CACHE = 'public, max-age=86400';

module.exports = (req, res) => {
  if (handleOptions(req, res)) return;
  const { server } = queryParams(req);
  const s = cardServers()[String(server || '').replace(/^\/+|\/+$/g, '')];
  if (!s) return sendJson(res, 404, { error: `no MCP server "${server}" — /.well-known/ai-catalog.json lists every card` }, { 'Cache-Control': 'no-store' });
  res.writeHead(200, { 'Content-Type': `${CARD_TYPE}; charset=utf-8`, 'Cache-Control': CACHE, ...CORS });
  res.end(JSON.stringify(serverCard(s), null, 2));
};
