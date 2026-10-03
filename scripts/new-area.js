#!/usr/bin/env node
/**
 * Scaffold a new curated area (docs/ADDING_AN_AREA.md):
 *
 *   node scripts/new-area.js <area-slug> --title "US tax thresholds" --cadence "Every January and after each IRS revenue procedure" [--refresh-days 45]
 *
 * Creates, from templates with TODO markers:
 *   api/_areas/<area>.js      the area module (one tool, categories → figures data shape)
 *   data/<area>.json          { area, verifiedDate, nextScheduledRefresh, licence, sources: [], categories: {} }
 *   tests/<area>.test.js      tool list, happy path, near-miss, REST 400, changelog entries, freshness, discovery
 *   docs/CURATION.md          an appended "Verification log (<title>, added <date>)" stub
 * then runs `node scripts/sync-areas.js` (llms.txt, sitemap, discovery document, README, CURATION
 * calendar, index.html, verify-hub.sh) and prints what a human still has to fill in. The output
 * loads and its tests pass with the TODO data, so the real work can be committed step by step.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const today = () => new Date().toISOString().slice(0, 10);

function parseArgs(argv) {
  const [slug, ...rest] = argv;
  const opts = { title: null, cadence: null, refreshDays: 35 };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--title') opts.title = rest[++i];
    else if (rest[i] === '--cadence') opts.cadence = rest[++i];
    else if (rest[i] === '--refresh-days') opts.refreshDays = Number(rest[++i]);
    else throw new Error(`unknown argument ${rest[i]}`);
  }
  if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) throw new Error('usage: node scripts/new-area.js <area-slug> --title "…" --cadence "…" [--refresh-days N]  (slug: lowercase, digits, hyphens)');
  if (!opts.title) throw new Error('--title "…" is required (human label, e.g. "US tax thresholds")');
  if (!opts.cadence) throw new Error('--cadence "…" is required (how often the sources are re-checked, in words)');
  if (!Number.isInteger(opts.refreshDays) || opts.refreshDays < 1) throw new Error('--refresh-days must be a positive integer');
  return { slug, ...opts };
}

const js = (s) => JSON.stringify(s);

function moduleTemplate({ slug, title, cadence, refreshDays, order, toolName }) {
  const AREA = js(slug);
  return `/**
 * Area: ${slug} — ${title}.
 * TODO: one paragraph on what this area serves, from which official pages, and
 * how it is refreshed. Data: data/${slug}.json (categories → figures), edited
 * against the source pages and diffed by \`node scripts/changelog.js\`.
 * Contract: api/_areas/README.md. Playbook: docs/ADDING_AN_AREA.md.
 */
const DATA = require('../../data/${slug}.json');
const { nearest } = require('../_text');
const { BASE, diffCategories } = require('../_area_kit');

const AREA = ${AREA};
const REFRESH_DAYS = ${refreshDays}; // nextScheduledRefresh = verifiedDate + ${refreshDays}, stamped by scripts/changelog.js
const CATEGORIES = Object.keys(DATA.categories);

/** { category } → that category's figures with source + verifiedDate; nothing → the listing; unknown → covered:false. */
function lookup({ category } = {}) {
  if (category === undefined || category === null || String(category).trim() === '') {
    return {
      area: AREA,
      verifiedDate: DATA.verifiedDate,
      categories: Object.fromEntries(CATEGORIES.map((k) => [k, DATA.categories[k].title])),
      usage: 'pass category=<key> for figures',
    };
  }
  const key = String(category).toLowerCase().trim();
  const hit = DATA.categories[key];
  if (!hit) {
    return {
      covered: false,
      requested: category,
      message: \`unknown category "\${category}"\`,
      nearest: nearest(key, CATEGORIES),
      coverage: CATEGORIES,
    };
  }
  return { area: AREA, category: key, verifiedDate: DATA.verifiedDate, ...hit };
}

module.exports = {
  area: AREA,
  order: ${order},
  title: ${js(title)},
  short: ${js(`TODO short noun phrase, e.g. ${title.toLowerCase()}`)},

  server: {
    serverName: 'databutler-${slug}',
    url: \`\${BASE}/api/mcp/${slug}\`,
    instructions:
      'TODO: what this server serves, from which official pages, and how an agent should present it ' +
      '(verifiedDate and source alongside every figure). Plain statements. Cite https://databutler.dev/ and the source.',
    tools: [
      {
        name: ${js(toolName)},
        title: ${js(`${title} lookup`)},
        description:
          'TODO: a plain statement of what the tool returns (no imperatives — say what it is, not what to do): ' +
          \`${title} figures verified against the official pages, by category (\${CATEGORIES.join(', ') || 'TODO'}), \` +
          'each with its source URL and verifiedDate. An unknown category answers covered:false with the nearest keys.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: \`one of: \${CATEGORIES.join(', ') || 'TODO'} (omit to list all)\` },
          },
        },
        run: (a) => lookup(a),
        freshness: AREA,
        // frontDoor: true,  // only for a genuinely high-frequency tool — it joins the front door's listed set
        cite: (a) => ({ path: ${AREA}, query: { category: a.category } }),
      },
    ],
  },

  coverage: () => ({
    categories: CATEGORIES,
    verifiedDate: DATA.verifiedDate,
    scope: 'TODO: jurisdiction / population / what each category names as its source',
    notCovered: ['TODO: the nearest things agents will ask for that this area does not answer'],
  }),

  freshness: { dataFile: 'data/${slug}.json', cadenceDays: REFRESH_DAYS, data: DATA },

  changelog: {
    diff: (prev, next) => diffCategories(AREA, prev, next),
    files: ['data/${slug}.json'],
    context: (e) => '', // TODO: a short context line for /changes, e.g. the tax year or jurisdiction
  },
  discovery: {
    description: ${js(`TODO: ${title} — what facts this area covers, verified against which official pages.`)},
    cadence: ${js(cadence)},
  },

  sources: () => Object.entries(DATA.categories).map(([k, c]) => ({ url: c.source, label: c.title || k })),

  rest: [
    { path: ${AREA}, tool: ${js(toolName)}, args: (q) => ({ category: q.category }), required: ['category'] },
  ],

  hub: {
    changed: ${js(`TODO ${title.toLowerCase()} (what_changed_since phrase)`)},
    coverage: ${js(`TODO ${title.toLowerCase()} categories`)},
    catalogue: ${js(`TODO ${title.toLowerCase()}`)},
  },

  docs: {
    readme: {
      roadmapRow: ${js(`| TODO | **${title}** — TODO one line on the value to an agent | \`/api/mcp/${slug}\` | **v1 — built ${today()}** |`)},
      catalogueRow: ${js(`| \`/api/mcp/${slug}\` | \`${toolName}\` | \`data/${slug}.json\`, TODO verified against … |`)},
    },
    llms: {
      rest: [${js(`- \`GET https://databutler.dev/api/${slug}?category=TODO\` — TODO one line: what comes back, verified against which official pages.`)}],
      server: ${js(`- \`POST https://databutler.dev/api/mcp/${slug}\` — tool \`${toolName}\`. TODO one line.`)},
    },
    curation: [${js(`| \`data/${slug}.json\` | ${cadence} | Open each category's \`source\` page; edit the figures; bump \`verifiedDate\`; \`node scripts/changelog.js\` (stamps \`nextScheduledRefresh\` = verifiedDate + ${refreshDays}, appends one entry per figure that moved, refreshes \`data/sources.json\`). |`)}],
    index: { blurb: ${js(`TODO ${title.toLowerCase()}`)} },
    api: () => ({
      endpoints: {
        ${js(`GET /api/${slug}`)}: {
          description: \`TODO: ${title}, verified \${DATA.verifiedDate} against the official pages.\`,
          params: { category: \`one of \${CATEGORIES.join(', ') || 'TODO'}\` },
          example: ${js(`https://databutler.dev/api/${slug}?category=TODO`)},
        },
      },
      coverage: { ${js(slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()))}: \`\${CATEGORIES.length} categories, verified \${DATA.verifiedDate}\` },
    }),
  },

  verify: [
    { label: ${js(`${slug}-listing`)}, kind: 'tool', tool: ${js(toolName)}, args: {}, assert: "'categories' in d and 'freshness' in d" },
    // TODO: a happy-path check on a real category and its cite url, and a REST 400:
    // { label: '${slug}-rest-400', kind: 'rest', path: ${AREA}, query: '', assert: "'missing' in d['error']" },
  ],
};
`;
}

function dataTemplate({ slug, refreshDays }) {
  const d = today();
  const due = new Date(`${d}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + refreshDays);
  return JSON.stringify({
    area: slug,
    verifiedDate: d,
    nextScheduledRefresh: due.toISOString().slice(0, 10),
    licence: 'TODO: the licence the official source publishes under (e.g. Open Government Licence v3.0), quoted from the page',
    sources: [],
    categories: {},
  }, null, 2) + '\n';
}

function testTemplate({ slug, title, toolName }) {
  return `// tests/${slug}.test.js — ${title}: data, tool, server, REST mirror, changelog entries, freshness, discovery.
// Scaffolded by scripts/new-area.js; replace each TODO with a real figure as the data lands.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const router = require('../api/router');
const AREA_MODULE = require('../api/_areas/${slug}');
const DATA = require('../data/${slug}.json');
const WELL_KNOWN = require('../public/.well-known/changes.json');
const { ALL_TOOLS } = require('../api/_registry');
const { freshnessFor, DUE_WINDOW_DAYS } = require('../api/_freshness');
const { CHANGELOG_AREAS } = require('../api/_changelog');
const { plusDays } = require('../api/_area_kit');

const AREA = ${js(slug)};
const TOOL = ${js(toolName)};
const server = router.ROUTES[\`mcp/\${AREA}\`];
const rest = router.ROUTES[AREA];
const get = (h, url) => invoke(h, undefined, { method: 'GET', url });
const day = (iso) => new Date(\`\${iso}T12:00:00Z\`);
const ISO = /^\\d{4}-\\d{2}-\\d{2}$/;
const CATEGORIES = Object.keys(DATA.categories);
const ENTRY_FIELDS = ['area', 'key', 'label', 'from', 'to', 'effectiveFrom', 'source', 'verifiedDate', 'note'];

test('data: verifiedDate, nextScheduledRefresh = verifiedDate + cadence, every category sourced', () => {
  assert.equal(DATA.area, AREA);
  assert.match(DATA.verifiedDate, ISO);
  assert.equal(DATA.nextScheduledRefresh, plusDays(DATA.verifiedDate, AREA_MODULE.freshness.cadenceDays));
  for (const [k, c] of Object.entries(DATA.categories)) {
    assert.ok(c.title, \`\${k} title\`);
    assert.match(c.source, /^https?:\\/\\//, \`\${k} source is an official URL\`);
    assert.ok(Array.isArray(c.figures) && c.figures.length, \`\${k} figures\`);
    for (const f of c.figures) assert.ok(f.label && f.value !== undefined, \`\${k} figure\`);
  }
  // TODO: pin the figures you read from the official page (and record them in docs/CURATION.md), e.g.
  // assert.equal(DATA.categories['standard-deduction'].figures[0].value, 15000);
});

test('server: lists the tool with clean MCP keys and read-only annotations', async () => {
  const list = await rpc(server, 'tools/list');
  assert.deepEqual(list.body.result.tools.map((t) => t.name), [TOOL]);
  assert.deepEqual(Object.keys(list.body.result.tools[0]).sort(), ['annotations', 'description', 'inputSchema', 'name', 'title']);
  assert.equal(ALL_TOOLS[TOOL].server, AREA);
  assert.equal(ALL_TOOLS[TOOL].freshness, AREA);
  // House rule: plain statements, no imperatives, in the tool description.
  assert.doesNotMatch(ALL_TOOLS[TOOL].description, /\\b(use this|you should|always|never|call this|do not)\\b/i);
});

test('happy path: a category answers with figures, source, verifiedDate, freshness and a cite permalink', async () => {
  if (!CATEGORIES.length) {
    // TODO data: until a category exists, the listing is the happy path.
    const { isError, data } = await callTool(server, TOOL, {});
    assert.equal(isError, false);
    assert.deepEqual(data.categories, {});
    assert.equal(data.cite.url, \`https://databutler.dev/r/\${AREA}\`);
    return;
  }
  const key = CATEGORIES[0];
  const { isError, data } = await callTool(server, TOOL, { category: key });
  assert.equal(isError, false);
  assert.equal(data.covered, undefined);
  assert.equal(data.category, key);
  assert.deepEqual(data.figures, DATA.categories[key].figures);
  assert.equal(data.source, DATA.categories[key].source);
  assert.equal(data.freshness.verifiedDate, DATA.verifiedDate);
  assert.equal(data.cite.url, \`https://databutler.dev/r/\${AREA}?category=\${encodeURIComponent(key)}\`);
  assert.match(data.cite.text, new RegExp(\`^databutler\\\\.dev, verified \${DATA.verifiedDate} against \`));
});

test('near-miss: an unknown category is covered:false with nearest keys, never an error', async () => {
  const { isError, data } = await callTool(server, TOOL, { category: 'zzz-not-a-category' });
  assert.equal(isError, false);
  assert.equal(data.covered, false);
  assert.equal(data.requested, 'zzz-not-a-category');
  assert.ok(Array.isArray(data.nearest));
  assert.deepEqual(data.coverage, CATEGORIES);
  assert.equal(data.error, undefined);
});

test('REST mirror: 400 without ?category=, otherwise the tool with envelope + cite', async () => {
  const bad = await get(rest, \`/api/\${AREA}\`);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /missing \\?category=/);
  const miss = await get(rest, \`/api/\${AREA}?category=zzz\`);
  assert.equal(miss.status, 200);
  assert.equal(miss.body.covered, false);
  assert.ok(miss.body.freshness && miss.body.cite);
  const viaRouter = await get(router, \`/api/router?route=\${AREA}&category=zzz\`);
  assert.equal(viaRouter.status, 200);
});

test('changelog: the area is listed, and its diff produces protocol-shaped entries', () => {
  assert.ok(CHANGELOG_AREAS.includes(AREA));
  const first = AREA_MODULE.changelog.diff(null, DATA);
  assert.equal(first.length, Object.values(DATA.categories).reduce((n, c) => n + c.figures.length, 0));
  for (const e of first) {
    for (const f of ENTRY_FIELDS) assert.ok(f in e, \`\${e.key} has \${f}\`);
    assert.equal(e.area, AREA);
    assert.equal(e.from, null);
    assert.equal(e.verifiedDate, DATA.verifiedDate);
    assert.equal(e.note, '');
  }
  assert.deepEqual(AREA_MODULE.changelog.diff(DATA, DATA), [], 'nothing moved');
});

test('freshness: fresh until the cadence elapses, due for the window, then overdue', () => {
  const n = AREA_MODULE.freshness.cadenceDays;
  assert.equal(freshnessFor(AREA, day(DATA.verifiedDate)).staleness, 'fresh');
  assert.equal(freshnessFor(AREA, day(plusDays(DATA.verifiedDate, n))).staleness, 'due');
  assert.equal(freshnessFor(AREA, day(plusDays(DATA.verifiedDate, n + DUE_WINDOW_DAYS + 1))).staleness, 'overdue');
});

test('discovery: the area appears in /.well-known/changes.json (run node scripts/sync-areas.js)', () => {
  const entry = WELL_KNOWN.areas.find((a) => a.name === AREA);
  assert.ok(entry, 'area in the discovery document');
  assert.equal(entry.cadence, AREA_MODULE.discovery.cadence);
});
`;
}

function curationStub({ title }) {
  return `
## Verification log (${title.toLowerCase()}, added ${today()})

- TODO ${today()} — <official page URL>: quote the figure(s) as they appear on
  the page, the licence statement, and anything odd kept as published. Figures
  are read from the page, never from memory.
`;
}

function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  const { AREAS } = require('../api/_areas');
  const { ALL_TOOLS } = require('../api/_registry');
  const toolName = `${a.slug.replace(/-/g, '_')}_lookup`;
  if (AREAS.some((x) => x.area === a.slug)) throw new Error(`area "${a.slug}" already exists (api/_areas/${a.slug}.js)`);
  if (ALL_TOOLS[toolName]) throw new Error(`tool name "${toolName}" is taken`);
  const order = Math.max(0, ...AREAS.map((x) => x.order)) + 10;
  const files = {
    [`api/_areas/${a.slug}.js`]: moduleTemplate({ ...a, order, toolName }),
    [`data/${a.slug}.json`]: dataTemplate(a),
    [`tests/${a.slug}.test.js`]: testTemplate({ ...a, toolName }),
  };
  for (const rel of Object.keys(files)) if (fs.existsSync(path.join(ROOT, rel))) throw new Error(`${rel} already exists — refusing to overwrite`);
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(ROOT, rel), body);
  fs.appendFileSync(path.join(ROOT, 'docs/CURATION.md'), curationStub(a));
  // Fresh process: this one already loaded the area list without the new module.
  execFileSync(process.execPath, [path.join(__dirname, 'sync-areas.js')], { cwd: ROOT, stdio: 'inherit' });

  console.log(`
Scaffolded area "${a.slug}" (order ${order}, tool ${toolName}). Created:
  api/_areas/${a.slug}.js   data/${a.slug}.json   tests/${a.slug}.test.js   docs/CURATION.md (section appended)
and regenerated llms.txt, sitemap.xml, .well-known/changes.json, README, CURATION calendar, index.html, verify-hub.sh.

Still yours to do (docs/ADDING_AN_AREA.md):
  1. data/${a.slug}.json — add categories { key: { title, source, figures: [{ label, value, unit }] } } from the OFFICIAL page;
     record the page URL, its licence statement, verifiedDate; quote each figure in docs/CURATION.md's new section.
  2. api/_areas/${a.slug}.js — replace every TODO: short, instructions, tool description (plain statements, no imperatives),
     coverage.scope + notCovered, discovery.description, hub phrases, docs rows/lines, verify checks.
  3. tests/${a.slug}.test.js — pin the real figures in the data test; keep the near-miss and REST 400 tests.
  4. node scripts/changelog.js   → first entries (null → value) for every figure; fill each note; it also refreshes data/sources.json.
  5. node scripts/sync-areas.js  → after any docs/hub/discovery edit;  node scripts/sync-areas.js --check must pass.
  6. node --test tests/*.test.js → then UPDATE_SNAPSHOTS=1 node --test tests/snapshot.test.js and read the diff of tests/snapshots/.
  7. Commit; after deploy: bash scripts/verify-hub.sh
`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message || e); process.exit(1); }
}

module.exports = { parseArgs, moduleTemplate, dataTemplate, testTemplate, curationStub };
