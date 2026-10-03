# Adding a curated area

A new area is **four files you write** — `api/_areas/<area>.js`, its data file,
`tests/<area>.test.js`, a section in `docs/CURATION.md` — plus one deliberate snapshot
refresh. Everything else (registry + `server-<area>.json` manifest, coverage, freshness,
changelog, routes, `/r`, `/api`, front door, watcher, llms.txt, sitemap, discovery document,
README rows, index.html, verify-hub.sh) derives from the module. Contract and helpers:
`api/_areas/README.md`. Nothing below needs a WIP commit or a hand edit elsewhere.

1. **Scaffold.** `node scripts/new-area.js <slug> --title "…" --cadence "<in words>"` plus:
   `--refresh-days N` (default 35; the script stamps `nextScheduledRefresh`) **or**
   `--calendar YYYY-MM-DD` (`cadenceDays: null`, date set by hand — annual/budget-driven data);
   `--per-year 2026` for the `data/<slug>/<year>.json` + `previousSibling` layout (annual areas
   whose old years stay queryable; otherwise one `data/<slug>.json` corrected in place);
   `--previous` when figures carry `previous: { value }` (first appearance logs previous → value);
   `--required-param` for a REST 400 on empty query (default: the listing, like uk_rates_lookup);
   `--note-template "…"` (default `{label}: {from} → {to} ({document})`); `--retires 12c` to drop
   the README "planned" row this area replaces. It writes the four files, runs `sync-areas`, and
   the scaffolded tests pass — expectations derive from the module and data, not pinned counts.
2. **Fill the data from the official page only.** `categories.<key> = { title, source,
   figures: [{ label, value, unit, quote?, previous?: { value } }] }`; `licence` quoted from the
   page; `verifiedDate` today; with `--calendar`, `nextScheduledRefresh` by hand. Record URL,
   quoted figure and licence in the CURATION section. A figure never comes from memory.
3. **Write the tool.** Replace the TODOs: `short`, `server.description` (one sentence → the
   registry manifest), `instructions`, tool `description`, `coverage.scope`/`notCovered`,
   `discovery.description`, `hub` phrases, `docs` rows (the roadmap row has no `#` cell —
   sync-areas numbers rows from `order`), `verify` checks. Near-miss = `covered:false` +
   `nearest` + `coverage`, never a throw; `categoriesLookup` already does this.
4. **Pin real figures** in `tests/<area>.test.js`'s data test. Nothing else there to edit.
5. **Changelog + watcher.** `node scripts/changelog.js --only <slug>`. It runs with the four
   files uncommitted (an area whose data is not yet in git may leave its module, test, manifest,
   CURATION and every generated file dirty; `--allow-dirty` for anything else), diffs the data
   (first commit: `null → value`, or `previous.value → value` with `--previous`; un-previoused
   figures then record nothing), stamps `nextScheduledRefresh` when `cadenceDays` is set,
   pre-fills every `note` from `changelog.note` — **review them** — and re-hashes only this
   area's sources into `data/sources.json`. Without `--only` it re-hashes **every** watched page,
   which resets the Monday watcher baseline for all areas: do not run it bare on a new area.
6. **Sync + tests.** `node scripts/sync-areas.js` (after any docs/hub/discovery edit), then
   `node --test tests/*.test.js`; `node scripts/sync-areas.js --check` must exit 0.
7. **Snapshot refresh (deliberate).** The public surface grew, so `tests/snapshot.test.js` fails
   on purpose: `UPDATE_SNAPSHOTS=1 node --test tests/snapshot.test.js`, read
   `git diff tests/snapshots/`, confirm only your area appeared (its tools/list, `/api` entry,
   REST mirror, llms.txt lines, sitemap and discovery rows).
8. **Commit** the four files + `data/changelog.json` + `data/sources.json` + generated files
   together; push deploys. **After deploy:** `bash scripts/verify-hub.sh` runs your `verify` live.

## House rules

- **Plain-statement tool descriptions.** Say what the tool returns; no "use this",
  "always", "never", "call this", "do not" (`tests/areas.test.js` enforces it).
- **Freshness cadence.** `cadenceDays: N` (stamped) or `null` with a calendar rule and a hand-set
  `nextScheduledRefresh`; `due` begins at `nextScheduledRefresh`, `overdue` 14 days later.
  State the cadence in `discovery.cadence`.
- **Front door stays small: at most 5 direct tools (`frontDoor: true`) + 4 hub tools = 9
  listed** (`tests/areas.test.js`). Promote deliberately; the long tail is reachable via `call`.
- **Cite path.** Every tool's `cite()` returns a path that exists as a REST mirror (or a
  `cite` override), so `cite.url` always opens a human-readable page.
- **Proxies** set `openWorld: true`, `freshness: 'live'`, and put `upstreamProvenance`
  (attribution, link, licence) on every result.
- **Data file < 1 MB** committed; larger needs `large: 'reason'` on the dataset.
- **URLs are forever.** Paths, tool names and `area` slugs never change once deployed.
- **Live tests** go in `verify`, offline tests in `tests/<area>.test.js`; a test may not
  reach the network. Count-pinning tests derive from `api/_areas.js` and the data files, so
  adding an area touches none of them; the snapshot is the one deliberate guard (step 7).
