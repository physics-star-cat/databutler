#!/usr/bin/env node
/**
 * Regenerate the static public files and docs that list the curated areas, from
 * the area modules (api/_areas/*.js). Hand-written prose stays; only the text
 * between a file's start/end markers is replaced:
 *
 *   public/llms.txt                 <!-- sync-areas:rest -->, <!-- sync-areas:servers -->
 *   public/sitemap.xml              whole file (one <url> per changelog area between the fixed pages)
 *   public/.well-known/changes.json areas[] (whole file rewritten; `updated` moves only when areas change)
 *   docs/CHANGES_PROTOCOL.md        the ```json discovery example = the file above
 *   README.md                       <!-- sync-areas:roadmap -->, <!-- sync-areas:catalogue -->
 *   docs/CURATION.md                <!-- sync-areas:calendar -->
 *   public/index.html               <!-- sync-areas:humans -->, <!-- sync-areas:agents -->
 *   scripts/verify-hub.sh           # sync-areas:checks start / end
 *   server-<key>.json               whole file (MCP registry manifest, one per focused server, from server.description)
 *
 * The README roadmap rows are numbered 1..N in `order`; a module's docs.readme.retires
 * names a row of the hand-maintained "planned" table below it, which is then removed.
 *
 *   node scripts/sync-areas.js            # rewrite whatever is stale
 *   node scripts/sync-areas.js --check    # exit 1 and name the stale files (tests/areas.test.js runs this)
 */
const fs = require('node:fs');
const path = require('node:path');
const { AREAS, discovery, restRoutes, changelogAreas } = require('../api/_areas');
const { SERVERS, ALL_TOOLS } = require('../api/_registry');
const { DIRECT, HUB_TOOLS } = require('../api/_hub');
const { joinList } = require('../api/_area_kit');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const today = () => new Date().toISOString().slice(0, 10);
const code = (s) => `<code>${s}</code>`;
const words = (n) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n);

/** Replace the lines between two marker lines (markers kept). Throws when a marker is missing. */
function replaceBlock(text, file, name, content, { open, close } = { open: `<!-- sync-areas:${name} start -->`, close: `<!-- sync-areas:${name} end -->` }) {
  const a = text.indexOf(open), b = text.indexOf(close);
  if (a === -1 || b === -1 || b < a) throw new Error(`${file}: markers "${open}" … "${close}" not found — add them around the block scripts/sync-areas.js should own`);
  const start = a + open.length;
  return `${text.slice(0, start)}\n${content}\n${text.slice(b)}`;
}
const bashMarkers = (name) => ({ open: `# sync-areas:${name} start`, close: `# sync-areas:${name} end` });

/* ---------------- generators ---------------- */

function llms(text) {
  let t = replaceBlock(text, 'public/llms.txt', 'rest', AREAS.flatMap((a) => a.docs.llms.rest).join('\n'));
  t = replaceBlock(t, 'public/llms.txt', 'servers', AREAS.filter((a) => a.server).map((a) => a.docs.llms.server).join('\n'));
  return t;
}

/** The sitemap has no prose to keep, so the whole file is generated (and stays comment-free for strict XML readers). */
function sitemap() {
  const url = (p) => `<url><loc>https://databutler.dev${p}</loc></url>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url('/'), url('/changes'),
    ...changelogAreas().map((a) => url(`/changes?area=${a}`)),
    url('/protocol'), url('/privacy'), url('/api'),
    '</urlset>',
    '',
  ].join('\n');
}

function wellKnown(text) {
  const current = JSON.parse(text);
  const areas = discovery();
  const changed = JSON.stringify(current.areas) !== JSON.stringify(areas);
  const next = { ...current, updated: changed ? today() : current.updated, areas };
  return JSON.stringify(next, null, 2) + '\n';
}

/** The spec's discovery example is the served file, verbatim (tests/protocol.test.js checks equality). */
function protocolDoc(text, wellKnownJson) {
  const fence = /```json\n([\s\S]*?)\n```/g;
  let hit = false;
  const out = text.replace(fence, (m, body) => {
    let obj;
    try { obj = JSON.parse(body); } catch { return m; }
    if (!obj || !obj.areas || !obj.endpoints || hit) return m;
    hit = true;
    return `\`\`\`json\n${wellKnownJson.trimEnd()}\n\`\`\``;
  });
  if (!hit) throw new Error('docs/CHANGES_PROTOCOL.md: no ```json discovery example (an object with areas + endpoints) found');
  return out;
}

/**
 * Drop the planned-table rows (between the roadmap block and the catalogue block) whose
 * `#` cell an area module retires, so building an area removes its own "planned" row.
 */
function retirePlanned(text, ids) {
  if (!ids.length) return text;
  const a = text.indexOf('<!-- sync-areas:roadmap end -->'), b = text.indexOf('<!-- sync-areas:catalogue start -->');
  if (a === -1 || b === -1 || b < a) return text;
  const middle = text.slice(a, b).split('\n').filter((line) => !ids.some((id) => new RegExp(`^\\|\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|`).test(line))).join('\n');
  return text.slice(0, a) + middle + text.slice(b);
}

function readme(text) {
  const roadmap = [
    '| # | Vertical (wishlist item it serves) | Endpoint | Status |',
    '|---|---|---|---|',
    ...AREAS.map((a, i) => `| ${i + 1} ${a.docs.readme.roadmapRow}`),
  ].join('\n');
  const hub = HUB_TOOLS.map((t) => `\`${t.name}\``).join(', ');
  const catalogue = [
    `## Tool catalogue (${Object.keys(ALL_TOOLS).length} tools, ${Object.keys(SERVERS).length} focused servers + front door)`,
    '',
    '| Server | Tools | Data |',
    '|---|---|---|',
    ...AREAS.filter((a) => a.server).map((a) => a.docs.readme.catalogueRow),
    `| \`/api/mcp\` (front door) | the ${words(DIRECT.length)} high-frequency tools above (${DIRECT.map((n) => `\`${n}\``).join(', ')}) + ${hub} | — |`,
    '',
    `REST mirrors: ${restRoutes().map((r) => `\`/api/${r.path}\``).join(', ')}.`,
  ].join('\n');
  let t = replaceBlock(text, 'README.md', 'roadmap', roadmap);
  t = replaceBlock(t, 'README.md', 'catalogue', catalogue);
  return retirePlanned(t, AREAS.map((a) => a.docs.readme.retires).filter(Boolean));
}

/** The MCP registry manifest for one focused server (the shape every server-*.json already has). */
function manifest(key, s) {
  const j = (v) => JSON.stringify(v);
  return [
    '{',
    `  "$schema": ${j('https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json')},`,
    `  "name": ${j(`io.github.physics-star-cat/${s.serverName}`)},`,
    `  "description": ${j(s.description)},`,
    `  "repository": { "url": ${j('https://github.com/physics-star-cat/databutler')}, "source": "github" },`,
    `  "version": ${j(s.version || '1.0.0')},`,
    `  "websiteUrl": ${j('https://databutler.dev/api')},`,
    `  "remotes": [{ "type": "streamable-http", "url": ${j(s.url)} }]`,
    '}',
    '',
  ].join('\n');
}

const CALENDAR_TAIL = [
  '| `data/sources.json` | After every data refresh (automatic via `scripts/changelog.js`) | `node scripts/sources.js` re-checks every source URL (gov.uk content API / page hash). |',
  '| `data/changelog.json` | With every data refresh | `node scripts/changelog.js` (areas with a `changelog.diff`) or the dataset\'s own script (`changelog.script`); fill in `note` lines. See "Changelog & source watcher" and docs/ADDING_AN_AREA.md. |',
];

function curation(text) {
  const rows = ['| Dataset | Refresh trigger | How |', '|---|---|---|', ...AREAS.flatMap((a) => a.docs.curation), ...CALENDAR_TAIL];
  return replaceBlock(text, 'docs/CURATION.md', 'calendar', rows.join('\n'));
}

function indexHtml(text) {
  const humans = `(${AREAS.filter((a) => a.changelog).map((a) => a.short).join(', ')})`;
  const rest = AREAS.filter((a) => a.rest.length).map((a) => code(`/api/${a.rest[0].path}`));
  const servers = AREAS.filter((a) => a.server).map((a) => code(a.server.url.replace('https://databutler.dev', '')) + (a.docs.index && a.docs.index.blurb ? ` (${a.docs.index.blurb})` : ''));
  const agents = `REST at ${[...rest, code('/api/changes')].join(', ')}; focused MCP servers at\n${joinList(servers, { sep: ',\n', last: ' and\n' })}.`;
  let t = replaceBlock(text, 'public/index.html', 'humans', humans);
  t = replaceBlock(t, 'public/index.html', 'agents', agents);
  return t;
}

function verifyHub(text) {
  const frontDoorNames = [...DIRECT, ...HUB_TOOLS.map((t) => t.name)];
  const json = (v) => {
    const s = JSON.stringify(v);
    if (s.includes("'")) throw new Error(`verify check argument contains a single quote: ${s}`);
    return s;
  };
  const lines = [
    'check tools/list "$(rpc \'{"jsonrpc":"2.0","id":2,"method":"tools/list"}\')" \\',
    `  "[t['name'] for t in d['result']['tools']]==[${frontDoorNames.map((n) => `'${n}'`).join(',')}]"`,
    `check catalogue "$(inner "$(tool catalogue '{}')")" "d['count']==${Object.keys(ALL_TOOLS).length}"`,
  ];
  for (const a of AREAS) {
    if (!a.verify.length) continue;
    lines.push(`# ${a.area}`);
    for (const v of a.verify) {
      if (v.kind === 'tool') {
        const call = frontDoorNames.includes(v.tool) ? `tool ${v.tool} '${json(v.args)}'` : `tool call '${json({ tool: v.tool, arguments: v.args })}'`;
        lines.push(`check ${v.label} "$(inner "$(${call})")" \\`, `  "${v.assert}"`);
      } else {
        const url = v.query ? `$BASE/api/${v.path}?${v.query}` : `$BASE/api/${v.path}`;
        lines.push(`check ${v.label} "$(curl -sS "${url}")" "${v.assert}"`);
      }
    }
  }
  lines.push(
    `for name in ${Object.keys(SERVERS).join(' ')}; do`,
    '  check "legacy $name tools/list" "$(curl -sS -X POST "$BASE/api/mcp/$name" -H \'Content-Type: application/json\' -d \'{"jsonrpc":"2.0","id":2,"method":"tools/list"}\')" "len(d[\'result\'][\'tools\'])>0"',
    'done',
  );
  return replaceBlock(text, 'scripts/verify-hub.sh', 'checks', lines.join('\n'), bashMarkers('checks'));
}

/* ---------------- driver ---------------- */

const readOr = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? read(rel) : '');

function plan() {
  const wk = wellKnown(read('public/.well-known/changes.json'));
  return [
    ...Object.entries(SERVERS).map(([key, s]) => [`server-${key}.json`, manifest(key, s)]),
    ['public/llms.txt', llms(read('public/llms.txt'))],
    ['public/sitemap.xml', sitemap()],
    ['public/.well-known/changes.json', wk],
    ['docs/CHANGES_PROTOCOL.md', protocolDoc(read('docs/CHANGES_PROTOCOL.md'), wk)],
    ['README.md', readme(read('README.md'))],
    ['docs/CURATION.md', curation(read('docs/CURATION.md'))],
    ['public/index.html', indexHtml(read('public/index.html'))],
    ['scripts/verify-hub.sh', verifyHub(read('scripts/verify-hub.sh'))],
  ];
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const stale = plan().filter(([rel, next]) => readOr(rel) !== next);
  if (check) {
    if (stale.length) {
      console.error(`sync-areas: stale — run \`node scripts/sync-areas.js\`:\n  ${stale.map(([r]) => r).join('\n  ')}`);
      return 1;
    }
    console.log('sync-areas: everything derived from api/_areas/*.js is up to date');
    return 0;
  }
  for (const [rel, next] of stale) {
    fs.writeFileSync(path.join(ROOT, rel), next);
    console.log(`sync-areas: wrote ${rel}`);
  }
  if (!stale.length) console.log('sync-areas: nothing to do');
  return 0;
}

if (require.main === module) process.exit(main());

/** Every file this script owns — scripts/changelog.js lets these be dirty while a new area is being added. */
const GENERATED = () => plan().map(([rel]) => rel);

module.exports = { main, plan, replaceBlock, retirePlanned, manifest, GENERATED };
