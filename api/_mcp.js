/**
 * Shared stateless MCP server plumbing (streamable HTTP, JSON-RPC 2.0).
 * Same contract proven on whatbreaks.uk and lowriskquotes.com: single POST
 * per message answered with application/json; notifications get 202; no
 * sessions, no SSE. Build a handler with makeMcpHandler().
 */
const { CORS, ATTRIBUTION } = require('./_lib');
const { trackEvent } = require('./_track');

const PROTOCOL_VERSION = '2025-06-18';

function makeMcpHandler({ serverName, instructions, tools }) {
  const toolDefs = tools.map(({ run, ...def }) => def);
  const runners = Object.fromEntries(tools.map((t) => [t.name, t.run]));

  async function handle(msg) {
    const id = msg.id ?? null;
    switch (msg.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion:
              typeof (msg.params || {}).protocolVersion === 'string'
                ? msg.params.protocolVersion : PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: serverName, version: '1.0.0' },
            instructions,
          },
        };
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: toolDefs } };
      case 'tools/call': {
        const { name, arguments: args = {} } = msg.params || {};
        try {
          if (!runners[name]) throw new Error(`unknown tool: ${name}`);
          const result = await runners[name](args);
          return {
            jsonrpc: '2.0', id,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ ...result, ...ATTRIBUTION }, null, 1) }],
              isError: false,
            },
          };
        } catch (e) {
          return {
            jsonrpc: '2.0', id,
            result: { content: [{ type: 'text', text: e.message || 'tool call failed' }], isError: true },
          };
        }
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${msg.method}` } };
    }
  }

  return (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'POST, OPTIONS', ...CORS });
      return res.end(JSON.stringify({ info: `${serverName}: POST JSON-RPC 2.0 messages here.`, docs: ATTRIBUTION.docs }));
    }
    const respond = async (msg) => {
      if (msg.id === undefined && typeof msg.method === 'string' && msg.method.startsWith('notifications/')) {
        res.writeHead(202, CORS);
        return res.end();
      }
      if (msg.method === 'tools/call') {
        await trackEvent(`agent_mcp_${String((msg.params || {}).name).slice(0, 28)}`, req);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
      res.end(JSON.stringify(await handle(msg)));
    };
    const parseError = () => {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }));
    };
    // Vercel pre-parses req.body; fall back to the stream for local harnesses.
    if (req.body !== undefined) {
      if (typeof req.body === 'object' && req.body !== null) return respond(req.body);
      try {
        return respond(JSON.parse(String(req.body)));
      } catch {
        return parseError();
      }
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        respond(JSON.parse(raw));
      } catch {
        parseError();
      }
    });
  };
}

module.exports = { makeMcpHandler, PROTOCOL_VERSION };
