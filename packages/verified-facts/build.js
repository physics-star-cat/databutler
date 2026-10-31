#!/usr/bin/env node
/**
 * Copy the few repo files the `verified-facts` package needs into lib/, verbatim, so the package is self-contained
 * and has no runtime dependency. The copies find each other by looking next to themselves first (the same rule a
 * vendored copy in a sister repo uses), so nothing is rewritten.
 *
 *   node build.js           write lib/
 *   node build.js --check   exit 1 when lib/ differs from the sources (tests/verified-facts-package.test.js runs it;
 *                           prepublishOnly runs it, so a stale lib/ is never published)
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../..');
const LIB = path.join(__dirname, 'lib');

/** published path under lib/ → source path in the repo */
const FILES = {
  'facts-check.js': 'scripts/facts-check.js',
  'facts-static.js': 'scripts/facts-static.js',
  'verify-fact.js': 'scripts/verify-fact.js',
  '_jcs.js': 'api/_jcs.js',
  '_facts_sign.js': 'api/_facts_sign.js',
  '_schema_check.js': 'api/_schema_check.js',
  'schema/fact.v0.json': 'public/schema/fact.v0.json',
  'schema/well-known-facts.v0.json': 'public/schema/well-known-facts.v0.json',
  'schema/well-known-changes.v0.json': 'public/schema/well-known-changes.v0.json',
};

function stale() {
  const out = [];
  for (const [rel, src] of Object.entries(FILES)) {
    const want = fs.readFileSync(path.join(REPO, src), 'utf8');
    const p = path.join(LIB, rel);
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== want) out.push(rel);
  }
  if (fs.existsSync(LIB)) {
    (function walk(d) {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        const rel = path.relative(LIB, p).split(path.sep).join('/');
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (!FILES[rel]) out.push(`${rel} (not a package file)`);
      }
    })(LIB);
  }
  return out;
}

function build() {
  fs.rmSync(LIB, { recursive: true, force: true });
  for (const [rel, src] of Object.entries(FILES)) {
    const p = path.join(LIB, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.copyFileSync(path.join(REPO, src), p);
  }
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--check')) {
    const s = stale();
    if (s.length) { console.error(`verified-facts: lib/ is stale — run node packages/verified-facts/build.js:\n  ${s.join('\n  ')}`); return 1; }
    console.log('verified-facts: lib/ matches the repo sources');
    return 0;
  }
  build();
  console.log(`verified-facts: ${Object.keys(FILES).length} files copied into lib/`);
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { FILES, stale, build, main };
