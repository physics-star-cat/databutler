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
`public/index.html`, `scripts/verify-hub.sh` and the `server-<key>.json`
registry manifests.

Start a new one with `node scripts/new-area.js <slug> --title "…"`
(docs/ADDING_AN_AREA.md). Shared helpers live in `api/_area_kit.js` —
`categoriesLookup`, `categorySources`, `areaHeader`, `diffCategories`, `noteTemplate`,
`figureKey`, `mergeEntries`, `plusDays`, `slug`, `same`, `factsFromCategories`, `factKey` — and a module must never require `_registry`, `_hub`,
`_changelog`, `_coverage`, `_freshness`, `_envelope`, `_rest` or `_areas` (they
require this directory — a cycle).

```js
module.exports = {
  area: 'policy-rates',          // slug; must equal the file name
  order: 80,                     // fixes the public ordering (catalogue, coverage, changelog areas, docs); unique —
                                 // parallel scaffolds both take max+10: pass --order; the loader names both on a clash
  title: 'Policy rates',         // human label
  short: 'central-bank policy rates',   // noun phrase for prose lists (index.html, /api index)

  server: {                      // null for an area with no MCP server of its own
    key: 'policy-rates',         // optional; defaults to `area` → POST /api/mcp/<key>
    serverName: 'databutler-policy-rates',
    url: `${BASE}/api/mcp/policy-rates`,
    description: '…',            // one sentence → server-<key>.json (MCP registry manifest, written by sync-areas)
    instructions: '…',           // MCP initialize.instructions
    tools: [{                    // MCP tool shape plus:
      name, title, description, inputSchema,
      run: (args) => result,     // sync or async; never throws for a near-miss — returns covered:false + nearest
      freshness: 'policy-rates', // a dataset key below, or 'live'
      cite: (args) => ({ path: 'policy-rates', query: { bank: args.bank } }),  // → https://databutler.dev/r/<path>?…
      openWorld: true,           // optional: fetches live external data → annotations.openWorldHint
      frontDoor: true,           // optional: listed directly at POST /api/mcp — at most 5 direct + 4 hub tools = 9 listed
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
        previousSibling: false,  // a brand-new file diffs against the previous sibling in its directory (per-year layout)
        previous: true,          // optional, informational: diff() uses previous.value semantics (tests + the script's message read it)
        note: noteTemplate('{label}: {from} → {to} ({document})'),  // optional: scripts/changelog.js pre-fills blank notes with it
        context: (entry) => 'Bank of England, decision 2025-12-18',  // optional line under the entry on /changes
      }
    | { diff: null, script: 'scripts/vehicles.js',     // entries come from the dataset's own build script
        datasetKeys: () => ['fr-recalls/dataset'] },    // the keys its first derivation wrote (tests/changes-page.test.js)
  discovery: { description, cadence },   // required with changelog: the /.well-known/changes.json areas[] entry (> 40 / > 5 chars)

  sources: () => [{ url, label, unreachable? }],  // official pages the weekly watcher re-fetches ([] when none);
                                 // unreachable: '<reason>' (403, CAPTCHA) → recorded so in data/sources.json, skipped by
                                 // the cron, listed in coverage (`unreachableSources`) and docs/CURATION.md.
                                 // categorySources(DATA) = every category + figure source, each once

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
    readme: {
      roadmapRow: '| **Policy rates** — … | `/api/mcp/policy-rates` | **v1 — built …** |',  // no # cell: sync-areas numbers rows 1..N from `order`
      catalogueRow: '| `/api/mcp/policy-rates` | … | … |',
      retires: '12c',            // optional: the # of the README "planned" row this area replaces — sync-areas removes it
    },
    llms: { rest: ['- `GET https://databutler.dev/api/policy-rates?bank=boe` — …'], server: '- `POST …/api/mcp/policy-rates` — …' },
    curation: ['| `data/policy-rates.json` | refresh trigger | how |'],   // refresh-calendar rows ([] when none)
    index: { blurb: 'Bank of England, Fed and ECB policy rates, …' },     // parenthetical on index.html (null for none)
    api: () => ({                // /api index: endpoint docs, coverage summary, optional custom server one-liner
      endpoints: { 'GET /api/policy-rates': { description, params, example } },
      coverage: { policyRates: { … } },
      mcp: 'Remote MCP server — tool policy_rate (…).',
    }),
  },

  facts: null                    // publishes no Verified Facts (docs/FACTS_PROTOCOL.md)
    | {                          // every figure becomes GET /f/<namespace>[/<prefix>]/<category>/<figure key> (api/_facts.js)
        namespace: 'uk',         // ISO 3166-1 alpha-2 lowercase (`uk`, not `gb`), `eu`, a subdivision (`uk-sct`), or a 3+ letter slug
        prefix: 'gov',           // optional segment between namespace and category (uk-gov-process: 'gov'; uk-exam-dates: 'exams')
        key: (f) => f.key,       // optional: the figure's id (default figureKey) — must match changelog.diff's key, so the
                                 // fact key is the changelog key with the namespace in front (factKeyFor round-trips; tested)
        period: (data, f) => data.taxYear,              // optional period label (default data.taxYear ?? null)
        previousPeriod: (data, f, prev) => prev.taxYear,// optional (default prev.taxYear ?? prev.series ?? null)
        effectiveFrom: (data, f) => f.effectiveFrom,     // optional (default f.effectiveFrom || f.from || null) — never verifiedDate
        effectiveTo: (data, f) => null,                  // optional (default null: current)
        periodStart: (period) => '2026-04-06',           // optional: first day of a period label; dates the previous record
        scope: (data, cat, f) => cat.scope,              // optional one-liner (default the category's `scope` string)
        aliases: { 'uk/national-insurance/primary-threshold': 'uk/national-insurance/primary-threshold-employee-pays-above-this' },
                                 // optional, reviewed; listed on the record. gb/… and `<area>:<changelog key>` are added automatically
        synonyms: { ni: 'national-insurance' },         // optional, for /f/resolve (a query word or phrase → key words)
        list: () => [{ record, previous, changelogKey, topic }],  // optional: areas without the categories shape build their own
                                 // entries (policy-rates; then `namespace` may be an array); factsFromCategories(data, opts) is the kit's
      },
  // A figure's previous block with a value, a source and a period label (or start date) is served as its own period
  // (?period=2025-26, ?as_of=2026-03-01). Every served record must be signed: node scripts/sign-facts.js.

  verify: [                      // scripts/verify-hub.sh checks (python expression over d, no " $ ` \)
    { label: 'call-policy-boe', kind: 'tool', tool: 'policy_rate', args: { bank: 'boe' }, assert: "d['bank']=='boe'" },
    { label: 'rest-policy-rates-400', kind: 'rest', path: 'policy-rates', query: '', assert: "'missing' in d['error']" },
  ],
};
```

**Script-driven areas.** A module requiring the data file its script writes would
break every import on the script's first derivation; `api/_areas.js` instead leaves such
an area out and lists it in `UNAVAILABLE` (with "run `node scripts/<area>.js`") when the
missing file is under `data/` and the module names a `changelog.script`. Any other load
failure still throws. Scripts require `mergeEntries` from `api/_area_kit` (pure) and diff
against the committed file (`scripts/_git.js` `previousSnapshot`), so a re-run before
committing appends nothing spurious; `scripts/changelog.js --redo <area>` drops the area's
uncommitted entries and re-runs.

House rules the kit tests enforce (`tests/areas.test.js`): every field above
is present and typed as shown; tool names, REST paths and `order` are unique
across areas; a changelog area has `discovery`; a committed data file is under
1 MB unless the dataset says `large: '…'`; tool descriptions are plain
statements (no "use this", "always", "never", "call this", "do not") for every
area added after the kit; the front door lists **at most 5 direct tools + the 4
hub tools = 9**; every server's `server-<key>.json` matches its module;
`node scripts/sync-areas.js --check` passes.

## The categories → figures data shape and the kit's helpers

```json
{ "area": "us-rates", "taxYear": "2026", "verifiedDate": "2026-10-03", "nextScheduledRefresh": "2026-11-01",
  "licence": "…", "categories": { "income-tax": { "title": "Income tax", "source": "https://…",
    "figures": [{ "key": "standard-deduction", "label": "Standard deduction", "value": 16100, "unit": "USD/year",
                  "source": "https://…/rp-25-32.pdf", "quote": "the sentence it was read from", "effectiveFrom": "2026-01-01",
                  "previous": { "value": 15750, "taxYear": "2025", "source": "https://…" } }] } } }
```

- `taxYear`, `taxYearRuns`, `jurisdiction`, `currency` are optional file-level
  fields; `areaHeader(data, area)` puts whichever exist (plus `verifiedDate`) on
  every answer.
- **`previous.value` is the comparable prior value.** A `previous` block without
  `.value` (e.g. a rate schedule's `bracketUpperBounds`) is kept for readers but
  is *not* comparable — `diffCategories` skips it (us-rates logs schedules with
  its own `scheduleArrivals`).
- `categoriesLookup(DATA, AREA, { exact, substring, nearest, header, param, filters })` →
  the tool's `run`: nothing → listing (`categories` → titles, `usage`); a key →
  that category under the header; otherwise, each switchable, `exact` key, then
  `substring` of a key or title (uk_rates_lookup's behaviour), else
  `covered:false` with `nearest` and `coverage`. `param` names the argument
  (default `category`; `--params kind,…`); each of `filters` narrows the
  category's figures to those whose field of that name matches, and an unknown
  value is `covered:false` with `field`, `nearest` and the values that exist. REST: leave `required` off so
  an empty query returns the listing (house style); `required: ['category']`
  for a 400 instead (`--required-param`).
- `diffCategories(area, prev, next, opts)` — one entry per figure whose `value`
  or `band` moved, was added or was removed. Options:
  `key(f)` the figure's stable id within its category (default `figureKey`:
  `f.key` when the figure carries one, else `slug(label)` — the same default
  `noteTemplate`/`findFigure` use); `previous: true` a figure's **first
  appearance** records `previous.value → value` and a figure with no
  `previous.value`, or one equal to its value, records nothing (default false:
  every first appearance is `null → value`); `effectiveFrom(next, f)` the day
  the new value applies (default `next.verifiedDate`; per-figure
  `f.effectiveFrom` for annual areas; the scaffold's per-year default is the
  first four digits of `taxYear` + `--year-start`); per-figure `source` on a figure wins over
  the category's; `extra(next, cat, f)` fields merged into every entry (e.g.
  `taxYear`). Notes are always `''` from `diff()` — `scripts/changelog.js` fills
  them from `changelog.note`.
- `noteTemplate(template, { key })` → a `changelog.note(entry, prev, next)`. Placeholders
  `{label} {key} {from} {to} {unit} {effectiveFrom} {source} {quote} {document}
  {title} {previousDocument}`; `{document}` is the figure's `quote` when it has
  one, else its source URL; `{title}` the category's title; `{previousDocument}`
  the figure's `previous.title`, else `previous.document`, else `previous.source`.
  An empty `()` left by a blank placeholder is dropped.
  Default `"{label}: {from} → {to} ({document})"`.
- `categorySources(DATA, { figures, extra, unreachable })` → `sources()`: every
  category `source`, then every figure `source`, then `extra`, each URL once;
  `unreachable: { <url or hostname>: '<reason>' }` marks pages the watcher cannot read.
- **Layout.** One file `data/<slug>.json` for data that is corrected in place
  (policy rates, EOL); one file per year `data/<slug>/<year>.json` with
  `changelog.files: ['data/<slug>/']` and `previousSibling: true` for annual
  areas whose old years stay queryable (uk-rates) — `--per-year <year>`.
