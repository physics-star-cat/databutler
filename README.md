# UK Data Butler

**An agent honeypot: clean, verified UK public data served to AI agents via
MCP and REST.** Not an SEO play — no GSC ambitions. The customer is an AI
assistant answering a human's question; the product is being the source that
is *right*, with provenance on every number.

- Planned domain: **ukdatabutler.com** (until purchased/connected, the
  Vercel default `ukdatabutler.vercel.app` works, but registry listings must
  NOT be published until the final domain is live — listings bake in URLs).
- Status: **spec stage** — see `docs/SPEC.md`. Nothing deployed yet.
- Born 2026-08-31 out of the agent-API work on whatbreaks.uk (MOT data) and
  lowriskquotes.com (Monte Carlo) — full history in
  `../docs/AUDIT_2026-08-30_five-sites.md` §3b–3e and
  `../docs/MONETISATION-DECISION.md`.

## The model (one brand, many focused servers)

There is no domain authority in MCP registries — discovery is per-listing.
So this is NOT one mega-server (tool-list bloat kills those); it is one
domain/repo/brand hosting **separate, focused MCP endpoints**, each listed
individually under one namespace, cross-referencing each other:

| Vertical | Endpoint | Status |
|---|---|---|
| Exams (boards, specs, topic→paper, past-paper index) | `/api/mcp/exams` | v1 — building |
| UK rates & thresholds (tax year numbers) | `/api/mcp/rates` | v1 — building |
| Councils (postcode→council→services) | `/api/mcp/councils` | phase 2 |
| Bin collection pilot (5–10 large councils) | — | phase 2, feasibility-gated |
| Recalls, more countries | — | later |

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
