#!/usr/bin/env node
/**
 * Serve the site locally the way Vercel does, without `vercel dev` (no login, no project link):
 * files under public/ statically (cleanUrls: /privacy → privacy.html), then the vercel.json rewrites
 * into api/router.js (and /api itself into api/index.js), with vercel.json's headers applied.
 *
 *   node scripts/dev/local-server.js [port]          # default 3000
 *   bash scripts/verify-hub.sh http://localhost:3000  # the live checks, against it
 *
 * Note: absolute URLs inside answers (cite.url, signature.keys, facts.json templates) still name
 * https://databutler.dev — the data is what is served, not the host.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const router = require('../../api/router');
const apiIndex = require('../../api/index');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const sourceRe = (source) => new RegExp(`^${source.replace(/\(\.[*+]\)/g, (g) => (g === '(.*)' ? '\u0001' : '\u0002')).replace(/[.]/g, '\\.').replace(/\u0001/g, '(.*)').replace(/\u0002/g, '(.+)')}$`);
function rewrite(p) {
  for (const r of VERCEL.rewrites) {
    const m = sourceRe(r.source).exec(p);
    if (m) return r.destination.replace(/\$(\d)/g, (_, i) => m[Number(i)]);
  }
  return null;
}
const headersFor = (p) => Object.assign({}, ...VERCEL.headers.filter((h) => sourceRe(h.source).test(p)).map((h) => Object.fromEntries(h.headers.map((x) => [x.key, x.value]))));

function staticFile(p) {
  const candidates = [p, `${p}.html`, path.join(p, 'index.html')];
  for (const c of candidates) {
    const f = path.join(PUBLIC, decodeURIComponent(c));
    if (f.startsWith(PUBLIC) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const extra = headersFor(u.pathname);
  const file = u.pathname === '/' ? path.join(PUBLIC, 'index.html') : staticFile(u.pathname);
  if (file && !u.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...extra });
    return res.end(fs.readFileSync(file));
  }
  const writeHead = res.writeHead.bind(res);
  res.writeHead = (code, hdrs = {}) => writeHead(code, { ...extra, ...hdrs });
  if (u.pathname === '/api' || u.pathname === '/api/') return apiIndex(req, res);
  const dest = rewrite(u.pathname);
  if (dest) {
    const d = new URL(dest, 'http://localhost');
    for (const [k, v] of u.searchParams) d.searchParams.set(k, v);
    req.url = d.pathname + d.search;
  }
  return router(req, res);
});

const port = Number(process.argv[2] || 3000);
server.listen(port, () => console.log(`databutler local: http://localhost:${port}`));
