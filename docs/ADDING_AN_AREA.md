# Adding a curated area

A new area is **four files you write** — `api/_areas/<area>.js`, its data file,
`tests/<area>.test.js`, a section in `docs/CURATION.md` — plus one deliberate snapshot
refresh. Everything else (registry + `server-<area>.json`, coverage, freshness, changelog, routes,
`/r`, `/api`, front door, watcher, llms.txt, sitemap, discovery document, README rows, index.html,
verify-hub.sh) derives from the module. Contract and helpers: `api/_areas/README.md`.

1. **Scaffold.** `node scripts/new-area.js <slug> --title "…"`, plus as needed:
   `--refresh-days N` (default 35, stamped) **or** `--calendar YYYY-MM-DD` (`cadenceDays: null`, set by hand);
   `--cadence "…"` (optional — default stated from the refresh rule); `--per-year 2026-27` for
   `data/<slug>/<year>.json` + `previousSibling`, with `--year-start MM-DD` (default `01-01`; VED `04-01`,
   UK tax `04-06`) → default `effectiveFrom` = first four digits of `taxYear` + that day; `--previous` when
   figures carry `previous: { value }`; `--params kind,board` (first picks the category, the rest filter its
   figures by the field of that name; default `category`); `--rest-path uk/exam-dates` (default the slug);
   `--required-param` (REST 400 without the first param); `--tool-title "…"` (≤ 40 chars; default
   "<title> lookup", else the title — longer fails early); `--order N` (default max+10 — **two branches
   scaffolding in parallel both take the same number: pass distinct `--order`**, and the loader's error
   names both areas); `--note-template "…"`; `--retires 12c`. It writes the four files and runs `sync-areas`;
   the scaffolded tests read tool, params, REST path and cadence from the module, so they pass as is.
2. **Fill the data from the official page only.** `categories.<key> = { title, source, figures: [{ key?,
   label, value, unit, source?, quote?, previous?: { value, source, title? } }] }`; `licence` quoted from the
   page; `verifiedDate` today. Figures carrying `key` are keyed by it (diff and notes agree automatically).
   Record URL, quoted figure and licence in the CURATION section. A figure never comes from memory.
3. **Write the tool.** Replace the TODOs: `short`, `server.description`, `instructions`, tool `description`,
   `coverage`, `discovery.description`, `hub` phrases, `docs` rows (no `#` cell), `verify` checks.
   `sources()` defaults to every category and figure `source`, each once; a page that answers 403/CAPTCHA
   gets `unreachable: 'reason'` (`categorySources(DATA, { unreachable: { host: 'reason' } })`).
4. **Pin real figures** in `tests/<area>.test.js`'s data test. Nothing else there to edit.
5. **Changelog + watcher.** `node scripts/changelog.js --only <slug>` — runs with the new area's files
   uncommitted (module, test, manifest, `scripts/<slug>.js`, `api/_<slug>.js`, `tests/fixtures/<slug>…`,
   CURATION, snapshots, generated files; no `--allow-dirty`), diffs against the **committed** file, stamps
   `nextScheduledRefresh`, pre-fills notes from `changelog.note` (`{label} {key} {from} {to} {unit}
   {effectiveFrom} {source} {title} {quote} {document} {previousDocument}`) — **review them** — and re-hashes
   only this area's sources. Fixed a template or parser? `--redo <slug>` drops the area's uncommitted entries
   and re-runs (a plain re-run appends nothing spurious but keeps old notes). An unfetchable page is
   recorded `unreachable` in `data/sources.json`; the Monday cron skips it, coverage and CURATION list it.
   Never run it bare on a new area: that re-hashes every area's pages.
6. **Sync + tests.** `node scripts/sync-areas.js`, `node --test tests/*.test.js`,
   `node scripts/sync-areas.js --check` (exit 0).
7. **Snapshot refresh (deliberate).** `UPDATE_SNAPSHOTS=1 node --test tests/snapshot.test.js`; read
   `git diff tests/snapshots/` — only your area should appear. Run dates are normalised to placeholders, so
   it never goes red on another day; prove it: `FAKE_NOW=<tomorrow> NODE_OPTIONS="--require
   ./tests/fake-clock.js" node --test tests/*.test.js`.
8. **Commit** the four files + `data/changelog.json` + `data/sources.json` + generated files together.
   **After deploy:** `bash scripts/verify-hub.sh` runs your `verify` live.

## Script-driven areas (data fetched by `scripts/<area>.js`)

Module: `changelog: { diff: null, script: 'scripts/<area>.js', datasetKeys: () => [...] }` — the keys its first
derivation writes (tests/changes-page.test.js checks them; nothing to add there). The script requires
`mergeEntries` from `api/_area_kit` and diffs against `previousSnapshot()` (`scripts/_git.js`). Until its data
file exists the loader marks the area unavailable with a clear error instead of failing every import.
`changelog.js --only <area>` only re-hashes its sources; `--redo <area>` re-runs the script.
Add the script to `.github/workflows/refresh-datasets.yml` for the monthly PR.

## House rules

- **Plain-statement tool descriptions** — no "use this", "always", "never", "call this", "do not".
- **Freshness:** `due` from `nextScheduledRefresh`, `overdue` 14 days later; state it in `discovery.cadence`.
- **Front door:** at most 5 direct tools (`frontDoor: true`) + 4 hub tools = 9 listed.
- **Cite path:** every `cite()` path is a REST mirror (or a `cite` override). **Data file < 1 MB**
  (else `large: 'reason'`). **URLs are forever:** paths, tool names, slugs never change once deployed.
- **Tests stay offline** (`verify` is the live check); count-pinning tests derive from the modules.

## When the area is live

`scripts/publish-registry.sh --check`, then `scripts/publish-registry.sh` (PulseMCP ingests from the registry);
resubmit the sitemap to Google and Bing (`webmon/bing_feeds.py`) — the area's `/changes?area=` view is new.
