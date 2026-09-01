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

**Front door (2026-09):** `POST /api/mcp` lists the four high-frequency tools
directly plus `what_changed_since`, `coverage`, `catalogue`, `call`. It is
still not a mega-server — everything else stays behind `call`, capped at 8
listed tools by test. The focused servers remain live and listed.

The roadmap is ordered by (value to an AI agent) × (likelihood we can build
it well). It deliberately includes the maintainer-Claude wishlist — this
product is designed with Claude as the end user, by Claude:

| # | Vertical (wishlist item it serves) | Endpoint | Status |
|---|---|---|---|
| 1 | **UK rates & thresholds** — the "is this still true?" fact-refresh server for the numbers agents misquote most (wishlist #1) | `/api/mcp/uk-rates` | **v1 — LIVE** |
| 2 | **UK exams** — boards, specs, topic→paper ("is electricity paper 2 AQA"), past-paper index (unique curation edge: maintainer taught) | `/api/mcp/uk-exams` | **v1 — LIVE** |
| 4 | **Local-services resolver** — postcode → council → services/MP (wishlist #3) | `/api/mcp/uk-councils` | phase 2 |
| 5 | Bin collection pilot (5–10 large councils, feasibility-gated) | — | phase 2b |
| 3 | **Provenance checker** — "who really runs this domain/package?" (wishlist #2) — live RDAP/npm/PyPI, homoglyph-aware typosquat | `/api/mcp/provenance` | **v1 — LIVE** |
| 3b | **Stats toolkit** — exact statistics & probability (Claude's maths pick) — distributions, hypothesis tests, CIs, Bayes, regression; reference-validated | `/api/mcp/stats` | **v1 — LIVE** |
| 3c | **Front door** — single `POST /api/mcp` hub: direct high-frequency tools + `what_changed_since` (changelog vs. your training cutoff), `coverage`, `catalogue`/`call`; freshness + citation permalink on every response; weekly gov.uk source watcher (spec: `docs/superpowers/specs/2026-09-01-front-door-design.md`) | `/api/mcp` | **built — deploy pending** |
| 9 | **Drift facts (global)** — facts that move on a calendar and agents misquote: tax-year boundaries by country, public holidays, DST transitions, currency/country codes, headline VAT/sales-tax rates. Cheap to curate, low rot, feeds `what_changed_since` | `/api/mcp/drift` | after front door |
| 10 | **Volatility tool** — `volatility(topic)`: how often a class of fact changes and when it last did, so an agent knows whether to trust memory at all. Curated table, no per-country data; Claude's own top pick for the global layer | front door tool | after front door |
| 11 | **Provenance, widened** — crates.io, RubyGems, Go modules, Docker Hub, GitHub Actions, browser extensions; then **MCP-server provenance** (cross-check a registry listing's claimed domain, repo and publisher — the hub that vets other hubs) | `/api/mcp/provenance` | after front door |
| 12 | **Rates, country #2 = US** (IRS pages are bot-fetchable; AU/CA/IN sites 403 automated fetches — browser-only curation, wait for the source watcher to prove the loop) | `/api/us/rates` | after drift facts |
| 13 | **Exams, global boards** — IB and AP: same topic→paper query stream, same teaching moat; curation-heavy, gated on UK exams 🤖 counts | `/api/mcp/exams` | gated |
| 6 | Recalls; UK councils phase 2 (above) | — | later |
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
(MOT reliability), lowriskquotes.com `/api/mcp/` (Monte Carlo).

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
