// tests/protocol.test.js — the Verified Changes protocol v0.1: schemas, validator, discovery document, conforming output, /protocol page
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { invoke, callTool } = require('./helpers');
const { validate, assertValid } = require('../api/_schema_check');
const { changesSince, CHANGELOG_AREAS, COVERAGE_START, PROTOCOL, SCHEMA_URL, WELL_KNOWN_URL, PROTOCOL_URL, PUBLISHER } = require('../api/_changelog');
const { whatChangedSince, FRONT_DOOR_TOOLS } = require('../api/_hub');
const M = require('../api/_markdown');
const router = require('../api/router');
const changes = require('../api/_routes/changes');
const changesPage = require('../api/_routes/changes-page');
const protocol = require('../api/_routes/protocol');
const frontDoor = require('../api/_routes/mcp');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const get = (handler, url) => invoke(handler, undefined, { method: 'GET', url });

const DOC_SCHEMA = readJson('public/schema/changes.v0.json');
const ENTRY_SCHEMA = DOC_SCHEMA.$defs.entry;
const WK_SCHEMA = readJson('public/schema/well-known-changes.v0.json');
const WELL_KNOWN = readJson('public/.well-known/changes.json');
const CHANGELOG = readJson('data/changelog.json');
const SPEC = read('docs/CHANGES_PROTOCOL.md');
const VERCEL = readJson('vercel.json');

const ENTRY_FIELDS = ['area', 'key', 'label', 'from', 'to', 'effectiveFrom', 'source', 'verifiedDate', 'note'];
const GOOD_ENTRY = CHANGELOG.find((e) => e.key === 'fr-recalls/dataset');

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

/* ---------------- validator ---------------- */

test('validator: types, required, const/enum, pattern, min/max, items, additionalProperties', () => {
  const S = {
    type: 'object', required: ['a', 'b'], additionalProperties: false,
    properties: {
      a: { type: 'string', minLength: 2, pattern: '^[a-z]+$' },
      b: { type: ['integer', 'null'], minimum: 0, maximum: 10 },
      c: { enum: ['x', 'y'] },
      d: { const: 'fixed' },
      e: { type: 'array', minItems: 1, items: { type: 'number' } },
    },
  };
  assert.deepEqual(validate(S, { a: 'ab', b: null }), { ok: true, errors: [] });
  assert.ok(validate(S, { a: 'ab', b: 3, c: 'x', d: 'fixed', e: [1, 2.5] }).ok);
  const bad = validate(S, { a: 'A1', b: 11, c: 'z', d: 'other', e: [], f: 1 });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors, [
    '$.a: "A1" does not match ^[a-z]+$',
    '$.b: above maximum 10',
    '$.c: must be one of ["x","y"]',
    '$.d: must equal "fixed"',
    '$.e: fewer than 1 items',
    '$: unexpected property "f"',
  ]);
  assert.deepEqual(validate(S, {}).errors, ['$: missing required "a"', '$: missing required "b"']);
  assert.deepEqual(validate(S, { a: 'a', b: 1.5 }).errors, ['$.a: shorter than 2', '$.b: expected integer|null, got number']);
  assert.deepEqual(validate({ type: 'array', items: { type: 'string' } }, ['ok', 2]).errors, ['$[1]: expected string, got number']);
  assert.deepEqual(validate({ type: 'object' }, []).errors, ['$: expected object, got array']);
  assert.ok(validate({ type: 'number' }, 3).ok); // integers are numbers
  assert.ok(validate({ properties: { x: { type: 'string' } } }, { x: 'a', y: 1 }).ok, 'additional properties allowed by default');
});

test('validator: formats — real calendar dates, date-time, http(s)/mailto URIs', () => {
  const date = { type: 'string', format: 'date' };
  for (const ok of ['2026-10-03', '2024-02-29']) assert.ok(validate(date, ok).ok, ok);
  for (const bad of ['2026-02-30', '2023-02-29', '2026-13-01', '2026-1-1', '2026-10-03T00:00:00Z', 'yesterday']) assert.equal(validate(date, bad).ok, false, bad);
  const dt = { type: 'string', format: 'date-time' };
  for (const ok of ['2026-10-03T13:30:49.286Z', '2026-10-03T13:30Z', '2026-10-03T13:30:00+01:00']) assert.ok(validate(dt, ok).ok, ok);
  for (const bad of ['2026-10-03', '2026-10-03 13:30', '2026-10-03T25:00Z']) assert.equal(validate(dt, bad).ok, false, bad);
  const uri = { type: 'string', format: 'uri' };
  for (const ok of ['https://www.gov.uk/income-tax-rates', 'http://localhost:3000/x', 'mailto:hello@example.com']) assert.ok(validate(uri, ok).ok, ok);
  for (const bad of ['ftp://x', 'javascript:alert(1)', 'www.gov.uk', '']) assert.equal(validate(uri, bad).ok, false, bad);
  assert.match(validate(date, '2026-02-30').errors[0], /is not a valid date/);
  assert.throws(() => validate({ type: 'string', format: 'email' }, 'x'), /unsupported format/);
});

test('validator: $ref into $defs, unsupported refs throw, assertValid lists every problem', () => {
  const S = { type: 'object', properties: { e: { $ref: '#/$defs/thing' }, list: { type: 'array', items: { $ref: '#/$defs/thing' } } }, $defs: { thing: { type: 'object', required: ['k'], properties: { k: { type: 'string' } } } } };
  assert.ok(validate(S, { e: { k: 'a' }, list: [{ k: 'b' }] }).ok);
  assert.deepEqual(validate(S, { e: {}, list: [{ k: 1 }] }).errors, ['$.e: missing required "k"', '$.list[0].k: expected string, got number']);
  assert.throws(() => validate({ $ref: '#/definitions/x' }, {}), /unsupported \$ref/);
  assert.throws(() => validate({ $ref: 'https://elsewhere/schema.json' }, {}), /unsupported \$ref/);
  assert.throws(() => assertValid(S, { e: {} }, 'sample'), /sample does not validate:\n {2}\$\.e: missing required "k"/);
  const v = { e: { k: 'a' } };
  assert.equal(assertValid(S, v), v, 'assertValid returns the value for chaining');
});

/* ---------------- the published schemas ---------------- */

test('schemas: draft 2020-12, $id = served URL, entry requires exactly the nine protocol fields', () => {
  for (const [s, id] of [[DOC_SCHEMA, SCHEMA_URL], [WK_SCHEMA, 'https://databutler.dev/schema/well-known-changes.v0.json']]) {
    assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(s.$id, id);
    assert.equal(s.properties.protocol.const, PROTOCOL);
    assert.match(s.description, /databutler\.dev\/protocol/);
  }
  assert.deepEqual(DOC_SCHEMA.required, ['protocol', 'publisher', 'generated', 'entries']);
  assert.deepEqual(ENTRY_SCHEMA.required, ENTRY_FIELDS);
  assert.deepEqual(DOC_SCHEMA.properties.entries.items, { $ref: '#/$defs/entry' });
  assert.deepEqual(WK_SCHEMA.required, ['protocol', 'publisher', 'areas', 'endpoints', 'schema']);
  assert.deepEqual(WK_SCHEMA.properties.endpoints.required, ['json']);
  assert.deepEqual(Object.keys(WK_SCHEMA.properties.endpoints.properties), ['json', 'html', 'rss', 'atom', 'mcp']);
  assert.deepEqual(WK_SCHEMA.properties.areas.items.required, ['name', 'description', 'cadence']);
  // the schema files are static under public/ so the URLs resolve without a rewrite
  assert.ok(fs.existsSync(path.join(ROOT, 'public', new URL(SCHEMA_URL).pathname)));
  assert.equal(PROTOCOL, 'verified-changes/0.1');
  assert.equal(SCHEMA_URL, 'https://databutler.dev/schema/changes.v0.json');
  assert.equal(WELL_KNOWN_URL, 'https://databutler.dev/.well-known/changes.json');
});

test('entry schema: every live changelog entry validates; each protocol rule has a negative', () => {
  for (const e of CHANGELOG) assertValid(ENTRY_SCHEMA, e, e.key);
  assert.ok(validate(ENTRY_SCHEMA, { ...GOOD_ENTRY, from: 1663, to: 1700, unit: 'fiches', taxYear: '2026-27' }).ok, 'extra context fields allowed');
  assert.ok(validate(ENTRY_SCHEMA, { ...GOOD_ENTRY, effectiveFrom: null, to: null, from: ['a', 'b'] }).ok, 'null effectiveFrom, null to (withdrawn), array values');
  const broken = (patch) => validate(ENTRY_SCHEMA, { ...GOOD_ENTRY, ...patch }).errors;
  for (const f of ENTRY_FIELDS) {
    const e = { ...GOOD_ENTRY }; delete e[f];
    assert.deepEqual(validate(ENTRY_SCHEMA, e).errors, [`$: missing required "${f}"`], f);
  }
  assert.match(broken({ area: 'UK Rates' })[0], /\$\.area/);
  assert.match(broken({ key: '/leading-slash' })[0], /\$\.key/);
  assert.match(broken({ key: 'spaces not allowed' })[0], /\$\.key/);
  assert.ok(validate(ENTRY_SCHEMA, { ...GOOD_ENTRY, key: 'income-tax/personal-allowance' }).ok);
  assert.ok(validate(ENTRY_SCHEMA, { ...GOOD_ENTRY, key: '8463/paper-1/topics' }).ok);
  assert.deepEqual(broken({ label: '' }), ['$.label: shorter than 1']);
  assert.deepEqual(broken({ effectiveFrom: '2026-02-30' }), ['$.effectiveFrom: "2026-02-30" is not a valid date']);
  assert.deepEqual(broken({ verifiedDate: '03/10/2026' }), ['$.verifiedDate: "03/10/2026" is not a valid date']);
  assert.deepEqual(broken({ source: 'rappel.conso.gouv.fr' }), ['$.source: "rappel.conso.gouv.fr" is not a valid uri']);
  assert.deepEqual(broken({ note: null }), ['$.note: expected string, got null']);
  assert.deepEqual(broken({ unit: 5 }), ['$.unit: expected string|null, got number']);
});

/* ---------------- discovery document ---------------- */

test('/.well-known/changes.json: validates, matches the code (areas, coverage, schema, publisher), endpoints resolve to router routes', async () => {
  assertValid(WK_SCHEMA, WELL_KNOWN, '.well-known/changes.json');
  assert.equal(WELL_KNOWN.protocol, PROTOCOL);
  assert.deepEqual(WELL_KNOWN.publisher, PUBLISHER);
  assert.deepEqual(WELL_KNOWN.areas.map((a) => a.name), CHANGELOG_AREAS, 'areas[] must track CHANGELOG_AREAS');
  for (const a of WELL_KNOWN.areas) { assert.ok(a.description.length > 40, a.name); assert.ok(a.cadence.length > 5, a.name); }
  assert.equal(WELL_KNOWN.coverageStart, COVERAGE_START);
  assert.equal(WELL_KNOWN.schema, SCHEMA_URL);
  assert.equal(WELL_KNOWN.specification, PROTOCOL_URL);
  assert.match(WELL_KNOWN.updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(WELL_KNOWN.licence, /attribution/i);
  assert.match(WELL_KNOWN.contact, /^https:\/\/github\.com\/physics-star-cat\/databutler\/issues$/);

  const { endpoints } = WELL_KNOWN;
  assert.equal(endpoints.json, 'https://databutler.dev/api/changes');
  assert.equal(routeOf(rewriteFor(new URL(endpoints.json).pathname).destination), 'changes');
  assert.equal(routeOf(rewriteFor(new URL(endpoints.html).pathname).destination), 'changes-page');
  assert.equal(rewriteFor(new URL(endpoints.rss).pathname).destination, '/api/router?route=changes-feed&format=rss');
  assert.equal(rewriteFor(new URL(endpoints.atom).pathname).destination, '/api/router?route=changes-feed&format=atom');
  assert.equal(routeOf(rewriteFor(new URL(endpoints.mcp.url).pathname).destination), 'mcp');
  for (const r of ['changes', 'changes-page', 'changes-feed', 'mcp']) assert.ok(router.ROUTES[r], r);
  assert.equal(endpoints.mcp.tool, whatChangedSince.name);
  assert.ok(FRONT_DOOR_TOOLS.some((t) => t.name === endpoints.mcp.tool), 'tool listed on the front door');

  // every endpoint answers through the router with the media type the spec names
  const json = await get(router, `/api/router?route=changes&since=${COVERAGE_START}`);
  assert.equal(json.status, 200); assert.match(json.headers['Content-Type'], /application\/json/);
  const html = await get(router, '/api/router?route=changes-page');
  assert.equal(html.status, 200); assert.match(html.headers['Content-Type'], /text\/html/);
  assert.equal((await get(router, '/api/router?route=changes-feed&format=rss')).headers['Content-Type'], 'application/rss+xml; charset=utf-8');
  assert.equal((await get(router, '/api/router?route=changes-feed&format=atom')).headers['Content-Type'], 'application/atom+xml; charset=utf-8');
  const list = await invoke(router, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { url: '/api/router?route=mcp' });
  assert.ok(list.body.result.tools.some((t) => t.name === 'what_changed_since'));
});

test('static protocol files are not captured by any vercel.json rewrite', () => {
  for (const p of ['/.well-known/changes.json', '/schema/changes.v0.json', '/schema/well-known-changes.v0.json']) {
    assert.equal(rewriteFor(p), undefined, `${p} must be served from public/ untouched`);
    assert.ok(fs.existsSync(path.join(ROOT, 'public', p)), `${p} exists under public/`);
  }
  // sanity: the matcher does see the rewrites that should match
  assert.equal(rewriteFor('/api/changes').source, '/api/(.+)');
  assert.equal(rewriteFor('/changes').source, '/changes');
  assert.equal(rewriteFor('/protocol').source, '/protocol');
});

/* ---------------- conforming output ---------------- */

test('GET /api/changes: a Verified Changes document inside the unchanged envelope', async () => {
  const r = await get(changes, '/api/changes?since=2026-06-01&area=vehicles');
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.protocol, PROTOCOL);
  assert.equal(b.schema, SCHEMA_URL);
  assert.deepEqual(b.publisher, PUBLISHER);
  assert.match(b.generated, /^\d{4}-\d{2}-\d{2}$/);
  assertValid(DOC_SCHEMA, b, '/api/changes response');
  // envelope intact
  assert.equal(b.attribution, 'databutler.dev');
  assert.equal(b.freshness.staleness, 'live');
  assert.equal(b.cite.url, 'https://databutler.dev/r/changes?since=2026-06-01&area=vehicles');
  assert.equal(b.count, 3); assert.equal(b.entries.length, 3);
  assert.deepEqual(b.areasCovered, CHANGELOG_AREAS);
  // protocol keys come first in the document, before the query echo
  const keys = Object.keys(b);
  assert.ok(keys.indexOf('protocol') < keys.indexOf('since') && keys.indexOf('generated') < keys.indexOf('entries'));
  // same day → identical bytes (what the existing format=json test relies on)
  assert.equal(JSON.stringify((await get(changes, '/api/changes?since=2026-06-01&area=vehicles')).body), JSON.stringify(b));
  // the error branch is not a document and says so without the protocol keys
  const bad = await get(changes, '/api/changes?since=yesterday');
  assert.equal(bad.body.covered, false); assert.equal(bad.body.protocol, undefined);
});

test('what_changed_since (MCP) returns the same document; changesSince is deterministic for a given day', async () => {
  const { isError, data } = await callTool(frontDoor, 'what_changed_since', { since: '2026-06-01', area: 'vehicles' });
  assert.equal(isError, false);
  assert.equal(data.protocol, PROTOCOL); assert.equal(data.schema, SCHEMA_URL); assert.deepEqual(data.publisher, PUBLISHER);
  assertValid(DOC_SCHEMA, data, 'what_changed_since result');
  const rest = (await get(changes, '/api/changes?since=2026-06-01&area=vehicles')).body;
  assert.deepEqual(data.entries, rest.entries);
  const fixed = changesSince({ since: '2026-06-01' }, CHANGELOG, new Date('2026-12-25T23:59:00Z'));
  assert.equal(fixed.generated, '2026-12-25');
  assert.deepEqual(fixed, changesSince({ since: '2026-06-01' }, CHANGELOG, new Date('2026-12-25T00:00:01Z')));
  assertValid(DOC_SCHEMA, changesSince({ since: '2020-01-01' }), 'pre-coverage document');
  assert.match(whatChangedSince.description, /verified-changes\/0\.1/);
  assert.match(whatChangedSince.description, /databutler\.dev\/protocol/);
});

/* ---------------- /protocol page ---------------- */

test('/protocol: registered, rewritten before /api/(.+), spec file bundled with the function', () => {
  assert.ok(router.ROUTES.protocol);
  assert.equal(protocol.SPEC_PATH, path.join(ROOT, 'docs', 'CHANGES_PROTOCOL.md'));
  const idx = (source) => VERCEL.rewrites.findIndex((r) => r.source === source);
  assert.equal(VERCEL.rewrites[idx('/protocol')].destination, '/api/router?route=protocol');
  assert.ok(idx('/protocol') >= 0 && idx('/protocol') < idx('/api/(.+)'), '/protocol before the generic rewrite');
  assert.match(VERCEL.functions['api/router.js'].includeFiles, /docs\/CHANGES_PROTOCOL\.md/); // the kit also bundles api/_areas/** and data/** (wildcard require)
});

test('/protocol: indexable HTML of the spec with every section, cached like /changes; ?format=md is the file', async () => {
  const r = await get(router, '/api/router?route=protocol');
  assert.equal(r.status, 200);
  assert.equal(r.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['Cache-Control'], 'public, max-age=300, s-maxage=3600');
  assert.equal(r.headers['Access-Control-Allow-Origin'], '*');
  const html = String(r.raw);
  assert.doesNotMatch(html, /noindex/);
  assert.match(html, /<title>Verified Changes protocol, v0\.1 — Data Butler<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/databutler\.dev\/protocol">/);
  assert.match(html, /<meta name="description" content="A small, open convention[^"]{20,200}">/);
  assert.match(html, /<link rel="alternate" type="text\/markdown" href="https:\/\/databutler\.dev\/protocol\?format=md">/);
  assert.match(html, /<h1 id="verified-changes-protocol-v0-1">Verified Changes protocol, v0\.1<\/h1>/);
  assert.deepEqual([...html.matchAll(/<h2 id="([^"]+)">/g)].map((m) => m[1]),
    ['purpose', 'entry-schema', 'discovery', 'transports', 'freshness-envelope', 'verification-rule', 'conformance', 'versioning']);
  assert.match(html, /<code>verified-changes\/0\.1<\/code>/);
  assert.match(html, /href="https:\/\/databutler\.dev\/\.well-known\/changes\.json"/);
  assert.match(html, /href="https:\/\/databutler\.dev\/schema\/changes\.v0\.json"/);
  assert.match(html, /<pre><code class="language-json">\{\n\s+&quot;area&quot;: &quot;vehicles&quot;,\n\s+&quot;key&quot;: &quot;fr-recalls\/dataset&quot;/);
  assert.match(html, /<ol><li><strong>Fetch before publish\.<\/strong>/);
  assert.match(html, /<a href="\/changes">\/changes<\/a>/);
  assert.equal(String((await get(router, '/api/router?route=protocol')).raw), html, 'byte-stable');
  const md = await get(router, '/api/router?route=protocol&format=md');
  assert.equal(md.headers['Content-Type'], 'text/markdown; charset=utf-8');
  assert.equal(String(md.raw), SPEC);
});

test('the spec: required sections, under budget, and its JSON examples are the real artefacts', () => {
  const h2 = M.headings(SPEC).filter((h) => h.level === 2).map((h) => h.text);
  assert.deepEqual(h2, ['Purpose', 'Entry schema', 'Discovery', 'Transports', 'Freshness envelope', 'Verification rule', 'Conformance', 'Versioning']);
  const prose = SPEC.split('\n').reduce((acc, l) => { if (/^```/.test(l)) acc.inCode = !acc.inCode; else if (!acc.inCode) acc.words += l.split(/\s+/).filter(Boolean).length; return acc; }, { inCode: false, words: 0 }).words;
  assert.ok(prose > 1200 && prose < 2500, `spec prose is ${prose} words`);
  for (const must of [
    /training cutoff/, /`null` means the fact is new/,
    /`effectiveFrom` and `verifiedDate` answer different questions/, /never edited or deleted/, /`area` \+ `key` \+ `verifiedDate`/,
    /\/\.well-known\/changes\.json/, /`verifiedDate > since` or `effectiveFrom > since`/, /newest `verifiedDate` first/,
    /`guid` \(RSS\) and `id` \(Atom\) are the entry's permalink/, /`what_changed_since`/, /`fresh` \(before/, /`due`/, /`overdue`/, /`live`/,
    /Fetch before publish/, /Mondays 06:00 UTC/, /^1\. `GET \/\.well-known\/changes\.json`/m, /^10\. /m, /call `endpoints\.json` \(or the MCP tool\) once with `since` set to your training cutoff/,
    /`verified-changes\/<major>\.<minor>`/,
  ]) assert.match(SPEC, must, String(must));
  // every ```json block parses; the discovery example IS the served file; the entry example IS the live entry
  const blocks = [...SPEC.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.ok(blocks.length >= 5);
  const disc = blocks.find((b) => b.areas);
  assert.deepEqual(disc, WELL_KNOWN, 'discovery example in the spec must equal public/.well-known/changes.json');
  const entry = blocks.find((b) => b.key === 'fr-recalls/dataset');
  assert.deepEqual(entry, GOOD_ENTRY, 'entry example must be the live changelog entry');
  const doc = blocks.find((b) => b.entries);
  assertValid(DOC_SCHEMA, doc, 'transport example');
  assert.equal(doc.cite.url, 'https://databutler.dev/r/changes?since=2026-10-01&area=vehicles');
  const env = blocks.find((b) => b.freshness && !b.entries);
  assert.deepEqual(Object.keys(env.freshness), ['verifiedDate', 'nextScheduledRefresh', 'staleness']);
  assert.ok(['fresh', 'due', 'overdue', 'live'].includes(env.freshness.staleness));
});

/* ---------------- markdown renderer ---------------- */

test('markdown renderer: headings with ids, lists, fenced code, inline code protects its content, safe links only, escaping', () => {
  const html = M.renderMarkdown([
    '# Title `x`', '', 'A **bold** [link](/protocol) and [ext](https://example.com/a?b=1&c=2) and `code **not bold** [no](x)` & <b>.',
    '', '- one', '- two', '  continued', '', '1. first', '2. second', '', '```json', '{"a": "<x>"}', '```', '', '---', '## Sub heading', 'text [bad](javascript:alert(1))',
  ].join('\n'));
  assert.match(html, /^<h1 id="title-x">Title <code>x<\/code><\/h1>\n/);
  assert.match(html, /<p>A <strong>bold<\/strong> <a href="\/protocol">link<\/a> and <a href="https:\/\/example\.com\/a\?b=1&amp;c=2">ext<\/a> and <code>code \*\*not bold\*\* \[no\]\(x\)<\/code> &amp; &lt;b&gt;\.<\/p>/);
  assert.match(html, /<ul><li>one<\/li><li>two continued<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<pre><code class="language-json">\{&quot;a&quot;: &quot;&lt;x&gt;&quot;\}<\/code><\/pre>/);
  assert.match(html, /<hr>\n<h2 id="sub-heading">Sub heading<\/h2>\n<p>text \[bad\]\(javascript:alert\(1\)\)<\/p>$/);
  assert.doesNotMatch(html, /<script|href="javascript/);
  assert.deepEqual(M.summary('# T\n\nFirst **para** `c`.\n\nSecond.'), { title: 'T', description: 'First para c.' });
  assert.ok(M.summary(`# T\n\n${'Long sentence. '.repeat(30)}`).description.length <= 201);
  assert.equal(M.renderMarkdown('```\nunclosed'), '<pre><code>unclosed</code></pre>');
});

/* ---------------- discoverability ---------------- */

test('discoverability: sitemap, robots, llms.txt, README, CURATION, /api index, /changes footer, index.html', async () => {
  assert.match(read('public/sitemap.xml'), /<url><loc>https:\/\/databutler\.dev\/protocol<\/loc><\/url>/);
  const robots = read('public/robots.txt');
  assert.match(robots, /^Allow: \/protocol$/m); assert.match(robots, /^Allow: \/\.well-known\/changes\.json$/m); assert.match(robots, /^Allow: \/schema\/$/m);
  const llms = read('public/llms.txt');
  assert.match(llms, /https:\/\/databutler\.dev\/\.well-known\/changes\.json` — Verified Changes protocol discovery document/);
  assert.match(llms, /https:\/\/databutler\.dev\/protocol/); assert.match(llms, /schema\/changes\.v0\.json/);
  assert.match(read('README.md'), /^### The Verified Changes protocol \(v0\.1\)$/m);
  assert.match(read('docs/CURATION.md'), /Verified Changes protocol v0\.1/);
  const api = await get(require('../api/index'), '/api');
  assert.match(api.body.endpoints['GET /protocol'].description, /Verified Changes protocol v0\.1/);
  assert.ok(api.body.endpoints['GET /.well-known/changes.json']); assert.ok(api.body.endpoints['GET /schema/changes.v0.json']);
  assert.deepEqual(api.body.protocol, { name: PROTOCOL, specification: PROTOCOL_URL, discovery: WELL_KNOWN_URL, schema: SCHEMA_URL });
  const page = String((await get(changesPage, '/api/changes-page')).raw);
  assert.match(page, /<footer[\s\S]*<a href="\/protocol">Verified Changes protocol<\/a> \(verified-changes\/0\.1\)[\s\S]*href="\/\.well-known\/changes\.json"/);
  assert.match(read('public/index.html'), /<footer[\s\S]*<a href="\/protocol">protocol<\/a>/);
});
