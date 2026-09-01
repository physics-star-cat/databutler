'use strict';
/** Drive Vercel-style (req, res) handlers in-process. */
function safeParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

function invoke(handler, body, { method = 'POST', url = '/api/mcp', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method, url, headers, body,
      on() {}, // stream API unused: body is pre-parsed like Vercel does
      [Symbol.asyncIterator]: async function* () {},
    };
    const res = {
      statusCode: 0, headers: {},
      writeHead(code, hdrs) { this.statusCode = code; this.headers = hdrs || {}; },
      end(data) {
        resolve({ status: this.statusCode, headers: this.headers, body: data === undefined ? null : safeParse(String(data)), raw: data });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function rpc(handler, method, params, id = 1) {
  return invoke(handler, { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
}

async function callTool(handler, name, args = {}) {
  const r = await rpc(handler, 'tools/call', { name, arguments: args });
  const { isError, content } = r.body.result;
  const text = content[0].text;
  return { isError, data: safeParse(text), text };
}

module.exports = { invoke, rpc, callTool };
