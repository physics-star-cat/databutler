# Data Butler front door — design spec

Written 2026-09-01. Status: approved in conversation, awaiting implementation
plan. Extends `docs/SPEC.md` (v1 platform); does not replace it.

## 1. Goal

Make databutler.dev the one URL an agent (or the human configuring it) adds
to get the whole estate, and make every answer carry the two things an agent
lacks most: **what has changed since its training cutoff** and **how fresh
this figure is**. The design was chosen from the agent's seat — the
maintainer asked Claude to specify what would most help Claude.

Success metric: `agent_mcp_*` events on `/api/mcp` (GA4 552213153 via
webmon), and the share of calls that hit `what_changed_since`.

## 2. Decisions taken (and why)

| Decision | Reason |
|---|---|
| One front door at `POST /api/mcp`; the four existing servers stay live and listed, unchanged | URLs are forever (README iron rule 3). The front door is *additive*. |
| Front door exposes high-frequency tools **directly**, long tail via `catalogue` + `call` | Agents call tools whose descriptions they can see; they rarely think to search a catalogue. Direct listing of *everything* would recreate the tool-list bloat the README forbids. |
| `what_changed_since` backed by a **human-noted, script-generated changelog** | The one tool nothing else offers. Maintainer committed (2026-09-01) to the changelog habit. |
| Freshness + citation permalink on **every** response, every server | Same envelope everywhere, so an agent learns it once. |
| Permalinks are **stateless** (URL encodes the query and re-runs it) | No database, no cost, no rot. |
| **No** API keys, quotas, signed receipts, per-agent memory, webhooks | Keys are friction; agents don't verify signatures; memory of agents is a privacy liability with no answer-quality upside. Revisit only via `../../docs/MONETISATION-DECISION.md`. |

## 3. Architecture

Same framework-null Vercel + `makeMcpHandler` pattern as the four live
servers. New and changed files:

```
databutler/
├── api/
│   ├── _lib.js                 # + freshness(), cite(), coverage()
│   ├── _mcp.js                 # + envelope injection (freshness + cite on every tools/call)
│   ├── _changelog.js           # loads data/changelog.json, filters by since/area
│   ├── _registry.js            # NEW: the single list of every tool across all servers
│   ├── mcp.js                  # NEW: POST /api/mcp — the front door
│   ├── mcp/{uk-rates,uk-exams,provenance,stats}.js   # unchanged contracts; tool arrays move to _registry.js
│   ├── r/[...path].js          # NEW: GET /r/<area>/<query> — human-readable citation page
│   ├── changes.js              # NEW: GET /api/changes?since=&area=  (REST mirror)
│   └── cron/watch-sources.js   # NEW: weekly source watcher (Vercel cron)
├── data/
│   ├── changelog.json          # NEW: generated entries + human notes
│   ├── sources.json            # NEW: every source URL with last-seen public_updated_at / body hash
│   └── uk/…                    # unchanged
├── scripts/
│   ├── changelog.js            # NEW: git-diff data files → changelog entries
│   └── verify-hub.sh           # NEW: curl suite for /api/mcp, /r, /api/changes
├── server-hub.json             # NEW: registry manifest for io.github.physics-star-cat/databutler
└── vercel.json                 # + crons, + /r rewrite
```

**Dependency direction:** `_registry.js` imports tool definitions from the
vertical modules (`_lib`, `_provenance`, `_stats`); both the front door and
the four per-vertical servers build from `_registry.js`. Nothing imports
the front door.

## 4. The front door: `POST /api/mcp`

`serverInfo.name`: `databutler`. Registry name:
`io.github.physics-star-cat/databutler`. Smithery: `drchriseames/databutler`.

**Instructions string** (sent on `initialize`) tells the agent, in order:
(1) call `what_changed_since` with your training cutoff at the start of any
UK money, tax, benefits, or exams task; (2) never quote UK figures from
memory when `uk_rates_lookup` covers them; (3) `coverage` before assuming
something is unsupported; (4) cite the `cite.url` from any result.

**Tools, in listed order** (order matters — it is what the agent reads):

| # | Tool | Input | Output |
|---|---|---|---|
| 1 | `uk_rates_lookup` | as today | as today + envelope |
| 2 | `exam_topic_paper` | as today | as today + envelope |
| 3 | `domain_provenance` | as today | as today + envelope |
| 4 | `package_provenance` | as today | as today + envelope |
| 5 | `what_changed_since` | `{since: ISO date, area?: "uk-rates" \| "uk-exams" \| "all"}` | `{since, entries: [ChangeEntry…], areasCovered, note}` — entries newest first, capped at 100, each with `from`, `to`, `effectiveFrom`, `source`, `verifiedDate`, `note` |
| 6 | `coverage` | `{area?: string}` | structured list of what is covered per area (boards/subjects/levels; rate categories + tax years; provenance ecosystems; stats ops) and what is explicitly **not** yet |
| 7 | `catalogue` | `{query?: string}` | every tool on every server: name, one-line description, server URL, input schema; optional substring/keyword filter |
| 8 | `call` | `{tool: string, arguments: object}` | runs any tool in the registry by name; same envelope. Unknown tool → `isError:false` result with `covered:false` and nearest names |

Direct tools 1–4 are the *only* vertical tools listed at the front door.
Stats (6 tools), `exam_spec_lookup`, `exam_paper_index` are reached via
`call`. If 🤖 counts later show heavy `call` traffic for a specific tool,
promote it — that is a data-driven listing change, not a redesign.

Tracking: `agent_mcp_<tool>` as today; `call` additionally emits
`agent_mcp_call_<inner tool>` so promotion decisions have data.

## 5. Response envelope (all servers, all tools)

Injected in `_mcp.js` after the tool runs, so vertical code stays unaware:

```json
{
  "...tool result as today...": "",
  "freshness": {
    "verifiedDate": "2026-08-31",
    "nextScheduledRefresh": "2027-04-06",
    "staleness": "fresh"            // fresh | due | overdue | live
  },
  "cite": {
    "url": "https://databutler.dev/r/uk/rates?category=income-tax",
    "text": "databutler.dev, verified 2026-08-31 against https://www.gov.uk/income-tax-rates"
  },
  "attribution": "databutler.dev", "docs": "…", "note": "…"
}
```

- `staleness` is computed from the refresh calendar in `CURATION.md`,
  encoded per dataset in `_lib.js`: `fresh` before `nextScheduledRefresh`,
  `due` within 14 days after it, `overdue` beyond. Live-computed tools
  (provenance, stats) return `live` with `verifiedDate` = now.
- `cite.url` is stateless: `/r/<area>/<path>?<query>` re-runs the matching
  REST endpoint and renders a small HTML page (answer, source link,
  verified date, "how to verify yourself"). No storage. `noindex` — this is
  for humans following an agent's citation, not for search.
- Each tool declares its own `citePath` in the registry so the envelope
  knows which REST URL reproduces it. Tools with no REST mirror (`call`,
  `catalogue`) cite `/api`.

**Near-miss rule.** A query outside coverage returns a normal result
(`isError:false`) shaped `{covered:false, requested, nearest, coverage}` —
never a bare error. `exam_topic_paper` already fuzzy-matches topics; this
extends the same courtesy to boards, subjects, categories, and tool names.

## 6. Changelog

`data/changelog.json`, an array of `ChangeEntry`:

```json
{
  "area": "uk-rates",                    // uk-rates | uk-exams (provenance/stats hold no data)
  "key": "income-tax/personal-allowance",
  "label": "Personal Allowance",
  "from": 12570, "to": 13070, "unit": "GBP/year",   // illustrative values, not a forecast
  "effectiveFrom": "2027-04-06",         // tax year start / first-teaching date
  "source": "https://www.gov.uk/income-tax-rates",
  "verifiedDate": "2026-11-27",
  "note": "Announced at Autumn Budget 2026"   // the human line, optional
}
```

**Generation** (`scripts/changelog.js`, run by the maintainer after editing
a data file, before commit):

1. Finds data files changed vs `HEAD` (`git diff --name-only`).
2. Rates: compares figure by `category/label` between the previous
   committed file (or the prior tax-year file when a new year file is
   added) and the working copy. Exams: compares topic→paper mappings and
   paper structures per spec code.
3. Appends entries with `note: ""`; prints them; the maintainer fills any
   notes and commits data + changelog together.
4. Idempotent: re-running does not duplicate an entry with the same
   `area/key/verifiedDate`.

**Source watcher** (`api/cron/watch-sources.js`, Vercel cron, weekly Monday
06:00 UTC, protected by `CRON_SECRET` as Vercel requires):

- For every `source` URL in the data files: gov.uk URLs go via the JSON
  content API (`https://www.gov.uk/api/content/<path>`, verified
  2026-09-01: returns `public_updated_at` and body, accepts a User-Agent).
  Others (AQA, future boards) are fetched and body-hashed after stripping
  scripts/nav.
- Compares against `data/sources.json` (`{url, lastSeenUpdatedAt, bodyHash}`).
- On change: opens a GitHub issue on `physics-star-cat/databutler` titled
  `source changed: <title> (<date>)` with the URL, old/new timestamps and a
  text diff where available. Needs a `GITHUB_TOKEN` (repo-scoped, issues
  only) in Vercel env. One issue per URL per change; no duplicates while
  an open issue exists for that URL.
- **The watcher never edits data.** Humans verify and edit; scripts diff.

**Maintainer workflow per change** (target: under 10 minutes):
issue arrives → open source page → edit JSON → `node scripts/changelog.js`
→ add note lines → commit → push (deploys). `sources.json` is refreshed by
the same script so the watcher goes quiet.

`GET /api/changes?since=&area=` is the REST mirror of `what_changed_since`.

## 7. Registry & discoverability updates

- Publish `server-hub.json` to the official registry and Smithery **after**
  `/api/mcp` is verified live (fresh `mcp-publisher login github` needed —
  JWTs expire in hours).
- `llms.txt`, `README.md`, `public/index.html`, `/api` index: lead with the
  single URL; list the four per-vertical URLs beneath as "focused servers".
- Add `/api/mcp` to the maintainer's own Claude Code config to dogfood.
- `webmon`: nothing to change — same GA4 property, new event names appear
  automatically.

## 8. Error handling

- Envelope injection must never break a tool: if `freshness`/`cite`
  computation throws, log and return the bare result.
- `call` wraps the inner tool; inner errors surface as `isError:true` with
  the inner message, exactly as if called directly.
- Watcher: per-URL try/catch; a failed fetch is reported in the cron log
  and skipped, never treated as "changed". 403/timeouts on gov.uk fall back
  to the HTML page hash; if both fail, the URL is listed in a single
  "watcher could not check" issue (deduplicated) rather than silently
  skipped.
- Changelog script refuses to run with uncommitted changes outside `data/`
  (keeps diffs attributable).

## 9. Testing

- `node --test` unit tests (no framework dependency): changelog diff on a
  fixture pair of rates files and a fixture pair of exam specs; staleness
  with a frozen clock across the fresh/due/overdue/live boundaries;
  `cite.url` construction for each registry entry; near-miss shaping.
- `scripts/verify-hub.sh`: curl suite — `initialize`, `tools/list` order
  and count (exactly 8), each direct tool, `call` reaching **every**
  registry tool, `what_changed_since` with the maintainer's cutoff, `/r`
  page returns 200 + `noindex`, `/api/changes` mirror, cron endpoint
  rejects requests without `CRON_SECRET`.
- Watcher dry-run mode (`?dry=1`) that reports what it *would* file.
- Existing `_statsmath.js` reference harness must still pass (envelope
  change touches `_mcp.js`, which stats goes through).

## 10. Out of scope (this spec)

New verticals, second country, payments/x402, API keys, webhooks/push,
persistent permalink storage, signed responses. Breadth beyond the UK is
a roadmap discussion (README), not part of this build; the country-prefixed
paths and per-area changelog already leave room for it.

## 11. Risks

- **Changelog discipline lapses** → `what_changed_since` silently under-reports.
  Mitigation: the watcher files issues, the script generates entries, and
  `staleness: overdue` is visible to every caller — a lapse is loud.
- **Front door tool order drifts** as verticals are added and the list
  bloats again. Mitigation: hard cap of 8 listed tools at the front door,
  enforced by a test; everything else goes behind `call`.
- **Vercel cron + GitHub token** are new operational surface. Mitigation:
  token is issues-only; cron is idempotent and dry-runnable.
