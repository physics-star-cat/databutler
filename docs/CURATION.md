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
