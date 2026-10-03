# Data curation workflow

The product is trust. A wrong number is worse than no number. Rules:

1. **Nothing ships unverified.** Every record's `source` URL was fetched and
   read on `verifiedDate` — figures are extracted from the live page, never
   written from model memory.
2. **Provenance on every record**: `source`, `verifiedDate`, and scope notes
   (e.g. "England & NI only — Scotland differs").
3. **Copyright**: exam papers/mark schemes are board copyright — we index and
   link to official archives, never host or excerpt them.

## Refresh calendar

| Dataset | Refresh trigger | How |
|---|---|---|
| `data/uk/rates/<year>.json` | Every 6 April (new tax year) + after Budgets/Autumn Statements; NMW on 1 April | Re-fetch each `source` gov.uk page; write a NEW file per tax year (keep old years — agents ask historical questions); update the year the API defaults to in `_lib.js`. |
| `data/uk/exams/*.json` | Each September (spec changes announce ~a year ahead) | Re-fetch each `specUrl` at-a-glance page; bump `verifiedDate`; diff topic lists. |
| `data/vehicles/fr-recalls.json` | Monthly (RappelConso publishes continuously) | In `../car_websites/controle-technique`: `node data/fetch-rappelconso.js`, commit; then here `node scripts/vehicles.js fr` (derives the compact file, bumps `verifiedDate`/`nextScheduledRefresh` from the fetch date, appends a `vehicles` changelog entry when counts move). |
| `data/vehicles/jp-recalls.json` | Monthly (MLIT filings are newsworthy when fresh) | In `../car_websites/shaken-data`: `node data/fetch-mlit.js` (15–20 min, 700 ms politeness delay — do not hammer), commit; then here `node scripts/vehicles.js jp`. |
| `data/vehicles/uk-recalls.json` | Monthly (DVSA regenerates the source CSV daily; new recalls land every week) | `node scripts/vehicles.js uk` — downloads DVSA's bulk `RecallsFile.csv` (one ~8 MB request, UA names databutler.dev), keeps recalls launched in the ten calendar years before the fetch year plus the fetch year, groups rows by recall number, bumps `verifiedDate`/`nextScheduledRefresh`, appends a `vehicles` changelog entry when counts move. `DVSA_RECALLS_CSV=path` builds from a saved copy. Each January the window rolls forward a year — say so in the changelog note. |
| UK MOT (vehicles) | — | No dataset here: live proxy to whatbreaks.uk, which owns the DfT bulk-data refresh. |
| `data/sources.json` | After every data refresh (automatic via `scripts/changelog.js`) | `node scripts/sources.js` re-checks every source URL (gov.uk content API / page hash). |
| `data/changelog.json` | With every data refresh | `node scripts/changelog.js` (UK data) or `node scripts/vehicles.js` (vehicles); fill in `note` lines. See "Changelog & source watcher" and "How to add a changelog entry when a dataset is refreshed". |

## Verification log

- 2026-08-31 — rates 2026-27: all 10 categories fetched from live gov.uk
  pages (income tax, NI via employer rates page, NMW, student loans, VAT,
  ISA + LISA, new State Pension, SDLT, CGT, pension AA).
- 2026-08-31 — AQA GCSE: Physics 8463, Biology 8461, Chemistry 8462,
  Combined Science Trilogy 8464, Maths 8300 — all from live AQA
  specification-at-a-glance pages. Notable verified quirks: Trilogy Physics
  Paper 2 has NO Space physics; Maths has no topic→paper mapping (any topic,
  any paper; Paper 1 non-calculator).

## Verification log (vehicles, added 2026-10-03)

- 2026-10-02 — RappelConso: full `rappelconso-v2-gtin-espaces` export for
  sub-category "automobiles, motos, scooters" (1,663 fiches, 2018-01-19 →
  2026-08-07) as committed in controle-technique; curated model index = that
  site's reviewed alias matching (568 fiches → 94 models). Reshaped, not edited.
- 2026-08-30 — MLIT: 919 unique recall filings (1,377 model links) and 19,659
  owner complaints across 75 models, as committed in shaken-data. Per-filing
  PDF URL pattern `https://renrakuda.mlit.go.jp/mt/recallpdf/<no>.pdf` verified
  200 on 2026-10-03. Data is a month old at build time — the freshness block
  says `due` honestly until the monthly refresh runs.
- EU Safety Gate: stub only; no data claimed.
- 2026-10-03 — DVSA (UK) recalls: full bulk download of
  `https://www.check-vehicle-recalls.service.gov.uk/documents/RecallsFile.csv`
  (7.67 MB, 17,711 rows = 8,975 distinct recall numbers, launch dates
  1992 → 2026; `Last-Modified: Sat, 03 Oct 2026 03:02:52 GMT`), the file the
  GOV.UK "Check if a vehicle, part or accessory has been recalled" service
  links as "All recalls since 1992 (CSV)". Licence: the service footer states
  "All content is available under the Open Government Licence v3.0, except
  where otherwise stated" (Crown copyright). Field definitions from DVSA's
  "Recalls Data User Guide v4" (April 2015, `/documents/Recalls%20Data%20User%20Guide_v4.doc`):
  one row per recall × model, `Vehicle Numbers` is the recall total repeated
  against each model (observed to differ per model in 641 recalls — served
  as published, `vehiclesAffected` = largest figure among the rows shown),
  recall-number prefixes R/RM/RCOMP/RCT/RPT/RSPV/RTW/RPC classify the product.
  Update cadence: the CSV is regenerated daily (Last-Modified moves each
  night). Served window: launch dates from 2016-01-01 (ten calendar years +
  current) → 4,876 recalls / 10,879 model rows / 272 make slugs in a 2.6 MB
  file; older recalls stay in the source CSV, which every response links as
  `datasetUrl`. Not on data.gov.uk: CKAN lists only an empty, unpublished
  VOSA "Vehicle Safety Branch Recalls Database" entry (no resources), so the
  service's own download is the official bulk route. Quirks kept as
  published: 742 rows contain U+FFFD from the source's own encoding history;
  one recall (R/2026/030, Ford Kuga) carries launch date 2027-02-03; `Model`
  and `Recalls Model Information` are identical in every row, so only `Model`
  is kept. Per-recall links use the checker's make / model / build-year page
  (`/recall-type/vehicle/make/<MAKE>/model/<MODEL>/year/<YYYY>/recalls`),
  verified 200 with recall numbers listed for VAUXHALL/CORSA/2015 and
  TOYOTA (GB) PLC/YARIS/2019; equipment categories (RCOMP, RTW, RPC) link to
  the dataset because their page layout was not verified. Make strings are
  the importer's legal name ("MERCEDES-BENZ CARS UK LTD", "TOYOTA (GB)
  PLC"); `ukMakeSlug` in `api/_vehicles_text.js` drops the corporate noise
  so "Vauxhall Corsa" and "vauxhall corsa" resolve identically — `make` is
  always served as published alongside the slug.

## Expansion queue (exams)

Edexcel GCSE sciences/maths → OCR Gateway + 21st Century → AQA/Edexcel/OCR
A-level sciences + maths → English Language/Literature set-text/paper maps
(high value: "which paper is Macbeth on"). Each addition follows the same
fetch-verify-record loop; the maintainer's teaching background is the QA
layer — teacher review before publish.

## Numerical validation (stats vertical)

- 2026-08-31 — `_statsmath.js` checked against textbook reference values:
  normalCdf(1.96)=0.975, normalInv(0.975)=1.95996, t/chi²/F critical values
  (3.841 @ χ²df1=0.95, F(0.05,3,10)=3.708), binomial/Poisson pmf+cdf, logGamma.
  All 14 pass. `_stats.js` sanity-checked end-to-end incl. the base-rate Bayes
  example (1% prior, 99% sens, 95% spec → 0.1667 posterior). Re-run the harness
  in the commit history before changing any special-function code.

## Changelog & source watcher (added 2026-09-01)

`what_changed_since` reads `data/changelog.json`. Entries are **generated,
never hand-written**; the maintainer adds the one line a script cannot know.

Per change (target: under 10 minutes):

1. A GitHub issue labelled `source-changed` arrives from the weekly watcher
   (`api/_routes/cron/watch-sources.js`, served through `api/router.js`, Mondays 06:00 UTC), or a Budget/spec change
   is announced.
2. Open the source page; edit the data file against it (new tax year = new
   file; bump `verifiedDate`; set `nextScheduledRefresh`).
3. `node scripts/changelog.js` — diffs the edited files against git, appends
   entries with `note: ""`, then refreshes `data/sources.json` so the watcher
   goes quiet.
4. Fill in each `note` ("Autumn Budget 2026", "AQA spec update for first
   teaching 2027"). Commit `data/` together. Push deploys.

If the watcher fires but nothing material changed (typo fix on gov.uk), run
`node scripts/sources.js` and commit — no changelog entry.

Rules: the watcher never edits data; the script never invents an entry; a
`from`/`to` pair always comes from two committed versions of a data file.

## Where the changelog is served

`data/changelog.json` is one file with five read surfaces, all from the same
entries (`api/_changelog.js` → `listEntries` for the public ones,
`changesSince` for the agent one):

| Surface | URL | Handler |
|---|---|---|
| Page (indexable) | `/changes`, `/changes?area=uk-rates\|uk-exams\|vehicles`, `?since=YYYY-MM-DD` | `api/_routes/changes-page.js` |
| RSS 2.0 | `/changes.rss` (`?area=`) | `api/_routes/changes-feed.js` (`format=rss`) |
| Atom | `/changes.atom` (`?area=`) | `api/_routes/changes-feed.js` (`format=atom`) |
| JSON | `/api/changes?since=…&area=…` (`format=html\|rss\|atom` delegates) | `api/_routes/changes.js` |
| MCP | `what_changed_since` on `POST /api/mcp` | `api/_hub.js` |

Rendering lives in `api/_changes_render.js` and is pure: no clock, no I/O, so
feeds re-render byte-for-byte and edge caches (`s-maxage=3600`) stay quiet
until the data changes. The feed `guid` is the entry's permalink on the page
(`https://databutler.dev/changes#<area>-<key>-<verifiedDate>`), `link` is the
official source, `pubDate` is the `verifiedDate`. Listed in
`public/sitemap.xml`, `public/robots.txt` (`Allow: /changes*`), `public/llms.txt`,
the `/api` index and the `rel=alternate` links on `public/index.html`.

All five surfaces follow the Verified Changes protocol v0.1
(`docs/CHANGES_PROTOCOL.md`, served at `/protocol`): the entry shape is the
protocol's entry schema, `/api/changes` and `what_changed_since` return a
protocol document, and `public/.well-known/changes.json` is the discovery
document — **when an area is added to `CHANGELOG_AREAS`, add it there too**
(`tests/protocol.test.js` checks the two lists agree).

The page is the one part of the site that *is* meant to be indexed — unlike
the `/r/` citation pages — so a change here (a new area, a renamed key) should
keep old anchors working: `entryId` (`area|key|verifiedDate`) is the dedupe key
and the anchor is derived from the same three fields.

## How to add a changelog entry when a dataset is refreshed

Entries are never typed into `data/changelog.json` by hand; a script writes
the entry and the maintainer writes the note. Each entry carries
`area, key, label, from, to, effectiveFrom, source, verifiedDate, note`
(uk-rates adds `unit`/`taxYear`/`band`; uk-exams adds `board`/`level`/
`subject`/`specCode`).

- **UK rates or exams** (`data/uk/**`): edit the data file against the live
  source page, then `node scripts/changelog.js`. It diffs against git, appends
  one entry per changed figure/topic/paper with `note: ""`, and refreshes
  `data/sources.json`. Fill in each note (which Budget, which spec update).
- **Vehicles** (`data/vehicles/*.json`): refresh the sibling repo's fetcher
  (`controle-technique` → `node data/fetch-rappelconso.js`; `shaken-data` →
  `node data/fetch-mlit.js`), commit there, then here
  `node scripts/vehicles.js fr|jp|all`. `writeDataset` compares the new
  derivation with the committed file and appends one entry per metric that
  moved (`fr-recalls/count`, `fr-recalls/curated-fiches`,
  `jp-recalls/recall-filings`, `jp-recalls/complaints`), `effectiveFrom` and
  `verifiedDate` both the snapshot date. On the **first** derivation of a
  dataset (no committed file) it appends `<name>/dataset` (null → `covered`)
  with `effectiveFrom` = snapshot date, `verifiedDate` = the day you ran it,
  and a note carrying the counts — the three existing `vehicles` entries are
  in exactly that shape (`fr-recalls/dataset`, `jp-recalls/dataset`,
  `eu-safety-gate/dataset`; the EU one is a stub recorded by hand because
  there is no dataset file to derive).
- **A new dataset that has no script yet**: write the script first (the
  entry shape above, `mergeEntries` for dedupe), then run it — that is how
  the vehicles entries came to exist.
- Review the notes, `node --test tests/*.test.js` (the changelog tests check
  every entry's shape, dates and source URL), commit `data/` together, push.
  Within the hour the edge cache expires and `/changes`, both feeds and
  `what_changed_since` all show the entry.

A refresh that changes nothing material (counts unchanged, typo fix on the
source) adds no entry — the script only records a `from`/`to` that differ.

The citation pages (`/r/<route>`) track their own traffic with a
`cite_page_view` GA4 event, not `agent_*` — so webmon's agent-usage counts
exclude citation-page views by design.

A front-door `call` emits both `agent_mcp_call` and `agent_mcp_call_<inner>` —
one event for the front-door hit, one for the tool it delegated to — so the
second event exists to show which long-tail tools get called often enough to
deserve promotion to the front door. webmon sums `total_calls` over events
whose name does not start with `agent_mcp_call_`, so a delegated call is
counted once, not twice.
