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

/* vercel.json rewrites, applied as Vercel would (tests/protocol.test.js, tests/facts-http.test.js). */
const VERCEL = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'vercel.json'), 'utf8'));
/** A vercel.json rewrite source as the anchored regex Vercel applies. */
const sourceRe = (source) => new RegExp(`^${source.replace(/\(\.[*+]\)/g, (g) => (g === '(.*)' ? '\u0001' : '\u0002')).replace(/[.]/g, '\\.').replace(/\u0001/g, '(.*)').replace(/\u0002/g, '(.+)')}$`);
/** First rewrite whose source matches the path, with $1 etc. substituted in its destination — what Vercel would dispatch. */
function rewriteFor(p) {
  for (const r of VERCEL.rewrites) {
    const m = sourceRe(r.source).exec(p);
    if (m) return { ...r, destination: r.destination.replace(/\$(\d)/g, (_, i) => m[Number(i)]) };
  }
  return undefined;
}
const routeOf = (destination) => new URL(destination, 'https://databutler.dev').searchParams.get('route');

module.exports = { invoke, rpc, callTool, rewriteFor, routeOf, VERCEL };
