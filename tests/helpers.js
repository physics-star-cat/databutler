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

/**
 * A fetch() over the deployment, in-process: a path that is a file under public/ is served from disk (as Vercel's
 * static layer would), anything else goes through the vercel.json rewrites to api/router.js. Same origin only.
 */
function routerFetch(origin = 'https://databutler.dev') {
  const fs = require('node:fs');
  const path = require('node:path');
  const router = require('../api/router');
  const wrap = (status, headers, text) => ({
    status,
    headers: { get: (n) => { const k = Object.keys(headers).find((h) => h.toLowerCase() === String(n).toLowerCase()); return k ? String(headers[k]) : null; } },
    text: async () => text,
    json: async () => JSON.parse(text),
  });
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.origin !== origin) throw new Error(`routerFetch: ${url} is not on ${origin}`);
    const file = path.join(__dirname, '..', 'public', decodeURIComponent(u.pathname));
    if (u.pathname !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return wrap(200, { 'Content-Type': file.endsWith('.json') ? 'application/json' : 'text/plain' }, fs.readFileSync(file, 'utf8'));
    }
    const rw = rewriteFor(u.pathname);
    let target = u.pathname + u.search;
    if (rw) {
      const d = new URL(rw.destination, origin);
      for (const [k, v] of u.searchParams) d.searchParams.set(k, v);
      target = d.pathname + d.search;
    }
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init.body === undefined ? undefined : (() => { try { return JSON.parse(init.body); } catch { return init.body; } })();
    const r = await invoke(router, body, { method: init.method || 'GET', url: target, headers });
    return wrap(r.status, r.headers, r.raw === null || r.raw === undefined ? '' : String(r.raw));
  };
}

module.exports = { invoke, rpc, callTool, rewriteFor, routeOf, VERCEL, routerFetch };
