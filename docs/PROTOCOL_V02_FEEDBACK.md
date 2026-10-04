# Verified Changes — feedback for v0.2

*Collected 2026-10-04 from the first five adopters outside Data Butler (whatbreaks,
lowriskquotes, auto-maengel, controle-technique-fiabilite, shakendata). Each publishes
`/.well-known/changes.json` and `/changes.json` as static files, validated in its own
`npm test` against vendored copies of the v0 schemas.*

| # | Problem | Proposal |
|---|---|---|
| 1 | Static publishers cannot honour `?since=` / `?area=`; each put it in a free-text note | Discovery field `"filtering": "server" \| "client"` |
| 2 | `generated` is ambiguous for byte-identical static builds | Define it as the newest `verifiedDate` for static documents |
| 3 | Derived figures (recomputations, match counts, matching-rule changes) move without a source change | Entry field `derived: true` with `method` URL instead of an authority `source` |
| 4 | Modelled data and the publisher's own assumptions cannot be published (source must be an authority) | Allow `sourceType: "methodology"` pointing at the publisher's methodology page, or declare such data out of scope |
| 5 | Empty publishers: `areas` needs ≥ 1 item; changes schema has no `note` | Allow empty `areas`; add a standard top-level `note`/`status` |
| 6 | Identity area+key+verifiedDate allows one change per key per day | Add an optional `seq` (or full timestamp) to the identity |
| 7 | Backfilled history uses commit dates as `verifiedDate` | Field `dateBasis: "verified" \| "commit" \| "source"` |
| 8 | `effectiveFrom` ambiguous for snapshots (download day vs newest record) | Field `sourceRelease` / `snapshot` date; keep `effectiveFrom` for the source's own effective date |
| 9 | `since = coverageStart` misses first-coverage entries under the strictly-after rule | Make `since` inclusive, or document `coverageStart − 1` |
| 10 | "Authority's own domain" unclear for catalogues (data.gov.uk linking to DfT hosts) | Allow an official catalogue page as `source`, with the file host in `sourceFile` |
| 11 | Cadence reads as a commitment; doesn't fit on-change-only areas or sites without a watcher | `cadence` gains `planned: true` or a `"on-change"` value |
| 12 | Counts-only datasets become many null→N entries; no distinction between source total and records held | Entry field `bundle` for first coverage; `heldCount` vs `sourceCount` |
| 13 | Trailing-slash routing (Next.js) serves both forms | Spec note: both forms acceptable; canonical is without slash |

Data Butler-side lessons from the same week (kit, not protocol): see
`docs/ADDING_AN_AREA.md` and the area-kit commits.
