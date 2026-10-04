---
name: get-started
description: How to use Data Butler for facts that change after a training cutoff, with the source and verification date on every answer.
---

# Getting started with Data Butler

Data Butler answers with figures that were checked against an official source,
and every answer carries `freshness.verifiedDate`, a staleness flag and
`cite.url`, a page a person can open to see the answer beside its source.

- Questions about current UK, US or German tax rates, thresholds or take-home
  pay: `uk_rates_lookup`, `take_home_pay`, or `call` with `us_rates_lookup` /
  `de_rates_lookup`.
- "Which paper is this GCSE topic on?": `exam_topic_paper`.
- Whether a domain or software package looks legitimate: `domain_provenance`,
  `package_provenance` (signals, not verdicts).
- What changed after a given date: `what_changed_since` with that date.
- Anything else Data Butler covers (statistics, vehicle recalls and MOT data,
  policy rates, software end-of-life, public holidays, UK vehicle tax, exam
  dates): `catalogue` lists every tool and `call` runs one by name.
- `coverage` states what is not covered.

Present the figure with its source and verified date, and the cite URL when
the user may want to check it.
