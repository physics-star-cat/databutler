# Data Butler (databutler.dev)

**An agent honeypot: clean, verified UK public data served to AI agents via
MCP and REST.** Not an SEO play — no GSC ambitions. The customer is an AI
assistant answering a human's question; the product is being the source that
is *right*, with provenance on every number.

- Planned domain: **databutler.dev** (until purchased/connected, the
  Vercel default `databutler.vercel.app` works, but registry listings must
  NOT be published until the final domain is live — listings bake in URLs).
- Status: **LIVE** (launched 2026-08-31): https://databutler.dev — REST +
  MCP serving, domain attached, listed on Smithery
  (drchriseames/databutler-uk-exams, -uk-rates) and the official MCP
  Registry (io.github.physics-star-cat/databutler-uk-exams, -uk-rates).
  Tracking LIVE (GA4 property 552213153, verified in realtime; monitored by webmon 🤖 column).
  PulseMCP will auto-ingest from the official registry. Front door `POST /api/mcp` —
  built 2026-09-01 on branch feat/front-door; listing as
  `io.github.physics-star-cat/databutler` / Smithery `drchriseames/databutler`
  pending deploy.
- Born 2026-08-31 out of the agent-API work on whatbreaks.uk (MOT data) and
  lowriskquotes.com (Monte Carlo) — full history in
  `../docs/AUDIT_2026-08-30_five-sites.md` §3b–3e and
  `../docs/MONETISATION-DECISION.md`.

## The model (one brand, many focused servers)

There is no domain authority in MCP registries — discovery is per-listing.
So this is NOT one mega-server (tool-list bloat kills those); it is one
domain/repo/brand hosting **separate, focused MCP endpoints**, each listed
individually under one namespace, cross-referencing each other:

**Front door (2026-09):** `POST /api/mcp` lists the five high-frequency tools
directly plus `what_changed_since`, `coverage`, `catalogue`, `call`. It is
still not a mega-server — everything else stays behind `call`, capped at 9
listed tools by test. The focused servers remain live and listed.

The roadmap is ordered by (value to an AI agent) × (likelihood we can build
it well). It deliberately includes the maintainer-Claude wishlist — this
product is designed with Claude as the end user, by Claude:

<!-- sync-areas:roadmap start -->
| # | Vertical (wishlist item it serves) | Endpoint | Status |
|---|---|---|---|
| 1 | **UK rates & thresholds** — the "is this still true?" fact-refresh server for the numbers agents misquote most (wishlist #1) | `/api/mcp/uk-rates` | **v1 — LIVE** |
| 2 | **UK exams** — boards, specs, topic→paper ("is electricity paper 2 AQA"), past-paper index (unique curation edge: maintainer taught) | `/api/mcp/uk-exams` | **v1 — LIVE** |
| 3 | **Provenance checker** — "who really runs this domain/package?" (wishlist #2) — live RDAP/npm/PyPI, homoglyph-aware typosquat | `/api/mcp/provenance` | **v1 — LIVE** |
| 4 | **Stats toolkit** — exact statistics & probability (Claude's maths pick) — distributions, hypothesis tests, CIs, Bayes, regression; reference-validated | `/api/mcp/stats` | **v1 — LIVE** |
| 5 | **Vehicles hub** — UK MOT failure data (live proxy to whatbreaks.uk), UK safety recalls (DVSA, 4,876 recalls since 2016), French recalls (RappelConso, 1,663 fiches), Japanese recalls + owner complaints (MLIT, 75 models); EU Safety Gate stub | `/api/mcp/vehicles` | **v1 — built 2026-10-03** |
| 6 | **Take-home pay** — `take_home_pay` for us, uk, ca, au, in, br, de, fr, pl (+ es listed, covered:false): live proxy to the LifeByNumbers salary calculators (same operator), uniform shape (gross/net/deductions annual + monthly, typed breakdown, taxYear, assumptions). Listed at the front door — the highest-frequency money question after rates | `/api/mcp/tax` | **v1 — built 2026-10-03** |
| 7 | **Software end-of-life** — "is this version still supported, and until when" for the 14 runtimes/OSes agents are asked about most (Node.js, Python, Ubuntu, Debian, Android, iOS, macOS, Windows, Oracle JDK, Go, Ruby, PHP, PostgreSQL, React): committed monthly snapshot of endoflife.date open data (MIT, 340 cycles), version → cycle resolution, days remaining/since, changelog entries when a cycle reaches EOL or a date moves | `/api/mcp/software-eol` | **v1 — built 2026-10-03** |
| 8 | **Policy rates** — `policy_rate`: the three most-asked central-bank rates (BoE Bank Rate, Fed federal funds target range, ECB key rates) as committed, changelogged, source-watched data; the first global step of the "is this still true?" layer (#9, #12). Freshness `due` after 45 days; eight decisions a year each | `/api/mcp/policy-rates` | **v1 — built 2026-10-03** |
| 9 | **US federal rates & thresholds** — `us_rates_lookup`: tax year 2026 income-tax schedules and standard deduction, Social Security wage base, Medicare, retirement-plan/IRA, HSA and estate-gift figures read from the IRS revenue procedures, notices and SSA's Federal Register notice, each with the quoted sentence and prior-year value (wishlist #12, "Rates, country #2 = US"); first country after the UK on the "is this still true?" layer | `/api/mcp/us-rates` | **v1 — built 2026-10-03** |
| 10 | **German rates & thresholds** — `de_rates_lookup`: Veranlagungszeitraum 2026 Einkommensteuertarif (§ 32a) and Solidaritätszuschlag, Sozialversicherung Beitragsbemessungsgrenzen, Rechengrößen and Beitragssätze, Mindestlohn (2026 and the fixed 2027 step), Geringfügigkeitsgrenze, Kindergeld, Kinderfreibetrag, Pauschbeträge and Entfernungspauschale, read from the consolidated statutes and the Bundesgesetzblatt with German term + English label, quoted sentence and prior value; country #3 on the "is this still true?" layer | `/api/mcp/de-rates` | **v1 — built 2026-10-03** |
<!-- sync-areas:roadmap end -->

Planned, parked and out of scope (hand-maintained — these are not area modules):

| # | Vertical (wishlist item it serves) | Endpoint | Status |
|---|---|---|---|
| 4 | **Local-services resolver** — postcode → council → services/MP (wishlist #3) | `/api/mcp/uk-councils` | phase 2 |
| 5 | Bin collection pilot (5–10 large councils, feasibility-gated) | — | phase 2b |
| 3c | **Front door** — single `POST /api/mcp` hub: direct high-frequency tools + `what_changed_since` (changelog vs. your training cutoff), `coverage`, `catalogue`/`call`; freshness + citation permalink on every response; weekly gov.uk source watcher (spec: `docs/superpowers/specs/2026-09-01-front-door-design.md`) | `/api/mcp` | **built — deploy pending** |
| 9 | **Drift facts (global)** — facts that move on a calendar and agents misquote: tax-year boundaries by country, public holidays, DST transitions, currency/country codes, headline VAT/sales-tax rates. Cheap to curate, low rot, feeds `what_changed_since` | `/api/mcp/drift` | after front door |
| 10 | **Volatility tool** — `volatility(topic)`: how often a class of fact changes and when it last did, so an agent knows whether to trust memory at all. Curated table, no per-country data; Claude's own top pick for the global layer | front door tool | after front door |
| 11 | **Provenance, widened** — crates.io, RubyGems, Go modules, Docker Hub, GitHub Actions, browser extensions; then **MCP-server provenance** (cross-check a registry listing's claimed domain, repo and publisher — the hub that vets other hubs) | `/api/mcp/provenance` | after front door |
| 12c | **Rates, further countries** — AU/CA/IN sites 403 automated fetches (browser-only curation); US and Germany are built (roadmap above) | `/api/<cc>/rates` | after the source watcher proves the annual loop on us-rates/de-rates |
| 13 | **Exams, global boards** — IB and AP: same topic→paper query stream, same teaching moat; curation-heavy, gated on UK exams 🤖 counts | `/api/mcp/exams` | gated |
| 6b | UK councils phase 2 (above) | — | later |
| 7 | **Current-docs for libraries** (wishlist #4) | — | parked — Context7 et al. exist; only enter if a clearly underserved niche appears |
| 8 | **Infra-config/auth broker** (wishlist #5) | — | out of scope — VC-scale product, documented so we stop re-litigating it |

**Global direction (added 2026-09-01):** the niche is *verified reference
facts with provenance and change history* — not docs, not search. Provenance
and stats are already country-free; the country-prefixed paths take more
countries without renames. Rule: no vertical that depends on scraping sites
that block bots until the source watcher (#3c) has proven the maintenance loop.

Rationale for the order: #1 is the highest-frequency, lowest-build-cost,
most correctness-critical item — every agent answering UK money questions
needs it weekly and gets it wrong from memory. #2 has the strongest
curation moat (domain expertise) and a huge natural query stream. #3–#5
each need real engineering programmes; they wait for evidence of demand
(agent_* event counts) from #1/#2.

Existing family members on their own domains: whatbreaks.uk `/api/mcp`
(MOT reliability), lowriskquotes.com `/api/mcp/` (Monte Carlo), and
lifebynumbers.net (the Flask/Lambda salary calculators behind `take_home_pay`).

<!-- sync-areas:catalogue start -->
## Tool catalogue (27 tools, 10 focused servers + front door)

| Server | Tools | Data |
|---|---|---|
| `/api/mcp/uk-rates` | `uk_rates_lookup` | `data/uk/rates/<taxYear>.json`, verified against gov.uk |
| `/api/mcp/uk-exams` | `exam_topic_paper`, `exam_spec_lookup`, `exam_paper_index` | `data/uk/exams/*.json`, verified against board spec pages |
| `/api/mcp/provenance` | `domain_provenance`, `package_provenance` | live RDAP / npm / PyPI |
| `/api/mcp/stats` | `descriptive_stats`, `distribution`, `hypothesis_test`, `confidence_interval`, `bayes_update`, `linear_regression` | pure computation, reference-validated |
| `/api/mcp/vehicles` | `uk_mot_reliability`, `uk_mot_vehicle_search` (live proxy → whatbreaks.uk, 8 s timeout, UA `databutler-hub/1.0`); `uk_recalls_for_model`, `uk_recalls_search` (`data/vehicles/uk-recalls.json`, DVSA bulk CSV, Open Government Licence v3.0, recalls launched in the last ten calendar years); `fr_recalls_for_model`, `fr_recalls_search` (`data/vehicles/fr-recalls.json`, RappelConso V2 open data, Licence Ouverte 2.0); `jp_recalls_for_model`, `jp_complaints_summary` (`data/vehicles/jp-recalls.json`, MLIT); `eu_safety_gate_recalls` (**stub**) | regenerate with `node scripts/vehicles.js` — FR/JP from the sibling `car_websites/` repos after their fetchers run, UK straight from DVSA (`node scripts/vehicles.js uk`) |
| `/api/mcp/tax` | `take_home_pay` — country ∈ {us, uk, ca, au, in, br, de, es, fr, pl}, gross (annual, or monthly with `period`), optional `state`/`filingStatus` (US), `province` (CA), `region` (UK) | live proxy → LifeByNumbers Lambda `POST /calculate {calculatorId:'<cc>-salary', input}` (8 s timeout, UA `databutler-hub/1.0`); contract + per-country fields + tax years documented in `api/_tax.js`. **Spain returns `covered:false`** — lifebynumbers.net computes it client-side, no backend calculator. Tax years are hard-coded upstream and mirrored in `_tax.js` `COUNTRIES[].taxYear`: re-check when LBN updates rates |
| `/api/mcp/software-eol` | `support_status` {product, version} — resolves "18", "18.19.0", "3.11", "22.04", "bookworm", "1.8.0_392", "11-24h2-w" to its release cycle; supported true\|false as of today, eol date, days remaining/since, active/extended-support ends, LTS, latest release, newest supported (LTS) cycle, plain-statement recommendation; `support_timeline` {product} — every cycle. Products: nodejs, python, ubuntu, debian, android, ios, macos, windows, oracle-jdk (java/jdk alias; the site has no "java" product — /java redirects to its java-distribution tag), go, ruby, php, postgresql, react | `data/software-eol.json` (65 KB, 340 cycles): monthly snapshot of endoflife.date `/api/<product>.json`, MIT License, `upstreamProvenance` on every result; regenerate with `node scripts/software-eol.js` (appends `software-eol` changelog entries: first derivation → `<product>/dataset`; afterwards `<product>/<cycle>` when an eol date moves, a cycle reaches end of life between snapshots, or a new cycle appears) |
| `/api/mcp/policy-rates` | `policy_rate` — bank ∈ {boe, fed, ecb}, optional `all: true` | `data/policy-rates.json`: Bank of England Bank Rate, Fed federal funds target range (lower/upper bound), ECB deposit facility / main refinancing / marginal lending — current level, effectiveFrom, decisionDate + meeting, previous level, latest decision (may be a hold), next scheduled decision, the bank's own page as `source` and the decision press release. **Committed data, not a live proxy**, verified against the banks' pages; freshness turns `due` 45 days after verifiedDate; the three source pages sit in `data/sources.json` for the weekly watcher. Refresh: edit the file against the pages, `node scripts/changelog.js` (docs/CURATION.md) |
| `/api/mcp/us-rates` | `us_rates_lookup` — category ∈ {income-tax, social-security, medicare, retirement, hsa, estate-gift} (omit to list) | `data/us-rates.json` (tax year 2026, 43 figures): read from Rev. Proc. 2025-32, Notice 2025-67, Rev. Proc. 2025-19, SSA's Federal Register notice 2025-19763, Publication 15 and Tax Topic 751; every figure carries `quote` (the sentence or table row) and `previous` (the prior-year value). Rate schedules are bracket rows. **Committed data, not a live proxy**; freshness turns `due` at the IRS release window set by hand in `nextScheduledRefresh`. Refresh annually: edit against the new Rev. Proc./Notice, `node scripts/changelog.js` (docs/CURATION.md) |
| `/api/mcp/de-rates` | `de_rates_lookup` — category ∈ {income-tax, social-insurance, minimum-wage, minijob, kindergeld, kinderfreibetrag, sparer-pauschbetrag, arbeitnehmer-pauschbetrag, entfernungspauschale} (omit to list) | `data/de-rates.json` (Veranlagungszeitraum 2026, 44 figures): read from § 32a/§ 9/§ 9a/§ 20/§ 32/§ 66 EStG, §§ 3–4 SolzG, SV-Rechengrößen-VO 2026 (BGBl. 2025 I Nr. 278), § 241 SGB V, § 341 SGB III, § 55 SGB XI + PBAV 2025, § 8 SGB IV, MiLoV5 and the BMG/DRV/BMAS/BMFSFJ/Minijob-Zentrale pages; every figure carries `term` (German), `label` (English), `quote` and `previous`; social-insurance rates carry `employeeShare`/`employerShare`. **Committed data, not a live proxy**; freshness turns `due` at the hand-set `nextScheduledRefresh` (mid-December, when the next year's Verordnung and Zusatzbeitrag are final). Refresh: edit against the BGBl/statutes, `node scripts/changelog.js` (docs/CURATION.md) |
| `/api/mcp` (front door) | the five high-frequency tools above (`uk_rates_lookup`, `exam_topic_paper`, `domain_provenance`, `package_provenance`, `take_home_pay`) + `what_changed_since`, `coverage`, `catalogue`, `call` | — |

REST mirrors: `/api/uk/rates`, `/api/uk/exams/topic`, `/api/uk/exams/specs`, `/api/uk/exams/papers`, `/api/provenance/domain`, `/api/provenance/package`, `/api/stats`, `/api/vehicles/uk/mot`, `/api/vehicles/uk/search`, `/api/vehicles/uk/recalls`, `/api/vehicles/uk/recalls-search`, `/api/vehicles/fr/recalls`, `/api/vehicles/fr/search`, `/api/vehicles/jp/recalls`, `/api/vehicles/jp/complaints`, `/api/vehicles/eu/safety-gate`, `/api/tax/take-home`, `/api/software-eol/status`, `/api/software-eol/timeline`, `/api/policy-rates`, `/api/us/rates`, `/api/de/rates`.
<!-- sync-areas:catalogue end -->

Every tool carries `title` and MCP annotations (`readOnlyHint: true`,
`destructiveHint: false`, `openWorldHint` true only for live fetches).
Privacy statement: `/privacy`.

## Adding an area

Every curated area is one module under `api/_areas/` (contract:
`api/_areas/README.md`) plus its data file, its test and a CURATION section;
registry, routes, coverage, freshness, changelog, `/api`, llms.txt, sitemap,
discovery document and this README's tables all derive from it. Start with
`node scripts/new-area.js <slug> --title "…" --cadence "…"` and follow
**`docs/ADDING_AN_AREA.md`**. `node scripts/sync-areas.js --check` tells you
when a generated block here is stale.

## The changelog is a product

"What changed in the official facts" is served in its own right, not only as
a tool an agent calls. One data file (`data/changelog.json`, script-generated,
maintainer-noted) feeds every surface:

| Surface | URL | For | Notes |
|---|---|---|---|
| Page | `GET /changes` (`?area=`, `?since=`) | humans, search engines | Indexable, canonical + `rel=alternate` to the feeds; newest first, grouped by month; each entry shows area, from → to, effectiveFrom, official source, maintainer note, verifiedDate. `Cache-Control: public, max-age=300, s-maxage=3600`; bad filter → 400, no-store. |
| RSS 2.0 | `GET /changes.rss` (`?area=`) | feed readers, Slack/Discord RSS bots | guid = `https://databutler.dev/changes#<area-key-verifiedDate>` (isPermaLink), link = official source, pubDate = verifiedDate. Byte-stable until the data changes. |
| Atom | `GET /changes.atom` (`?area=`) | feed readers | Same entries as RSS. |
| JSON | `GET /api/changes?since=&area=&format=json` | agents, scripts | Envelope unchanged; `format=html\|rss\|atom` hands off to the page/feeds. |
| MCP | `what_changed_since` on `POST /api/mcp` | agents | "Pass your training cutoff" view of the same entries. |
| Sitemap | `/sitemap.xml` | crawlers | `/`, `/changes`, the four `?area=` views, `/privacy`, `/api`. |

### The Verified Changes protocol (v0.1)

The shape above is written down as an open convention any site can publish
and any assistant can consume — `docs/CHANGES_PROTOCOL.md`, served indexable
at `/protocol` (`?format=md` for the markdown; handler
`api/_routes/protocol.js`, renderer `api/_markdown.js`). Data Butler is the
reference implementation:

| Artefact | Where |
|---|---|
| Discovery document | `public/.well-known/changes.json` → `/.well-known/changes.json` (areas, cadence, endpoints, schema, licence, contact) |
| JSON Schemas (draft 2020-12) | `public/schema/changes.v0.json` (document + `$defs/entry`), `public/schema/well-known-changes.v0.json` |
| Validator | `api/_schema_check.js` — hand-rolled subset (type/required/enum/pattern/format/$ref), no dependencies; `tests/protocol.test.js` validates `data/changelog.json`, the discovery document and the live `/api/changes` output against the schemas |
| Conforming output | `GET /api/changes` and `what_changed_since` carry `protocol`, `schema`, `publisher`, `generated` |

Bumping the version: change `PROTOCOL` in `api/_changelog.js`, add a new
schema file (keep the old one — URLs are forever), update the `const` in
both schemas and the discovery document, and the spec's Versioning section.

Handlers: `api/_routes/changes-page.js`, `api/_routes/changes-feed.js`
(routes `changes-page`, `changes-feed` in `api/router.js`; rewrites in
`vercel.json` ahead of the generic `/api/(.+)` one). Rendering is pure in
`api/_changes_render.js`; `api/_changelog.js` exposes `listEntries` and
`entryId`. How entries get written: `docs/CURATION.md` → "How to add a
changelog entry when a dataset is refreshed".

## Iron rules (learned the hard way)

1. **No fabricated data, ever.** Every record carries `source` (official
   URL), `verifiedDate`, and where relevant `specVersion`/`taxYear`. The
   seed-data-that-claimed-to-be-TÜV episode is the cautionary tale.
2. **Copyright: index, don't host.** Past papers are exam-board copyright.
   We serve *metadata and official links*, never the PDFs.
3. **URLs are forever.** Trailing/exact endpoint URLs get baked into
   registry listings and agent configs — don't rename after publishing.
4. **Track from day one.** GA4 Measurement Protocol events (`agent_*`),
   anonymous, reported by `../webmon/`.

## Key docs

- `docs/SPEC.md` — full design: architecture, tool schemas, data model,
  curation workflow, rollout checklist, monetisation posture.
- `../docs/MONETISATION-DECISION.md` — when/how the x402 switch gets flipped
  (requires the paid domain on Cloudflare; impossible on *.vercel.app).
