# Future areas: candidates not yet built

Ideas with evidence behind them, waiting for a go/no-go. Building one is a Fable research job first
(source and licence), then the normal four-file area job (`docs/ADDING_AN_AREA.md`).

## Property and renovation costs (noted 2026-10-13)

**Evidence of demand.** lowriskquotes.com already ranks, weakly, for homeowner cost questions. Search Console,
2026-07-14 to 2026-10-11:

- About half of its Google impressions are cost questions: 3,961 of 8,003, across 321 distinct queries.
- Top queries: "home extension cost" 238, "home addition cost" 228, "house extension cost" 213,
  "quanto costa rifare il tetto di una casa" 156, "how much does an addition cost" 155,
  "granny flat cost" 140, "home addition cost toronto" 107, "bathroom renovation cost" 58.
- By country: Canada 2,044, Australia 971, Italy 703, UK 68, US 55.

The pages sit at positions 60–85, so these impressions turn into almost no clicks. The question is asked
constantly, and nobody hands an agent a sourced answer.

**What a Data Butler version would be.** Sourced cost *ranges*, not quotes. Keys of the form
`ca/renovation/home-addition/cost-per-sqft` or `au/build/granny-flat/cost-range`, each with:

- the range, unit, region and period;
- the official or published source;
- `verifiedDate`;
- a `methodology` note (what is in and out of the range).

lowriskquotes' line-item models could supply `sourceType: methodology` figures. Any official index
supplies the dated anchor.

**Sources to research (unverified, licence unknown):**
- Statistics Canada building construction price indexes;
- ABS producer price indexes for house construction (Australia);
- ISTAT construction cost index (Italy);
- ONS construction output price indices (UK);
- US Census / BLS PPI for residential construction.

Commercial cost guides such as BCIS or RSMeans are paid and not redistributable, so they are out.

**Risks.** A range presented as a price invites being quoted as one. Regional spread is wide. The demand
lives on lowriskquotes, so the agent channel may be the smaller prize. Decide together with the
lowriskquotes ranking and audience question in the 2026-10-13 search-snippet review.

## Evaluated 2026-10-12 (verdicts recorded so they are not re-researched)

| Candidate | Verdict | Why |
|---|---|---|
| US retirement (401(k)/IRA limits, SSA tables, Monte Carlo) | Build narrow | IRS and SSA figures are official. The Monte Carlo needs sourced assumptions and FINRA 2214-style disclaimers. 2026 SSA bend points were read 2026-10-13: PIA $1,286 / $7,749. |
| Car insurance quotes | No | Quoting is regulated (FCA / US state). No official open source. |
| UK grocery prices (Tesco, Asda, Lidl) | No | Retailer terms forbid scraping. No official per-product feed. |
| UK Fuel Finder (statutory fuel prices) | Optional live-data area | Official and open, but live data rather than a curated fact. |
