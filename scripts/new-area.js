#!/usr/bin/env node
/**
 * Scaffold a new curated area (docs/ADDING_AN_AREA.md):
 *
 *   node scripts/new-area.js <area-slug> --title "US tax thresholds" \
 *        [--cadence "…"] [--refresh-days 45 | --calendar 2027-01-01] [--per-year 2026-27 [--year-start 04-06]] [--previous] \
 *        [--params kind,board] [--rest-path uk/exam-dates] [--required-param] [--tool-title "…"] [--order 130] \
 *        [--note-template "{label}: {from} → {to} ({document})"] [--retires 12c]
 *
 *   --cadence T          discovery.cadence in words (default: stated from --refresh-days / --calendar)
 *   --refresh-days N     day cadence: scripts/changelog.js stamps nextScheduledRefresh = verifiedDate + N (default 35)
 *   --calendar DATE      calendar cadence instead: cadenceDays null, nextScheduledRefresh set by hand (DATE first)
 *   --per-year YEAR      annual layout data/<slug>/<YEAR>.json (+ previousSibling diffs); YEAR is 2026 or 2026-27
 *   --year-start MM-DD   with --per-year: the day the year starts, for the default effectiveFrom (default 01-01;
 *                        UK VED 04-01, UK income tax 04-06) — effectiveFrom = <first four digits of taxYear>-MM-DD
 *   --previous           figures carry a `previous: { value }` block; a figure's first appearance logs previous → value
 *   --params a,b,…       the tool's arguments (default: category). The first names the category; each further one
 *                        narrows that category's figures to those whose field of the same name matches (figures carry it)
 *   --rest-path P        the REST mirror and /r citation path (default: the slug), e.g. uk/exam-dates
 *   --required-param     REST mirror answers 400 without the first param (default: the listing, like uk_rates_lookup)
 *   --tool-title T       the tool's display title, at most 40 characters (default "<title> lookup", or the title alone)
 *   --order N            the area's public position (default: highest existing + 10). Two branches scaffolding at
 *                        the same time both take the same default — pass distinct --order values in that case
 *   --note-template T    changelog.note template (api/_area_kit.js noteTemplate) the changelog script pre-fills notes with
 *   --retires ID         the README "planned" row (# cell) this area replaces — sync-areas removes it
 *
 * Creates, from templates with TODO markers:
 *   api/_areas/<area>.js      the area module (one tool, categories → figures data shape)
 *   data/<area>.json          { area, verifiedDate, nextScheduledRefresh, licence, sources: [], categories: {} }  (or data/<area>/<YEAR>.json)
 *   tests/<area>.test.js      tool list, happy path, filters, near-miss, REST, changelog entries, freshness, discovery — every
 *                             expectation (tool, params, REST path, cadence, previous semantics) read from the module and data
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

const TITLE_MAX = 40; // tests/annotations.test.js
const USAGE = 'usage: node scripts/new-area.js <area-slug> --title "…" [--cadence "…"] [--refresh-days N | --calendar YYYY-MM-DD] ' +
  '[--per-year YYYY[-YY] [--year-start MM-DD]] [--previous] [--params a,b] [--rest-path p/q] [--required-param] [--tool-title "…"] ' +
  '[--order N] [--note-template "…"] [--retires ID]  (slug: lowercase, digits, hyphens)';

/** The default tool title: "<title> lookup", else the title alone, within the 40-character cap — or null. */
function defaultToolTitle(title) {
  for (const t of [`${title} lookup`, title]) if (t.length <= TITLE_MAX) return t;
  return null;
}

/** discovery.cadence when --cadence is not given, stated from the refresh rule. */
const defaultCadence = ({ calendar, refreshDays }) => (calendar
  ? `Calendar-driven: re-verified against the official pages when the source publishes (next due ${calendar}); every source page re-fetched weekly.`
  : `Re-verified against the official pages every ${refreshDays} days; every source page re-fetched weekly.`);

function parseArgs(argv) {
  const [slug, ...rest] = argv;
  const opts = {
    title: null, cadence: null, refreshDays: null, calendar: null, perYear: null, yearStart: null, previous: false, requiredParam: false,
    noteTemplate: null, retires: null, params: null, restPath: null, toolTitle: null, order: null,
  };
  const value = (i, flag) => {
    if (i >= rest.length || /^--/.test(rest[i])) throw new Error(`${flag} needs a value`);
    return rest[i];
  };
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i];
    if (f === '--title') opts.title = value(++i, f);
    else if (f === '--cadence') opts.cadence = value(++i, f);
    else if (f === '--refresh-days') opts.refreshDays = Number(value(++i, f));
    else if (f === '--calendar') opts.calendar = value(++i, f);
    else if (f === '--per-year') opts.perYear = value(++i, f);
    else if (f === '--year-start') opts.yearStart = value(++i, f);
    else if (f === '--previous') opts.previous = true;
    else if (f === '--required-param') opts.requiredParam = true;
    else if (f === '--note-template') opts.noteTemplate = value(++i, f);
    else if (f === '--retires') opts.retires = value(++i, f);
    else if (f === '--params') opts.params = value(++i, f).split(',').map((x) => x.trim()).filter(Boolean);
    else if (f === '--rest-path') opts.restPath = value(++i, f);
    else if (f === '--tool-title') opts.toolTitle = value(++i, f);
    else if (f === '--order') opts.order = Number(value(++i, f));
    else throw new Error(`unknown argument ${f}\n${USAGE}`);
  }
  if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) throw new Error(USAGE);
  if (!opts.title) throw new Error('--title "…" is required (human label, e.g. "US tax thresholds")');
  if (opts.refreshDays !== null && opts.calendar !== null) throw new Error('--refresh-days and --calendar are alternatives: a day cadence the script stamps, or a calendar date set by hand');
  if (opts.calendar !== null && (!ISO.test(opts.calendar) || Number.isNaN(Date.parse(opts.calendar)))) throw new Error('--calendar needs an ISO date (YYYY-MM-DD): the first nextScheduledRefresh');
  if (opts.calendar === null && opts.refreshDays === null) opts.refreshDays = 35;
  if (opts.refreshDays !== null && (!Number.isInteger(opts.refreshDays) || opts.refreshDays < 1)) throw new Error('--refresh-days must be a positive integer');
  if (opts.cadence !== null && opts.cadence.trim().length <= 5) throw new Error('--cadence must say how often the sources are re-checked, in words (more than 5 characters)');
  if (opts.cadence === null) opts.cadence = defaultCadence(opts);
  if (opts.perYear !== null && !/^\d{4}(-\d{2})?$/.test(opts.perYear)) throw new Error('--per-year needs the year the first file covers, e.g. 2026 or 2026-27');
  if (opts.yearStart !== null) {
    if (opts.perYear === null) throw new Error('--year-start only applies with --per-year (it sets the default effectiveFrom of a year file)');
    if (!/^\d{2}-\d{2}$/.test(opts.yearStart) || Number.isNaN(Date.parse(`2001-${opts.yearStart}`))) throw new Error('--year-start needs MM-DD, e.g. 04-01 (UK VED) or 04-06 (UK income tax)');
  }
  if (opts.perYear !== null && opts.yearStart === null) opts.yearStart = '01-01';
  if (opts.noteTemplate !== null && !opts.noteTemplate.trim()) throw new Error('--note-template must not be empty');
  if (opts.retires !== null && !/^[0-9]+[a-z]?$/.test(opts.retires)) throw new Error('--retires names a README planned-table row id, e.g. 12c');
  if (opts.params === null) opts.params = ['category'];
  if (!opts.params.length) throw new Error('--params needs at least one name, e.g. --params kind,board');
  for (const p of opts.params) if (!/^[a-z][a-zA-Z0-9_]*$/.test(p)) throw new Error(`--params: "${p}" is not a plain argument name (letters, digits, _)`);
  if (new Set(opts.params).size !== opts.params.length) throw new Error('--params: names must be distinct');
  if (opts.restPath === null) opts.restPath = slug;
  if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(opts.restPath)) throw new Error('--rest-path is lowercase segments joined by /, e.g. uk/exam-dates (no leading or trailing slash)');
  if (opts.toolTitle !== null) {
    if (opts.toolTitle.length > TITLE_MAX || opts.toolTitle.trim().length < 3) throw new Error(`--tool-title must be 3–${TITLE_MAX} characters (got ${opts.toolTitle.length}); tests/annotations.test.js caps tool titles`);
  } else {
    opts.toolTitle = defaultToolTitle(opts.title);
    if (!opts.toolTitle) throw new Error(`--title "${opts.title}" is ${opts.title.length} characters; the tool title is capped at ${TITLE_MAX} (tests/annotations.test.js) — pass --tool-title "<at most ${TITLE_MAX} characters>"`);
  }
  if (opts.order !== null && (!Number.isInteger(opts.order) || opts.order < 1)) throw new Error('--order must be a positive integer');
  return { slug, ...opts };
}

const js = (s) => JSON.stringify(s);
/** Where the data lives: one file, or one file per year under data/<slug>/. */
const layout = ({ slug, perYear }) => (perYear
  ? { dataFile: `data/${slug}/${perYear}.json`, requirePath: `../../data/${slug}/${perYear}.json`, files: [`data/${slug}/`], perYear: true }
  : { dataFile: `data/${slug}.json`, requirePath: `../../data/${slug}.json`, files: [`data/${slug}.json`], perYear: false });

function moduleTemplate(a) {
  const { slug, title, cadence, refreshDays, calendar, previous, requiredParam, noteTemplate, retires, order, toolName, toolTitle, params, restPath, yearStart } = a;
  const AREA = js(slug);
  const L = layout(a);
  const [param, ...filters] = params;
  const cadenceLine = calendar
    ? `const CADENCE_DAYS = null; // calendar-driven: nextScheduledRefresh is set by hand in the data file (${calendar} first); freshness turns due from that day`
    : `const CADENCE_DAYS = ${refreshDays}; // nextScheduledRefresh = verifiedDate + ${refreshDays}, stamped by scripts/changelog.js`;
  const refreshHow = calendar
    ? `set \`nextScheduledRefresh\` by hand to the next release date; \`node scripts/changelog.js --only ${slug}\``
    : `\`node scripts/changelog.js --only ${slug}\` (stamps \`nextScheduledRefresh\` = verifiedDate + ${refreshDays}`;
  const filterProps = filters.map((f) => `            ${f}: { type: 'string', description: ${js(`TODO: narrows the figures to those whose ${f} matches (optional)`)} },`).join('\n');
  return `/**
 * Area: ${slug} — ${title}.
 * TODO: one paragraph on what this area serves, from which official pages, and
 * how it is refreshed. Data: ${L.dataFile} (categories → figures), edited
 * against the source pages and diffed by \`node scripts/changelog.js --only ${slug}\`.
 * Contract: api/_areas/README.md. Playbook: docs/ADDING_AN_AREA.md.
 */
const DATA = require('${L.requirePath}');
const { BASE, diffCategories, categoriesLookup, categorySources, figureKey, noteTemplate } = require('../_area_kit');

const AREA = ${AREA};
const TOOL = ${js(toolName)};
const REST_PATH = ${js(restPath)}; // GET /api/<REST_PATH> and the /r/<REST_PATH> citation page
/** The tool's arguments: the first names the category; each further one narrows its figures by the figure field of that name. */
const PARAMS = ${js(params)};
${cadenceLine}
const CATEGORIES = Object.keys(DATA.categories);
/**
 * Figures carry \`previous: { value }\` — a figure's first appearance in the file records
 * previous.value → value (one without a previous records nothing); afterwards every refresh
 * diffs value against the committed file.${previous ? '' : ' Off: a first appearance records null → value.'}
 */
const PREVIOUS = ${previous};
/** A figure's id: its own \`key\` when it carries one, else slug(label). The diff and the note template share it. */
const KEY = figureKey;${L.perYear ? `
/** Day the data year starts (MM-DD): a figure without its own effectiveFrom takes <first four digits of taxYear>-${yearStart}. */
const YEAR_START = ${js(yearStart)};` : ''}

/** House-style lookup (api/_area_kit.js): nothing → listing; key or substring of key/title → category; else covered:false + nearest. */
const lookup = categoriesLookup(DATA, AREA, { param: PARAMS[0], filters: PARAMS.slice(1) });
const pick = (q) => Object.fromEntries(PARAMS.map((p) => [p, q[p]]));

module.exports = {
  area: AREA,
  order: ${order},
  title: ${js(title)},
  short: ${js(`TODO short noun phrase, e.g. ${title.toLowerCase()}`)},

  server: {
    serverName: 'databutler-${slug}',
    url: \`\${BASE}/api/mcp/${slug}\`,
    description: ${js(`TODO (≤ 100 chars, MCP Registry limit): ${title}`.slice(0, 100))},
    instructions:
      'TODO: what this server serves, from which official pages, and how an agent should present it ' +
      '(verifiedDate and source alongside every figure). Plain statements. Cite https://databutler.dev/ and the source.',
    tools: [
      {
        name: TOOL,
        title: ${js(toolTitle)},
        description:
          'TODO: a plain statement of what the tool returns (no imperatives — say what it is, not what to do): ' +
          \`${title} figures verified against the official pages, by ${param} (\${CATEGORIES.join(', ') || 'TODO'}), \` +
          'each with its source URL and verifiedDate. An unknown ${param} answers covered:false with the nearest keys.',
        inputSchema: {
          type: 'object',
          properties: {
            ${param}: { type: 'string', description: \`one of: \${CATEGORIES.join(', ') || 'TODO'} (omit to list all)\` },${filterProps ? `\n${filterProps}` : ''}
          },
        },
        run: (a) => lookup(a),
        freshness: AREA,
        // frontDoor: true,  // only for a genuinely high-frequency tool — at most 5 direct + 4 hub tools = 9 listed (docs/ADDING_AN_AREA.md)
        cite: (a) => ({ path: REST_PATH, query: pick(a) }),
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
    diff: (prev, next) => diffCategories(AREA, prev, next, { key: KEY, previous: PREVIOUS${L.perYear ? ", effectiveFrom: (n, f) => f.effectiveFrom || `${String(n.taxYear).slice(0, 4)}-${YEAR_START}`, extra: (n) => ({ taxYear: n.taxYear })" : ''} }),
    files: ${js(L.files)},${L.perYear ? `
    previousSibling: true, // a brand-new year file diffs against the previous year's file in data/${slug}/` : ''}
    previous: PREVIOUS,
    // scripts/changelog.js pre-fills every blank note with this. Placeholders: {label} {key} {from} {to} {unit} {effectiveFrom}
    // {source} {title} (category) {quote} {document} (quote, else source) {previousDocument} (previous.title/document/source)
    note: noteTemplate(${js(noteTemplate || DEFAULT_NOTE)}, { key: KEY }),
    context: (e) => ${L.perYear ? "(e.taxYear ? `year ${e.taxYear}` : '')" : "''"}, // TODO: a short context line for /changes, e.g. the tax year or jurisdiction
  },
  discovery: {
    description: ${js(`TODO: ${title} — what facts this area covers, verified against which official pages.`)},
    cadence: ${js(cadence)},
  },

  // Every category's source and every figure's own source, each URL once. A page the watcher cannot fetch (403, CAPTCHA):
  // categorySources(DATA, { unreachable: { 'www.example.org': 'HTTP 403 to non-browser user agents' } }) — recorded, skipped, listed.
  sources: () => categorySources(DATA),

  rest: [
    { path: REST_PATH, tool: TOOL, args: pick${requiredParam ? ', required: [PARAMS[0]]' : ' /* no `required`: an empty query answers the listing, like uk_rates_lookup */'} },
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
      catalogueRow: ${js(`| \`/api/mcp/${slug}\` | \`${toolName}\` {${params.join(', ')}} | \`${L.dataFile}\`, TODO verified against … |`)},${retires ? `
      retires: ${js(retires)}, // the README planned-table row this area replaces — sync-areas removes it` : ''}
    },
    llms: {
      rest: [${js(`- \`GET https://databutler.dev/api/${restPath}?${param}=TODO\` — TODO one line: what comes back, verified against which official pages.`)}],
      server: ${js(`- \`POST https://databutler.dev/api/mcp/${slug}\` — tool \`${toolName}\`. TODO one line.`)},
    },
    curation: [${js(`| \`${L.perYear ? `data/${slug}/<year>.json` : L.dataFile}\` | ${cadence}${calendar ? ' (calendar-driven: `cadenceDays: null`, `nextScheduledRefresh` set by hand)' : ''} | Open each category's \`source\` page; edit the figures${previous ? ' (move the old `value` into `previous`)' : ''}; bump \`verifiedDate\`; ${refreshHow}${calendar ? '' : ','} appends one entry per figure that moved, re-hashes this area's sources in \`data/sources.json\`). |`)}],
    index: { blurb: ${js(`TODO ${title.toLowerCase()}`)} },
    api: () => ({
      endpoints: {
        [\`GET /api/\${REST_PATH}\`]: {
          description: \`TODO: ${title}, verified \${DATA.verifiedDate} against the official pages.\`,
          params: {
            ${param}: \`one of \${CATEGORIES.join(', ') || 'TODO'} (omit to list)\`,${filters.map((f) => `\n            ${f}: 'TODO (optional) narrows the figures',`).join('')}
          },
          example: \`https://databutler.dev/api/\${REST_PATH}?${param}=TODO\`,
        },
      },
      coverage: { ${js(slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()))}: \`\${CATEGORIES.length} categories, verified \${DATA.verifiedDate}\` },
    }),
  },

  // Verified Facts: null, or { namespace: 'uk' } to publish every figure at /f/<namespace>/<category>/<figure>
  // (api/_areas/README.md "facts"; then node scripts/sign-facts.js — an unsigned fact fails tests/facts-sign.test.js).
  facts: null,

  verify: [
    { label: ${js(`${slug}-listing`)}, kind: 'tool', tool: TOOL, args: {}, assert: "'categories' in d and 'freshness' in d" },
    ${requiredParam
    ? `{ label: ${js(`${slug}-rest-400`)}, kind: 'rest', path: REST_PATH, query: '', assert: "'missing' in d['error']" },`
    : `{ label: ${js(`${slug}-rest-listing`)}, kind: 'rest', path: REST_PATH, query: '', assert: "'categories' in d and 'cite' in d" },`}
    // TODO: a happy-path check on a real ${param} and its cite url.
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

function testTemplate({ slug, title }) {
  return `// tests/${slug}.test.js — ${title}: data, tool, server, REST mirror, changelog entries, freshness, discovery.
// Scaffolded by scripts/new-area.js. Every expectation is read from the module and its data — tool name, params,
// REST path, cadence, previous semantics, required params — so filling the data (or renaming a param or the REST
// path in the module) needs no edits here beyond pinning real figures.
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

const AREA = AREA_MODULE.area;
const TOOL_DEF = AREA_MODULE.server.tools[0];
const TOOL = TOOL_DEF.name;
const [PARAM, ...FILTERS] = Object.keys(TOOL_DEF.inputSchema.properties); // the first names the category; the rest narrow its figures
const REST = AREA_MODULE.rest.find((r) => r.tool === TOOL);
const REST_PATH = REST.path;
const DATA = AREA_MODULE.freshness.data; // the file the module serves (data/<slug>.json or data/<slug>/<year>.json)
const CADENCE = AREA_MODULE.freshness.cadenceDays; // null = calendar-driven
const PREVIOUS = AREA_MODULE.changelog.previous === true;
const REQUIRED = (REST.required || []).includes(PARAM);
const server = router.ROUTES[\`mcp/\${AREA_MODULE.server.key || AREA}\`];
const rest = router.ROUTES[REST_PATH];
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
  assert.ok(TOOL_DEF.title.length <= 40, 'tool title within the 40-character cap');
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
    assert.equal(data.cite.url, \`https://databutler.dev/r/\${REST_PATH}\`);
    return;
  }
  const key = CATEGORIES[0];
  const { isError, data } = await callTool(server, TOOL, { [PARAM]: key });
  assert.equal(isError, false);
  assert.equal(data.covered, undefined);
  assert.equal(data.category, key);
  assert.deepEqual(data.figures, DATA.categories[key].figures);
  assert.equal(data.source, DATA.categories[key].source);
  assert.equal(data.freshness.verifiedDate, DATA.verifiedDate);
  assert.equal(data.cite.url, \`https://databutler.dev/r/\${REST_PATH}?\${PARAM}=\${encodeURIComponent(key)}\`);
  assert.match(data.cite.text, new RegExp(\`^databutler\\\\.dev, verified \${DATA.verifiedDate} against \`));
});

test('filters: each further param narrows the figures by the field of that name; an unknown value is a near-miss', async () => {
  for (const field of FILTERS) {
    const hit = FIGURES.find(({ f }) => f[field] !== undefined && f[field] !== null && f[field] !== '');
    if (!hit) continue; // TODO data: no figure carries this field yet
    const want = String(hit.f[field]).toLowerCase();
    const { data } = await callTool(server, TOOL, { [PARAM]: hit.cat, [field]: hit.f[field] });
    assert.ok(data.figures.length >= 1, \`\${field} keeps at least the figure it was read from\`);
    for (const f of data.figures) assert.equal(String(f[field]).toLowerCase(), want);
    const miss = (await callTool(server, TOOL, { [PARAM]: hit.cat, [field]: 'zzz-not-a-value' })).data;
    assert.equal(miss.covered, false);
    assert.equal(miss.field, field);
    assert.ok(Array.isArray(miss.nearest) && Array.isArray(miss.coverage));
  }
});

test('near-miss: an unknown category is covered:false with nearest keys, never an error', async () => {
  const { isError, data } = await callTool(server, TOOL, { [PARAM]: 'zzz-not-a-category' });
  assert.equal(isError, false);
  assert.equal(data.covered, false);
  assert.equal(data.requested, 'zzz-not-a-category');
  assert.ok(Array.isArray(data.nearest));
  assert.deepEqual(data.coverage, CATEGORIES);
  assert.equal(data.error, undefined);
});

test(\`REST mirror: empty query → \${REQUIRED ? '400' : 'the listing'}; otherwise the tool with envelope + cite\`, async () => {
  const empty = await get(rest, \`/api/\${REST_PATH}\`);
  if (REQUIRED) {
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, new RegExp(\`missing \\\\?\${PARAM}=\`));
  } else {
    assert.equal(empty.status, 200);
    assert.deepEqual(Object.keys(empty.body.categories), CATEGORIES);
    assert.ok(empty.body.freshness && empty.body.cite);
  }
  const miss = await get(rest, \`/api/\${REST_PATH}?\${PARAM}=zzz\`);
  assert.equal(miss.status, 200);
  assert.equal(miss.body.covered, false);
  assert.ok(miss.body.freshness && miss.body.cite);
  const viaRouter = await get(router, \`/api/router?route=\${REST_PATH}&\${PARAM}=zzz\`);
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
    if (f.key) assert.equal(e.key, \`\${cat}/\${f.key}\`, 'a figure that carries key is keyed by it');
    assert.deepEqual(e.from, PREVIOUS ? f.previous.value : null);
    assert.deepEqual(e.to, f.value);
    assert.match(e.effectiveFrom, ISO);
    assert.equal(e.verifiedDate, DATA.verifiedDate);
    assert.equal(e.note, '', 'notes are filled by scripts/changelog.js (changelog.note), never by diff()');
  }
  assert.deepEqual(AREA_MODULE.changelog.diff(DATA, DATA), [], 'nothing moved');
  if (first.length && AREA_MODULE.changelog.note) {
    const note = AREA_MODULE.changelog.note(first[0], null, DATA);
    assert.ok(note.length > 0, 'changelog.note pre-fills a note');
    assert.doesNotMatch(note, /\\{\\w+\\}/, 'every placeholder in the note template is filled');
  }
});

test('sources: each watched URL once, every category source among them', () => {
  const urls = AREA_MODULE.sources().map((s) => s.url);
  assert.equal(new Set(urls).size, urls.length);
  for (const c of Object.values(DATA.categories)) assert.ok(urls.includes(c.source), c.source);
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
  const { AREAS, restRoutes } = require('../api/_areas');
  const { ALL_TOOLS } = require('../api/_registry');
  const toolName = `${a.slug.replace(/-/g, '_')}_lookup`;
  if (AREAS.some((x) => x.area === a.slug)) throw new Error(`area "${a.slug}" already exists (api/_areas/${a.slug}.js)`);
  if (ALL_TOOLS[toolName]) throw new Error(`tool name "${toolName}" is taken`);
  const taken = restRoutes().find((r) => r.path === a.restPath);
  if (taken) throw new Error(`REST path "${a.restPath}" is taken by ${taken.area} — pass a free --rest-path`);
  const byOrder = AREAS.find((x) => x.order === a.order);
  if (byOrder) throw new Error(`--order ${a.order} is taken by ${byOrder.area} — pick a free number`);
  // Default: after every area on this branch. A parallel branch computes the same max+10, so concurrent scaffolds
  // pass distinct --order values (the loader names both areas if two ever share one).
  const order = a.order ?? Math.max(0, ...AREAS.map((x) => x.order)) + 10;
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
Scaffolded area "${a.slug}" (order ${order}${a.order === null ? ' — max+10; on a parallel branch pass --order' : ''}, tool ${toolName} {${a.params.join(', ')}} "${a.toolTitle}", REST /api/${a.restPath}${a.calendar ? `, calendar cadence, next refresh ${a.calendar}` : `, every ${a.refreshDays} days`}${L.perYear ? `, per-year layout from ${a.perYear} (year starts ${a.yearStart})` : ''}). Created:
  api/_areas/${a.slug}.js   ${L.dataFile}   tests/${a.slug}.test.js   docs/CURATION.md (section appended)
and regenerated llms.txt, sitemap.xml, .well-known/changes.json, README, CURATION calendar, index.html, verify-hub.sh, server-${a.slug}.json.

Still yours to do (docs/ADDING_AN_AREA.md) — nothing outside these four files:
  1. ${L.dataFile} — add categories { key: { title, source, figures: [{ key?, label, value, unit${a.params.length > 1 ? `, ${a.params.slice(1).join(', ')}` : ''}${a.previous ? ', previous: { value, source }' : ''} }] } } from the OFFICIAL page;
     record the page URL, its licence statement, verifiedDate${a.calendar ? ', nextScheduledRefresh (by hand)' : ''}; quote each figure in docs/CURATION.md's new section.
  2. api/_areas/${a.slug}.js — replace every TODO: short, server.description, instructions, tool description (plain statements, no imperatives),
     coverage.scope + notCovered, discovery.description, hub phrases, docs rows/lines, verify checks.
  3. tests/${a.slug}.test.js — pin the real figures in the data test; the rest derives from the module and data.
  4. node scripts/changelog.js --only ${a.slug}   → first entries: ${firstEntries}; notes pre-filled from changelog.note — review them;
     re-hashes only this area's sources (no --only re-hashes every area's and resets the Monday watcher baseline). Runs with the files above uncommitted.
     Fixed the template or the data? node scripts/changelog.js --redo ${a.slug} drops this area's uncommitted entries and re-runs.
     A page that answers 403/CAPTCHA is recorded unreachable in data/sources.json (declare it in sources() to give the reason).
  5. node scripts/sync-areas.js  → after any docs/hub/discovery edit and after step 4;  node scripts/sync-areas.js --check must pass.
  6. node --test tests/*.test.js → then UPDATE_SNAPSHOTS=1 node --test tests/snapshot.test.js and read the diff of tests/snapshots/.
  7. Commit; after deploy: bash scripts/verify-hub.sh
`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message || e); process.exit(1); }
}

module.exports = { parseArgs, moduleTemplate, dataTemplate, testTemplate, curationStub, layout, defaultToolTitle, defaultCadence, DEFAULT_NOTE, TITLE_MAX };
