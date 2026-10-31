#!/usr/bin/env node
/**
 * verified-facts — the Verified Facts conformance checker, verifier and static generator (https://databutler.dev/protocol/facts).
 *
 *   npx verified-facts check https://example.org [--level L1|L2|L3] [--offline] [--sample N]
 *   npx verified-facts verify https://databutler.dev/f/uk/income-tax/personal-allowance [--jwks <path|url>]
 *   npx verified-facts static facts-source.json --out public [--check] [--key <jwk|pem> --kid <kid> --jwks <path>]
 *
 * Zero dependencies; Node 18 or later (global fetch, Ed25519 in node:crypto).
 */
const path = require('node:path');
const fs = require('node:fs');

const LIB = path.join(__dirname, '..', 'lib');
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

const USAGE = `verified-facts ${VERSION} — https://databutler.dev/protocol/facts

  verified-facts check <site>      run the conformance levels L1–L3 against https://<site>
      --level L1|L2|L3             the level to require (default: the one the site declares)
      --offline                    do not fetch the official source pages (item 4)
      --sample N                   check N keys instead of every key
  verified-facts verify <url|file> verify a record's hash and Ed25519 signature
      --jwks <path|url>            the key set (default: the record's signature.keys)
  verified-facts static <facts-source.json> --out <dir>
                                   write the L1 static files (facts.json, f/index.json, f/<key>.json)
      --check                      then run the checker over <dir>
      --key <path> --kid <kid> --jwks <path>   sign at build (L3)

Exit status: 0 pass, 1 fail, 2 usage.`;

const arg = (argv, name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };

/**
 * The CLI as a function, so tests drive it in-process: run(argv, { fetchFn, log, now }) → exit code.
 *   fetchFn — a fetch-like function (default: global fetch)
 */
async function run(argv = process.argv.slice(2), { fetchFn = globalThis.fetch, log = console.log, now = new Date() } = {}) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { log(USAGE); return cmd ? 0 : 2; }
  if (cmd === '--version' || cmd === '-v') { log(VERSION); return 0; }

  if (cmd === 'check' || /^https?:\/\//.test(cmd)) {
    const args = cmd === 'check' ? rest : argv;
    const site = args.find((a, i) => !a.startsWith('--') && !['--level', '--sample'].includes(args[i - 1]));
    if (!site) { log(USAGE); return 2; }
    const { checkSite, format } = require(path.join(LIB, 'facts-check.js'));
    const base = /^https?:\/\//.test(site) ? site : `https://${site}`;
    const report = await checkSite(base, { fetchFn, offline: args.includes('--offline'), sample: Number(arg(args, '--sample') || 0), level: arg(args, '--level'), now });
    log(format(report));
    return report.ok ? 0 : 1;
  }

  if (cmd === 'verify') {
    const { main } = require(path.join(LIB, 'verify-fact.js'));
    return main(rest, { log, now, fetchFn });
  }

  if (cmd === 'static') {
    const { main } = require(path.join(LIB, 'facts-static.js'));
    return main(rest);
  }

  log(`unknown command "${cmd}"\n\n${USAGE}`);
  return 2;
}

if (require.main === module) {
  run().then((code) => process.exit(code), (e) => { console.error(`verified-facts: ${e.message}`); process.exit(1); });
}

module.exports = { run, USAGE, VERSION };
