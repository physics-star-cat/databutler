# Adding a curated area

A new area touches four files you write — `api/_areas/<area>.js`, `data/<area>.json`,
`tests/<area>.test.js`, a section in `docs/CURATION.md` — plus the snapshot refresh.
Everything else (registry, coverage, freshness, changelog, routes, `/r`, `/api`, front
door, watcher, llms.txt, sitemap, discovery document, README, index.html, verify-hub.sh)
derives from the module. Contract: `api/_areas/README.md`.

1. **Scaffold.** `node scripts/new-area.js us-tax-thresholds --title "US tax thresholds" --cadence "Every January and after each IRS revenue procedure" [--refresh-days 45]`
   — writes the module, data skeleton and test from templates, appends a CURATION
   verification-log stub, runs `sync-areas`, prints the checklist. Tests pass as scaffolded.
2. **Fill the data from the official page only.** In `data/<area>.json` add
   `categories.<key> = { title, source, figures: [{ label, value, unit }] }`; set `licence`
   to the page's own licence statement, `verifiedDate` to today. Record the URL, the quoted
   figure and the licence in the CURATION section. A figure never comes from memory.
3. **Write the tool.** Replace the TODOs in `api/_areas/<area>.js`: `instructions`, the tool
   `description`, `coverage.scope`/`notCovered`, `discovery.description`, `hub` phrases,
   `docs` rows/lines, `verify` checks. Keep the near-miss path: unknown input →
   `covered:false` with `nearest` and `coverage`, never a throw.
4. **Sources to the watcher.** `sources()` returns every official page (the template reads
   them from the categories). `node scripts/changelog.js` refreshes `data/sources.json`
   so the Monday watcher knows the current page hash.
5. **Changelog.** `node scripts/changelog.js` — it finds the area by `changelog.files`,
   runs the area's `diff`, appends `null → value` entries for the first commit, and stamps
   `nextScheduledRefresh` = verifiedDate + `cadenceDays`. Fill every `note`.
6. **Sync + tests.** `node scripts/sync-areas.js` then `node --test tests/*.test.js`.
   The snapshot test will fail on purpose (the public surface grew):
   `UPDATE_SNAPSHOTS=1 node --test tests/snapshot.test.js`, read `git diff tests/snapshots/`,
   confirm only your area appeared. `node scripts/sync-areas.js --check` must exit 0.
7. **Commit** module + data + test + docs + generated files together; push deploys.
8. **After deploy:** `bash scripts/verify-hub.sh` — your `verify` checks run live.

## House rules

- **Plain-statement tool descriptions.** Say what the tool returns; no "use this",
  "always", "never", "call this", "do not" (`tests/areas.test.js` enforces it).
- **Freshness cadence.** Committed data declares `cadenceDays` (stamped by the script) or
  `null` with a calendar rule and a hand-set `nextScheduledRefresh`; `due` begins at
  `nextScheduledRefresh`, `overdue` 14 days later. Say the cadence in `discovery.cadence`.
- **Cite path.** Every tool's `cite()` returns a path that exists as a REST mirror (or a
  `cite` override), so `cite.url` always opens a human-readable page.
- **Near-misses:** `covered:false`, `requested`, `nearest`, `coverage` — never an error.
- **Proxies** set `openWorld: true`, `freshness: 'live'`, and put `upstreamProvenance`
  (attribution, link, licence) on every result.
- **Data file < 1 MB** committed; larger needs `large: 'reason'` on the dataset.
- **Front door stays small.** `frontDoor: true` only for a genuinely high-frequency tool.
- **URLs are forever.** Paths, tool names and `area` slugs never change once deployed.
- **Live tests** go in `verify`, offline tests in `tests/<area>.test.js`; a test may not
  reach the network.
