/**
 * The area kit's loader: every api/_areas/<area>.js is one curated area, and
 * everything else — registry servers, coverage, freshness, changelog areas,
 * router routes, citation routes, /api index, hub descriptions, discovery
 * document, llms.txt, sitemap, README catalogue, verify-hub checks — derives
 * from the list this module returns. The contract is api/_areas/README.md.
 *
 * `require('./_areas/' + file)` is a wildcard require on purpose: Vercel's file
 * tracer (@vercel/nft) globs the directory for it, so every module ships in the
 * router and index functions without being named anywhere.
 */
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '_areas');
const SLUG = /^[a-z][a-z0-9-]*$/;

function fail(file, msg) {
  throw new Error(`api/_areas/${file}: ${msg} (contract: api/_areas/README.md)`);
}

function validate(m, file) {
  const expectArea = file.replace(/\.js$/, '');
  if (!m || typeof m !== 'object') fail(file, 'must export one object');
  if (m.area !== expectArea) fail(file, `area must be "${expectArea}" (the file name)`);
  if (!SLUG.test(m.area)) fail(file, 'area must be a lowercase slug');
  if (typeof m.order !== 'number') fail(file, 'order (number) is required — it fixes the public ordering');
  if (typeof m.title !== 'string' || !m.title) fail(file, 'title is required');
  if (typeof m.short !== 'string' || !m.short) fail(file, 'short (noun phrase for prose lists) is required');
  if (m.server !== null) {
    const s = m.server;
    if (!s || typeof s !== 'object') fail(file, 'server must be an object or null');
    if (typeof s.description === 'string' && s.description.length > 100) fail(file, `server.description is ${s.description.length} chars; the MCP Registry rejects more than 100`);
    for (const k of ['serverName', 'url', 'instructions', 'description']) if (typeof s[k] !== 'string' || !s[k]) fail(file, `server.${k} is required${k === 'description' ? ' (one sentence for the server-<key>.json registry manifest, written by scripts/sync-areas.js)' : ''}`);
    if (!Array.isArray(s.tools) || !s.tools.length) fail(file, 'server.tools must be a non-empty array');
    for (const t of s.tools) {
      if (!t.name || !t.title || !t.description || !t.inputSchema) fail(file, `tool ${t.name || '?'} needs name, title, description, inputSchema`);
      if (typeof t.run !== 'function') fail(file, `tool ${t.name} needs run(args)`);
      if (typeof t.cite !== 'function') fail(file, `tool ${t.name} needs cite(args) → { path, query }`);
      if (typeof t.freshness !== 'string') fail(file, `tool ${t.name} needs freshness (dataset key or "live")`);
    }
  }
  if (typeof m.coverage !== 'function') fail(file, 'coverage() is required and must return an object with notCovered');
  if (m.freshness !== 'live') {
    const list = Array.isArray(m.freshness) ? m.freshness : [m.freshness];
    for (const d of list) {
      if (!d || typeof d.dataFile !== 'string') fail(file, 'freshness needs dataFile (or "live")');
      if (d.cadenceDays !== null && typeof d.cadenceDays !== 'number') fail(file, 'freshness.cadenceDays must be a number or null (calendar-driven)');
      if (!d.data || typeof d.data !== 'object') fail(file, `freshness.data must be the parsed ${d.dataFile}`);
      if (!d.data.verifiedDate || !d.data.nextScheduledRefresh) fail(file, `${d.dataFile} needs verifiedDate and nextScheduledRefresh`);
    }
    if (Array.isArray(m.freshness)) for (const d of list) if (!d.key) fail(file, 'each dataset in a freshness array needs a key');
  }
  if (m.changelog !== null) {
    const c = m.changelog;
    if (!c || typeof c !== 'object') fail(file, 'changelog must be an object or null');
    if (c.diff !== null && typeof c.diff !== 'function') fail(file, 'changelog.diff must be a function or null');
    if (c.diff === null && typeof c.script !== 'string') fail(file, 'a changelog without diff() must name the script that writes its entries');
    if (c.diff === null && typeof c.datasetKeys !== 'function') fail(file, 'a script-driven changelog needs datasetKeys() → the keys of the entries its first derivation wrote (tests/changes-page.test.js checks the live changelog against them)');
    if (c.note !== undefined && typeof c.note !== 'function') fail(file, 'changelog.note must be a function (entry, prev, next) → string — see noteTemplate in api/_area_kit.js');
    if (c.previous !== undefined && typeof c.previous !== 'boolean') fail(file, 'changelog.previous must be true or false (does diff() use previous.value for first appearances?)');
    if (!m.discovery || typeof m.discovery.description !== 'string' || typeof m.discovery.cadence !== 'string') fail(file, 'a changelog area needs discovery { description, cadence }');
    if (m.discovery.description.length <= 40) fail(file, 'discovery.description must say more than 40 characters');
    if (m.discovery.cadence.length <= 5) fail(file, 'discovery.cadence must be stated');
  } else if (m.discovery) fail(file, 'discovery only applies to changelog areas');
  if (typeof m.sources !== 'function') fail(file, 'sources() → [{ url, label }] is required (return [] when nothing is watched)');
  if (!Array.isArray(m.rest)) fail(file, 'rest must be an array');
  const toolNames = new Set(m.server ? m.server.tools.map((t) => t.name) : []);
  for (const r of m.rest) {
    if (typeof r.path !== 'string' || !r.path) fail(file, 'each rest entry needs path');
    if (r.handler) { if (typeof r.handler !== 'string') fail(file, `rest ${r.path}: handler names a file under api/_routes/`); continue; }
    if (!toolNames.has(r.tool)) fail(file, `rest ${r.path}: tool "${r.tool}" is not one of this area's tools`);
    if (typeof r.args !== 'function') fail(file, `rest ${r.path}: args(q) is required`);
  }
  if (m.cite && typeof m.cite !== 'object') fail(file, 'cite must be an object of { path: { tool, args } }');
  if (!m.hub || typeof m.hub.coverage !== 'string' || typeof m.hub.catalogue !== 'string') fail(file, 'hub { coverage, catalogue } phrases are required');
  if (m.changelog && typeof m.hub.changed !== 'string') fail(file, 'a changelog area needs hub.changed (phrase for what_changed_since)');
  const d = m.docs;
  if (!d || !d.readme || typeof d.readme.roadmapRow !== 'string' || typeof d.readme.catalogueRow !== 'string') fail(file, 'docs.readme { roadmapRow, catalogueRow } required');
  if (/^\|\s*[0-9]+[a-z]?\s*\|/.test(d.readme.roadmapRow)) fail(file, 'docs.readme.roadmapRow starts at the Vertical cell — scripts/sync-areas.js numbers the rows from `order`');
  if (d.readme.retires !== undefined && (typeof d.readme.retires !== 'string' || !d.readme.retires)) fail(file, 'docs.readme.retires names the # of the README planned-table row this area replaces');
  if (!d.llms || !Array.isArray(d.llms.rest) || (m.server && typeof d.llms.server !== 'string')) fail(file, 'docs.llms { rest: [], server } required');
  if (!Array.isArray(d.curation)) fail(file, 'docs.curation (refresh-calendar rows, may be []) required');
  if (typeof d.api !== 'function') fail(file, 'docs.api() → { endpoints, coverage?, mcp? } required');
  if (!Array.isArray(m.verify)) fail(file, 'verify must be an array');
  for (const v of m.verify) {
    if (!v.label || !v.assert || !['tool', 'rest'].includes(v.kind)) fail(file, 'each verify check needs label, kind (tool|rest), assert');
    if (/["$`\\]/.test(v.assert)) fail(file, `verify ${v.label}: assert must not contain " $ \` or \\ (it is embedded in bash)`);
    if (v.kind === 'tool' && (!v.tool || typeof v.args !== 'object')) fail(file, `verify ${v.label}: tool checks need tool and args`);
    if (v.kind === 'rest' && typeof v.path !== 'string') fail(file, `verify ${v.label}: rest checks need path (and query)`);
  }
}

/**
 * A script-driven area (changelog.script) requires the data file its script writes. On the
 * script's first derivation that file does not exist yet, and anything that loads the areas
 * (api/_changelog, the router) would fail before the script could write it. So when a module's
 * require fails on a missing file under data/ AND its source names a changelog script, the area
 * is left out and listed in UNAVAILABLE with the reason; any other load failure still throws.
 */
function missingScriptData(e, file, dir) {
  if (!e || e.code !== 'MODULE_NOT_FOUND') return null;
  const missing = (String(e.message).match(/Cannot find module '([^']+)'/) || [])[1] || '';
  if (!/(^|\/)data\//.test(missing)) return null;
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  const script = (src.match(/script:\s*['"`]([^'"`]+)['"`]/) || [])[1];
  if (!script) return null;
  const rel = missing.replace(/^(\.\.\/)+/, '');
  return {
    area: file.replace(/\.js$/, ''), script, missing: rel,
    error: `api/_areas/${file}: ${rel} does not exist yet — run \`node ${script}\` (its first derivation writes it); the area is unavailable until then`,
  };
}

function loadAreas(dir = DIR) {
  const unavailable = [];
  const areas = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .flatMap((f) => {
      let m;
      try {
        // The literal './_areas/' + f keeps the wildcard require Vercel's tracer globs (header); other dirs are tests.
        m = dir === DIR ? require('./_areas/' + f) : require(path.join(dir, f));
      } catch (e) {
        const u = missingScriptData(e, f, dir);
        if (!u) throw e;
        unavailable.push(u);
        return [];
      }
      validate(m, f);
      return [m];
    })
    .sort((a, b) => a.order - b.order || a.area.localeCompare(b.area));
  const seen = new Map();
  for (const a of areas) {
    if (seen.has(a.order)) {
      const free = a.order + 5;
      throw new Error(
        `api/_areas: ${seen.get(a.order)} and ${a.area} share order ${a.order}. Two areas scaffolded on parallel branches both took ` +
        `max+10 — give one a free number (e.g. order: ${free} in api/_areas/${a.area}.js) and run node scripts/sync-areas.js; ` +
        'a scaffold that may race another branch should pass --order N to scripts/new-area.js',
      );
    }
    seen.set(a.order, a.area);
  }
  return { areas, unavailable };
}

const { areas: AREAS, unavailable: UNAVAILABLE } = loadAreas();
for (const u of UNAVAILABLE) console.warn(u.error);

const BY_KEY = Object.fromEntries(AREAS.map((a) => [a.area, a]));

/** Focused MCP servers, keyed, in area order. The server key defaults to the area slug. */
function servers() {
  const out = {};
  for (const a of AREAS) if (a.server) out[a.server.key || a.area] = a.server;
  return out;
}

/** Every committed dataset: { key, dataFile, cadenceDays, data, area, large }. */
function datasets() {
  const out = [];
  for (const a of AREAS) {
    if (a.freshness === 'live') continue;
    const list = Array.isArray(a.freshness) ? a.freshness : [{ key: a.area, ...a.freshness }];
    for (const d of list) out.push({ key: d.key || a.area, dataFile: d.dataFile, cadenceDays: d.cadenceDays, data: d.data, area: a.area, large: d.large || null });
  }
  return out;
}

const changelogAreas = () => AREAS.filter((a) => a.changelog).map((a) => a.area);
const discovery = () => AREAS.filter((a) => a.changelog).map((a) => ({ name: a.area, description: a.discovery.description, cadence: a.discovery.cadence }));

/** REST mirrors in area order, each with the derived GA4 event name. */
function restRoutes() {
  return AREAS.flatMap((a) => a.rest.map((r) => ({ area: a.area, event: `agent_api_${r.path.replace(/[/-]/g, '_')}`, ...r })));
}

/**
 * Citation (/r/<path>) routes: one per REST mirror by default (same tool, same
 * args, numeric coercion applied), with the area's `cite` overrides on top.
 */
function citeRoutes() {
  const { coerceNumeric } = require('./_area_kit');
  const out = {};
  for (const a of AREAS) {
    for (const r of a.rest) if (!r.handler) out[r.path] = { tool: r.tool, args: (q) => coerceNumeric(r.args(q), r.numeric || []), area: a.area };
    for (const [p, c] of Object.entries(a.cite || {})) out[p] = { ...c, area: a.area };
  }
  return out;
}

/** Watched source pages, deduped by URL, in area order (the first area to list a URL owns it); entries may carry `unreachable`. */
function sourceList() {
  const seen = new Map();
  for (const a of AREAS) {
    for (const s of a.sources()) {
      if (!s || !s.url) continue;
      const had = seen.get(s.url);
      if (!had) seen.set(s.url, { ...s, area: a.area });
      else if (s.unreachable && !had.unreachable) had.unreachable = s.unreachable; // any area's declaration counts
    }
  }
  return [...seen.values()];
}
const sourceUrls = () => sourceList().map((s) => s.url);

/** Tools flagged frontDoor: true, in area order — the front door's directly listed set. */
function frontDoorTools() {
  return AREAS.flatMap((a) => (a.server ? a.server.tools.filter((t) => t.frontDoor).map((t) => t.name) : []));
}

/** hub.<kind> phrase per area that has one, in area order. */
const hubPhrases = (kind, filter = () => true) => AREAS.filter((a) => filter(a) && a.hub && a.hub[kind]).map((a) => a.hub[kind]);

module.exports = {
  AREAS, UNAVAILABLE, loadAreas, BY_KEY, servers, datasets, changelogAreas, discovery, restRoutes, citeRoutes, sourceList, sourceUrls, frontDoorTools, hubPhrases, DIR,
};
