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

<!-- sync-areas:calendar start -->
| Dataset | Refresh trigger | How |
|---|---|---|
| `data/uk/rates/<year>.json` | Every 6 April (new tax year) + after Budgets/Autumn Statements; NMW on 1 April | Re-fetch each `source` gov.uk page; write a NEW file per tax year (keep old years — agents ask historical questions); update the year the API defaults to in `_lib.js`. |
| `data/uk/exams/*.json` | Each September (spec changes announce ~a year ahead) | Re-fetch each `specUrl` at-a-glance page; bump `verifiedDate`; diff topic lists. |
| `data/vehicles/fr-recalls.json` | Monthly (RappelConso publishes continuously) | In `../car_websites/controle-technique`: `node data/fetch-rappelconso.js`, commit; then here `node scripts/vehicles.js fr` (derives the compact file, bumps `verifiedDate`/`nextScheduledRefresh` from the fetch date, appends a `vehicles` changelog entry when counts move). |
| `data/vehicles/jp-recalls.json` | Monthly (MLIT filings are newsworthy when fresh) | In `../car_websites/shaken-data`: `node data/fetch-mlit.js` (15–20 min, 700 ms politeness delay — do not hammer), commit; then here `node scripts/vehicles.js jp`. |
| `data/vehicles/uk-recalls.json` | Monthly (DVSA regenerates the source CSV daily; new recalls land every week) | `node scripts/vehicles.js uk` — downloads DVSA's bulk `RecallsFile.csv` (one ~8 MB request, UA names databutler.dev), keeps recalls launched in the ten calendar years before the fetch year plus the fetch year, groups rows by recall number, bumps `verifiedDate`/`nextScheduledRefresh`, appends a `vehicles` changelog entry when counts move. `DVSA_RECALLS_CSV=path` builds from a saved copy. Each January the window rolls forward a year — say so in the changelog note. |
| UK MOT (vehicles) | — | No dataset here: live proxy to whatbreaks.uk, which owns the DfT bulk-data refresh. |
| `data/software-eol.json` | Monthly (endoflife.date changes continuously; freshness says `due` from 35 days after the fetch) | `node scripts/software-eol.js` — 14 requests to `https://endoflife.date/api/<product>.json` (500 ms apart, UA names databutler.dev), normalises each cycle, bumps `verifiedDate`/`nextScheduledRefresh` (+35 days), appends `software-eol` changelog entries: `<product>/<cycle>` when an eol date moved (from → to, effectiveFrom = new date), when a cycle reached end of life between the two snapshots (supported → end of life, effectiveFrom = eol date) or when a cycle is new (null → released). Fill the blank notes, commit `data/` together. `EOL_DIR=path` builds from saved copies. |
| `data/policy-rates.json` | Within 45 days of `verifiedDate` (freshness flips to `due`) and after every scheduled decision — BoE MPC ("Next due" on the Bank Rate page), FOMC (fomccalendars.htm), ECB Governing Council (mgcgc calendar); each decides eight times a year. The weekly watcher hashes the three bank source pages. | Open the bank's `source` page and the decision press release; edit `figures`, move the replaced level into `previous`, update `effectiveFrom`, `decisionDate`, `decisionMeeting`, `latestDecision`, `nextDecision`, `decisionSource` and both `verifiedDate`s; then `node scripts/changelog.js` (sets `nextScheduledRefresh` = verifiedDate + 45 days, appends one `policy-rates` entry per figure that moved, refreshes `data/sources.json`). A hold moves no figure: update `latestDecision`/`nextDecision`/`verifiedDate` only, no entry. |
| `data/us-rates.json` | Annual, calendar-driven (`cadenceDays: null`; `nextScheduledRefresh` set by hand to the IRS release window, 2026-11-01 for tax year 2027): the IRS tax-year inflation adjustments (Rev. Proc., mid/late October, announced on the newsroom page), the retirement-plan limits (Notice, early/mid November), SSA's COLA/wage-base Federal Register notice (late October/November), the HSA Rev. Proc. (May). The weekly watcher hashes the five pages in `sources()` (newsroom, Federal Register API, Tax Topic 751, COLA limits table, Pub 969). | Fetch the new Rev. Proc./Notice PDF from `/pub/irs-drop/`; for each figure move `value` into `previous` (with its source), write the new `value`, `effectiveFrom`, `source`, `quote`, `verifiedDate`; bump the file's `taxYear`, `taxYearRuns`, `verifiedDate` and set `nextScheduledRefresh` to the next release window; then `node scripts/changelog.js` (one `us-rates` entry per figure that moved, from → to; refreshes `data/sources.json`); fill each `note` with the Rev. Proc./Notice number. ssa.gov blocks curl — read the Federal Register notice instead. |
| `data/de-rates.json` | Annual, calendar-driven (`cadenceDays: null`; `nextScheduledRefresh` set by hand, 2026-12-15 for 2027): the Sozialversicherungsrechengrößen-Verordnung in the BGBl (late November; the BMAS Verordnung page's "Umsetzungsstand" flips first), the durchschnittlicher Zusatzbeitragssatz in the Bundesanzeiger (by 1 November; BMG `/beitraege` table), any Steuergesetz rewriting § 32a/§ 32/§ 66 EStG (consolidated text on gesetze-im-internet.de within days), the Mindestlohnkommission decision (by 30 June of the year before). The weekly watcher hashes the twelve pages in `sources()`. | Open the BGBl PDF on recht.bund.de and the consolidated § pages; for each figure move `value` into `previous` (with its source and quote), write the new `value`, `effectiveFrom`, `source`, `quote`, `verifiedDate`; promote the already-fixed next-year figures (Mindestlohn, Geringfügigkeitsgrenze) and add the following year's if enacted; bump `taxYear`, `taxYearRuns`, `verifiedDate`, set `nextScheduledRefresh`; then `node scripts/changelog.js` (one `de-rates` entry per figure that moved; refreshes `data/sources.json`); fill each `note` with the Verordnung/Gesetz and BGBl citation. bundesfinanzministerium.de serves a CAPTCHA to curl — the statutes and BGBl are the primary sources anyway. |
| `data/calendar.json` | Monthly (freshness says `due` from 35 days after the fetch); and when a government publishes the next year's list (gov.uk and OPM publish ~2 years ahead, calendrier.api.gouv.fr 5 years) | `node scripts/calendar.js` — fetches gov.uk `bank-holidays.json`, OPM's federal-holidays page and `calendrier.api.gouv.fr` (UA names databutler.dev, 500 ms apart), merges `data/calendar/manual.json` (German Länder rules, tax-year and DST rules — edit that file against the official pages, bump its `verifiedDate`, keep every `quote`/`verification`), computes rule-based dates and stops if a hand-copied official date disagrees, bumps `verifiedDate`/`nextScheduledRefresh` (+35 days), appends `calendar` changelog entries (`<cc>/holidays/<year>` for a new year, `<cc>/holidays/<region>/<year>/<key>` for an added/removed/moved day, `<cc>/tax-year/<part>`, `<cc>/dst/<year>` for rule changes). Fill the blank notes, commit `data/` together. To widen the window add the year to `manual.json` `years`. `CAL_DIR=path` builds from saved copies. Re-try the `nonOfficial` entries (HB, MV, SH, TH holidays; fr and br DST; br personal tax year) each refresh. |
| `data/sources.json` | After every data refresh (automatic via `scripts/changelog.js`) | `node scripts/sources.js` re-checks every source URL (gov.uk content API / page hash). |
| `data/changelog.json` | With every data refresh | `node scripts/changelog.js` (areas with a `changelog.diff`) or the dataset's own script (`changelog.script`); fill in `note` lines. See "Changelog & source watcher" and docs/ADDING_AN_AREA.md. |
<!-- sync-areas:calendar end -->

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

## Verification log (software-eol, added 2026-10-03)

- 2026-10-03 — endoflife.date: 14 products fetched from the JSON API
  `https://endoflife.date/api/<product>.json` (one request each, User-Agent
  `databutler.dev data curation (+https://databutler.dev)`, 200 on all 14):
  nodejs 26 cycles, python 17, ubuntu 44, debian 18, android 34, ios 16,
  macos 23, windows 49, oracle-jdk 28, go 18, ruby 15, php 18, postgresql 29,
  react 5 — 340 cycles, 65 KB committed. `/api/all.json` listed 478 products
  on the fetch date. **Licence:** the repository
  `https://github.com/endoflife-date/endoflife.date` is under the MIT License
  (LICENSE file: "Copyright 2020 endoflife.date contributors", fetched from
  raw.githubusercontent.com master; README "Licensed under the MIT License");
  the site itself carries no separate data licence statement, so the
  repository licence is what is recorded in the dataset header
  (`licence`) and in every result (`upstreamProvenance.licence`). The site's
  product descriptions are CC BY-SA 3.0 (Wikipedia-derived) — not reused here;
  only lifecycle fields are kept. **Java naming:** the site has no `java`
  product — `/api/java.json` is 404 and `/java` and `/jdk` both 301 to
  `/tags/java-distribution`; the Oracle entry is `oracle-jdk` ("Oracle JDK",
  200), which is what is served, with `java`/`jdk` as aliases. The other
  distributions (openjdk-builds-from-oracle, redhat-build-of-openjdk,
  microsoft-build-of-openjdk) are listed under notCovered. **Field quirks
  kept as published:** `eol` is a date, `false` (no date set) or `true`
  (end of life, date unknown); `lts` is a boolean or, for Node.js, the date
  LTS begins; `support` is a date or `true` (active, no end date); Ruby's
  `link` is a template over the latest release (`v__LATEST__`), filled in at
  build; Windows cycle ids are slugs (`11-24h2-w`) with a `releaseLabel`.
  Cadence: endoflife.date updates continuously via community pull requests
  and automated vendor checks; served as a monthly snapshot with the fetch
  date as `verifiedDate`.

## Verification log (policy rates, added 2026-10-03)

All three banks fetched 2026-10-03 with curl (UA `databutler-curation/1.0`);
none blocked the automated fetch. Figures read from the pages, never from
memory. Cadence: each bank decides eight times a year; the file is
re-verified within 45 days of `verifiedDate` and after every decision.

- Bank of England — `https://www.bankofengland.co.uk/monetary-policy/the-interest-rate-bank-rate`
  showed "Current Bank Rate 3.75%", "Next due: 5 November 2026" and "Bank
  rate maintained at 3.75% — September 2026" (published 17 September 2026).
  History table `https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp`:
  18 Dec 25 → 3.75, 07 Aug 25 → 4.00. Decision page
  `https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2025/december-2025`:
  "At its meeting ending on 17 December 2025, the MPC voted by a majority of
  5–4 to reduce Bank Rate by 0.25 percentage points, to 3.75%", published
  18 December 2025. Watcher caveat: the Bank Rate page also carries the
  monthly CPI figure, so a `source-changed` issue on it needs the history
  table checked before anything is edited.
- US Federal Reserve — `https://www.federalreserve.gov/monetarypolicy/openmarket.htm`
  table: 2026 "September 17 | +25 | 3.75-4.00"; 2025 "December 11 | −25 |
  3.50-3.75". FOMC statement
  `https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm`
  (12–0 vote): "raise the target range for the federal funds rate by 1/4
  percentage point to 3-3/4 to 4 percent"; implementation note
  `…/monetary20260916a1.htm`: "Effective September 17, 2026 … target range of
  3-3/4 to 4 percent". Calendar `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm`:
  2026 meetings September 15–16, October 27–28, December 8–9.
- European Central Bank — `https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html`
  table (date "with effect from"): 2026 16 Sep. 2.50 / 2.65 / 2.90; 2026
  17 Jun. 2.25 / 2.40 / 2.65. Press release
  `https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.mp260910~314e508016.en.html`
  (10 September 2026): "raise the three key ECB interest rates by 25 basis
  points … increased to 2.50%, 2.65% and 2.90% respectively, with effect from
  16 September 2026". Calendar `https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html`:
  next monetary policy meeting 28–29 October 2026, then 16–17 December 2026.
  The decisions index page is JavaScript-rendered; the per-year snippet
  `/press/govcdec/mopo/2026/html/index_include.en.html` is plain HTML.

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
| Page (indexable) | `/changes`, `/changes?area=<area>` (one of the areas in `/.well-known/changes.json`), `?since=YYYY-MM-DD` | `api/_routes/changes-page.js` |
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
document — generated from the area modules by `node scripts/sync-areas.js`
(`tests/protocol.test.js` and `tests/areas.test.js` check the lists agree).

The page is the one part of the site that *is* meant to be indexed — unlike
the `/r/` citation pages — so a change here (a new area, a renamed key) should
keep old anchors working: `entryId` (`area|key|verifiedDate`) is the dedupe key
and the anchor is derived from the same three fields.

## How to add a changelog entry when a dataset is refreshed

**Adding a whole new area?** Follow `docs/ADDING_AN_AREA.md` — the scaffold,
the module contract (`api/_areas/README.md`) and `node scripts/changelog.js`
(which runs the area's own `changelog.diff`) replace the per-area recipes
below for anything built after 2026-10-03.

Entries are never typed into `data/changelog.json` by hand; a script writes
the entry and the maintainer writes the note. Each entry carries
`area, key, label, from, to, effectiveFrom, source, verifiedDate, note`
(uk-rates adds `unit`/`taxYear`/`band`; uk-exams adds `board`/`level`/
`subject`/`specCode`; policy-rates adds `unit`/`bank`/`bankName`/`decisionDate`).

- **UK rates or exams** (`data/uk/**`): edit the data file against the live
  source page, then `node scripts/changelog.js`. It diffs against git, appends
  one entry per changed figure/topic/paper with `note: ""`, and refreshes
  `data/sources.json`. Fill in each note (which Budget, which spec update).
- **Policy rates** (`data/policy-rates.json`): open the bank's `source` page
  and the new decision press release; set the bank's `figures`, move the old
  figures into `previous` (with its `effectiveFrom`), update `effectiveFrom`,
  `decisionDate`, `decisionMeeting`, `latestDecision`, `nextDecision`,
  `decisionSource` and both `verifiedDate`s, then `node scripts/changelog.js`.
  It keeps `nextScheduledRefresh` at verifiedDate + 45 days, appends one
  `policy-rates` entry per figure that moved (`<bank>/<figure>`, with
  `unit`/`bank`/`bankName`/`decisionDate`, source = the decision page) and
  refreshes `data/sources.json`. Fill in each note with the meeting ("MPC
  meeting ending 17 December 2025", "FOMC 15–16 September 2026"). A hold
  moves no figure and adds no entry — still bump `latestDecision`,
  `nextDecision` and `verifiedDate`. The six entries dated 2026-10-03 came
  from the first run, where each bank's `previous` block was the from side.
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
- **Software end-of-life** (`data/software-eol.json`): `node scripts/software-eol.js`
  fetches the 14 products and compares the new snapshot with the committed
  file: one `<product>/<cycle>` entry when a cycle's eol date moved (from the
  old date to the new, `effectiveFrom` = the new date — which can be in the
  future, and `what_changed_since` includes it on that basis), when a cycle
  reached end of life between the two snapshots (`supported` → `end of life`,
  `effectiveFrom` = the eol date), or when a cycle is new (null → `released`,
  `effectiveFrom` = its release date). The first derivation wrote one
  `<product>/dataset` entry per product (14 entries, 2026-10-03) with the
  cycle counts in the note.
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

## Verification log (us-rates, added 2026-10-03)

Fetch notes: every irs.gov page and PDF, federalregister.gov and govinfo.gov
returned 200 to curl with the UA above. **ssa.gov returned 403 "Access Denied"
(Akamai edgesuite)** on `/oact/cola/cbb.html`, `/cola/` and
`/news/press/factsheets/colafacts2026.pdf`; the wage base is therefore taken
from SSA's own Federal Register notice (90 FR, 2025-11-03, doc 2025-19763),
which is the legally required publication of the same determinations, and
corroborated by IRS Publication 15 (2026) and Tax Topic 751.

### income-tax — Rev. Proc. 2025-32 (`https://www.irs.gov/pub/irs-drop/rp-25-32.pdf`, 200), summarised by IR-2025-103 (`https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill`, 200)

- Rate schedules, § 3.01 "Tax Rate Tables. For taxable years beginning in 2026":
  - TABLE 1 (MFJ / surviving spouses): "Not over $24,800 — 10%"; "$24,800 … $100,800 — $2,480 plus 12%"; "$100,800 … $211,400 — $11,600 plus 22%"; "$211,400 … $403,550 — $35,932 plus 24%"; "$403,550 … $512,450 — $82,048 plus 32%"; "$512,450 … $768,700 — $116,896 plus 35%"; "Over $768,700 — $206,583.50 plus 37%".
  - TABLE 2 (Heads of households): "Not over $17,700 — 10%"; "$17,700 … $67,450 — $1,770 plus 12%"; "$67,450 … $105,700 — $7,740 plus 22%"; "$105,700 … $201,750 — $16,155 plus 24%"; "$201,750 … $256,200 — $39,207 plus 32%"; "$256,200 … $640,600 — $56,631 plus 35%"; "Over $640,600 — $191,171 plus 37%".
  - TABLE 3 (Single): "Not over $12,400 — 10%"; "$12,400 … $50,400 — $1,240 plus 12%"; "$50,400 … $105,700 — $5,800 plus 22%"; "$105,700 … $201,775 — $17,966 plus 24%"; "$201,775 … $256,225 — $41,024 plus 32%"; "$256,225 … $640,600 — $58,448 plus 35%"; "Over $640,600 — $192,979.25 plus 37%".
  - TABLE 4 (MFS): as TABLE 3 up to $256,225, then "$256,225 … $384,350 — $58,448 plus 35%"; "Over $384,350 — $103,291.75 plus 37%".
  - Cross-check: IR-2025-103 "37% for individual single taxpayers with incomes greater than $640,600 ($768,700 for married couples filing jointly) … 35% for incomes over $256,225 ($512,450 …); 32% … $201,775 ($403,550); 24% … $105,700 ($211,400); 22% … $50,400 ($100,800); 12% … $12,400 ($24,800)". Matches the tables.
- Standard deduction, § 3.14(1): "Married Individuals Filing Joint Returns and Surviving Spouses $32,200; Heads of Households $24,150; Unmarried Individuals $16,100; Married Individuals Filing Separate Returns $16,100". IR-2025-103 table "TY 2026 Under OBBB $16,100 / $32,200 / $24,150".
- Additional standard deduction aged/blind, § 3.14(3): "is $1,650. The additional standard deduction amount is increased to $2,050 if the individual is also unmarried and not a surviving spouse."
- Dependent standard deduction, § 3.14(2): "cannot exceed the greater of (1) $1,350, or (2) the sum of $450 and the individual's earned income."
- Previous (2025): Rev. Proc. 2024-40 (`https://www.irs.gov/pub/irs-drop/rp-24-40.pdf`, 200) Tables 1–4 upper bounds (MFJ 23,850 / 96,950 / 206,700 / 394,600 / 501,050 / 751,600; HoH 17,000 / 64,850 / 103,350 / 197,300 / 250,500 / 626,350; Single 11,925 / 48,475 / 103,350 / 197,300 / 250,525 / 626,350; MFS … 375,800); aged/blind "$1,600 … increased to $2,000". 2025 standard deduction as rewritten by OBBBA is in Rev. Proc. 2025-32 § 3.01: "$31,500 / $23,625 / $15,750 / $15,750" (section 2.15(1) of Rev. Proc. 2024-40 removed).

### social-security — Federal Register notice 2025-19763 (`https://www.federalregister.gov/documents/2025/11/03/2025-19763/cost-of-living-increase-and-other-determinations-for-2026`, 200; PDF `https://www.govinfo.gov/content/pkg/FR-2025-11-03/pdf/2025-19763.pdf`, 200)

- Wage base: "The OASDI contribution and benefit base is $184,500 for remuneration paid in 2026 and self-employment income earned in tax years beginning in 2026." Previous: "Because $184,500 exceeds the current base amount of $176,100 …".
- COLA: "there will be a 2.8 percent cost-of-living increase in Social Security benefits effective December 2025."
- Quarter of coverage: "The earnings required for a quarter of coverage in 2026 is $1,890."
- Rates — Publication 15 (2026) (`https://www.irs.gov/pub/irs-pdf/p15.pdf`, 200, rev. Dec 15 2025) "What's New": "The rate of social security tax on taxable wages is 6.2% each for the employer and employee. The social security wage base limit is $184,500." Tax Topic 751 (`https://www.irs.gov/taxtopics/tc751`, 200, "Page Last Reviewed or Updated: 24-Sep-2026"): "The current tax rate for Social Security is 6.2% for the employer and 6.2% for the employee, or 12.4% total. … For earnings in 2026, this base limit is $184,500."

### medicare — Pub 15, Tax Topic 751, Additional Medicare Tax Q&A (`https://www.irs.gov/businesses/small-businesses-self-employed/questions-and-answers-for-the-additional-medicare-tax`, 200)

- Pub 15: "The Medicare tax rate is 1.45% each for the employee and employer, unchanged from 2025. There is no wage base limit for Medicare tax."
- Q&A: "The rate is 0.9 percent." Threshold table: "Married filing jointly $250,000; Married filing separate $125,000; Single $200,000; Head of household (with qualifying person) $200,000; Qualifying widow(er) with dependent child $200,000".
- TC751: "Employers are responsible for withholding the 0.9% Additional Medicare tax on an individual's wages paid in excess of $200,000 in a calendar year, without regard to filing status."

### retirement — Notice 2025-67 (`https://www.irs.gov/pub/irs-drop/n-25-67.pdf`, 200), summarised by IR-2025-111 (`https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500`, 200)

- § 402(g)(1): "is increased from $23,500 to $24,500."
- § 414(v)(2)(B)(i) catch-up 50+: "is increased from $7,500 to $8,000."
- § 414(v)(2)(E)(i) ages 60–63: "remains $11,250."
- Roth catch-up wage threshold § 414(v)(7)(A): "is increased from $145,000 to $150,000."
- § 415(c)(1)(A): "is increased in 2026 from $70,000 to $72,000."
- § 401(a)(17): "is increased from $350,000 to $360,000."
- IRA § 219(b)(5)(A): "is increased from $7,000 to $7,500."; IRA catch-up § 219(b)(5)(B)(ii): "is increased from $1,000 to $1,100."
- SIMPLE § 408(p)(2)(E)(i)(III): "is increased from $16,500 to $17,000."
- HCE § 414(q)(1)(B): "remains $160,000."
- Previous-year values are stated in the same sentences ("from … to …"); Notice 2024-80 (`https://www.irs.gov/pub/irs-drop/n-24-80.pdf`, 200) was also fetched and agrees ($23,500 / $7,500 / $11,250).

### hsa — Rev. Proc. 2025-19 (`https://www.irs.gov/pub/irs-drop/rp-25-19.pdf`, 200)

- "the annual limitation on deductions under § 223(b)(2)(A) for an individual with self-only coverage … is $4,400. … family coverage … is $8,750."
- HDHP: "annual deductible that is not less than $1,700 for self-only coverage or $3,400 for family coverage, and for which the annual out-of-pocket expenses … do not exceed $8,500 for self-only coverage or $17,000 for family coverage."
- Excepted benefit HRA: "is $2,200."
- Previous: Rev. Proc. 2024-25 (`https://www.irs.gov/pub/irs-drop/rp-24-25.pdf`, 200): "$4,300 … $8,550 … not less than $1,650 … or $3,300 … do not exceed $8,300 … or $16,600 … $2,150".

### estate-gift — Rev. Proc. 2025-32 and IR-2025-103

- § 2.14: "Section 70106 of the OBBBA amends § 2010(c)(3) by increasing the basic exclusion amount to $15,000,000 for calendar year 2026. … the generation-skipping transfer exemption amount under § 2631(c) is equal to $15,000,000. … The basic exclusion amount will be adjusted for inflation for calendar year 2027 and future years."
- § 3.42(1): "For calendar year 2026, the first $19,000 of gifts to any person (other than gifts of future interests in property) are not included in the total amount of taxable gifts under § 2503".
- IR-2025-103: "basic exclusion amount of $15,000,000, up from a total of $13,990,000 for estates of decedents who died in 2025"; "the annual exclusion for gifts remains at $19,000. (… gifts to a spouse who is not a citizen of the United States increases to $194,000 for calendar year 2026, up $4,000 from calendar year 2025.)"
- Previous: Rev. Proc. 2024-40 § 2.43: "For calendar year 2025, the first $19,000 of gifts to any person …"; § 2.41 "$13,990,000".

### Catches by the curated layer — disagreements with LifeByNumbers `flask-backend/app.py` (2026-10-03)

The first thing the US file caught. `calculate_us_salary` (app.py ~L1198–1300,
comment "per OBBBA / IRS Rev. Proc. 2025") disagrees with Rev. Proc. 2025-32
§ 3.01 (and IR-2025-103, which agrees with the Rev. Proc.) at five bracket
breakpoints:

| Schedule | Breakpoint | app.py | Rev. Proc. 2025-32 | Δ |
|---|---|---|---|---|
| Married filing jointly | 32 % → 35 % | 512,400 | **512,450** | −50 |
| Married filing jointly | 35 % → 37 % | 768,400 | **768,700** | −300 |
| Head of household | 12 % → 22 % | 67,400 | **67,450** | −50 |
| Head of household | 24 % → 32 % | 201,775 | **201,750** | +25 |
| Head of household | 32 % → 35 % | 256,225 | **256,200** | +25 |

Pattern: app.py's MFJ 35 %/37 % thresholds look like 2× the Single/MFS values
rounded wrongly, and its HoH 24 %/32 %/35 % values are the Single values. The
official HoH schedule genuinely differs from Single by $25 at two points (as in
2025: 250,500 vs 250,525), so any "derive HoH from Single" shortcut is wrong by
construction. Everything else in app.py matches the official pages (all seven
Single breakpoints; MFJ 24,800 / 100,800 / 211,400 / 403,550; HoH 17,700 /
105,700 / 640,600; standard deductions 16,100 / 32,200 / 24,150; SS wage base
184,500 and 6.2 %; Medicare 1.45 %; Additional Medicare 0.9 %).

Logic flag (not a figure): app.py applies the $250,000 Additional Medicare
threshold to every non-single status (`200000 if single else 250000`). The IRS
table gives **$200,000 for head of household** (and $125,000 for married filing
separately, which app.py does not model) — a small under-statement of tax for
HoH filers above $200k. The take_home_pay proxy inherits both until LBN is fixed.

### Not yet published as of 2026-10-03 (stated, not guessed)

- Tax year **2027** inflation adjustments (Rev. Proc. 2026-xx, normally mid/late
  October): not published. The IRS "news releases for current month" page
  ("Page Last Reviewed or Updated: 02-Oct-2026") lists IR-2026-103 … IR-2026-119
  and none is the inflation-adjustment release.
- **2027 Social Security COLA / wage base**: not published (SSA announces
  mid-October; the Federal Register notice follows ~2–3 weeks later). The
  Federal Register API query the watcher uses returned only the 2026 notice.
- **2027 retirement-plan limits** (Notice 2026-xx): not published (early/mid
  November).
- **2027 HSA limits** (Rev. Proc. 2026-xx, normally May): not searched for — the
  brief was tax year 2026; a May-2026 release probably exists and is the first
  thing a 2027 file needs.
- Every 2026 figure served is final; nothing in the set is provisional. The
  estate basic exclusion is fixed by statute at $15,000,000 for 2026 and indexed
  only from 2027, so the 2027 Rev. Proc. will carry a new figure. The OBBBA
  "senior deduction" ($6,000, TY 2025–2028) is a separate, income-limited
  deduction, not the § 63(f) amount; it is not in the inflation release and is
  not served.

### Fetch behaviour of the sources

| Host | 2026-10-03 | Used instead |
|---|---|---|
| `www.ssa.gov` (`/oact/cola/cbb.html`, `/cola/`, `/news/press/factsheets/colafacts2026.pdf`) | **403 "Access Denied"** (Akamai edgesuite) | SSA's Federal Register notice (federalregister.gov HTML + govinfo.gov PDF, both 200) — same determinations, legally authoritative; IRS Pub 15 / TC751 corroborate the wage base. The watcher polls the Federal Register API, not ssa.gov. |
| `www.irs.gov` | no block — all 12 pages/PDFs 200 with UA `databutler-curation/1.0` | the newsroom feeds at `/newsroom/rss` remain the fallback if that changes |

Watcher: one page per category (`sources()` in `api/_areas/us-rates.js`) —
the newsroom "current month" page (the TY2027 release appears there first and
names the Rev. Proc. to fetch from `/pub/irs-drop/rp-26-NN.pdf`), the Federal
Register API query for SSA's COLA notices, Tax Topic 751, the IRS COLA
limitations table and Publication 969. Most of these pages change for
unrelated reasons (newsroom lists, "Page Last Reviewed" dates), so a
`source-changed` issue needs a human read before any figure is edited.

## Verification log (de-rates, added 2026-10-03)

Fetch notes: gesetze-im-internet.de (all § pages), recht.bund.de (BGBl PDFs),
bmas.de, bundesgesundheitsministerium.de, deutsche-rentenversicherung.de,
minijob-zentrale.de, bmfsfj.de and bundesanzeiger.de all returned 200.
**bundesfinanzministerium.de served a Radware CAPTCHA page** ("your activity
and behavior on this site made us think that you are a bot") for every URL
tried, so no BMF page is cited; the statutes and the Bundesgesetzblatt are the
primary sources anyway. bundesregierung.de topic URLs guessed from memory were
404 (only the search page loads); bzst.de Kindergeld URLs were 404;
arbeitsagentur.de is JavaScript-rendered and returned no text. The EStG
consolidated text carries "Stand: Neugefasst durch Bek. v. 8.10.2009 I 3366,
3862; zuletzt geändert durch Art. 7 G v. 29.6.2026 I Nr. 197", i.e. the text in
force on the fetch date.

### income-tax — § 32a EStG (`https://www.gesetze-im-internet.de/estg/__32a.html`, 200)

- "Sie beträgt ab dem Veranlagungszeitraum 2026 … 1. bis 12 348 Euro (Grundfreibetrag): 0; 2. von 12 349 Euro bis 17 799 Euro: (914,51 • y + 1 400) • y; 3. von 17 800 Euro bis 69 878 Euro: (173,10 • z + 2 397) • z + 1 034,87; 4. von 69 879 Euro bis 277 825 Euro: 0,42 • x – 11 135,63; 5. von 277 826 Euro an: 0,45 • x – 19 470,38." Definitions of y, z, x and the rounding rule quoted in the JSON.
- Previous Grundfreibetrag: SteFeG, BGBl. 2024 I Nr. 449 (`https://www.recht.bund.de/bgbl/1/2024/449/regelungstext.pdf?__blob=publicationFile&v=2`, 200): Art. 1 "1. bis 12 096 Euro (Grundfreibetrag)" (2025), Art. 2 "1. bis 12 348 Euro (Grundfreibetrag)" (2026); Art. 10 "(2) Die Artikel 2, 4 und 6 treten am 1. Januar 2026 in Kraft."
- Solidaritätszuschlag — § 4 SolzG (`…/solzg_1995/__4.html`, 200): "Der Solidaritätszuschlag beträgt 5,5 Prozent der Bemessungsgrundlage. Er beträgt nicht mehr als 11,9 Prozent des Unterschiedsbetrages …". § 3 Abs. 3 (`…/solzg_1995/__3.html`, 200): "1. in den Fällen des § 32a Absatz 5 und 6 des Einkommensteuergesetzes 40 700 Euro, 2. in anderen Fällen 20 350 Euro übersteigt." Previous from SteFeG Art. 3/4: "„18 130 Euro“ durch „19 950 Euro“ … „36 260 Euro“ durch „39 900 Euro“" (2025) and "„39 900 Euro“ durch „40 700 Euro“ … „19 950 Euro“ durch „20 350 Euro“ … erstmals im Veranlagungszeitraum 2026".

### social-insurance — Sozialversicherungsrechengrößen-Verordnung 2026, BGBl. 2025 I Nr. 278 (`https://www.recht.bund.de/bgbl/1/2025/278/regelungstext.pdf?__blob=publicationFile&v=2`, 200; index `https://www.gesetze-im-internet.de/svbezgrv_2026/index.html`, 200), BMAS summary (`https://www.bmas.de/DE/Service/Gesetze-und-Gesetzesvorhaben/sozialversicherungs-rechengroessenverordnung-2026.html`, 200)

- § 1: "Die Bezugsgröße … für das Jahr 2026 beträgt 47 460 Euro. Umgerechnet auf den Monat ergeben sich 3 955 Euro."
- § 2 (1): "Jahresarbeitsentgeltgrenze nach § 6 Absatz 6 … auf 77 400 Euro festgesetzt. … 6 450 Euro." § 2 (2): "nach § 6 Absatz 7 … auf 69 750 Euro festgesetzt. … 5 812,50 Euro."
- § 3 (2): "Das vorläufige Durchschnittsentgelt … für das Jahr 2026 beträgt 51 944 Euro."
- § 4 (1): "1. in der allgemeinen Rentenversicherung auf 101 400 Euro jährlich; … 8 450 Euro, und 2. in der knappschaftlichen Rentenversicherung auf 124 800 Euro jährlich; … 10 400 Euro." § 5: "Diese Verordnung tritt am 1. Januar 2026 in Kraft." Signed "Berlin, den 24. November 2025 … Merz … Bärbel Bas".
- BMAS table agrees: "Bezugsgröße 3.955 / 47.460; JAEG § 6 Abs. 6 6.450 / 77.400; JAEG § 6 Abs. 7 5.812,50 / 69.750; BBG allgemeine RV und AV 8.450 / 101.400; vorläufiges Durchschnittsentgelt 2026 51.944".
- Previous (2025): BMAS SV-Rechengrößen 2025 page (`…/sozialversicherungs-rechengroessenverordnung-2025.html`, 200): "Beitragsbemessungsgrenze in der allgemeinen Rentenversicherung erhöht sich im Jahr 2025 auf 8.050 Euro im Monat … gesetzlichen Krankenversicherung steigt auf 5.512,50 Euro im Monat … Jahresarbeitsentgeltgrenze auf 6.150 Euro im Monat"; DRV Werte page history "ab 1.1.2025 … 8.050; ab 1.1.2026 … 8.450" and Bezugsgröße "3.745 / 3.955".
- Rates: § 241 SGB V (`…/sgb_5/__241.html`, 200) "Der allgemeine Beitragssatz beträgt 14,6 Prozent". BMG Beiträge (`https://www.bundesgesundheitsministerium.de/beitraege`, 200, "Stand: 3. September 2026"): "Für das Jahr 2026 beträgt der durchschnittliche Zusatzbeitragssatz 2,9 Prozent." and table "Allgemeiner Beitragssatz 14,6 Prozent; Ermäßigter Beitragssatz 14,0 Prozent; Durchschnittlicher Zusatzbeitragssatz 2,9 Prozent; Beitragsbemessungsgrenze (Monat) 5.812,50 Euro; (Jahr) 69.750 Euro". Previous Zusatzbeitrag: BAnz AT 07.11.2024 B4 (`https://www.bundesanzeiger.de/pub/publication/lErtX3qtBqz33CLzogK/content/lErtX3qtBqz33CLzogK/BAnz%20AT%2007.11.2024%20B4.pdf?inline=`, 200): "Der durchschnittliche Zusatzbeitragssatz nach § 242a Absatz 1 SGB V für das Jahr 2025 beträgt 2,5 Prozent."
- RV 18,6 %: DRV Werte (`https://www.deutsche-rentenversicherung.de/DRV/DE/Experten/Zahlen-und-Fakten/Werte-der-Rentenversicherung/werte-der-rentenversicherung_node.html`, 200, "Stand 01.07.2026"): "Rentenversicherung: 18,6 Prozent … Beitragssatz zur Rentenversicherung in Prozent ab 1.1.2018 monatlich 18,6". § 158 SGB VI fetched for the mechanism (rate is set by Bekanntmachung, not printed in the statute).
- AV 2,6 %: § 341 SGB III (`…/sgb_3/__341.html`, 200) "(2) Der Beitragssatz beträgt 2,6 Prozent. … (4) Beitragsbemessungsgrenze ist die Beitragsbemessungsgrenze der allgemeinen Rentenversicherung."
- PV 3,6 %: PBAV 2025 § 1 (`…/pbav_2025/__1.html`, 200) "wird zum 1. Januar 2025 auf 3,6 Prozent … festgesetzt. (2) Die Anhebung … um 0,2 Prozentpunkte gegenüber dem am 31. Dezember 2024 geltenden Beitragssatz"; § 55 SGB XI (`…/sgb_11/__55.html`, 200) base "3,4 Prozent", Abs. 3 "Beitragszuschlag in Höhe von 0,6 Beitragssatzpunkten (Beitragszuschlag für Kinderlose)" and "ab dem zweiten Kind bis zum fünften Kind um jeweils einen Abschlag in Höhe von 0,25 Beitragssatzpunkten". BMG Finanzierung (`…/die-pflegeversicherung/finanzierung`, 200, "Stand: 14. September 2026"): "Seit dem 1. Januar 2025 beträgt der Beitragssatz 3,6 Prozent …, bei Kinderlosen sind es 4,2 Prozent … jeweils 1,8 Prozent. … Sachsen … 2,3 Prozent auf die Beschäftigten und 1,3 Prozent auf die Arbeitgeber." and "Beitragssätze: allgemeine Rentenversicherung: 18,6 Prozent; Arbeitslosenversicherung: 2,6 Prozent; Pflegeversicherung: 3,6 Prozent".

### minimum-wage — MiLoV5 (`https://www.gesetze-im-internet.de/milov5/__1.html`, 200; BGBl. 2025 I Nr. 268 `https://www.recht.bund.de/bgbl/1/2025/268/regelungstext.pdf?__blob=publicationFile&v=2`, 200)

- "§ 1 Höhe des Mindestlohns — Der Mindestlohn beträgt 1. ab 1. Januar 2026 13,90 Euro brutto je Zeitstunde, 2. ab 1. Januar 2027 14,60 Euro brutto je Zeitstunde." BGBl: "Vom 5. November 2025 … § 2 Diese Verordnung tritt am 1. Januar 2026 in Kraft."
- BMAS history (`…/einfuehrung-und-anpassung-mindestlohn.html`, 200): "01.01.2025 12,82 Euro | 01.01.2026 13,90 Euro Fünfte Mindestlohnanpassungsverordnung vom 05. November 2025 (BGBl. 2025 I Nr. 268) | 01.01.2027 14,60 Euro". BMAS Mindestlohn page: "Seit 1. Januar 2026 gilt ein Mindestlohn von 13,90 Euro."
- § 1 MiLoG footnote confirms the chain of Verordnungen: "§ 1 V v. 5.11.2025 I Nr. 268".

### minijob — § 8 SGB IV (`…/sgb_4/__8.html`, 200), DRV Werte, Minijob-Zentrale (`https://www.minijob-zentrale.de/DE/die-minijobs/minijob-mit-verdienstgrenze`, 200)

- § 8 (1a): "Sie wird berechnet, indem der Mindestlohn mit 130 vervielfacht, durch drei geteilt und auf volle Euro aufgerundet wird."
- DRV: "In der Zeit vom 1.1.2025 bis 31.12.2025 … 556,00 EUR. In der Zeit vom 1.1.2026 bis 31.12.2026 … 603,00 EUR. Ab dem 1.1.2027 … 633,00 EUR."
- Minijob-Zentrale: "Sie dürfen durchschnittlich im Monat nicht mehr als 603 Euro verdienen. Auf ein Jahr gerechnet sind das bis zu 7.236 Euro." and "von 603,01 Euro bis 2.000 Euro im Monat, handelt es sich um einen sogenannten Midijob."; its table "13,90 Euro (Mindestlohn ab 01.01.2026) 43,38 [Stunden]".

### kindergeld — § 66 EStG (`…/estg/__66.html`, 200), BMFSFJ (`https://www.bmfsfj.de/bmfsfj/themen/familie/familienleistungen/kindergeld/kindergeld-73892`, 200)

- "(1) Das Kindergeld beträgt monatlich für jedes Kind 259 Euro." BMFSFJ: "Es beträgt zum 1. Januar 2026 monatlich 259 Euro pro Kind."
- Previous: SteFeG Art. 1 Nr. 4 "„250 Euro“ durch „255 Euro“" (2025) and Art. 2 "„255 Euro“ durch „259 Euro“" (2026).

### kinderfreibetrag — § 32 Abs. 6 EStG (`…/estg/__32.html`, 200)

- "ein Freibetrag von 3 414 Euro für das sächliche Existenzminimum des Kindes (Kinderfreibetrag) sowie ein Freibetrag von 1 464 Euro für den Betreuungs- und Erziehungs- oder Ausbildungsbedarf des Kindes … Bei Ehegatten, die … zusammen zur Einkommensteuer veranlagt werden, verdoppeln sich die Beträge".
- Previous: SteFeG Art. 1 Nr. 1 "„3 306 Euro“ durch „3 336 Euro“" (2025), Art. 2 Nr. 1 "„3 336 Euro“ durch „3 414 Euro“" (2026). BEA 1 464 € unchanged.

### sparer-pauschbetrag — § 20 Abs. 9 EStG (`…/estg/__20.html`, 200)

- "ein Betrag von 1 000 Euro abzuziehen (Sparer-Pauschbetrag) … Ehegatten, die zusammen veranlagt werden, wird ein gemeinsamer Sparer-Pauschbetrag von 2 000 Euro gewährt." Unchanged since 2023.

### arbeitnehmer-pauschbetrag — § 9a EStG (`…/estg/__9a.html`, 200)

- "ein Arbeitnehmer-Pauschbetrag von 1 230 Euro; b) … ein Pauschbetrag von 102 Euro". Unchanged since 2023.

### entfernungspauschale — § 9 Abs. 1 Satz 3 Nr. 4 EStG (`…/estg/__9.html`, 200), StÄndG 2025 BGBl. 2025 I Nr. 363 (`https://www.recht.bund.de/bgbl/1/2025/363/regelungstext.pdf?__blob=publicationFile&v=2`, 200)

- § 9: "eine Entfernungspauschale für jeden vollen Kilometer der Entfernung zwischen Wohnung und erster Tätigkeitsstätte von 0,38 Euro anzusetzen, höchstens jedoch 4 500 Euro im Kalenderjahr; ein höherer Betrag als 4 500 Euro ist anzusetzen, soweit der Arbeitnehmer einen eigenen oder ihm zur Nutzung überlassenen Kraftwagen benutzt." Familienheimfahrt: "0,38 Euro für jeden vollen Kilometer".
- StÄndG 2025 ("Vom 22. Dezember 2025", ausgegeben 23.12.2025): "aa) In Satz 2 wird die Angabe „0,30 Euro“ durch die Angabe „0,38 Euro“ ersetzt. … bb) In Satz 6 wird die Angabe „0,30 Euro“ durch die Angabe „0,38 Euro“ ersetzt." — i.e. until 2025 the first 20 km were 0,30 € and 0,38 € applied from the 21st km (the pre-2026 "ab dem 21. vollen Entfernungskilometer" wording is still referenced in the Mobilitätsprämie amendment in the same Act).

### 2027 look-ahead (not served as figures)

- DRV press note 24.09.2026 (`https://www.deutsche-rentenversicherung.de/DRV/DE/Ueber-uns-und-Presse/Presse/Meldungen/2026/260922-sv-rechengroessen-vo-2027.html`, 200): "Die den Sozialversicherungsrechengrößen 2027 zugrundeliegende Lohnentwicklung im Jahr 2025 beträgt 4,38 Prozent. … Die Sozialversicherungsrechengrößen-Verordnung 2027 muss zunächst von der Bundesregierung beschlossen werden. Anschließend bedarf sie noch der Zustimmung des Bundesrats." No 2027 euro amounts are given in the note; see NOTES.md for the BMAS draft page.

### Catches by the curated layer — comparison with LifeByNumbers `flask-backend/app.py` (2026-10-03)

`calculate_de_salary` (app.py ~L2092–2290): **no figure disagreements**. Every
statutory number matches the official text read today — Grundfreibetrag
12,348; tariff zone bounds 17,799 / 69,878 / 277,825 and all coefficients
(914.51, 1,400, 173.10, 2,397, 1,034.87, 0.42, 11,135.63, 0.45, 19,470.38);
BBG KV/PV 5,812.50; BBG RV/AV 8,450; KV 7.3 % employee; Zusatzbeitrag 1.45 %
employee (2.9 % average); PV 1.8 % / 2.4 % childless; RV 9.3 %; AV 1.3 %; Soli
Freigrenze 20,350 / 40,700, 5.5 %, 11.9 %.

Things in app.py that are *not* official figures and are not in
`de-rates.json` (worth knowing, not a disagreement): the `annual_taxable -
36000` adjustment for Steuerklasse III, the "~2.4 % Umlagen (U1, U2,
insolvency)" employer add-on, and treating Steuerklasse V/VI as "no
allowance". The Lohnsteuer procedure (§ 39b) is not modelled by either file.

### Not yet published as of 2026-10-03 (stated, not guessed)

- **Sozialversicherungsrechengrößen-Verordnung 2027**: only a
  *Referentenentwurf* (21 Sep 2026). The BMAS page
  `https://www.bmas.de/DE/Service/Gesetze-und-Gesetzesvorhaben/sozialversicherungs-rechengroessenverordnung-2027.html`
  (200 today; the watcher's page) shows "Kabinettbeschluss … Noch nicht
  veröffentlicht", "Länder- und Verbändebeteiligung … Noch nicht veröffentlicht".
  Draft table (monthly / annual €, **draft, not in force, not served**):
  Bezugsgröße 4.130 / 49.560; JAEG § 6 Abs. 6 SGB V — / 84.150; JAEG § 6 Abs. 7
  6.075 / 72.900; JAEG § 6 Abs. 8 6.712,50 / 80.550; **Beitragsbemessungsgrenze
  KV 6.375 / 76.500** — the draft decouples the KV ceiling from the § 6 Abs. 7
  JAEG (the extra +300 €/month from the GKV-Beitragssatzstabilisierungsgesetz),
  so a 2027 file must not assume BBG KV = JAEG Abs. 7 as in 2026; BBG RV/AV
  8.850 / 106.200; knappschaftlich 10.900 / 130.800; vorläufiges
  Durchschnittsentgelt 2027 53.452; endgültiges Durchschnittsentgelt 2025
  49.147. Lohnentwicklung 2025 = 4,38 %. Expect BGBl promulgation late Nov 2026.
- **Durchschnittlicher Zusatzbeitragssatz 2027**: not announced (BMG announces by
  1 November in the Bundesanzeiger after the Schätzerkreis in mid-October).
- **Grundfreibetrag / Kinderfreibetrag / Kindergeld 2027**: § 32a EStG as
  consolidated today reads "ab dem Veranlagungszeitraum 2026", § 66 says 259 €;
  no 2027 values are enacted (the 2026 Existenzminimumbericht is due in autumn
  2026 and usually triggers a tariff bill).
- **Pflegeversicherung 2027**: 3,6 % has no scheduled change in the texts read;
  the DRV home page lists a "GKV-Beitragssatzstabilisierungsgesetz … ab 2027"
  item (pension-recipient changes) — not examined.
- Already fixed for 2027 and **served** (with their own `effectiveFrom`):
  Mindestlohn 14,60 € (MiLoV5 § 1 Nr. 2) and the Geringfügigkeitsgrenze 633 €
  (DRV Werte page; § 8 Abs. 1a SGB IV formula 14,60 × 130 ÷ 3, rounded up).

### Fetch behaviour of the sources

| Host | 2026-10-03 | Used instead |
|---|---|---|
| `www.bundesfinanzministerium.de` (every URL tried) | **Radware CAPTCHA** ("your activity and behavior on this site made us think that you are a bot") | not needed: statutes on gesetze-im-internet.de and BGBl PDFs on recht.bund.de are the primary sources; no BMF page is cited or watched |
| `www.bundesregierung.de` topic pages | 404 for the slugs tried; only `/breg-de/suche` loads | not needed (BMAS, BGBl, DRV) |
| `www.bzst.de` Kindergeld pages | 404 (site restructured) | BMFSFJ Kindergeld page (200) + § 66 EStG |
| `www.arbeitsagentur.de` | 200 but JavaScript-rendered shell, no text | same |
| `www.gkv-spitzenverband.de` Beitragssatz page | 404 | BMG `/beitraege` + BAnz Bekanntmachung |
| `www.gesetze-im-internet.de` | 200, served as ISO-8859-1; the "Stand: … zuletzt geändert …" header is only on the full-text page (`estg/BJNR010050934.html`), not on the `__32a.html` Einzelnorm pages | read the full-text header once for the version stamp |
| `www.recht.bund.de` (BGBl) | 200 for `/bgbl/1/<year>/<nr>/regelungstext.pdf?__blob=publicationFile&v=2`; a guessed `gesetze-im-internet.de/svbezgrv_2026/BJNR….html` slug 404s — use `index.html` | — |
| `www.bundesanzeiger.de` | 200 for the deep PDF link found via search; the site search itself is JS | keep the deep link |

Quirks kept as published: § 55 SGB XI still prints the Pflegeversicherung base
rate "3,4 Prozent" — the operative 3,6 % comes from the PBAV 2025 under the
Abs. 1a Verordnungsermächtigung (cap +0,5 points), so the BMG contributions
page, not § 55, is the watch target. § 9 EStG now reads 0,38 € from the first
kilometre (StÄndG 2025, BGBl. 2025 I Nr. 363); the 2025 two-tier rule survives
only in cross-references, so that figure's `previous` is a string. The
Zusatzbeitrag 2,9 % is the statutory average — a user's Krankenkasse rate
differs; the figure carries a `note`. The social-insurance category serves
annual and monthly values as separate figures because the Verordnung prints
both and the monthly value is the legally stated one for payroll.

Watcher: twelve pages (`sources()` in `api/_areas/de-rates.js`) — the
consolidated § pages for every statutory figure (they cannot lag the BGBl by
more than days), the BMAS SV-Rechengrößen-VO 2027 page (its "Umsetzungsstand"
flips when promulgated), the BMG contributions table, the DRV values page, the
BMAS Mindestlohn history and the Minijob-Zentrale limit page.

## Verification log (calendar, added 2026-10-04)

Area `calendar`: public holidays (UK, US federal, Germany, France), tax-year
starts/ends (nine countries) and daylight-saving switches, for 2026–2028.
Built by `node scripts/calendar.js` from three machine-readable official sources
plus `data/calendar/manual.json`, where every hand-verified entry carries the
page it was read from on 2026-10-04 and the sentence read (`quote`), and a
`verification` line saying what was fetched. Rule-based dates (Easter-relative
holidays, US statutory dates, DST transitions, tax-year periods) are **computed
from the quoted rule** and the build **stops** if a computed date disagrees with
a date copied by hand from an official page (`checks`). Everything that could
not be re-verified against an official page carries `nonOfficial: true` in the
served data and is listed under "Not re-verified" below — seven entries.

- 2026-10-04 — **gov.uk** `https://www.gov.uk/bank-holidays.json` (200, 22 KB,
  User-Agent `databutler.dev data curation (+https://databutler.dev)`): three
  divisions, events 2019–2028; kept 2026–2028: England and Wales 8/8/8,
  Scotland 10/9/9, Northern Ireland 10/10/10 = 82 entries. Titles kept as
  published, `(substitute day)` flagged `substitute`. **Licence:** page footer
  "All content is available under the Open Government Licence v3.0, except where
  otherwise stated © Crown copyright". Statutory basis linked: Banking and
  Financial Dealings Act 1971 Sch. 1 (legislation.gov.uk, 200; e.g. Scotland
  "30th November, if it is not a Saturday or Sunday or, if it is a Saturday or
  Sunday, the first Monday following that day").
- 2026-10-04 — **OPM** `https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/`
  (200, 152 KB): one `<table>` per year captioned "YYYY Holiday Schedule",
  tables for 2011–2030 present; parsed 2026/2027/2028 (11 rows each). OPM prints
  the **observed** date (month and day only): 2026 Independence Day → Friday
  July 03; 2027 Juneteenth → Friday June 18, Independence Day → Monday July 05,
  Christmas → Friday December 24; 2028 New Year's Day → Friday December 31
  (i.e. 2027-12-31), Veterans Day → Friday November 10. Footnotes read on the
  page: "If a holiday falls on a Saturday, for most Federal employees, the
  preceding Friday will be treated as a holiday for pay and leave purposes." /
  "If a holiday falls on a Sunday, for most Federal employees, the following
  Monday will be treated as a holiday for pay and leave purposes." The served
  `date` is the **statutory** date computed from 5 U.S.C. § 6103(a) (govinfo.gov
  USCODE-2023 HTML, 200, quoted in manual.json) and `observed` is OPM's date when
  it differs — the build fails if OPM's date is more than three days from the
  statutory one or a statute holiday is missing from the table. **Licence:** US
  Government work, public domain (17 U.S.C. § 105; govinfo.gov/about/policies:
  "place in the public domain all work of the United States Government"); the
  OPM page itself carries no licence statement. Inauguration Day (2029, DC area
  only) is outside the window.
- 2026-10-04 — **calendrier.api.gouv.fr** `/jours-feries/metropole/{2026,2027,2028}.json`
  and `/alsace-moselle/…` (all six 200): 11 metropole + 13 Alsace-Moselle days
  per year = 72 entries, names kept as published ("1er janvier", "Lundi de
  Pâques", "Vendredi saint", "2ème jour de Noël"). Dataset page
  `https://www.data.gouv.fr/fr/datasets/jours-feries-en-france/` (200):
  **Licence "Licence Ouverte / Open Licence version 2.0"**, producteur
  data.gouv.fr, "La liste des jours fériés est définie dans le code du travail"
  (art. L3133-1 à L3133-3, L3422-2); exports cover 20 years back / 5 forward.
  Cross-checked against service-public.gouv.fr F2405 (200; "Sauf mention
  contraire, tous les contenus de ce site sont sous licence etalab-2.0"), whose
  2026 and 2027 tables match date for date, Alsace-Moselle Vendredi Saint
  "(dans les communes ayant un temple protestant ou une église mixte)" included.
- 2026-10-04 — **Germany, nationwide**: BMI
  `…/nationale-feiertage/nationale-feiertage-node.html` (200 after following its
  cookie-check redirect with a cookie jar): "Durch die Sonn- und Feiertagsgesetze
  der Länder sind jedoch neun Feiertage bundeseinheitlich gesetzlich geschützt:
  Neujahr Karfreitag Ostermontag Christi Himmelfahrt Pfingstmontag 1. Mai Tag der
  Deutschen Einheit erster Weihnachtstag zweiter Weihnachtstag" and "Alle anderen
  Feiertage legen die Länder fest." Easter computed (Meeus/Jones/Butcher):
  2026-04-05, 2027-03-28, 2028-04-16; asserted against **Hessen**
  (innen.hessen.de/buerger-staat/feiertage, 200: Karfreitag 03.04.2026,
  Ostermontag 06.04.2026, Christi Himmelfahrt 14.05.2026, Pfingstmontag
  25.05.2026, Fronleichnam 04.06.2026) and **Rheinland-Pfalz** (mdi.rlp.de
  Sonn- und Feiertagsrecht, 200: 2027 Karfreitag 26.03., Ostermontag 29.03.,
  Christi Himmelfahrt 06.05., Pfingstmontag 17.05., Fronleichnam 27.05.;
  Allerheiligen 01.11.) and gov.uk's Good Friday 2028-04-14. Buß- und Bettag =
  the Wednesday before 23 November: 2026-11-18, 2027-11-17, 2028-11-22.
- 2026-10-04 — **Germany, per Land** (additions to the nine): **BY** Art. 1 FTG
  on gesetze-bayern.de (200): Heilige Drei Könige, Fronleichnam, Allerheiligen;
  Mariä Himmelfahrt "in Gemeinden mit überwiegend katholischer Bevölkerung"
  (served `partial` with scope); 8 August Friedensfest "in der Stadt Augsburg".
  **BE** berlin.de Senatsverwaltung für Inneres (200): "der Frauentag (8. März)".
  **BB** § 2 FTG on bravors.brandenburg.de (200): Ostersonntag, Pfingstsonntag,
  Reformationsfest. **HE** (200): Fronleichnam. **HH** hamburg.de Ferien und
  Feiertage 2026 (200): "Reformationstag: Sa. 31.10.2026". **NI** § 2 NFeiertagsG
  on mi.niedersachsen.de (200): "h) der 31. Oktober, als Reformationstag". **RP**
  (200): Fronleichnam, Allerheiligen. **SN** § 1 SächsSFG PDF on
  recht.sachsen.de (200, pdftotext): Reformationstag, Buß- und Bettag,
  Fronleichnam "(nur in den vom Staatsministerium des Innern durch
  Rechtsverordnung bestimmten Regionen)" → `partial`. **BW, NW, SL, ST** from the
  Hamburg Behörde für Schule und Berufsbildung's "Übersicht über die gesetzlichen
  Feiertage in der Bundesrepublik Deutschland (Stand: September 2018)"
  (hamburg.de PDF, 200, pdftotext, column positions checked against the header):
  BW Hl. Drei Könige/Fronleichnam/Allerheiligen; NW Fronleichnam/Allerheiligen;
  SL Fronleichnam/Mariä Himmelfahrt/Allerheiligen; ST Hl. Drei
  Könige/Reformationstag — official but dated, so it also served to confirm
  MV/TH Reformationstag and the TH partial Fronleichnam (footnote 3). Every Land
  answer carries its own `source`, `quote` where a sentence was read, and
  `verification`. The juris-based Landesrecht portals (BW, BE, HH, HE, MV, RP,
  SL, ST, SH, TH) all answer "Aktivieren Sie bitte JavaScript" to the fetcher;
  recht.nrw.de redirects to a search page; thueringen.de serves a Link11
  CAPTCHA; saarland.de 403.
- 2026-10-04 — **Tax years** (quoted in manual.json → served on every answer):
  UK gov.uk/income-tax-rates (200) "The current tax year is from 6 April 2026 to
  5 April 2027." and Interpretation Act 1978 Sch. 1 (200) "the twelve months
  ending with 31st March" for the government year; US irs.gov Tax years (200)
  "Calendar year – 12 consecutive months beginning January 1 and ending December
  31." and 31 U.S.C. § 1102 (govinfo, 200) "begins on October 1 of each year and
  ends on September 30"; Australia payrolltax.gov.au (200, the state revenue
  offices' joint site) "financial year Each year commencing on 1 July and ending
  30 June." — ato.gov.au 403, legislation.gov.au (ITAA 1997 s 995-1) is a
  JavaScript app, business.gov.au/moneysmart 404/403; India ies.gov.in
  Arthapedia (200) "India's financial year runs from 1st April to 31st March of
  next year." plus incometax.gov.in "Objective and scope of the New Act" (200):
  the Income Tax Act, 2025 repeals the 1961 Act on 01.04.2026 and "A 'Tax year'
  is a period of twelve months contained in a financial year … applicable from
  01 April 2026 … Tax Year 2026-27" — incometaxindia.gov.in and
  indiacode.nic.in 403; Canada ITA s. 249(1)(c) "in any other case, a calendar
  year" and FAA s. 2 "fiscal year means the period beginning on April 1 in one
  year and ending on March 31 in the next year" (laws-lois.justice.gc.ca, both
  200); Germany § 25 EStG and § 4 BHO (gesetze-im-internet.de, 200); France
  service-public.gouv.fr F358 (200) "Déclaration 2026 des revenus 2025" —
  Légifrance (CGI art. 12) 403; Brazil Lei 4.320/1964 art. 34 "O exercício
  financeiro coincidirá com o ano civil." (camara.leg.br, 200); Poland Ordynacja
  podatkowa art. 11 "Rokiem podatkowym jest rok kalendarzowy, chyba że ustawa
  podatkowa stanowi inaczej." (ISAP consolidated PDF, 200, pdftotext).
- 2026-10-04 — **DST**: UK Summer Time Act 1972 s. 1(2) (legislation.gov.uk,
  200; the Act is 1972 c. 6 — `/ukpga/1972/48` is a different Act and 404s)
  "beginning at one o'clock, Greenwich mean time, in the morning of the last
  Sunday in March and ending at one o'clock, Greenwich mean time, in the morning
  of the last Sunday in October"; computed 2026-03-29/10-25, 2027-03-28/10-31,
  2028-03-26/10-29 asserted against gov.uk/when-do-the-clocks-change (200) table
  "2026 29 March 25 October 2027 28 March 31 October 2028 26 March 29 October".
  Germany § 2 SoZV (gesetze-im-internet.de, 200) "letzten Sonntag im März um 2
  Uhr … letzten Sonntag im Oktober um 3 Uhr". US 15 U.S.C. § 260a(a) (govinfo,
  200) "second Sunday of March … first Sunday of November"; computed
  2026-03-08/11-01, 2027-03-14/11-07, 2028-03-12/11-05. Australia
  dcj.nsw.gov.au (200) "begins at 2am on the first Sunday in October and ends at
  3am on the first Sunday in April"; observing/not-observing lists from the same
  page and nsw.gov.au (200: "Sunday 4 October 2026 … Sunday 4 April 2027");
  computed 2026-10-04/2026-04-05, 2027-10-03/2027-04-04, 2028-10-01/2028-04-02
  asserted against those two dates. EUR-Lex (Directive 2000/84/EC) served a bot
  wall (HTTP 202, empty) and legislation.gov.uk's `/eudr/2000/84` has only a
  title page; state legislation sites (NSW, SA, Tas 403; Vic, ACT JavaScript)
  could not be read.
- **Not re-verified on 2026-10-04 (`nonOfficial: true`, re-try each refresh):**
  `de/holidays/HB` and `SH` (Reformationstag — bremen.de/schleswig-holstein.de
  404, the 2018 overview predates their laws), `de/holidays/MV` (Frauentag since
  2023 — regierung-mv.de 404), `de/holidays/TH` (Weltkindertag since 2019 —
  CAPTCHA), `br/tax-year/personal` (Lei 9.250/1995 ano-calendário —
  planalto.gov.br resets connections, normas.leg.br JavaScript), `fr/dst`
  (directive/décret text unread; rule identical to the fetched German SoZV),
  `br/dst` (Decreto 9.772/2019 text unreachable).
- **Counts committed:** holidays uk 82, us 33, de 561 (17 regions × 3 years),
  fr 72; 9 tax-year countries; 6 DST countries. `data/calendar.json` ≈ 138 KB
  (97 KB compact). Window fixed at 2026–2028 even though OPM (to 2030) and
  calendrier.api.gouv.fr (5 years ahead) publish further: gov.uk stops at 2028
  and the German/DST rules were only cross-checked that far — widen by adding
  the year to `manual.json` `years` and re-running.
