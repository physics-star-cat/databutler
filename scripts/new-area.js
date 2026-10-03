#!/usr/bin/env node
/**
 * Scaffold a new curated area (docs/ADDING_AN_AREA.md):
 *
 *   node scripts/new-area.js <area-slug> --title "US tax thresholds" --cadence "Every January and after each IRS revenue procedure" \
 *        [--refresh-days 45 | --calendar 2027-01-01] [--per-year 2026] [--previous] [--required-param] \
 *        [--note-template "{label}: {from} → {to} ({document})"] [--retires 12c]
 *
 *   --refresh-days N     day cadence: scripts/changelog.js stamps nextScheduledRefresh = verifiedDate + N (default 35)
 *   --calendar DATE      calendar cadence instead: cadenceDays null, nextScheduledRefresh set by hand (DATE first)
 *   --per-year YEAR      annual data layout data/<slug>/<YEAR>.json (+ previousSibling diffs) instead of data/<slug>.json
 *   --previous           figures carry a `previous: { value }` block; a figure's first appearance logs previous → value
 *   --required-param     REST mirror answers 400 without ?category= (default: the listing, like uk_rates_lookup)
 *   --note-template T    changelog.note template (api/_area_kit.js noteTemplate) the changelog script pre-fills notes with
 *   --retires ID         the README "planned" row (# cell) this area replaces — sync-areas removes it
 *
 * Creates, from templates with TODO markers:
 *   api/_areas/<area>.js      the area module (one tool, categories → figures data shape)
 *   data/<area>.json          { area, verifiedDate, nextScheduledRefresh, licence, sources: [], categories: {} }  (or data/<area>/<YEAR>.json)
 *   tests/<area>.test.js      tool list, happy path, near-miss, REST, changelog entries, freshness, discovery — expectations derived from the data
 *   docs/CURATION.md          an appended "Verification log (<slug>, added <date>)" stub
 * then runs `node scripts/sync-areas.js` (llms.txt, sitemap, discovery document, README, CURATION calendar,
 * index.html, verify-hub.sh, server-<area>.json) and prints what a human still has to fill in. The output
 * loads and its tests pass with the TODO data, so the real work can be committed step by step.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const today = () => new Date().toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_NOTE = '{label}: {from} → {to} ({document})';

function parseArgs(argv) {
  const [slug, ...rest] = argv;
  const opts = { title: null, cadence: null, refreshDays: null, calendar: null, perYear: null, previous: false, requiredParam: false, noteTemplate: null, retires: null };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--title') opts.title = rest[++i];
    else if (rest[i] === '--cadence') opts.cadence = rest[++i];
    else if (rest[i] === '--refresh-days') opts.refreshDays = Number(rest[++i]);
    else if (rest[i] === '--calendar') opts.calendar = rest[++i];
    else if (rest[i] === '--per-year') opts.perYear = rest[++i];
    else if (rest[i] === '--previous') opts.previous = true;
    else if (rest[i] === '--required-param') opts.requiredParam = true;
    else if (rest[i] === '--note-template') opts.noteTemplate = rest[++i];
    else if (rest[i] === '--retires') opts.retires = rest[++i];
    else throw new Error(`unknown argument ${rest[i]}`);
  }
  if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) throw new Error('usage: node scripts/new-area.js <area-slug> --title "…" --cadence "…" [--refresh-days N | --calendar YYYY-MM-DD] [--per-year YYYY] [--previous] [--required-param] [--note-template "…"] [--retires ID]  (slug: lowercase, digits, hyphens)');
  if (!opts.title) throw new Error('--title "…" is required (human label, e.g. "US tax thresholds")');
  if (!opts.cadence) throw new Error('--cadence "…" is required (how often the sources are re-checked, in words)');
  if (opts.refreshDays !== null && opts.calendar !== null) throw new Error('--refresh-days and --calendar are alternatives: a day cadence the script stamps, or a calendar date set by hand');
  if (opts.calendar !== null && (!ISO.test(opts.calendar) || Number.isNaN(Date.parse(opts.calendar)))) throw new Error('--calendar needs an ISO date (YYYY-MM-DD): the first nextScheduledRefresh');
  if (opts.calendar === null && opts.refreshDays === null) opts.refreshDays = 35;
  if (opts.refreshDays !== null && (!Number.isInteger(opts.refreshDays) || opts.refreshDays < 1)) throw new Error('--refresh-days must be a positive integer');
  if (opts.perYear !== null && !/^\d{4}(-\d{2})?$/.test(opts.perYear)) throw new Error('--per-year needs the year the first file covers, e.g. 2026 or 2026-27');
  if (opts.noteTemplate !== null && !opts.noteTemplate.trim()) throw new Error('--note-template must not be empty');
  if (opts.retires !== null && !/^[0-9]+[a-z]?$/.test(opts.retires)) throw new Error('--retires names a README planned-table row id, e.g. 12c');
  return { slug, ...opts };
}

const js = (s) => JSON.stringify(s);
/** Where the data lives: one file, or one file per year under data/<slug>/. */
const layout = ({ slug, perYear }) => (perYear
  ? { dataFile: `data/${slug}/${perYear}.json`, requirePath: `../../data/${slug}/${perYear}.json`, files: [`data/${slug}/`], perYear: true }
  : { dataFile: `data/${slug}.json`, requirePath: `../../data/${slug}.json`, files: [`data/${slug}.json`], perYear: false });

function moduleTemplate(a) {
  const { slug, title, cadence, refreshDays, calendar, previous, requiredParam, noteTemplate, retires, order, toolName } = a;
  const AREA = js(slug);
  const L = layout(a);
  const cadenceLine = calendar
    ? `const CADENCE_DAYS = null; // calendar-driven: nextScheduledRefresh is set by hand in the data file (${calendar} first); freshness turns due from that day`
    : `const CADENCE_DAYS = ${refreshDays}; // nextScheduledRefresh = verifiedDate + ${refreshDays}, stamped by scripts/changelog.js`;
  const refreshHow = calendar
    ? `set \`nextScheduledRefresh\` by hand to the next release date; \`node scripts/changelog.js --only ${slug}\``
    : `\`node scripts/changelog.js --only ${slug}\` (stamps \`nextScheduledRefresh\` = verifiedDate + ${refreshDays}`;
  return `/**
 * Area: ${slug} — ${title}.
 * TODO: one paragraph on what this area serves, from which official pages, and
 * how it is refreshed. Data: ${L.dataFile} (categories → figures), edited
 * against the source pages and diffed by \`node scripts/changelog.js --only ${slug}\`.
 * Contract: api/_areas/README.md. Playbook: docs/ADDING_AN_AREA.md.
 */
const DATA = require('${L.requirePath}');
const { BASE, diffCategories, categoriesLookup, noteTemplate } = require('../_area_kit');

const AREA = ${AREA};
${cadenceLine}
const CATEGORIES = Object.keys(DATA.categories);
/**
 * Figures carry \`previous: { value }\` — a figure's first appearance in the file records
 * previous.value → value (one without a previous records nothing); afterwards every refresh
 * diffs value against the committed file.${previous ? '' : ' Off: a first appearance records null → value.'}
 */
const PREVIOUS = ${previous};

/** House-style lookup (api/_area_kit.js): nothing → listing; key or substring of key/title → category; else covered:false + nearest. */
const lookup = categoriesLookup(DATA, AREA);

module.exports = {
  area: AREA,
  order: ${order},
  title: ${js(title)},
  short: ${js(`TODO short noun phrase, e.g. ${title.toLowerCase()}`)},

  server: {
    serverName: 'databutler-${slug}',
    url: \`\${BASE}/api/mcp/${slug}\`,
    description: ${js(`TODO one sentence for the MCP registry listing (server-${slug}.json): ${title} verified against the official pages, with source URL and verification date on every figure.`)},
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
        // frontDoor: true,  // only for a genuinely high-frequency tool — at most 5 direct + 4 hub tools = 9 listed (docs/ADDING_AN_AREA.md)
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

  freshness: { dataFile: ${js(L.dataFile)}, cadenceDays: CADENCE_DAYS, data: DATA },

  changelog: {
    diff: (prev, next) => diffCategories(AREA, prev, next, { previous: PREVIOUS${L.perYear ? ", effectiveFrom: (n, f) => f.effectiveFrom || `${n.taxYear}-01-01`, extra: (n) => ({ taxYear: n.taxYear })" : ''} }),
    files: ${js(L.files)},${L.perYear ? `
    previousSibling: true, // a brand-new year file diffs against the previous year's file in data/${slug}/` : ''}
    previous: PREVIOUS,
    // scripts/changelog.js pre-fills every blank note with this; placeholders: {label} {key} {from} {to} {unit} {source} {quote} {document}
    note: noteTemplate(${js(noteTemplate || DEFAULT_NOTE)}),
    context: (e) => ${L.perYear ? "(e.taxYear ? `year ${e.taxYear}` : '')" : "''"}, // TODO: a short context line for /changes, e.g. the tax year or jurisdiction
  },
  discovery: {
    description: ${js(`TODO: ${title} — what facts this area covers, verified against which official pages.`)},
    cadence: ${js(cadence)},
  },

  sources: () => Object.entries(DATA.categories).map(([k, c]) => ({ url: c.source, label: c.title || k })),

  rest: [
    { path: ${AREA}, tool: ${js(toolName)}, args: (q) => ({ category: q.category })${requiredParam ? ", required: ['category']" : ' /* no `required`: an empty query answers the listing, like uk_rates_lookup */'} },
  ],

  hub: {
    changed: ${js(`TODO ${title.toLowerCase()} (what_changed_since phrase)`)},
    coverage: ${js(`TODO ${title.toLowerCase()} categories`)},
    catalogue: ${js(`TODO ${title.toLowerCase()}`)},
  },

  docs: {
    readme: {
      // The # cell is numbered by scripts/sync-areas.js from \`order\`; start at the Vertical cell.
      roadmapRow: ${js(`| **${title}** — TODO one line on the value to an agent | \`/api/mcp/${slug}\` | **v1 — built ${today()}** |`)},
      catalogueRow: ${js(`| \`/api/mcp/${slug}\` | \`${toolName}\` | \`${L.dataFile}\`, TODO verified against … |`)},${retires ? `
      retires: ${js(retires)}, // the README planned-table row this area replaces — sync-areas removes it` : ''}
    },
    llms: {
      rest: [${js(`- \`GET https://databutler.dev/api/${slug}?category=TODO\` — TODO one line: what comes back, verified against which official pages.`)}],
      server: ${js(`- \`POST https://databutler.dev/api/mcp/${slug}\` — tool \`${toolName}\`. TODO one line.`)},
    },
    curation: [${js(`| \`${L.perYear ? `data/${slug}/<year>.json` : L.dataFile}\` | ${cadence}${calendar ? ' (calendar-driven: `cadenceDays: null`, `nextScheduledRefresh` set by hand)' : ''} | Open each category's \`source\` page; edit the figures${previous ? ' (move the old `value` into `previous`)' : ''}; bump \`verifiedDate\`; ${refreshHow}${calendar ? '' : ','} appends one entry per figure that moved, re-hashes this area's sources in \`data/sources.json\`). |`)}],
    index: { blurb: ${js(`TODO ${title.toLowerCase()}`)} },
    api: () => ({
      endpoints: {
        ${js(`GET /api/${slug}`)}: {
          description: \`TODO: ${title}, verified \${DATA.verifiedDate} against the official pages.\`,
          params: { category: \`one of \${CATEGORIES.join(', ') || 'TODO'} (omit to list)\` },
          example: ${js(`https://databutler.dev/api/${slug}?category=TODO`)},
        },
      },
      coverage: { ${js(slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()))}: \`\${CATEGORIES.length} categories, verified \${DATA.verifiedDate}\` },
    }),
  },

  verify: [
    { label: ${js(`${slug}-listing`)}, kind: 'tool', tool: ${js(toolName)}, args: {}, assert: "'categories' in d and 'freshness' in d" },
    ${requiredParam
    ? `{ label: ${js(`${slug}-rest-400`)}, kind: 'rest', path: ${AREA}, query: '', assert: "'missing' in d['error']" },`
    : `{ label: ${js(`${slug}-rest-listing`)}, kind: 'rest', path: ${AREA}, query: '', assert: "'categories' in d and 'cite' in d" },`}
    // TODO: a happy-path check on a real category and its cite url.
  ],
};
`;
}

function dataTemplate(a) {
  const d = today();
  let due = a.calendar;
  if (!due) {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + a.refreshDays);
    due = t.toISOString().slice(0, 10);
  }
  return JSON.stringify({
    area: a.slug,
    ...(a.perYear ? { taxYear: a.perYear } : {}),
    verifiedDate: d,
    nextScheduledRefresh: due,
    licence: 'TODO: the licence the official source publishes under (e.g. Open Government Licence v3.0), quoted from the page',
    sources: [],
    categories: {},
  }, null, 2) + '\n';
}

function testTemplate({ slug, title, toolName }) {
  return `// tests/${slug}.test.js — ${title}: data, tool, server, REST mirror, changelog entries, freshness, discovery.
// Scaffolded by scripts/new-area.js. Expectations derive from the module and its data (cadence, previous
// semantics, REST required params), so filling the data needs no edits here beyond pinning real figures.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc, callTool, invoke } = require('./helpers');
const router = require('../api/router');
const AREA_MODULE = require('../api/_areas/${slug}');
const WELL_KNOWN = require('../public/.well-known/changes.json');
const { ALL_TOOLS } = require('../api/_registry');
const { freshnessFor, DUE_WINDOW_DAYS } = require('../api/_freshness');
const { CHANGELOG_AREAS } = require('../api/_changelog');
const { plusDays, same } = require('../api/_area_kit');

const AREA = ${js(slug)};
const TOOL = ${js(toolName)};
const DATA = AREA_MODULE.freshness.data; // the file the module serves (${'data/<slug>.json'} or data/<slug>/<year>.json)
const CADENCE = AREA_MODULE.freshness.cadenceDays; // null = calendar-driven
const PREVIOUS = AREA_MODULE.changelog.previous === true;
const REQUIRED = (AREA_MODULE.rest[0].required || []).includes('category');
const server = router.ROUTES[\`mcp/\${AREA}\`];
const rest = router.ROUTES[AREA];
const get = (h, url) => invoke(h, undefined, { method: 'GET', url });
const day = (iso) => new Date(\`\${iso}T12:00:00Z\`);
const ISO = /^\\d{4}-\\d{2}-\\d{2}$/;
const CATEGORIES = Object.keys(DATA.categories);
const FIGURES = Object.entries(DATA.categories).flatMap(([cat, c]) => c.figures.map((f) => ({ cat, f })));
const ENTRY_FIELDS = ['area', 'key', 'label', 'from', 'to', 'effectiveFrom', 'source', 'verifiedDate', 'note'];
const hasPrevious = (f) => f.previous && f.previous.value !== undefined && !same(f.previous.value, f.value);

test('data: verifiedDate, nextScheduledRefresh follows the cadence, every category sourced', () => {
  assert.equal(DATA.area, AREA);
  assert.match(DATA.verifiedDate, ISO);
  if (CADENCE === null) {
    assert.match(DATA.nextScheduledRefresh, ISO, 'calendar-driven: an ISO date set by hand');
    assert.ok(!Number.isNaN(Date.parse(DATA.nextScheduledRefresh)));
  } else {
    assert.equal(DATA.nextScheduledRefresh, plusDays(DATA.verifiedDate, CADENCE));
  }
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

test(\`REST mirror: empty query → \${REQUIRED ? '400' : 'the listing'}; otherwise the tool with envelope + cite\`, async () => {
  const empty = await get(rest, \`/api/\${AREA}\`);
  if (REQUIRED) {
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, /missing \\?category=/);
  } else {
    assert.equal(empty.status, 200);
    assert.deepEqual(Object.keys(empty.body.categories), CATEGORIES);
    assert.ok(empty.body.freshness && empty.body.cite);
  }
  const miss = await get(rest, \`/api/\${AREA}?category=zzz\`);
  assert.equal(miss.status, 200);
  assert.equal(miss.body.covered, false);
  assert.ok(miss.body.freshness && miss.body.cite);
  const viaRouter = await get(router, \`/api/router?route=\${AREA}&category=zzz\`);
  assert.equal(viaRouter.status, 200);
});

test('changelog: the area is listed; a first commit records what the data says (previous → value, or null → value)', () => {
  assert.ok(CHANGELOG_AREAS.includes(AREA));
  const first = AREA_MODULE.changelog.diff(null, DATA);
  // With previous semantics a figure arrives as previous.value → value and an un-previoused figure records
  // nothing; without them every figure arrives as null → value.
  const arrivals = FIGURES.filter(({ f }) => !PREVIOUS || hasPrevious(f));
  assert.equal(first.length, arrivals.length);
  for (const { cat, f } of arrivals) {
    const e = first.find((x) => x.key.startsWith(\`\${cat}/\`) && x.label === f.label);
    assert.ok(e, \`entry for \${cat}/\${f.label}\`);
    for (const k of ENTRY_FIELDS) assert.ok(k in e, \`\${e.key} has \${k}\`);
    assert.equal(e.area, AREA);
    assert.deepEqual(e.from, PREVIOUS ? f.previous.value : null);
    assert.deepEqual(e.to, f.value);
    assert.equal(e.verifiedDate, DATA.verifiedDate);
    assert.equal(e.note, '', 'notes are filled by scripts/changelog.js (changelog.note), never by diff()');
  }
  assert.deepEqual(AREA_MODULE.changelog.diff(DATA, DATA), [], 'nothing moved');
  if (first.length && AREA_MODULE.changelog.note) {
    assert.ok(AREA_MODULE.changelog.note(first[0], null, DATA).length > 0, 'changelog.note pre-fills a note');
  }
});

test('freshness: fresh before nextScheduledRefresh, due from that day, overdue after the window', () => {
  const next = DATA.nextScheduledRefresh;
  if (CADENCE !== null) assert.equal(freshnessFor(AREA, day(DATA.verifiedDate)).staleness, 'fresh');
  assert.equal(freshnessFor(AREA, day(plusDays(next, -1))).staleness, 'fresh');
  assert.equal(freshnessFor(AREA, day(next)).staleness, 'due');
  assert.equal(freshnessFor(AREA, day(plusDays(next, DUE_WINDOW_DAYS + 1))).staleness, 'overdue');
});

test('discovery: the area appears in /.well-known/changes.json (run node scripts/sync-areas.js)', () => {
  const entry = WELL_KNOWN.areas.find((a) => a.name === AREA);
  assert.ok(entry, 'area in the discovery document');
  assert.equal(entry.cadence, AREA_MODULE.discovery.cadence);
});
`;
}

function curationStub({ slug }) {
  return `
## Verification log (${slug}, added ${today()})

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
  const L = layout(a);
  const files = {
    [`api/_areas/${a.slug}.js`]: moduleTemplate({ ...a, order, toolName }),
    [L.dataFile]: dataTemplate(a),
    [`tests/${a.slug}.test.js`]: testTemplate({ ...a, toolName }),
  };
  for (const rel of Object.keys(files)) if (fs.existsSync(path.join(ROOT, rel))) throw new Error(`${rel} already exists — refusing to overwrite`);
  if (L.perYear) fs.mkdirSync(path.join(ROOT, `data/${a.slug}`), { recursive: true });
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(ROOT, rel), body);
  fs.appendFileSync(path.join(ROOT, 'docs/CURATION.md'), curationStub(a));
  // Fresh process: this one already loaded the area list without the new module.
  execFileSync(process.execPath, [path.join(__dirname, 'sync-areas.js')], { cwd: ROOT, stdio: 'inherit' });

  const firstEntries = a.previous
    ? 'previous.value → value for every figure that carries a previous (un-previoused figures record nothing)'
    : 'null → value for every figure';
  console.log(`
Scaffolded area "${a.slug}" (order ${order}, tool ${toolName}${a.calendar ? `, calendar cadence, next refresh ${a.calendar}` : `, every ${a.refreshDays} days`}${L.perYear ? ', per-year layout' : ''}). Created:
  api/_areas/${a.slug}.js   ${L.dataFile}   tests/${a.slug}.test.js   docs/CURATION.md (section appended)
and regenerated llms.txt, sitemap.xml, .well-known/changes.json, README, CURATION calendar, index.html, verify-hub.sh, server-${a.slug}.json.

Still yours to do (docs/ADDING_AN_AREA.md) — nothing outside these four files:
  1. ${L.dataFile} — add categories { key: { title, source, figures: [{ label, value, unit${a.previous ? ', previous: { value }' : ''} }] } } from the OFFICIAL page;
     record the page URL, its licence statement, verifiedDate${a.calendar ? ', nextScheduledRefresh (by hand)' : ''}; quote each figure in docs/CURATION.md's new section.
  2. api/_areas/${a.slug}.js — replace every TODO: short, server.description, instructions, tool description (plain statements, no imperatives),
     coverage.scope + notCovered, discovery.description, hub phrases, docs rows/lines, verify checks.
  3. tests/${a.slug}.test.js — pin the real figures in the data test; the rest derives from the module and data.
  4. node scripts/changelog.js --only ${a.slug}   → first entries: ${firstEntries}; notes pre-filled from changelog.note — review them;
     re-hashes only this area's sources (no --only re-hashes every area's and resets the Monday watcher baseline). Runs with the files above uncommitted.
  5. node scripts/sync-areas.js  → after any docs/hub/discovery edit;  node scripts/sync-areas.js --check must pass.
  6. node --test tests/*.test.js → then UPDATE_SNAPSHOTS=1 node --test tests/snapshot.test.js and read the diff of tests/snapshots/.
  7. Commit; after deploy: bash scripts/verify-hub.sh
`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message || e); process.exit(1); }
}

module.exports = { parseArgs, moduleTemplate, dataTemplate, testTemplate, curationStub, layout, DEFAULT_NOTE };
