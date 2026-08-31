# Data Butler (databutler.dev) — design spec

Written 2026-08-31. Approved verticals: **exams** + **rates** (user choice).
Name: databutler.dev. Lives in its own folder/repo, separate from the
other site repos.

## 1. Mission & positioning

Serve AI agents the UK public data they can't derive or shouldn't trust
themselves on. Success metric: `agent_*` event counts (GA4/webmon), registry
usage stats — **not** search traffic. Free with attribution during
adoption; the x402/Cloudflare monetisation option follows the decision
framework in `../../docs/MONETISATION-DECISION.md`.

## 2. Architecture

Copied from the proven whatbreaks pattern (framework-null Vercel, repo-root
functions, stateless streamable-HTTP MCP):

```
databutler/
├── api/
│   ├── _lib.js              # CORS, provenance/attribution, sendJson
│   ├── _track.js            # GA4 MP events (needs new GA4 property)
│   ├── index.js             # GET /api — self-documenting index
│   ├── uk/                  # country prefix — country #2 slots in beside it
│   │   ├── exams/           # REST: /api/uk/exams/*
│   │   │   ├── topic.js     #   ?board=aqa&subject=physics&level=gcse&topic=electricity
│   │   │   ├── specs.js     #   spec metadata search
│   │   │   └── papers.js    #   past-paper index (metadata + official links)
│   │   └── rates.js         #   /api/uk/rates?category=income-tax[&year=2026-27]
│   └── mcp/
│       ├── uk-exams.js      # POST /api/mcp/uk-exams  (MCP server 1)
│       └── uk-rates.js      # POST /api/mcp/uk-rates  (MCP server 2)
├── data/
│   ├── uk/exams/            # curated JSON per board+subject+level
│   └── uk/rates/            # one JSON per tax year
├── public/  (llms.txt, robots.txt allowing AI crawlers, index page)
├── docs/SPEC.md (this file) + CURATION.md (refresh workflow)
└── vercel.json
```

MCP servers: stateless JSON-RPC 2.0 (`initialize`, `ping`, `tools/list`,
`tools/call`; notifications→202), CORS-open, no auth, attribution +
provenance in every response. Registry names:
`io.github.physics-star-cat/databutler-uk-exams` and `databutler-uk-rates`.

## 3. Exams vertical (the teacher insight is the product)

The core query is a student asking their AI *"is electricity paper 2 AQA"*.
So the primary tool answers topic→paper directly:

- **`exam_topic_paper`** (MCP) / `GET /api/uk/exams/topic`:
  `{board, subject, level, topic}` → which paper(s) the topic appears on,
  the spec code, topic number, sibling topics on each paper, and the
  official spec URL. Fuzzy topic matching ("electricity", "electromagnetism",
  "forces").
- **`exam_spec_lookup`**: board/subject/level → spec code, paper structure
  (count, duration, calculator?, tiers), assessment weightings, first-taught
  year, official spec link.
- **`exam_paper_index`**: board+subject+level(+year) → list of past series
  with links to the board's official question paper / mark scheme /
  examiner report pages. **Metadata and links only — never hosted PDFs**
  (board copyright; PMT-style archives operate on permissions we don't have).

**v1 data scope** (quality over breadth): GCSE sciences + maths + English
for AQA, Edexcel, OCR (the three big English boards) — the highest-volume
"which paper" subjects. A-level sciences/maths next. Every record:
`{specCode, specVersion, source (official spec URL), verifiedDate}`.
Curation is manual against the official spec PDFs — **no figure ships
unverified**, and web-verification happens at curation time, not from
memory. `docs/CURATION.md` will hold the per-board checklist.

## 4. Rates vertical

- **`uk_rates_lookup`** (MCP) / `GET /api/uk/rates?category=…`:
  categories v1: `income-tax`, `national-insurance`, `student-loans`,
  `minimum-wage`, `stamp-duty`, `isa`, `pensions`, `vat`, `capital-gains`,
  `state-pension`. Returns the current tax year's figures (and prior year on
  request), each figure `{value, taxYear, source (gov.uk URL), verifiedDate}`.
- One JSON file per tax year in `data/uk/rates/`; a quarterly refresh task
  (gov.uk pages are the source of truth; several return 403 to bots — the
  CLAUDE.md rate-limits note applies, so curation may need the browser).
- This vertical exists because models confidently quote stale thresholds —
  correctness-critical beats compute-heavy.

## 5. Cross-cutting

- **Tracking**: new GA4 property "databutler" + MP secret; `agent_api_*` /
  `agent_mcp_*` events; add property to `webmon/sites.py` so the 🤖 column
  covers it. (Note: webmon's sites.py currently asserts every property has
  GSC — databutler may skip GSC; handle gracefully.)
- **llms.txt + robots.txt** with AI-crawler allows, self-documenting
  `/api` index — same as the other sites.
- **Phase 2** (only after v1 shows usage): councils postcode resolver →
  bins pilot (5–10 big councils, feasibility-gated — scraper brittleness is
  the risk), recalls, second country.
- **Explicitly out of scope**: Gemini's enterprise plays (security gateway,
  auth broker, sandboxes) — VC-scale products, wrong fit for this operation.

## 6. Launch checklist (in order)

1. User buys **databutler.dev** (~£10/yr) — required for the Cloudflare/
   x402 path; *.vercel.app can never be monetised that way. Cloudflare DNS
   like the other domains.
2. Push repo to GitHub (`physics-star-cat/databutler`, private fine).
3. User imports repo as a new Vercel project (dashboard, 2 min — API token
   is dead) and attaches the domain.
4. GA4 property + MP secret — DONE 2026-08-31 (property 552213153, GA4_MEASUREMENT_ID=G-H34VHWQJHD + GA4_MP_API_SECRET set in Vercel via clipboard paste; verified in realtime).
5. Build + verify endpoints live (curl suite like whatbreaks).
6. Only then: publish both MCP servers to Smithery + official registry
   (URLs are forever), llms.txt cross-links from the family sites.

## 7. Risks, named

- **Data rot** is the #1 product risk — a wrong paper mapping or stale
  threshold destroys the only asset (trust). Mitigation: verifiedDate on
  everything, quarterly refresh calendar, small verified scope > big
  unverified scope.
- **Copyright** (exams): links-only policy, revisit if a board objects.
- **Adoption may be slow** — same posture as MOT API: free, attributed,
  measured, reviewed monthly alongside MONETISATION-DECISION.md.

## 8. Provenance vertical (added 2026-08-31, wishlist #2)

The "who really runs this?" checker — Claude's own most-wanted (see the
maintainer wishlist in the README roadmap). Unlike rates/exams it holds **no
dataset to rot**: everything is computed **live per request** from public
sources, which sidesteps the #1 product risk entirely.

Sources (all verified fetchable 2026-08-31): **RDAP** (`rdap.org` redirector →
domain registration date, registrar, nameservers, status), **npm**
(`registry.npmjs.org/<pkg>`), **PyPI** (`pypi.org/pypi/<pkg>/json`).

Tools (`/api/mcp/provenance`, REST mirror `/api/provenance/*`):

- **`domain_provenance`** `{domain}` → registration/expiry dates + age, registrar,
  nameservers, status; **typosquat check**: edit-distance and substring match of
  the registrable label against a curated list of high-value brands.
- **`package_provenance`** `{ecosystem: npm|pypi, name}` → first-publish date,
  release count, latest version, maintainers, linked repo; typosquat check
  against popular package names.

**Framing rule (critical):** descriptive, never accusatory. Return the signals
("registered 4 days ago; edit-distance 1 from stripe.com; registrant redacted")
and let the calling agent judge. We NEVER assert "this is the official X" or
"this is a phishing site" — that needs an endless allowlist and invites being
wrong. `data/provenance/popular.json` is a curated *reference* list for
typosquat distance only, not a claim of officialness.

Caveats handled: RDAP/registry rate-limits and redaction → short timeouts,
partial results returned gracefully rather than failing.
