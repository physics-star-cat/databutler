# Area modules — the contract

One file here is one curated area. `api/_areas.js` loads every `*.js` in this
directory (the directory starts with an underscore, so Vercel never deploys it
as functions), validates it against the contract below, sorts by `order`, and
everything else derives from the list: registry servers and `ALL_TOOLS`,
coverage, freshness datasets, changelog areas and diff dispatch, router routes
(`mcp/<server>` and REST mirrors), the `/r` citation table, the `/api` index,
the front door's listed tools and hub descriptions, the source watcher's URL
list, and — through `node scripts/sync-areas.js` — `public/llms.txt`,
`public/sitemap.xml`, `public/.well-known/changes.json`, the spec's discovery
example, the README roadmap/catalogue, the CURATION refresh calendar,
`public/index.html` and `scripts/verify-hub.sh`.

Start a new one with `node scripts/new-area.js <slug> --title "…" --cadence "…"`
(docs/ADDING_AN_AREA.md). Shared helpers live in `api/_area_kit.js`; a module
must never require `_registry`, `_hub`, `_changelog`, `_coverage`, `_freshness`,
`_envelope`, `_rest` or `_areas` (they require this directory — a cycle).

```js
module.exports = {
  area: 'policy-rates',          // slug; must equal the file name
  order: 80,                     // fixes the public ordering (catalogue, coverage, changelog areas, docs); unique
  title: 'Policy rates',         // human label
  short: 'central-bank policy rates',   // noun phrase for prose lists (index.html, /api index)

  server: {                      // null for an area with no MCP server of its own
    key: 'policy-rates',         // optional; defaults to `area` → POST /api/mcp/<key>
    serverName: 'databutler-policy-rates',
    url: `${BASE}/api/mcp/policy-rates`,
    instructions: '…',           // MCP initialize.instructions
    tools: [{                    // MCP tool shape plus:
      name, title, description, inputSchema,
      run: (args) => result,     // sync or async; never throws for a near-miss — returns covered:false + nearest
      freshness: 'policy-rates', // a dataset key below, or 'live'
      cite: (args) => ({ path: 'policy-rates', query: { bank: args.bank } }),  // → https://databutler.dev/r/<path>?…
      openWorld: true,           // optional: fetches live external data → annotations.openWorldHint
      frontDoor: true,           // optional: listed directly at POST /api/mcp (the front door's DIRECT set)
    }],
  },

  coverage: () => ({ …, notCovered: [ … ] }),   // the `coverage` tool's block for this area

  freshness: 'live'              // no committed dataset
    | { dataFile: 'data/policy-rates.json', cadenceDays: 45, data: POLICY }      // one dataset keyed by `area`
    | [{ key: 'uk-recalls', dataFile, cadenceDays: null, data, large: 'why > 1 MB' }, …],  // several datasets
  //  cadenceDays: scripts/changelog.js stamps nextScheduledRefresh = verifiedDate + N; null = calendar-driven, set by hand
  //  data: the parsed file (require it statically so Vercel's tracer ships it); needs verifiedDate + nextScheduledRefresh

  changelog: null                // area publishes no changes
    | {
        diff: (prev, next) => entries,   // protocol entries: area, key, label, from, to, effectiveFrom, source, verifiedDate, note ''
        files: ['data/policy-rates.json'],  // paths/prefixes scripts/changelog.js attributes to this area (default: dataFile)
        previousSibling: false,  // a brand-new file diffs against the previous sibling in its directory (tax years)
        context: (entry) => 'Bank of England, decision 2025-12-18',  // optional line under the entry on /changes
      }
    | { diff: null, script: 'scripts/vehicles.js' },   // entries come from the dataset's own build script
  discovery: { description, cadence },   // required with changelog: the /.well-known/changes.json areas[] entry (> 40 / > 5 chars)

  sources: () => [{ url, label }],       // official pages the weekly watcher re-fetches ([] when none)

  rest: [{                       // GET /api/<path> mirrors, built by api/router.js
    path: 'policy-rates', tool: 'policy_rate',
    args: (q) => ({ bank: q.bank }),   // query → tool args
    required: ['bank'],          // → 400 "missing ?bank=. See /api for usage."
    numeric: ['gross'],          // coerce numeric strings
    missing: '…',                // optional custom 400 message
    decorate: (result) => result,// optional note the REST surface adds
  }, { path: 'stats', handler: 'stats' }],   // or a hand-written handler at api/_routes/<handler>.js
  cite: {                        // optional /r overrides; every rest entry already gets a cite route of the same path
    stats: { tool: (q) => OPS[q.op], args: (q) => …, hint: 'needs a valid op: …' },
  },

  hub: {                         // phrases assembled into the front door's descriptions
    changed: 'central-bank policy rates (Bank of England, Fed, ECB)',   // what_changed_since (changelog areas)
    coverage: 'central-bank policy rates (boe, fed, ecb)',             // coverage tool
    catalogue: 'central-bank policy rates: Bank of England, Fed, ECB', // catalogue tool + instructions (4)
    call: 'policy_rate (…)',     // optional: the long-tail phrase for `call` (default: title + tool names)
    frontDoor: 'Never quote a central-bank rate from memory when policy_rate covers the bank.',  // optional extra instruction
  },

  docs: {
    readme: { roadmapRow: '| 16 | … |', catalogueRow: '| `/api/mcp/policy-rates` | … | … |' },
    llms: { rest: ['- `GET https://databutler.dev/api/policy-rates?bank=boe` — …'], server: '- `POST …/api/mcp/policy-rates` — …' },
    curation: ['| `data/policy-rates.json` | refresh trigger | how |'],   // refresh-calendar rows ([] when none)
    index: { blurb: 'Bank of England, Fed and ECB policy rates, …' },     // parenthetical on index.html (null for none)
    api: () => ({                // /api index: endpoint docs, coverage summary, optional custom server one-liner
      endpoints: { 'GET /api/policy-rates': { description, params, example } },
      coverage: { policyRates: { … } },
      mcp: 'Remote MCP server — tool policy_rate (…).',
    }),
  },

  verify: [                      // scripts/verify-hub.sh checks (python expression over d, no " $ ` \)
    { label: 'call-policy-boe', kind: 'tool', tool: 'policy_rate', args: { bank: 'boe' }, assert: "d['bank']=='boe'" },
    { label: 'rest-policy-rates-400', kind: 'rest', path: 'policy-rates', query: '', assert: "'missing' in d['error']" },
  ],
};
```

House rules the kit tests enforce (`tests/areas.test.js`): every field above
is present and typed as shown; tool names, REST paths and `order` are unique
across areas; a changelog area has `discovery`; a committed data file is under
1 MB unless the dataset says `large: '…'`; tool descriptions are plain
statements (no "use this", "always", "never", "call this", "do not") for every
area added after the kit; `node scripts/sync-areas.js --check` passes.
