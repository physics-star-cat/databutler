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
| `data/uk-vehicle-rules/<year>.json` | Every 1 April, calendar-driven (`cadenceDays: null`; `nextScheduledRefresh` set by hand to the next 1 April, 2027-04-01 for 2027-28): VED rates and the historic-vehicle exemption date are uprated by the Finance Act (announced at the Autumn Budget — HMRC tax information and impact notes on gov.uk on Budget day; the rate-tables page is rewritten shortly before 1 April). MOT maximum fees have not changed since 2010. The weekly watcher hashes the gov.uk pages in `sources()`. | Fetch gov.uk/vehicle-tax-rate-tables (all parts), gov.uk/getting-an-mot, gov.uk/historic-vehicles, gov.uk/vehicle-tax-direct-debit and gov.uk/vehicle-exempt-from-vehicle-tax (content API `https://www.gov.uk/api/content/<path>` gives every part as HTML); write a NEW `data/uk-vehicle-rules/<year>.json` (keep old years), moving each `value` into `previous` (with the National Archives capture URL of the outgoing page as previous.source), writing the new `value`, `quote`, `effectiveFrom` (1 April) and `verifiedDate`; bump `taxYear`, `taxYearRuns`, set `nextScheduledRefresh`; update the file the module requires; then `node scripts/changelog.js --only uk-vehicle-rules` (one entry per figure that moved, from → to, effectiveFrom 1 April; refreshes `data/sources.json`); review the pre-filled notes. |
| `data/uk-exam-dates.json` | Annual, calendar-driven (`cadenceDays: null`; `nextScheduledRefresh` set by hand, 2027-01-15 first): JCQ publishes the following June series' key dates and the boards their final summer timetables between May and July (provisional for consultation in February), the November series in September; Ofqual/DfE announcements of reformed or newly accredited specifications land at any time. The weekly watcher hashes the JCQ key-dates and timetables pages and the four boards' timetable landing pages (jcq.org.uk answers 403 to non-browser user agents). | Open the JCQ key-dates PDF for the new series and each board's final timetable PDF (AQA dates-and-timetables, Pearson exam-timetables, OCR key-dates-and-timetables, WJEC key-dates-and-timetables) and fee/key-dates document; for each figure move `value` into `previous` (with its series, source, document and quote), write the new `value`, `effectiveFrom`, `series`, `status`, `source`, `document`, `quote`; add spec-change figures from the regulator/board announcement with `previous: { value: null }`; bump `verifiedDate`, set `nextScheduledRefresh`; then `node scripts/changelog.js --only uk-exam-dates` (one `uk-exam-dates` entry per date that moved; refreshes `data/sources.json`); check the pre-filled notes name the JCQ/board document. |
| `data/calendar.json` | Monthly (freshness says `due` from 35 days after the fetch); and when a government publishes the next year's list (gov.uk and OPM publish ~2 years ahead, calendrier.api.gouv.fr 5 years) | `node scripts/calendar.js` — fetches gov.uk `bank-holidays.json`, OPM's federal-holidays page and `calendrier.api.gouv.fr` (UA names databutler.dev, 500 ms apart), merges `data/calendar/manual.json` (German Länder rules, tax-year and DST rules — edit that file against the official pages, bump its `verifiedDate`, keep every `quote`/`verification`), computes rule-based dates and stops if a hand-copied official date disagrees, bumps `verifiedDate`/`nextScheduledRefresh` (+35 days), appends `calendar` changelog entries (`<cc>/holidays/<year>` for a new year, `<cc>/holidays/<region>/<year>/<key>` for an added/removed/moved day, `<cc>/tax-year/<part>`, `<cc>/dst/<year>` for rule changes). Fill the blank notes, commit `data/` together. To widen the window add the year to `manual.json` `years`. `CAL_DIR=path` builds from saved copies. Re-try the `nonOfficial` entries (HB, MV, SH, TH holidays; fr and br DST; br personal tax year) each refresh. |
| `data/uk-gov-process.json` | Every 30 days (`nextScheduledRefresh` = verifiedDate + 30), and on Home Office / DVLA / DWP fee-change days (passport and ETA fees moved on 8 April 2026; benefits uprate each April). The weekly watcher reads each service's gov.uk page through the content API. | For each service fetch `https://www.gov.uk/api/content/<path>` for its `source` and `alsoRead` pages; compare every figure's `quote` against the page; for a changed value move the old value into `previous` (source = the National Archives capture of the outgoing page, or the announcement/SI) and set `effectiveFrom` to the change date; add a dated line to the service's `changes`; update `pageUpdatedAt`; bump `verifiedDate`; then `node scripts/changelog.js --only uk-gov-process` (stamps `nextScheduledRefresh`, appends one entry per figure that moved, re-hashes this area's sources) and review the notes. |
| `data/jp-vehicle-costs.json` | Every 35 days (`nextScheduledRefresh` = verifiedDate + 35), and on the change dates: 自賠責 2026-11-01 (re-check whether an official page now prints the revised 25/37-month rates), 自動車税/軽自動車税 each 1 April (税制改正大綱 in December), weight-tax eco bands 2027-05-01 and the table's end 2028-04-30, 検査手数料 when NALTEC announces a change. The weekly watcher hashes every source page. | Re-fetch every `source` (PDFs: `pdftotext -layout`); compare each figure's `quote` with the page; for a changed value move the old one into `previous` (`value`, `source`, `title`), write the new `value`, `quote`, `effectiveFrom` (and `effectiveTo` on the figure it replaces); once 2026-11-01 has passed the -from-2026-11 keys are current and the old-table keys keep `effectiveTo` 2026-10-31; bump `verifiedDate`; `node scripts/changelog.js --only jp-vehicle-costs` (stamps `nextScheduledRefresh`, appends one entry per figure that moved, re-hashes this area's sources); review the notes; `node scripts/sign-facts.js`. |
| `data/sources.json` | After every data refresh (automatic via `scripts/changelog.js`) | `node scripts/sources.js` re-checks every source URL (gov.uk content API / page hash); a page it cannot fetch is recorded `unreachable` and listed under "Sources the watcher cannot read". |
| `data/facts-signatures.json` | After every data change to a facts area, before commit | `node scripts/sign-facts.js` with the key in `~/.config/databutler/` (never on Vercel); `tests/facts-sign.test.js` fails while a served fact is unsigned. See "Signing and key rotation". |
| `data/changelog.json` | With every data refresh | `node scripts/changelog.js` (areas with a `changelog.diff`) or the dataset's own script (`changelog.script`); fill in `note` lines. See "Changelog & source watcher" and docs/ADDING_AN_AREA.md. |
<!-- sync-areas:calendar end -->

### Sources the watcher cannot read

Generated from `data/sources.json` (`unreachable`, written when a fetch fails) and the area
modules' `sources()` entries declaring `unreachable`. The Monday watcher skips these, so they
are re-read by hand (a browser) at each refresh; `node scripts/sources.js` retries them.

<!-- sync-areas:unreachable start -->
| Area | Page | Why the watcher skips it |
|---|---|---|
| uk-exam-dates | https://www.jcq.org.uk/exams-office/key-dates/ | HTTP 403 to any non-browser user agent (jcq.org.uk) — re-read in a browser at each refresh (recorded 2026-10-04) |
| uk-exam-dates | https://www.jcq.org.uk/exams-office/timetables/ | HTTP 403 to any non-browser user agent (jcq.org.uk) — re-read in a browser at each refresh (recorded 2026-10-04) |
<!-- sync-areas:unreachable end -->

## Verification log

- 2026-08-31 — rates 2026-27: all 10 categories fetched from live gov.uk
  pages (income tax, NI via employer rates page, NMW, student loans, VAT,
  ISA + LISA, new State Pension, SDLT, CGT, pension AA).
- 2026-08-31 — AQA GCSE: Physics 8463, Biology 8461, Chemistry 8462,
  Combined Science Trilogy 8464, Maths 8300 — all from live AQA
  specification-at-a-glance pages. Notable verified quirks: Trilogy Physics
  Paper 2 has NO Space physics; Maths has no topic→paper mapping (any topic,
  any paper; Paper 1 non-calculator).
- 2026-10-04 — rates 2026-27 **re-verified, no figure wrong**; AQA Maths 8300
  **re-verified, no change**; uk-rates extended to 17 categories (details below).

### uk-rates re-verification and extension (2026-10-04)

Fetch notes: every gov.uk page through the content API
(`https://www.gov.uk/api/content/<path>`, UA `databutler-curation/1.0`), all
200; every cited URL (40, including the archive captures) answered 200 to curl.
Previous (2025-26) values: the same page where it prints the earlier year, the
DWP "Benefit and pension rates 2026 to 2027" table (column "Rates 2025/26"),
HMRC's current-and-previous rates table, the 2025-26 employer rates page, or a
UK Government Web Archive capture (`…/ukgwa/<timestamp>mp_/https://www.gov.uk/…`
reads the page without the banner; the data cites the bare timestamp URL).
Nothing from memory. Each figure now carries `quote`, `previous` (where a source
gave one) and its own `verifiedDate`.

**The four watched pages that changed body since 2026-09-01 — figures or wording?**
Their content-API `updated_at` moved (income-tax-rates 2026-10-01, CGT
2026-10-02, new-state-pension 2026-09-09; `public_updated_at` unchanged), and
the watcher baseline had already been re-hashed on 2026-10-03.

- `https://www.gov.uk/income-tax-rates` — **wording only.** "The current tax year is from 6 April 2026 to 5 April 2027."; "The standard Personal Allowance is £12,570"; "Your personal allowance goes down by £1 for every £2 that your adjusted net income is above £100,000. This means your allowance is zero if your income is £125,140 or above."; "Personal Allowance | Up to £12,570 | 0%"; "Basic rate | £12,571 to £50,270 | 20%"; "Higher rate | £50,271 to £125,140 | 40%"; "Additional rate | over £125,140 | 45%". Part "Previous tax years": "The standard Personal Allowance from 6 April 2025 to 5 April 2026 was £12,570." All five figures re-verified 2026-10-04, no change.
- `https://www.gov.uk/capital-gains-tax/rates` — **wording, plus two facts not previously held.** Held figures unchanged: allowances part "The Capital Gains tax-free allowance is: £3,000; £1,500 for trusts"; "If this amount is within the basic Income Tax band, you’ll pay 18% on your gains made from 6 April 2026."; "If you’re a higher or additional rate taxpayer, you’ll pay 24% on your gains from 6 April 2026." — re-verified, no change. What changed on the page against the 30 June 2025 capture: the carried-interest 32% lines are gone ("carried interest (from 6 April 2026) … You’ll pay Income Tax and National Insurance contributions on carried interest you receive from 6 April 2026 instead."), and "From 6 April 2026 you’ll pay 18% if you’re a sole trader, partnership or trustee and your gains qualify for Business Asset Disposal Relief." (2025: "From 6 April 2025 you’ll pay 14% …"). Both added as figures with changelog entries (BADR 14 → 18; carried interest "32% Capital Gains Tax" → not CGT). Example 2 was also corrected by gov.uk: the 2025 capture said "18% on £30,270 and then 24% on £19,330", the live page "18% on £17,700 and then 24% on £31,900 … £10,842" (the live arithmetic is right: £20,000 + £49,600 − £37,700).
- `https://www.gov.uk/new-state-pension/what-youll-get` — **wording only.** "The full rate of new State Pension is £241.30 a week." (also "up to the full rate (£241.30 a week)"). Re-verified, no change; previous 230.25 from the DWP table "New State Pension | Full rate | 230.25 | 241.30".
- AQA Maths 8300 at-a-glance (uk-exams) — **no change.** "Students must take three question papers at the same tier."; each of Paper 1 "non-calculator", Paper 2 "calculator allowed", Paper 3 "calculator allowed": "written exam: 1 hour 30 minutes | 80 marks | 33⅓% of the GCSE Mathematics assessment", "Content from any part of the specification may be assessed"; "a Foundation tier (grades 1 – 5) and a Higher tier (grades 4 – 9)". The only date on the page is the specification PDF "for first teaching in 2015, 09 Dec 2014" — not a field in the data. The spec now carries `verifiedDate: 2026-10-04` and a `verification` line; the file-level `verifiedDate` stays 2026-08-31 because the other four specs were not re-read. Its live hash equals the 2026-10-03 baseline.

**The other held figures (re-verified 2026-10-04, no change):**

- NI — `…/guidance/rates-and-thresholds-for-employers-2026-to-2027`: "Lower earnings limit | £129 per week £559 per month £6,708 per year"; "Primary threshold | £242 per week £1,048 per month £12,570 per year"; "Secondary threshold | £96 per week £417 per month £5,000 per year"; "Upper earnings limit | £967 per week £4,189 per month £50,270 per year"; category A employee "0% | 8% | 2%", employer "15% | 15% | 15% | 15%"; "Employment Allowance for 2026 to 2027 is £10,500." Previous from the 2025-26 page (LEL £125, others equal).
- Minimum wage — `…/national-minimum-wage-rates`: "April 2026 | £12.71 | £10.85 | £8 | £8"; previous "April 2025 to March 2026 | £12.21 | £10 | £7.55 | £7.55"; apprentice rule "aged under 19; aged 19 or over and in the first year of their apprenticeship". The category already covered every age band and the apprentice rate, so nothing was added there.
- Student loans — `…/repaying-your-student-loan/what-you-pay`: "Plan 1 | £26,900", "Plan 2 | £29,385", "Plan 4 | £33,795", "Plan 5 | £25,000", "Postgraduate Loan | £21,000"; 9% / 6%. Previous (capture 20250630160709): £26,065, £28,470, £32,745, £25,000, £21,000.
- VAT — "Standard rate | 20%", "Reduced rate | 5%", "Zero rate | 0%" (capture 20250630153708 identical).
- ISA — "In the 2026 to 2027 tax year, the maximum you can save in ISAs is £20,000"; Lifetime ISA "up to £4,000 each year", "25% bonus … up to a maximum of £1,000 per year" (captures 20250630175307, 20250630155332 identical).
- SDLT — "Up to £125,000 | Zero"; "£125,001 to £250,000 | 2%"; "£250,001 to £925,000 | 5%"; "£925,001 to £1.5 million | 10%"; "above £1.5 million | 12%"; first-time buyers "no SDLT up to £300,000; 5% … £300,001 to £500,000"; "5% on top"; "2% surcharge" (capture 20250630201411 identical).
- Pensions — "This is £60,000 this tax year."; "‘threshold income’ is over £200,000"; "‘adjusted income’ is over £260,000" (capture 20250702115612 identical).

44 held figures re-verified (plus the 8300 paper structure); **none was wrong.**

**Added (46 figures, 7 new categories + 3 in state-pension + 2 in capital-gains):**

- state-pension (retitled "State Pension (new and basic)") — `…/state-pension/how-much-you-get`: "The full basic State Pension is £184.90 per week." (prev 176.45); DWP table "Category B (lower) basic pension - spouse or civil partner’s insurance | 105.70 | 110.75"; DWP press release `…/government/news/over-12-million-pensioners-to-receive-575-state-pension-boost`: "The full rate of the new State Pension will increase by 4.8% in line with the increase in average earnings from £230.25 to £241.30 a week. The full basic State Pension will increase from £176.45 to £184.90 a week." (the release's "Monday 6 April 2025" is a typo on gov.uk — the rates are 2026-27). No page gave the 2025-26 uprating %, so the triple-lock figure has no `previous` (entry null → 4.8).
- state-pension-age — `…/government/publications/state-pension-age-timetable/state-pension-age-timetable` (DWP): Table 3 "6 October 1954 – 5 April 1960 | 66th birthday"; Table 4 rows "6 April 1960 – 5 May 1960 | 66 years and 1 month" … "6 February 1961 – 5 March 1961 | 66 years and 11 months", "6 March 1961 – 5 April 1977* | 67"; Table 5 "6 April 1977 – 5 May 1977 | 6 May 2044" … "6 March 1978 – 5 April 1978 | 6 March 2046", "6 April 1978 onwards | 68th birthday"; "The State Pension age for men and women will now increase to 67 between 2026 and 2028." **The page does not print "6 May 2026"**: the figure "66 → 67 rise: first people reach State Pension age = 2026-05-06" is marked `derived` (born 6 April 1960 + 66 years 1 month). Capture 20250702110140 has identical tables, so these carry previous = value and log no entry.
- dividends — `…/tax-on-dividends`: "dividend allowance of £500 each year"; "rates from 6 April 2026 to 5 April 2027 | Basic rate | 10.75% | Higher rate | 35.75% | Additional rate | 39.35%". Previous from HMRC `…/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past`: "Dividend allowance | £500 | £500 | £500 | £1,000"; "Basic rate | 10.75% | 8.75% …"; "Higher rate | 35.75% | 33.75% …"; "Additional rate | 39.35% | 39.35% …". **Basic and higher dividend rates each rose 2 points** (entries 8.75 → 10.75, 33.75 → 35.75).
- savings — `…/apply-tax-free-interest-on-savings/how-much-is-tax-free`: "Basic rate | £1,000", "Higher rate | £500", "Additional rate | £0"; "less than £17,570 … up to £5,000 of interest" (capture 20250630153905 identical).
- marriage-allowance — `…/marriage-allowance`: "transfer £1,260 of your Personal Allowance"; "reduces their tax by up to £252" (capture 20250630170819 identical).
- statutory-sick-pay — `…/statutory-sick-pay/what-youll-get`: "£123.25 a week Statutory Sick Pay (SSP) or 80% of your normal weekly earnings - whichever is lower. It’s paid for up to 28 weeks."; "all the full days you’re off sick"; employer page "for each day they’re off work from the first day of illness". Capture 20250703214005: "£118.75 a week … except for the first 3"; eligibility "earn an average of at least £125 per week". Entries: rate 118.75 → 123.25, amount rule, paid-from rule.
- statutory-parental-pay — employer page: "SMP — weekly rate for first 6 weeks | 90%"; "SMP — weekly rate for remaining weeks | £194.32 or 90% … whichever is lower"; SPP, SAP, ShPP the same £194.32; "The Statutory Maternity Pay (SMP) rate applies from 5 April 2026. All other rates apply from 6 April 2026." (SMP effectiveFrom 2026-04-05). Maternity guide "earn on average at least £129 a week". DWP table: 187.18 → 194.32; earnings threshold 125.00 → 129.00.
- child-benefit — `…/child-benefit/what-youll-get`: "Eldest or only child | £27.05", "Additional children | £17.90 per child" (capture 20250702194804: £26.05, £17.25); `…/child-benefit-tax-charge`: "over £60,000 for tax years starting from 2024 to 2025"; "1% of your Child Benefit for every £200 you earn over £60,000. If you earn over £80,000 you’ll pay it all back."

`scripts/changelog.js --only uk-rates` wrote 17 entries (all verifiedDate 2026-10-04): basic SP ×2, triple lock, BADR, carried interest, dividend ×2, SSP ×3, statutory parental pay ×5, Child Benefit ×2. Unchanged new figures carry previous = value and log nothing. The uk-rates diff now honours `previous.value`, per-figure `source` and `effectiveFrom` (commit before this one). `--only uk-exams`: 0 entries.


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
   teaching 2027").
5. `node scripts/sign-facts.js` — re-signs the Verified Facts records the
   edit changed (see "Signing and key rotation"). Commit `data/` together
   (including `data/facts-signatures.json`). Push deploys.

If the watcher fires but nothing material changed (typo fix on gov.uk), run
`node scripts/sources.js` and commit — no changelog entry.

Rules: the watcher never edits data; the script never invents an entry; a
`from`/`to` pair always comes from two committed versions of a data file.

## Signing and key rotation (Verified Facts, added 2026-10-12)

Every record served at `/f/<key>` (and `get_fact`) carries a detached Ed25519
JWS over its attestation (docs/FACTS_PROTOCOL.md §8). Signing happens **here,
at curation time, never on Vercel**: the signature attests that the maintainer
read `source` on `verifiedDate`.

- **Where the key lives.** `~/.config/databutler/facts-ed25519.jwk` on the
  maintainer's machine (directory 0700, file 0600). Never committed (`*.jwk`
  and `*.pem` are gitignored), never printed, never in an environment variable
  on Vercel. The public half is in `public/.well-known/jwks.json`.
- **When to sign.** After every data change to a facts area, before commit:
  `node scripts/sign-facts.js` (re-signs, sorted and byte-stable; prints how
  many signatures were added and dropped). `scripts/changelog.js` prints the
  reminder. `tests/facts-sign.test.js` fails while any served record is
  unsigned or any signature is an orphan, so an unsigned data change cannot be
  merged. `node scripts/sign-facts.js --check` is the same check.
- **Verify.** `node scripts/verify-fact.js https://databutler.dev/f/uk/income-tax/personal-allowance`
  (or a saved JSON file with `--jwks public/.well-known/jwks.json`): hash, key,
  signature, verifiedDate — exit 0 when all pass.
- **Rotation** (yearly, or on any doubt): `node scripts/facts-keygen.js --kid db-YYYY-MM --out ~/.config/databutler/facts-db-YYYY-MM.jwk`
  publishes the new public key with `validFrom` = today + 7 days; deploy; on
  or after `validFrom` run `FACTS_SIGNING_KEY=~/.config/databutler/facts-db-YYYY-MM.jwk node scripts/sign-facts.js`
  and commit; then `node scripts/facts-keygen.js --retire <old kid>`. Retired
  keys stay in the set for at least two years so old citations still verify.
- **Revocation** (key exposed): `node scripts/facts-keygen.js --revoke <kid> --date <day of exposure>`,
  generate and sign with a new key at once (pass `--valid-from` today), deploy.
  Signatures whose `verifiedDate` is after the revocation day stop verifying.
- **The monthly refresh PR** (`.github/workflows/refresh-datasets.yml`) runs
  the tests with `FACTS_SIGNATURES_OPTIONAL=1` — the bot has no key. Its
  datasets (software-eol, calendar, UK recalls) publish no facts today; if a
  facts area is ever added to it, the PR body says "needs signing" and a human
  runs `node scripts/sign-facts.js` on the branch before merging.

- **Conformance self-check.** The Monday watcher (`api/_routes/cron/watch-sources.js`) also runs
  `scripts/facts-check.js` against https://databutler.dev (offline items skipped, 25 sampled keys) and
  files one issue, "Verified Facts conformance check failed", while it fails — treat it as an incident.
  By hand: `node scripts/facts-check.js https://databutler.dev` (all 18 items of spec §11; `--offline`
  skips the source fetches). Sister sites at L1: `node scripts/facts-static.js facts-source.json --out public`
  then the same checker with `--level L1`.

Key on file: `db-2026-10` (valid from 2026-10-12).

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

## Verification log (uk-vehicle-rules, added 2026-10-04)

Fetch notes: every gov.uk page was fetched 2026-10-04 with curl (UA
`databutler-curation/1.0`) both as HTML and through the gov.uk content API
(`https://www.gov.uk/api/content/<path>`, which returns every part of a guide
as HTML in one document); all returned 200. Content-API `updated_at`:
vehicle-tax-rate-tables 2026-09-09, getting-an-mot 2026-09-09,
historic-vehicles 2026-09-09, vehicle-tax-direct-debit 2025-01-30,
vehicle-exempt-from-vehicle-tax 2015-04-03. The historic-vehicles page says
"from 1 April 2026", so the rate-tables page served on the fetch date is the
2026-27 table. **No HMRC "Vehicle Excise Duty rates … from 1 April 2026"
uprating paper was found by gov.uk search** (the 2025 one is
`/government/publications/vehicle-excise-duty-rates-for-cars-vans-and-motorcycles-from-1-april-2025`,
which states the mechanism — RPI uprating of standard rates, first-year rates
set separately — but no figures); the rate-tables page is the figure source.
**Previous (2025-26) values** come from the UK Government Web Archive
(National Archives) captures of the same gov.uk pages, fetched with the `mp_`
modifier (`…/ukgwa/<timestamp>mp_/https://www.gov.uk/…` returns the archived
page without the archive banner; the bare timestamp URL returns a
JavaScript timeline shell with no page text): vehicle-tax-rate-tables
20250530154440, …/rates-for-cars-registered-on-or-after-1-march-2001
20250530180821, …/rates-for-cars-and-light-goods-vehicles-registered-before-1-march-2001
20250530180547, historic-vehicles 20250530154919, getting-an-mot/mot-test-fees
20250604102229. Licence: the gov.uk footer on every page, "All content is
available under the Open Government Licence v3.0, except where otherwise
stated". Nothing was written from memory; the figures were not copied from
whatbreaks.uk or any third-party calculator.

### ved-first-year, ved-standard, ved-expensive-car — `https://www.gov.uk/vehicle-tax-rate-tables` (part "Cars registered on or after 1 April 2017", 200)

- First-year table, columns "Diesel cars (TC49) that meet the RDE2 standard, petrol cars (TC48), Alternative fuel and zero emission cars | All other diesel cars (TC49)": "0g/km | £10 | £10"; "1 to 50g/km | £115 | £135"; "51 to 75g/km | £135 | £280"; "76 to 90g/km | £280 | £365"; "91 to 100g/km | £365 | £405"; "101 to 110g/km | £405 | £455"; "111 to 130g/km | £455 | £560"; "131 to 150g/km | £560 | £1,410"; "151 to 170g/km | £1,410 | £2,270"; "171 to 190g/km | £2,270 | £3,420"; "191 to 225g/km | £3,420 | £4,850"; "226 to 255g/km | £4,850 | £5,690"; "Over 255g/km | £5,690 | £5,690". "This payment covers your vehicle for 12 months."
- Previous (archive 20250530154440): "0g/km | £10 | £10"; "1 to 50g/km | £110 | £130"; "51 to 75g/km | £130 | £270"; "76 to 90g/km | £270 | £350"; "91 to 100g/km | £350 | £390"; "101 to 110g/km | £390 | £440"; "111 to 130g/km | £440 | £540"; "131 to 150g/km | £540 | £1,360"; "151 to 170g/km | £1,360 | £2,190"; "171 to 190g/km | £2,190 | £3,300"; "191 to 225g/km | £3,300 | £4,680"; "226 to 255g/km | £4,680 | £5,490"; "Over 255g/km | £5,490 | £5,490". Only the 0g/km row is unchanged (no changelog entry).
- Standard rate, "Rates for second tax payment onwards", one row "Petrol or diesel, Electric & Alternative Fuel": "Single 12 month payment | £200"; "Single 12 month payment by Direct Debit | £200"; "Total of 12 monthly payments by Direct Debit | £210"; "Single 6 month payment | £110"; "Single 6 month payment by Direct Debit | £105". "Alternative fuel vehicles include hybrids, bioethanol and liquid petroleum gas." Previous (same capture): "£195 | £195 | £204.75 | £107.25 | £102.38". The page was restructured between the captures (2025: one row with a "Fuel type" header; 2026: a two-column list) — the figures are the same five.
- Expensive car supplement, heading now "Vehicles with a list price of more than £40,000 (petrol/diesel) or £50,000 (electric)": "You have to pay an extra £440 a year if you have any of the following: a car or motorhome with a list price of more than £40,000; an electric car or motorhome with a list price of more than £50,000. This also applies to electric vehicles registered between 1 April 2025 and 31 March 2026. You do not have to pay this if both of the following apply: you have a zero emission vehicle; the vehicle was registered before 1 April 2025. The list price is the published price of the vehicle before it’s registered for the first time. It’s the price before any discounts are applied. You only have to pay this rate for 5 years (from the second time the vehicle is taxed)." Table: "£640 | £640 | £672 | £352 | £336". Previous (capture): heading "Vehicles with a list price of more than £40,000", "You have to pay an extra £425 a year if you have a car or motorhome with a list price of more than £40,000.", table "£620 | £620 | £651 | £341 | £325.50"; the 5-year sentence identical. The £40,000 threshold and the 5 years are unchanged (no entry).
- Zero-emission threshold, HMRC policy paper `https://www.gov.uk/government/publications/vehicle-excise-duty-for-expensive-car-supplement-threshold-increase-for-zero-emission-vehicles/increase-in-the-vehicle-excise-duty-expensive-car-supplement-threshold-for-zero-emission-cars` (200, published 2025-11-26): "As announced at Budget 2025, this measure increases the VED (Vehicle Excise Duty) Expensive Car Supplement (ECS) threshold for zero-emission cars, from its current level of £40,000 to £50,000. … The threshold will be maintained at its current level of £40,000 for all other cars. The change applies retrospectively, meaning that most vehicles registered from 1 April 2025 will not be required to pay the charge. … Operative date: The change will have effect from 1 April 2026." Kept as published: the rate-tables sentence "This also applies to electric vehicles registered between 1 April 2025 and 31 March 2026" reads as the retrospective application the policy paper describes (those cars get the £50,000 threshold), not as a charge on them.
- Direct Debit surcharge, `https://www.gov.uk/vehicle-tax-direct-debit` (200, part "Setting up"): "There’s a 5% surcharge if you pay: monthly; every 6 months. There’s no surcharge if you pay yearly." Consistent with the tables (£210 = 105% of £200; £105 = 105% of £100; the single 6-month payment £110 is 55%, which the page does not state as a rule — recorded as a note, not a figure).

### ved-2001-2017 — `https://www.gov.uk/vehicle-tax-rate-tables/rates-for-cars-registered-on-or-after-1-march-2001` (200)

- Table "Petrol car (TC48), diesel car (TC49), alternative fuel (59) and zero emission cars", columns "Band and CO2 emission | Single 12 month payment | Single 12 month payment by Direct Debit | Total of 12 monthly instalments by Direct Debit | Single 6 month payment | Single 6 month payment by Direct Debit": "A: Up to 100g/km | £20 | £20 | £21 | N/A | N/A"; "B: 101 to 110g/km | £20 | £20 | £21 | N/A | N/A"; "C: 111 to 120g/km | £35 | £35 | £36.75 | N/A | N/A"; "D: 121 to 130g/km | £170 | £170 | £178.50 | £93.50 | £89.25"; "E: 131 to 140g/km | £200 | £200 | £210 | £110 | £105"; "F: 141 to 150g/km | £225 | £225 | £236.25 | £123.75 | £118.13"; "G: 151 to 165g/km | £275 | £275 | £288.75 | £151.25 | £144.38"; "H: 166 to 175g/km | £325 | £325 | £341.25 | £178.75 | £170.63"; "I: 176 to 185g/km | £360 | £360 | £378 | £198 | £189"; "J: 186 to 200g/km | £410 | £410 | £430.50 | £225.50 | £215.25"; "K*: 201 to 225g/km | £445 | £445 | £467.25 | £244.75 | £233.63"; "L: 226 to 255g/km | £760 | £760 | £798 | £418 | £399"; "M: Over 255g/km | £790 | £790 | £829.50 | £434.50 | £414.75". "*Includes cars with a CO2 figure over 225g/km but were registered before 23 March 2006." The data file keeps the single 12 month payment as the value.
- Previous (archive 20250530180821), 12-month column: A £20, B £20, C £35, D £165, E £195, F £215, G £265, H £315, I £345, J £395, K £430, L £735, M £760. A–C unchanged (no entry).

### ved-pre-2001 — `https://www.gov.uk/vehicle-tax-rate-tables/rates-for-cars-and-light-goods-vehicles-registered-before-1-march-2001` (200)

- "The rate of vehicle tax is based on engine size. Private or light goods (TC11)": "Not over 1549 | £230 | £230 | £241.50 | £126.50 | £120.75"; "Over 1549 | £375 | £375 | £393.75 | £206.25 | £196.88".
- Previous (archive 20250530180547): "Not over 1549 | £220 | £220 | £231 | £121 | £115.50"; "Over 1549 | £360 | £360 | £378 | £198 | £189".

### ved-electric — `https://www.gov.uk/vehicle-exempt-from-vehicle-tax` (200) plus the rate-tables rows above

- "Electric vehicles — To be exempt, the electricity must come from any of the following: an external source …; an electric storage battery …; hydrogen fuel cells. You must pay vehicle tax if your vehicle is hybrid electric. From 1 April 2025, if you have an electric car, van, motorcycle or tricycle, you’ll need to pay vehicle tax. Only heavy goods vehicles that weigh over 3,500kg will still be exempt." (The page's heading still says "Electric vehicles" under exempt types; the body is the operative text.)
- Zero-emission car figures are the 0g/km first-year row (£10, unchanged), the standard rate (£200, was £195), the supplement (£440, was £425) and the £50,000 threshold (was £40,000, policy paper above). The 2025 TIIN `…/vehicle-excise-duty-rates-for-cars-vans-and-motorcycles-from-1-april-2025` (200) corroborates the mechanism: "From the second year of registration onwards, zero-emission cars will move to the standard annual rate."

### historic — `https://www.gov.uk/historic-vehicles` (200; parts "Eligibility", "Historic vehicle tax exemption", "Renewing your historic vehicle's vehicle tax")

- "You do not need to get an MOT if: the vehicle was built or first registered more than 40 years ago; no ‘substantial changes’ have been made to the vehicle - for example, replacing the chassis, body, axles or engine to change the way the vehicle works". Previous capture (20250530154919) read "no ‘substantial changes’ have been made to the vehicle in the last 30 years" — the "in the last 30 years" qualifier has gone from the live page; wording only, the 40 years is unchanged.
- "If your vehicle was built before 1 January 1986, you can stop paying vehicle tax from 1 April 2026. If you do not know when your vehicle was built, but it was registered before 8 January 1986, you do not need to pay vehicle tax from 1 April 2026." Part "Historic vehicle tax exemption": "You can apply to stop paying for vehicle tax from 1 April 2026 if your vehicle was built before 1 January 1986. You must tax your vehicle even if you do not have to pay. … first registered before 8 January 1986 …". Previous capture: "built before 1 January 1985, you can stop paying vehicle tax from 1 April 2025" and "registered before 8 January 1985".
- "You must apply for a vehicle tax exemption to stop paying vehicle tax. This is sometimes called putting a vehicle into the ‘historic tax class’. You do not have to apply to stop getting an MOT for your vehicle each year. However, you must still keep it in a roadworthy condition. You can be fined up to £2,500 and get 3 penalty points for using a vehicle in a dangerous condition." Not exempt: "it’s used for hire or reward …; it’s used commercially for a trade or business". Renewal part: "You can be fined £80 if you do not tax your vehicle on time."

### mot — `https://www.gov.uk/getting-an-mot` (200; parts "When to get an MOT", "MOT costs", "MOT test result", "Retest after a repair", "Test result appeals and problems", "Vehicles that do not need an MOT")

- Due: "You must get an MOT for your vehicle by either: the third anniversary of its registration; the anniversary of its last MOT, if it’s over 3 years old". "An MOT lasts for a year."
- Fees (part `/mot-test-fees`): "The maximum fee for a car is £54.85 and £29.65 for a standard motorcycle. You do not pay VAT on the fee." Table "Vehicle class | Age first MOT needed (years) | Maximum MOT fee": "Motorcycle (engine size up to 200cc) | 1 | 3 | £29.65"; "Motorcycle with sidecar (engine size up to 200cc) | 1 | 3 | £37.80"; "Motorcycle (engine size over 200cc) | 2 | 3 | £29.65"; "Motorcycle with sidecar (engine size over 200cc) | 2 | 3 | £37.80"; "3-wheeled vehicles (up to 450kg unladen weight) | 3 | 3 | £37.80"; "3-wheeled vehicles (over 450kg unladen weight) | 4 | 3 | £54.85"; "Cars (up to 8 passenger seats) | 4 | 3 | £54.85"; "Motor caravans | 4 | 3 | £54.85"; "Quads … | 4 | 3 | £54.85"; "Dual purpose vehicles | 4 | 3 | £54.85"; "Private hire and public service vehicles (up to 8 seats) | 4 | 3 | £54.85"; "Ambulances and taxis | 4 | 1 | £54.85"; "Private passenger vehicles and ambulances (9 to 12 passenger seats) | 4 | 1 | £57.30"; "Goods vehicles (up to 3,000kg design gross weight) | 4 | 3 | £54.85"; "Class 4 vehicles (9 to 12 passenger seats) with a seat belt installation check | 4a | n/a | £64"; "Private passenger vehicles and ambulances (13 to 16 passenger seats) | 5 | 1 | £59.55"; "Private passenger vehicles and ambulances (more than 16 passenger seats) | 5 | 1 | £80.65"; "Playbuses | 5 | 1 | £80.65"; "Class 5 vehicles (13 to 16 passenger seats) with a seatbelt installation check | 5a | n/a | £80.50"; "Class 5 vehicles (more than 16 passenger seats) with a seatbelt installation check | 5a | n/a | £124.50"; "Petrol, diesel and hybrid goods vehicles (over 3,000kg up to 3,500kg design gross weight) | 7 | 3 | £58.60"; "Zero emission goods vehicles (between 3,501kg and 4,250kg design gross weight) | 7 | 3 | £58.60".
- Previous (archive 20250604102229): every fee identical; the class 7 row read "Goods vehicles (over 3,000kg up to 3,500kg design gross weight) | 7 | 3 | £58.60" and the "Zero emission goods vehicles (between 3,501kg and 4,250kg …)" row did not exist — new row, no `previous`. Fees carry `previous` equal to `value`, so they produce no changelog entry.
- Early renewal: "You can get an MOT up to a month (minus a day) before it runs out and keep the same renewal date. … Example: If your MOT runs out on 15 May, the earliest you can get an MOT to keep the same renewal date for next year is 16 April." and "You can get an MOT earlier, but the renewal date for the following year will change to one year (minus a day) from the date the vehicle last passed its MOT." **The brief's "10-month-early renewal" is not what the page says** — it is one month minus a day; recorded as published.
- Retests: "You only need a partial retest if you leave the vehicle at the test centre for repair and it’s retested within 10 working days. There’s no fee for this." "You will not have to pay again if you take it back to the same test centre before the end of the next working day for a partial retest on one or more of these items: …" (the list is on the page). "You’ll only need a partial retest if you take the vehicle from the test centre for repairs and take it back within 10 working days. You can be charged a partial retest fee for this. In all other cases, you’ll need to get a full retest and pay the full MOT test fee again."
- After a fail: "You can take your vehicle away if: your current MOT is still valid; no ‘dangerous’ problems were listed in the MOT. Otherwise, you’ll need to get it repaired before you can drive." Appeals: "Fill in the complaint form and send it to DVSA within 14 working days of the test."
- Exemptions: "Other vehicles that do not need an MOT include: goods vehicles powered by electricity and registered before 1 March 2015; tractors; some historic (‘classic’) vehicles". Electric **cars** are not on the list and never were — the only electric exemption is goods vehicles registered before 1 March 2015 (the brief's "electric vehicle no longer exempt?" — correct for cars: they need an MOT like any other car). Northern Ireland: "There are different rules and processes in Northern Ireland for MOTs" — notCovered.

### penalties — getting-an-mot, historic-vehicles, vehicle-tax-direct-debit (all 200)

- "You can be fined up to £1,000 for driving a vehicle without a valid MOT." "You can be fined up to £2,500, be banned from driving and get 3 penalty points for driving a vehicle that has failed its MOT because of a ‘dangerous’ problem." "You can be fined up to £2,500 and get 3 penalty points for using a vehicle in a dangerous condition." (historic-vehicles).
- `https://www.gov.uk/vehicle-tax-direct-debit/payment-fails`: "You’ll be fined £80 if you do not tax your vehicle or tell DVLA that it’s off the road. You’ll also have to pay for the time it was not taxed. If you do not pay your fine on time your vehicle could be clamped or crushed, or your details passed to a debt collection agency." gov.uk/vehicle-tax (the "Tax your vehicle" transaction page) carries no penalty text, so the Direct Debit and historic-vehicle pages are the figure's sources.

### Not published / not found on 2026-10-04

- No gov.uk tax information and impact note for the 2026-27 standard-rate uprating was found (search: "Vehicle Excise Duty rates … from 1 April 2026"); the rate-tables page is the only gov.uk statement of the 2026-27 figures. The 2025-11-26 expensive-car-supplement paper is the only Budget 2025 VED paper indexed.
- `https://www.gov.uk/guidance/vehicle-tax-for-electric-zero-or-low-emission-vehicles` (a URL guessed from memory) is 404; not cited.
## Verification log (uk-exam-dates, added 2026-10-04)
Every date in `data/uk-exam-dates.json` was read on 2026-10-04 from the document
named in its `source`; `quote` reproduces the timetable row or sentence (columns
collapsed to three spaces), `document` names the PDF and its version, and
`previous` is the summer-2026 equivalent read from the board's **own** 2026
document, never inferred from the JCQ common slot. The 91 figures sit in four
kinds — `results`, `timetable`, `deadlines`, `spec-changes` — served by
`uk_exam_dates {kind, board?, qualification?}` and `GET /api/uk/exam-dates`.
### Fetch behaviour of the sources
| Host | 2026-10-04 | Used instead |
|---|---|---|
| `www.jcq.org.uk` (every page and PDF) | **HTTP 403** to curl with any user agent, including a Chrome string | a browser-class fetch read the PDFs; the key-dates landing page lists them. The watcher will log 403 for the two JCQ pages until it sends a browser user agent — treat "unchanged" there as "unreached" |
| `qualifications.pearson.com` summer **2026** final timetables (`gcse-summer-2026-final.pdf`, `gce-summer-2026-final.pdf`) | **"Page not found"** HTML (the 2027 and November 2026 PDFs serve fine) | no `previous` on any Pearson 2027 paper date; Pearson's 2026 dates are not claimed |
| `www.aqa.org.uk/exams-administration/dates-and-timetables/exam-timetables` | 404 (old path) | `/exams-administration/dates-and-timetables` (200) — "The timetables on this page are definitive." |
| `www.sqa.org.uk/sqa/results.html`, `/sqa/117907.html` | 404 | `/sqa/41324.html` (results by text and email: "The next Results day is Tuesday 10 August 2027.") and `/files_ccc/your-results-2026.pdf` |
| `www.ocr.org.uk`, `www.wjec.co.uk`, `www.eduqas.co.uk`, `www.aqa.org.uk/files/…`, `assets.publishing.service.gov.uk` | 200 | — |
### results — JCQ key dates, boards' results pages, Qualifications Scotland
- JCQ *Key dates in the examination cycle — June 2027 examination series*
  (`…/2026/05/Key_Dates_June2027_FINAL.pdf`, ©JCQCIC 2026, p. 3): "11/08/2027
  Restricted release of results to centres only — GCE, Extended Project";
  "12/08/2027 Release of results to candidates — GCE, Extended Project";
  "18/08/2027 Restricted release … GCSE, Level 1 & 2 Projects"; "19/08/2027
  Release of results to candidates — GCSE, Level 1 & 2 Projects".
- JCQ *June 2026* (`…/2025/09/Key_Dates_June2026_FINAL.pdf`, ©JCQCIC 2025):
  "12/08/2026 Restricted release … GCE"; "13/08/2026 Release of results to
  candidates GCE"; "19/08/2026 Restricted release … GCSE"; "20/08/2026 Release
  of results to candidates GCSE" → the `previous` of the four summer figures.
- JCQ *GCSE November 2026 series* (`…/2026/09/Key_Dates_Nov2026_UPDATED_SEP26.pdf`,
  "Published on: 1 December 2025 / Revision one: 3 September 2026", p. 2):
  "12/01/2027 Restricted release of results to centres only GCSE"; "13/01/2027
  Release of results to candidates GCSE". The series covers "Cymraeg Language
  and Literature, English Language, English Language and Literature,
  Mathematics, Mathematics and Numeracy and Welsh Language" only.
- AQA *Results days* page: "Results day for the November 2026 exam series is:
  13 January 2027"; table rows "June 2027 — A-level, AS Level — 12 August 2027"
  and "June 2027 — GCSE — 19 August 2027"; "From 8.00am on Thursday, you can
  give students their results slips."
- Pearson *Key dates 2026/2027* §1.7: "Jun–27 11/08/2027 12/08/2027 AS/A
  level, AEA, …"; "Jun–27 18/08/2027 19/08/2027 GCSE, International GCSE, …";
  "Nov–26 12/01/2027 13/01/2027 GCSE English Language and Mathematics".
- Qualifications Scotland `/sqa/41324.html`: "The next Results day is Tuesday
  10 August 2027."; *Your results 2026* PDF: "This is a guide for all learners
  getting results on 4 August 2026." (→ `previous`). The 2027 timetable page
  (`/sqa/1439.html`) also states "The 2027 National Qualifications exams will
  start on Monday 26 April and finish on Thursday 3 June. Results day will be
  Tuesday 10 August." — the exam window is **not served** (SQA beyond results
  day is out of scope).
### timetable — JCQ common window and the four boards' final timetables
- JCQ June 2027 key dates: "10/05/2027 Date of first examination on common
  timetable GCSE GCE"; "18/06/2027 Date of final examination on common
  timetable GCSE"; "22/06/2027 … GCE"; "23/06/2027 Contingency day in the
  event of national or significant local disruption to examinations in the
  United Kingdom". June 2026: "07/05/2026 … first examination … GCSE";
  "11/05/2026 … GCE"; "17/06/2026 … final … GCSE"; "23/06/2026 … GCE";
  "24/06/2026 Contingency day". Kept as published: in 2026 GCSE and GCE had
  different first days (7 and 11 May); in 2027 both open on 10 May, so the
  single 2027 figure's `previous` is the GCSE date with the GCE date in its
  quote. The JCQ *Commentary* on the June 2027 timetable lists the papers moved
  after consultation (none of the papers held here).
- **AQA** (`/exams-administration/dates-and-timetables`: "Confirmed exam
  timetables — The timetables on this page are definitive."). *Exam timetable
  May/June 2027 GCSE, AQA Certificates, ELC and Projects*, "Copyright © 2026 AQA
  and its licensors. All rights reserved. Version 1.1": "8300/1F Written
  (non-calculator) 1h 30m 14 May 2027 am"; "8300/2F Written (calculator) 1h 30m
  27 May 2027 am"; "8300/3F … 14 June 2027 am"; "8700/1 Explorations in
  creative reading and writing 1h 45m 24 May 2027 am"; "8700/2 Writers'
  viewpoints and perspectives 1h 45m 08 June 2027 am"; 8464 Trilogy "B/1F …
  11 May 2027 am", "C/1F … 17 May 2027 am", "P/1F … 25 May 2027 am", "B/2F …
  10 June 2027 am", "C/2F … 15 June 2027 am", "P/2F … 18 June 2027 am".
  *May/June 2027 AS, A-level …* Version 1.2: "7357/1 Paper 1 18 2h 26 May 2027
  pm"; "7357/2 … 09 June 2027 pm"; "7357/3 … 16 June 2027 pm". `previous` from
  the *May/June 2026* GCSE (Version 1.0) and A-level (Version 1.1) PDFs still on
  aqa.org.uk: 8300 14 May / 03 June / 10 June 2026; 8700 21 May / 05 June 2026;
  8464 12 May (pm) / 18 May / 02 June / 08 June / 12 June / 15 June 2026; 7357
  03 / 11 / 18 June 2026. *November 2026* GCSE timetable: 8700/1 03 November,
  8700/2 05 November, 8300 papers 04 / 06 / 09 November 2026.
- **Pearson Edexcel** — *GCSE Summer 2027 Examination Timetable — FINAL*:
  "Friday 14 May 1MA1 1F Mathematics Paper 1 (Non-Calculator) …"; "Thursday 27
  May 1MA1 2F … Paper 2 (Calculator)"; "Monday 14 June 1MA1 3F … Paper 3
  (Calculator)"; "Monday 24 May 1EN0 01 English Language Paper 1: Fiction and
  Imaginative Writing"; "Tuesday 08 June 1EN0 02 … Paper 2: Non-Fiction and
  Transactional Writing"; 1SC0 "Tuesday 11 May … Paper 1: Biology 1", "Monday
  17 May … Paper 2: Chemistry 1", "Tuesday 25 May … Paper 3: Physics 1",
  "Thursday 10 June … Paper 4: Biology 2", "Tuesday 15 June … Paper 5:
  Chemistry 2", "Friday 18 June … Paper 6: Physics 2". *GCE Summer 2027 — FINAL*:
  "Wednesday 26 May 9MA0 01 … Paper 1: Pure Mathematics 1 Afternoon 2h 00m";
  "Wednesday 09 June 9MA0 02 … Paper 2: Pure Mathematics 2"; "Wednesday 16 June
  9MA0 03 … Paper 3: Statistics & Mechanics". *GCSE November 2026 — FINAL*: 1EN0
  01 Tuesday 03 November, 1MA1 1 Wednesday 04 November, 1EN0 02 Thursday 05
  November, 1MA1 2 Friday 06 November, 1MA1 3 Monday 09 November 2026. **No
  `previous`** — see fetch table.
- **Cambridge OCR** — *GCSE and Cambridge Nationals Final Examination Timetable
  June 2027* (© Cambridge OCR 2026; "The awarding bodies have designated the
  morning and afternoon sessions of Wednesday 23 June 2027 as 'contingency
  sessions'"): "J560/01 Paper 1 (Foundation – calculator) 1 h 30 min Fri 14 May
  am"; "J560/02 Paper 2 (Foundation – non-calculator) … Thu 27 May am"; "J560/03
  … Mon 14 June am" (Higher 04/05/06 same days); "J351/01 Communicating
  information and ideas 2h Mon 24 May am"; "J351/02 Exploring effects and
  impact 2h Tue 8 June am"; J250 "01 Paper 1 (Biology) (Foundation) … Tue 11 May
  am", "03 (Chemistry) … Mon 17 May am", "05 (Physics) … Tue 25 May am", "02 …
  Thu 10 June am", "04 … Tue 15 June am", "06 … Fri 18 June am" (Higher 07–12
  same days). *AS and A Level … June 2027*: "H240/01 Pure mathematics 2h Wed 26
  May pm"; "H240/02 Pure mathematics and statistics 2h Wed 9 June pm"; "H240/03
  Pure mathematics and mechanics 2h Wed 16 June pm". `previous` from the *June
  2026* PDFs: J560 Thu 14 May / Wed 3 June / Wed 10 June; J351 Thu 21 May am /
  Fri 5 June am; J250 Tue 12 May pm / Mon 18 May am / Tue 2 June am / Mon 8 June
  am / Fri 12 June am / Mon 15 June am; H240 Wed 3 June / Thu 11 June / Thu 18
  June pm. Kept as published: OCR numbers tiers separately (Papers 1–3
  Foundation, 4–6 Higher) and its Paper 1/4 is the **calculator** paper, Paper
  2/5 non-calculator — the opposite order to AQA and Pearson. *November 2026*
  GCSE: J351/01 Tue 3 Nov, J560/01 Wed 4 Nov, J351/02 Thu 5 Nov, J560/02 Fri 6
  Nov, J560/03 Mon 9 Nov.
- **WJEC / Eduqas** — *WJEC Wales and Eduqas Summer 2027 FINAL Examination
  Timetable (version 2) — GCSE* ("Changes to the first published version are
  highlighted in yellow"; contingency sessions Wednesday 23 June 2027): the
  grid places "Mathematics (Eduqas) C300U10-1 Component 1 Foundation Tier 2h
  15m" under **Friday 14 May**, "C300U20-1 Component 2" under **Thursday 27 May**,
  "C700U10-1 English Language (Eduqas) Component 1 1h 45m" under **Monday 24
  May** and "C700U20-1 … Component 2 2h" under **Tuesday 8 June**. *GCE AS/A
  level — Final Version*: "1300U30-1 Mathematics (WALES) A2 Unit 3 2h 30m" under
  **Tuesday 25 May**, "1300U40-1 … A2 Unit 4 1h 45m" under **Wednesday 9 June**.
  `previous` from the *Summer 2026* GCSE and GCE (15.04.25) PDFs: C300U10-1
  Thursday 14 May, C300U20-1 Wednesday 3 June, C700U10-1 Thursday 21 May,
  C700U20-1 Friday 5 June, 1300U30-1 Wednesday 3 June, 1300U40-1 Thursday 11
  June 2026. Kept as published: Eduqas Mathematics has **two** components, not
  three; there is **no GCSE Combined Science** on the WJEC/Eduqas timetable
  (Wales sits "Science (Double Award)" and, from 2027, "NEW The Sciences
  (Double Award)") and **no Eduqas A level Mathematics** (the Wales 1300 units
  are the only A level Mathematics). Legacy WJEC Mathematics 3300 units are
  "RESIT ONLY" in 2027 and the "NEW Mathematics and Numeracy (Double Award)"
  3320 units are examined for the first time. *November 2026* GCSE timetable:
  C700U10-1 Tuesday 3, C300U10-1 Wednesday 4, C700U20-1 Thursday 5, C300U20-1
  Friday 6 November 2026.
### deadlines — JCQ entries deadline and each board's late-fee dates
- JCQ June 2027: "21/02/2027 Deadline for entries GCSE GCE Entries" (June 2026:
  "21/02/2026 Deadline for entries"); November 2026: "04/10/2026 Final date for
  entries GCSE".
- AQA *Exam series guide 2026/27 (version 1.1)*: columns "Entry closing date /
  Late Entry fees payable after" and "Very late entry/amendment fees payable
  after": "6A27 June 2027 series 6A 21 February 2027 … 20 November 2026 21 April
  2027 12 August 2027"; "6G27 June 2027 series 6G 21 February 2027 … 21 April
  2027 19 August 2027". *Entry fees and other charges — Summer 2027* (G02872_01,
  Version 1.0 issued June 2026, p. 5): "Late entry fee — Charged for each entry
  for a new student received after the entries deadline for each exam series.
  This fee is 100 % of the original entry fee and is in addition to the entry
  fee."; "Very late entry fee — Charged for each very late entry for a new
  student received from the date specified for each exam series … This fee is
  150 % of the original entry fee and in addition to the entry fee."
- Pearson *Key dates 2026/2027* §1.1 (GCSE and AS/A level tables): "Jun–27 UK
  Centres 20/11/2026 21/02/2027 22/02/2027 22/04/2027 22/04/2027" (basedata,
  entry deadline, late fees from, amendment fees from, high late fees from);
  "From the late fee date, the entry (subject or unit) fee is doubled. The entry
  fee is trebled from the high late fee date." (same wording in *Fees for UK
  centres 2026/27*, Version 1.0, August 2026, "Late Fees").
- Cambridge OCR *General Qualifications Fees List 2026/27* (Version 1.00, 1 July
  2026), p. 8: "June 2027 GCSE/Entry Level Certificate 21 February 2027 22
  February 2027 22 April 2027 21 March 2027"; "June 2027 AS/A Level/Core
  Maths/Extended Project/FSMQ 21 February 2027 22 February 2027 22 April 2027
  21 April 2027"; "Late entry (Stage 1) fee — Charged after the entry deadline.
  You pay the original entry fee and a late fee of the same amount."; "Very late
  entry (Stage 2) fee — Charged after the late entry (Stage 1) deadline. You pay
  the original entry fee and a very late fee of twice the original entry fee."
- WJEC *General and Vocational Qualification Fees 2026/27* ("Effective period:
  1 September 2026 to 31 August 2027"), §4.1 and table 4.1a: "GCSE May / June
  2027 21 February 2027 18 March 2027 20 working days 19 March 2027 19 April
  2027" (GCE identical); "The Late Fee is equivalent to 2 times the Entry Fee
  for that qualification (or unit)."; "The Very Late Fee is equivalent to 2.5
  times the Entry Fee for that qualification (or unit)." Kept as published:
  WJEC's amendment window to 18 March 2027 means its late fees start three and a
  half weeks after the other boards'.
### spec-changes — what is announced, and what is not
- DfE *Government response to the Curriculum and Assessment Review* (gov.uk
  publication of 5 November 2025, PDF dated November 2025): "publish a revised
  national curriculum in 2027 for first teaching in 2028. We will also update
  GCSEs, for first teaching from 2029 onwards"; "Our aim is that some are ready
  for first teaching in 2029 and the rest for first teaching in 2030. … We will
  also seek to update corresponding AS and A levels to be ready for first
  teaching in 2031 and 2032". **No reformed specification or spec code exists.**
- Ofqual *Decisions: proposed changes to the assessment of mathematics, physics
  and combined science GCSEs* (page published 2 March 2026, decisions added 5
  May 2026): "Ofqual has decided to implement the proposals set out in the
  consultation document" for "GCSE mathematics, physics and combined science
  exams being taken from 2028 onwards for the lifetime of the current
  qualifications, including any resit opportunities"; boards must "publish the
  formulae and equations sheets … by 1 September the year before each exam
  series". AQA news (1 September 2026) confirms the 2027 sheets "are the same
  ones which were used in 2026".
- AQA news (9 October 2025): "our new AS and A-level Business specification
  (7137, 7138) has been accredited by Ofqual. For first teaching in September
  2026, first AS exams in 2027 and A-level exams in 2028."
- Pearson subject update (22 June 2026), Edexcel AS and A level History
  amendments: "Both specifications are for first teaching September 2026, and
  for first assessment June 2027 (AS level) and June 2028 (A level)."
- Cambridge OCR subject update (29 April 2026): "our new A Level Psychology
  (H569) qualification is now accredited for first teaching in September 2027 …
  This new specification will be first examined in June 2029".
- Qualifications Wales (28 June 2023): "26 new Made-for-Wales GCSEs from
  September 2025 … introduced for first teaching from September 2025 … with the
  first new GCSEs being awarded in 2027" (WJEC *GCSE Mathematics and Numeracy
  (Double Award)* page: "Teaching: Sept 2025", code 3320QD).
- Ofqual press release (13 November 2025), BSL GCSE: "Ofqual has today set out
  the rules for the assessment of a groundbreaking new GCSE in British Sign
  Language (BSL) … it would be for any interested exam boards to develop their
  specific offers, which would then go through Ofqual's accreditation process."
  **No accredited BSL specification or first-teaching date is published** by
  the regulator or on any board page read; served as such, not as a date.
- Not announced on any official page read on 2026-10-04 and therefore absent:
  new GCSE specifications for England (all current GCSE codes run through at
  least summer 2030), a summer 2028 timetable (provisional expected February
  2027), November 2027 key dates.
Watcher: six pages (`sources()` in `api/_areas/uk-exam-dates.js`) — the JCQ
key-dates and timetables landing pages (the series PDFs hang off them) and the
four boards' timetable landing pages. jcq.org.uk answers 403 to the watcher's
user agent today, so its two rows will read as fetch errors until that changes;
the four board pages return 200.
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

## Verification log (uk-gov-process, added 2026-10-04)

Fetch notes: every service page was fetched 2026-10-04 through the gov.uk
content API (`https://www.gov.uk/api/content/<path>`, UA naming databutler.dev);
all returned 200. Each category's `pageUpdatedAt` is the API `updated_at` date
(the `public_updated_at` "last major change" on mainstream guides is years old —
e.g. /passport-fees 2015-01-12 — even though the fees changed in April 2026, so
it is not a change signal). **Mainstream guides (`guide`, `answer`,
`transaction`) publish no `change_history`**; only detailed guides, news and
publications do. So dated changes come from: the Home Office news stories
(`/government/news/new-fees-for-passport-applications` 18 March 2026,
`/government/news/changes-to-passport-application-fees` "came into force on 10
April 2025", the ETA rollout/enforcement stories of 27 November 2024, 5 March
2025, 24 November 2025 and 24 February 2026, the eVisa grace-period story of 27
February 2025), the `change_history` of
`/guidance/check-when-you-can-get-an-electronic-travel-authorisation-eta` and
`/guidance/universal-credit-if-you-have-children` ("The 2-child limit ended on 6
April 2026"), the Home Office fees tables (`/government/publications/visa-regulations-revised-table`
attachments for 9 April 2025 "Electronic travel authorisation (ETA) | £10 | £16"
and 8 April 2026 "electronic travel authorisation (ETA) | £16 | £20"), and the
statutory instruments: SI 2026/311 (Immigration, Nationality and Passports
(Fees) (Amendment) Regulations 2026; Part 3 in force 8 April 2026; Schedule 8
"The fifth entry £94.50 £102 … The seventh entry £108 £116.50 The eighth entry
£120.50 £130") and SI 2026/148 (Social Security Benefits Up-rating Order 2026,
art. 1(3)(n): Universal Credit amounts from "the first day of the first
assessment period to commence … on or after 6th April 2026"). Previous values
are also confirmed on National Archives captures of the same pages, fetched with
the `id_` modifier (`…/ukgwa/<timestamp>id_/https://www.gov.uk/<path>`):
passport-fees 20260227170031 ("£94.50 £107"), get-a-child-passport
20260227163858 ("£61.50" / "£74"), eta 20260227163904 ("An ETA costs £16"),
universal-credit 20260227160542 ("£400.14", "£292.81 per child"); the 30
September 2024 captures of renew-driving-licence, apply-first-provisional-driving-licence,
apply-blue-badge and register-birth show the same fees as today (£14/£21.50/£17,
£34/£43, £10/£20, £12.50), so those figures carry no `previous`. Licence: the
gov.uk footer, "All content is available under the Open Government Licence
v3.0, except where otherwise stated". Nothing was written from memory.

Kept as published / odd:
- HM Passport Office "about our services" (`/government/organisations/hm-passport-office/about/about-our-services`)
  still says a paper form "costs an extra £16.00" (last changed 2022-10-20); the
  fees pages now give £115.50 − £102 = £13.50. The area quotes the fees pages and
  uses that page only for "You’ll usually get your passport within 3 weeks."
- Overseas passport fees have no gov.uk guide page (`/overseas-passports` is a
  start page only); the figures come from the 18 March 2026 news story and are
  confirmed in force by SI 2026/311 Schedule 8.
- `/register-a-death` is a smart answer whose content API body is empty; the
  category's source is `/after-a-death` (part "Register the death": "within 5
  days (8 days in Scotland) of getting the confirmation"), with death certificate
  fees from `/order-copy-birth-death-marriage-certificate` ("Certificates cost
  £12.50").
- `/guidance/online-immigration-status-evisa` now redirects to `/evisa`
  (redirect published 2026-01-20); `/evisa` is the source.
- `/register-to-vote` says England and Northern Ireland "You must be aged 16 or
  over to register" and Scotland and Wales "14 or over".

### Services and the sentence each figure was read from

- passport-renewal-adult — /renew-adult-passport: "It costs £102 to renew or
  replace your passport if you apply online or £115.50 if you fill in a paper
  form."; /passport-fees: "Adult (16 and over) 54-page frequent traveller
  passport | £116 | £129.50"; /get-a-passport-urgently: "It costs £239.50 (or
  £253.50 …)", "£192 for an adult passport"; /apply-first-adult-passport: "An
  adult passport is valid for 10 years."
- passport-child — /get-a-child-passport: "It costs £66.50 to apply online and
  £80 to apply with a paper form from the Post Office. A child passport is valid
  for 5 years."
- driving-licence-renewal — /renew-driving-licence: "It costs £14 when you apply
  online.", "the £21.50 fee", "a cheque or postal order for £17", "You must renew
  a photocard licence every 10 years"; /renew-driving-licence-at-70: "Once you
  reach 70, you must renew every 3 years."
- provisional-licence — /apply-first-provisional-driving-licence: "It costs £34
  when you apply online.", "a cheque or postal order for £43", "be at least 15
  years and 9 months old".
- change-address — /change-address-driving-licence: "It does not cost anything to
  change your address with DVLA.", "fined up to £1,000"; /change-address-v5c:
  "It’s usually free to update it.", "you’ll have to pay £25 to get a
  replacement".
- vehicle-tax-sorn — /vehicle-tax and /make-a-sorn: "You must tax your vehicle
  even if you do not have to pay anything", "You’ll get a refund for any full
  months of remaining tax.", "a new log book costs £25".
- register-to-vote, register-birth ("within 42 days", "Both kinds cost £12.50"),
  register-death, blue-badge ("costs up to £10 in England and £20 in Scotland.
  It’s free in Wales.", "within 12 weeks").
- self-assessment — /register-for-self-assessment: "by 5 October 2026";
  /self-assessment-tax-returns (parts deadlines, penalties, who-must-send-a-tax-return):
  "by 11:59pm on 31 October 2026", "by 11:59pm on 31 January 2027", "by 11:59pm
  on 30 December 2026", "an initial £100 penalty", "earned more than £1,000";
  Making Tax Digital guidance: "£50,000 … from 6 April 2026", "£30,000 … from 6
  April 2027", "£20,000 … from 6 April 2028".
- national-insurance-number — "It can take up to 4 weeks to get your National
  Insurance number after you’ve proved your identity."
- universal-credit — "have £16,000 or less", "within 28 days of creating your
  account", "around 5 weeks", "£424.90", "£338.58", "£666.97", "£303.94 a month
  for each child".
- eu-settlement-scheme — "It’s free to apply", "extended by 5 years", "30 months
  (2.5 years) in the last 5 years".
- evisa — /evisa: "eVisas have replaced physical immigration documents.", "You
  do not need to pay"; /biometric-residence-permits: "All BRPs have now expired",
  "24 months after the expiry date printed on the card, or until 31 December
  2026".
- eta — /eta: "An ETA costs £20.", "An ETA lasts for 2 years or until your
  passport expires", "within a day, but it can take up to 3 working days".

## Verification log (jp-vehicle-costs, added 2026-10-24)

Fetch notes: every source was fetched 2026-10-24 with curl (browser
User-Agent); all returned HTTP 200. PDFs were read with `pdftotext -layout`,
HTML pages as text. The figure list is the VERIFIED entries of
`car_websites/shaken-data/data/jp-costs/figures.json` (verified the same day for
shakendata.com); every value below was re-read from its source page today and
cross-checked against that file (47 directly comparable values, 0 differences).
Rule figures (age counting, eco-rate rule, surcharge rules, green reductions)
are restated from the quoted sentence. Nothing was written from memory.

Licences: mlit.go.jp (`/link.html`), fsa.go.jp (`/rules/index.html`) and
soumu.go.jp (`/menu_kyotsuu/policy/tyosaku.html`) — "権利表記の記載がない限り
「公共データ利用規約（第1.0版）」（PDL1.0）に準拠した利用条件の下で、利用すること
ができます". naltec.go.jp (`/policy/`), tax.metro.tokyo.lg.jp (`/policy`) and
city.koto.lg.jp (`/011501/8787.html`) reserve copyright but allow quotation
(引用) under the Copyright Act; only the statutory amount and the row it sits in
are quoted. keikenkyo.or.jp (`/attribute/policy.html`) forbids reproduction
without permission, so its 継続検査 page (same kei fees, 2,500 / 2,100 / 1,850)
is corroboration only — the kei fees cite NALTEC's fee list, which prints the
軽自動車 rows.

- weight-tax — https://www.mlit.go.jp/jidosha/content/001884517.pdf
  "2026年5月1日からの自動車重量税の税額表 … １．乗用車 2年自家用 エコカー（本則税率）
  右以外 13年経過 18年経過: 0.5ﾄﾝ以下 5,000 8,200 11,400 12,600 / ～１ 10,000 16,400
  22,800 25,200 / … / ～３ 30,000 49,200 68,400 75,600"; 1年自家用 2,500 4,100 5,700
  6,300; "５．検査対象軽自動車（二輪を除く） 2年自家用 免税 5,000 6,600 8,200 8,800".
  Age rules from the same PDF's "経過年数の考え方": 12年10ヶ月 (登録自動車, 租税特別
  措置法 第九十条の十一の二・三) and "13年を経過した年の11月以後" (軽, 施行令 第五十一条
  の三). The table carries no end date of its own; 2028-04-30 is the flowchart's
  "2026年５月1日から2028年４月30日まで".
- weight-tax-eco — https://www.mlit.go.jp/jidosha/content/001884912.pdf
  "〔適用期間〕 ･令和８年５月1日～令和10年４月30日"; bands ① 令和８年５月１日～令和９年
  ４月30日 80/95/達成/105/125% = 25%軽減/50%軽減/75%軽減/免税/免税※１; ② 令和９年５月
  １日～令和10年４月30日 80% = 軽減なし・本則税率, 85% 25%軽減 …; "※１ 初回継続検査時等
  も免税。（車検証の有効期間が満了する日から起算して15日を経過する日までに…）".
- cali (current) — https://www.mlit.go.jp/jidosha/jibaiseki/common/data/ryouritsuhyo.pdf
  "自動車損害賠償責任保険基準料率 ２０２３年１月１８日届出 損害保険料率算出機構",
  "（1）離島以外の地域（沖縄県を除く。）に適用する基準料率": 自家用乗用自動車 12か月
  11,500 (その７), 24か月 17,650 and 25か月 18,160 (その５), 36か月 23,690 (その４),
  37か月 24,190 (その３); 軽自動車 検査対象車 11,440 / 17,540 / 18,040 / 23,520 /
  24,010. Applies-from date from
  https://www.mlit.go.jp/jidosha/jibaiseki/other_info/data/index.html: "（※１）令和5年
  4月1日以降に保険期間の始期を有する保険契約に適用されます。" Kept as published: the
  MLIT 加入 page (`/about/policyholder/`) lists the same 12/24/36 amounts as
  "令和6年4月以降始期の契約" (the April 2024 filing only added 特定小型原付).
- cali (from 2026-11-01) — https://www.fsa.go.jp/singi/singi_zidousya/siryou/20260430/01_153.pdf
  "① 改定の実施日 2026年11月１日"; "５．保険期間別改定基準料率表（１２・２４・３６か月
  契約）… 自家用乗用自動車 11,500 12,250 750 6.5 17,650 18,560 910 5.2 23,690 24,690
  1,000 4.2"; "検査対象車 11,440 12,300 860 7.5 17,540 18,660 1,120 6.4 23,520 24,830
  1,310 5.6". **Omitted:** the revised 25- and 37-month rates — the FSA document
  prints 12/24/36 months only and the 損害保険料率算出機構 table was not reachable
  (giroj.or.jp answered 503 when shaken-data was researched); they stay UNVERIFIED.
- inspection-fee — https://www.naltec.go.jp/business/inspection/hbh5ss0000000ngo-att/gtg5d20000000cre.pdf
  "令和８年４月１日以降の自動車検査手続きに関する手数料一覧" 継続検査: 持込検査 普通
  ６００円 ２，０００円 ２，６００円, 小型 ６００円 １，９００円 ２，５００円, 軽
  ２，１００円 ４００円 ２，５００円; 保安基準適合証の提出 普通/小型/軽 １，７００円
  ４００円 ２，１００円; 継続検査（OSS） 保安基準適合証 普通/小型/軽 １，４５０円
  ４００円 １，８５０円. Previous amounts from
  https://www.naltec.go.jp/business/inspection/hbh5ss0000000ngo-att/i5ss5i0000000cv4.pdf
  (現行 → 令和８年４月以降): 持込 普通 2,300 → 2,600, 小型 2,200 → 2,500, 軽 2,200 → 2,500;
  適合証 窓口 1,800 → 2,100; OSS 1,600 → 1,850. 400 yen 技術情報管理手数料:
  https://www.naltec.go.jp/business/inspection/fee.html "令和3年10月1日より … 技術情報
  管理手数料が追加（1台あたり一律400円）".
- auto-tax — https://www.tax.metro.tokyo.lg.jp/kazei/car_shubetsu.html "７ 税率（年額）"
  自家用 令和元年10月1日以後初回新規登録 / 令和元年9月30日以前: 1リットル以下 25,000 /
  29,500 … 1.5リットル超～2リットル以下 36,000 / 39,500 … 6リットル超 110,000 /
  111,000; "２ 環境負荷の大きい自動車に対する重課 … ディーゼル自動車…11年を超えるもの
  ・ガソリン自動車・ＬＰＧ自動車…13年を超えるもの 重課率 概ね15％". Surcharge table:
  https://www.tax.metro.tokyo.lg.jp/documents/d/tax/zikayou201909_green_h "１カ年分"
  33,900 … 127,600. Green reduction: https://www.mlit.go.jp/jidosha/content/001993314.pdf
  "令和８年４月１日～令和10年３月31日 … 概ね75％軽減". Rename:
  https://www.mlit.go.jp/jidosha/content/001993968.pdf "環境性能割は、令和８年３月 31 日
  をもって廃止する。…現行の自動車税種別割を自動車税とし…". Kept as published: the
  page's EV row (25,000 / 29,500) is not a figure in figures.json and is not published.
- kei-tax — https://www.soumu.go.jp/main_content/000404244.pdf "乗 用のもの 10,800円
  (7,200円)", "（※1） 平成27年3月31日以前に初めて車両番号の指定を受けた軽四輪等について
  は、Ｈ27.3.31までの税率を適用"; https://www.city.koto.lg.jp/060501/kurashi/zekin/kejidosha/5112.html
  "四輪以上（660cc以下） 乗用 自家用 7,200円 10,800円 12,900円", "13年経過した車両につ
  いては、14年経過した月の属する年度から、3.重課税率が適用", 軽課 "令和7年度中 … に最初
  の車両番号の指定を受けた場合は令和8年度分 … 四輪以上 乗用 自家用 2,700円". The
  総務省 PDF is the 平成28年度 overview; its standard rates are still those Kōtō
  City levies.
