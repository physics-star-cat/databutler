/**
 * Shared stateless MCP server plumbing (streamable HTTP, JSON-RPC 2.0).
 * Same contract proven on whatbreaks.uk and lowriskquotes.com: single POST
 * per message answered with application/json; notifications get 202; no
 * sessions, no SSE. Build a handler with makeMcpHandler().
 *
 * Tool objects may carry, beyond the MCP shape: run(args), freshness, cite,
 * openWorld, frontDoor (see _registry.js) and delegate(args) → { tool, args } — used by the front
 * door's `call` to run any registry tool while the envelope describes the
 * inner tool.
 */
const { CORS, ATTRIBUTION } = require('./_lib');
const { trackEvent, trackFacts } = require('./_track');
const { withEnvelope } = require('./_envelope');

const PROTOCOL_VERSION = '2025-06-18';

function makeMcpHandler({ serverName, instructions, tools }) {
  // Strip everything that is not part of the MCP tool shape (run/freshness/cite/
  // delegate/openWorld, plus the registry's server/serverUrl bookkeeping).
  const toolDefs = tools.map(({ run, freshness, cite, delegate, openWorld, frontDoor, server, serverUrl, ...def }) => def);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  async function handle(msg, req) {
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
            serverInfo: { name: serverName, version: '1.1.0' },
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
          const def = byName[name];
          if (!def) throw new Error(`unknown tool: ${name}`);
          const target = def.delegate ? def.delegate(args) : { tool: def, args };
          if (target.tool !== def) await trackEvent(`agent_mcp_call_${String(target.tool.name).slice(0, 23)}`, req);
          const result = await target.tool.run(target.args);
          if (target.tool.name === 'get_fact') await trackFacts(req, 'mcp', 'get', result);
          else if (target.tool.name === 'resolve_fact') await trackFacts(req, 'mcp', 'resolve', result);
          return {
            jsonrpc: '2.0', id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(withEnvelope(target.tool, target.args, result), null, 1) }],
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
      res.end(JSON.stringify(await handle(msg, req)));
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
