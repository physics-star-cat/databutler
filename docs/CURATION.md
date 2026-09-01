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
| `data/sources.json` | After every data refresh (automatic via `scripts/changelog.js`) | `node scripts/sources.js` re-checks every source URL (gov.uk content API / page hash). |
| `data/changelog.json` | With every data refresh | `node scripts/changelog.js`; fill in `note` lines. See "Changelog & source watcher". |

## Verification log

- 2026-08-31 — rates 2026-27: all 10 categories fetched from live gov.uk
  pages (income tax, NI via employer rates page, NMW, student loans, VAT,
  ISA + LISA, new State Pension, SDLT, CGT, pension AA).
- 2026-08-31 — AQA GCSE: Physics 8463, Biology 8461, Chemistry 8462,
  Combined Science Trilogy 8464, Maths 8300 — all from live AQA
  specification-at-a-glance pages. Notable verified quirks: Trilogy Physics
  Paper 2 has NO Space physics; Maths has no topic→paper mapping (any topic,
  any paper; Paper 1 non-calculator).

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
   (`api/cron/watch-sources.js`, Mondays 06:00 UTC), or a Budget/spec change
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

The citation pages (`/r/<route>`) track their own traffic with a
`cite_page_view` GA4 event, not `agent_*` — so webmon's agent-usage counts
exclude citation-page views by design.

A front-door `call` emits both `agent_mcp_call` and `agent_mcp_call_<inner>` —
one event for the front-door hit, one for the tool it delegated to — so the
second event exists to show which long-tail tools get called often enough to
deserve promotion to the front door. webmon sums `total_calls` over events
whose name does not start with `agent_mcp_call_`, so a delegated call is
counted once, not twice.
