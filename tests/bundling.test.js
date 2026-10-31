// Every module the router can reach must be required with a literal path. Vercel's tracer (nft) only follows
// literal require() arguments; a computed one (`require(near(...))`) left api/_schema_check.js out of the
// bundle on 2026-10-31 and every route answered 500. This test fails on the next computed require.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
});

test('no computed require() in api/ or in the scripts the router imports', () => {
  const files = [...walk(path.join(ROOT, 'api')), ...['facts-check.js', 'facts-static.js', 'verify-fact.js'].map((f) => path.join(ROOT, 'scripts', f))];
  // api/_areas.js loads area modules by wildcard on purpose; vercel.json includeFiles carries api/_areas/** for it
  const ALLOWED = new Set(['api/_areas.js']);
  const bad = [];
  for (const f of files) {
    if (ALLOWED.has(path.relative(ROOT, f))) continue;
    // drop comments, mark literal requires, drop string literals (so a "require(" inside a message is not counted)
    const src = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      .replace(/\brequire\(\s*(['"`])/g, 'REQUIRE_LITERAL($1')
      .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
    if (/\brequire\(/.test(src)) bad.push(path.relative(ROOT, f));
  }
  assert.deepEqual(bad, [], `computed require() in: ${bad.join(', ')}`);
});
