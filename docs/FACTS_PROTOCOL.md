# Verified Facts protocol, v0.2

One short key for one official figure; one compact, dated, sourced, signed answer back. Identifier: `verified-facts/0.2`. It is the facts layer of the Verified Changes protocol (`verified-changes/0.1`, `docs/CHANGES_PROTOCOL.md`) and leaves that layer's wire format unchanged. Reference implementation: Data Butler (https://databutler.dev). Served indexable at `/protocol/facts` (`?format=md` for this file). Status: live on databutler.dev since 2026-10-12 (L3: signed with key `db-2026-10`).

```
$ curl -s https://databutler.dev/f/uk/income-tax/personal-allowance?max_age=30d
{
  "protocol": "verified-facts/0.2",
  "key": "uk/income-tax/personal-allowance",
  "label": "Personal Allowance",
  "value": 12570,
  "unit": "GBP/year",
  "period": "2026-27",
  "effectiveFrom": "2026-04-06",
  "effectiveTo": null,
  "source": "https://www.gov.uk/income-tax-rates",
  "quote": "The standard Personal Allowance is £12,570, which is the amount of income you do not have to pay tax on.",
  "verifiedDate": "2026-10-04",
  "status": "fresh",
  "ageDays": 8,
  "maxAgeDays": 30,
  "previous": { "value": 12570, "period": "2025-26" },
  "hash": "sha256:9f2c…",
  "signature": { "alg": "EdDSA", "kid": "db-2026-10", "jws": "eyJhbGciOiJFZERTQSIsImtpZCI6ImRiLTIwMjYtMTAifQ..k7Q…", "keys": "https://databutler.dev/.well-known/jwks.json" },
  "publisher": { "name": "Data Butler", "url": "https://databutler.dev/" },
  "cite": { "url": "https://databutler.dev/f/uk/income-tax/personal-allowance", "text": "databutler.dev, verified 2026-10-04 against https://www.gov.uk/income-tax-rates" }
}
```

Every design choice below is justified against one criterion: **does it make the protocol more likely to be found and used by Claude, ChatGPT, Copilot, Perplexity and the agent frameworks?** Elegance lost every tie.

## 1. Purpose

Agents already know the fact they want — "the UK personal allowance", "the Social Security wage base", "the ECB deposit rate" — and are bad at only two things: knowing whether the number in their weights is still current, and finding the official page quickly. Today that costs them a web search, a page fetch and a guess. Verified Changes (v0.1) answered the first problem for whole datasets ("what moved since my cutoff?"). Verified Facts answers it for one figure at a time: name the fact, say how fresh it must be, get the value with its date, its official source and a signature that lets anyone check the publisher really said so.

The protocol adds nothing to the publishing discipline of v0.1 (fetch before publish, re-check on a cadence, never edit, say what is not covered). It adds a **key**, a **get**, a **resolve**, a **batch**, a **signature** and three **transports**, and it defines **conformance levels** so a site with no server at all can publish its facts as static files.

Design rules carried from v0.1: plain JSON, no authentication, no registration, no new transport. Everything reuses HTTP, JSON Schema, JWS, OpenAPI and MCP as they exist.

## 2. Relationship to Verified Changes v0.1

| Layer | Identifier | Discovery document | Unit | Status |
|---|---|---|---|---|
| Changes (what moved) | `verified-changes/0.1` | `/.well-known/changes.json` | entry: `area/key`, from → to, effectiveFrom, source, verifiedDate | unchanged on the wire; §12 lists the optional fields v0.2 adds for the five adopters' feedback |
| Facts (what is) | `verified-facts/0.2` | `/.well-known/facts.json` | fact record: `key`, value, period, effectiveFrom, source, verifiedDate, hash, signature | new |

Compatibility rules:

- A v0.1 publisher stays conformant without doing anything. `/.well-known/changes.json` keeps `"protocol": "verified-changes/0.1"`; every new field is optional and consumers ignore unknown fields.
- A v0.2 publisher serves both documents. `changes.json` gains one optional pointer, `"facts": "https://<site>/.well-known/facts.json"`, and `facts.json` carries `"changes": "https://<site>/.well-known/changes.json"`, so a consumer that finds either finds both.
- The changelog entry key `area` + `key` (v0.1) and the fact key (v0.2) are related by a published mapping (§3.4), so an entry in `what_changed_since` names the fact an agent then `get`s. Within one publisher a fact key resolves to exactly one changelog key and vice versa.
- Schema files are additive: `changes.v0.json` accepts `protocol` ∈ {`verified-changes/0.1`, `verified-changes/0.2`} and the §12 fields; `fact.v0.json` and `well-known-facts.v0.json` are new. URLs are forever; nothing is renamed.

## 3. Keys

### 3.1 Shape

A key is a lowercase, slash-separated path of two to six segments:

```
<namespace>/<topic>/<fact>              uk/income-tax/personal-allowance
<namespace>/<prefix>/<topic>/<fact>     uk/exams/results/gcse-results-day
<namespace>/<fact>                      uk/bank-rate
```

Grammar: `^[a-z][a-z0-9-]*(/[a-z0-9][a-z0-9.-]*){1,5}$`. Segments are hyphenated words (`national-insurance`), never underscores or camelCase, because hyphens are what people and models type into URLs. Digits and dots are allowed inside a segment for versions and bands (`18.19`, `co2-1-to-50g-km`). Keys are the publisher's: two publishers may use the same key, and when they do the key means the same fact, which is what makes cross-publisher corroboration (§8.2) possible.

Why human-readable and guessable rather than opaque ids (Wikidata `Q…`, Data Commons DCIDs): an agent that has never seen the publisher should be able to type the key it would have typed into a search box and be right, or be corrected (§6). FRED's `CPIAUCSL` and endoflife.date's `/api/python.json` show both ends of this: the opaque id needs a catalogue search first, the readable URL does not, and endoflife.date is the one agents actually call unprompted.

### 3.2 Namespaces

The first segment is the **namespace**. Two-letter namespaces are ISO 3166-1 alpha-2 codes in lowercase and mean the jurisdiction the figure applies in: `us`, `de`, `fr`, `eu` (EU-level rules and institutions), and `uk`. ISO reserves `UK` exceptionally for the United Kingdom; this protocol uses `uk`, not `gb`, because `uk` is what gov.uk, HMRC and every searcher write — guessability wins. Publishers resolve `gb/…` to `uk/…` as an alias (§3.4). Sub-national jurisdictions append an ISO 3166-2 subdivision code: `uk-sct/income-tax/starter-rate`, `us-ca/minimum-wage/hourly`. A namespace that is not a jurisdiction (a software ecosystem, an exam board, a sport) is any other slug of three or more letters and must be declared in `facts.json` `namespaces[]` with a description. Data Butler v0.2 declares only jurisdictions (`uk`, `us`, `de`, `eu`).

### 3.3 Period is a parameter, not part of the key

`uk/income-tax/personal-allowance` is one fact with a value per tax year; the key never carries `2026-27`. Reasons, all adoption-driven:

1. The agent usually does not know the current period — that is the whole reason it is asking. A key that requires the period to be right first fails the guess.
2. Stable keys make stable URLs, stable aliases, stable changelog entries and stable citations. FRED (series + observation date), Data Commons (variable + date) and DNS (name + TTL) all separate identity from time.
3. One signature scheme covers every period: the period is a field of the signed record (§8.3), not a part of the name.

The `period` and `as_of` parameters (§5.2) select which value of the fact is returned; the default is the value in force today.

### 3.4 Aliases and versioning

- A key, once published, never changes meaning and is never deleted. A fact the source withdraws keeps its key and answers with `"value": null, "withdrawn": "<date>"` (mirroring v0.1's `to: null`).
- A renamed or restructured key becomes an **alias**: the old key keeps working and the answer carries the canonical `key` plus `requestedKey`. Publishers list aliases in the index (§5.4) and in the record's `aliases[]`. Common alias classes: `gb/…` → `uk/…`; the changelog form `uk-rates:income-tax/personal-allowance` (v0.1's `area` + `key` joined by `:`) → the fact key; pre-prefix forms when an area gains a prefix.
- The protocol version (`verified-facts/<major>.<minor>`) follows v0.1's rules: minor versions add optional fields and transports; a major version may change required fields and ships a new schema URL. Keys are not versioned; a fact whose definition genuinely changes (a different legal basis, not a new value) gets a new key and the old one is withdrawn with a `supersededBy`.

## 4. The fact record

The object every transport returns. Fields are camelCase; all are required unless marked.

| Field | Type | Meaning |
|---|---|---|
| `protocol` | `"verified-facts/0.2"` | |
| `key` | string | canonical key (§3) |
| `requestedKey` | string, optional | present when the request used an alias or was auto-resolved (§6.3) |
| `aliases` | string[], optional | other keys that resolve here |
| `label` | string | human name of the fact |
| `value` | number \| string \| boolean \| object \| array \| null | the figure. `null` only with `withdrawn` |
| `unit` | string \| null | `GBP/year`, `%`, `GBP/week`, `date`, `rule`, `EUR/month`, … as in v0.1; `null` for text rules and dates stated in `value` |
| `period` | string \| null | the publisher's label for the period the value belongs to: `2026-27`, `2026`, `null` for a standing figure |
| `effectiveFrom` | date \| null | first day the value applies, as the source states it |
| `effectiveTo` | date \| null | last day, or `null` while the value is current / open-ended |
| `source` | URL | the official page the value was read from (v0.1 rules: the authority's own domain, or an official catalogue page with `sourceFile`) |
| `sourceType` | `"authority"` \| `"methodology"` \| `"derived"`, optional | default `authority` (§12 items 3–4) |
| `quote` | string, optional | the sentence or table row the value was read from |
| `verifiedDate` | date | the day the publisher fetched `source` and read `value` |
| `nextScheduledRefresh` | date \| null | when the publisher has committed to re-check |
| `status` | `"fresh"` \| `"stale"` | against the caller's `max_age` (§5.3) |
| `ageDays` | integer | today − `verifiedDate` |
| `maxAgeDays` | integer \| null | the `max_age` applied, `null` when the publisher's cadence was used |
| `previous` | object, optional | `{ value, period, effectiveFrom?, source? }` — the comparable prior value when the publisher holds one |
| `scope` | string, optional | one line of applicability ("England, Wales and Northern Ireland; Scottish rates differ") |
| `hash` | string | `sha256:<hex>` over the claim (§8.2) |
| `signature` | object, optional at L1–L2, required at L3 | `{ alg, kid, jws, keys }` (§8.3) |
| `publisher` | `{ name, url }` | |
| `freshness`, `cite`, `attribution` | v0.1 envelope, optional | kept so v0.1 consumers see the blocks they already read |

JSON Schema: `https://databutler.dev/schema/fact.v0.json` (draft 2020-12). Publishers may add fields; consumers ignore unknown ones. Compactness is a feature: the record above is ~900 bytes, because an agent pays for every byte in its context window and a bloated answer is one it stops calling.

## 5. `get`

### 5.1 Inputs

| Input | HTTPS | MCP (`get_fact`) | Meaning |
|---|---|---|---|
| key | path `/f/{key}` | `key` | canonical key or alias. Several keys separated by commas (≤ 50) make a batch (§7) |
| `max_age` | query | `max_age` | how old `verifiedDate` may be before the answer is `stale`: `30d`, `12w`, `6m` (= 30-day months), `1y` (= 365 days), or an ISO 8601 duration `P30D`, `P6M` |
| `as_of` | query | `as_of` | `YYYY-MM-DD`: return the value in force on that day (`effectiveFrom ≤ as_of` and `as_of < effectiveTo` or `effectiveTo` null) |
| `period` | query | `period` | the publisher's period label instead of a date: `2025-26` |

`as_of` and `period` are mutually exclusive; `period` is sugar for publishers with labelled periods. With neither, the value in force today is returned.

### 5.2 Periods the publisher holds

A publisher answers for the periods it has verified. Data Butler holds the current period and, where a figure carries a verified `previous` block, the prior one; a request for a period outside that answers `covered: false` with `periodsHeld: [...]`, never a guess and never the current value silently relabelled. The `previous` value, when served as a period in its own right, carries its own `source` (the page the prior value was read from) and the publisher's `verifiedDate` for it.

### 5.3 The freshness contract — never silently stale

`status` is computed on every answer:

- `max_age` given: `ageDays ≤ maxAgeDays` → `fresh`, else `stale`.
- `max_age` omitted: `fresh` unless the publisher's own freshness (v0.1 `staleness`) is `overdue`, in which case `stale`; `maxAgeDays` is `null`.

A stale answer is still returned, with its value: the publisher has no newer figure and the value may well still be right, but the agent is told, in a field it cannot miss, that the publisher's check is older than it asked for. The agent should say so to its user ("verified 2026-04-06, older than the 30 days you asked for") rather than present the figure as current. What the protocol forbids is returning an older verification as if it met the bar. HTTP status stays 200 for a stale answer (the request succeeded); L2 publishers also send `X-Facts-Status: stale` so a cache or proxy can see it without parsing the body.

`ageDays` is computed from `verifiedDate`, not from `effectiveFrom`: the question `max_age` answers is "how recently did a human check the source?", which is the only guarantee the publisher can make.

### 5.4 Misses

- Unknown key, no confident resolution (§6.3): HTTPS `404` with `{ "error": "unknown key", "requestedKey", "candidates": [ …up to 5 resolve results… ], "index": "<url of the key index>" }`; MCP returns `isError: false` with `covered: false` and the same fields — a miss is an answer, not a failure, and the candidates are the next call.
- Known key, period not held: `200`/`covered: false` with `periodsHeld`.
- Withdrawn: `200` with `value: null`, `withdrawn: "<date>"`, `supersededBy?`.

### 5.5 The index

`GET /f` (no key) returns every key the publisher serves — `{ protocol, publisher, count, generated, facts: [ { key, label, unit, period, verifiedDate, hash, aliases? } ] }` — so a client that would rather not guess can load the whole namespace once (~500 keys is ~70 KB; publishers with more paginate by `?namespace=`). The index is also the L1 publisher's only catalogue, and the Dataset JSON-LD (§10.4) describes it.

## 6. `resolve`

### 6.1 Why it exists

Every data API that has failed to be adopted by agents fails the same way: the agent must first search a catalogue to learn the identifier, then make the real call — two tool calls, two schemas, a context window full of catalogue entries. Data Commons needs `search_indicators` before `get_observations`; FRED needs `series/search` before `series/observations`. `resolve` exists so that a loose key or a plain question becomes a ranked list of canonical keys in one step, and so that `get` itself can call it on the agent's behalf (§6.3) and skip the step entirely when the answer is unambiguous.

### 6.2 Inputs and output

`GET /f/resolve?q=…&namespace=uk&limit=5` or MCP `resolve_fact { q, namespace?, limit? }`.

```json
{
  "protocol": "verified-facts/0.2",
  "query": "what is the NI primary threshold",
  "candidates": [
    { "key": "uk/national-insurance/primary-threshold", "label": "Primary Threshold (employee pays above this)", "unit": "GBP/week", "period": "2026-27", "verifiedDate": "2026-10-04", "score": 0.92, "matched": ["synonym:ni", "label"] },
    { "key": "uk/national-insurance/secondary-threshold", "label": "Secondary Threshold (employer pays above this)", "unit": "GBP/week", "period": "2026-27", "verifiedDate": "2026-10-04", "score": 0.61, "matched": ["synonym:ni", "label:threshold"] }
  ],
  "best": { …full fact record for the top candidate… },
  "hint": "best is present only when the top candidate is unambiguous; otherwise pick a key and call get."
}
```

Ranking is deterministic and published so two publishers behave alike: exact key 1.0; alias 0.95; every query token present in key + label + topic title + synonyms, scaled by token coverage, up to 0.9; partial token coverage, proportional; Levenshtein distance ≤ 2 per token 0.4. Tokens are lowercase, hyphen/space split, light-stemmed (`allowances` → `allowance`), with stop words removed and jurisdiction words mapped to namespaces (`uk`, `british`, `hmrc`, `gov.uk` → `uk`; `irs`, `federal`, `ssa` → `us`; `german`, `bund` → `de`; `ecb` → `eu`). Publishers declare synonyms per topic (`ni` → `national-insurance`, `pa` → `personal-allowance`, `nlw` → `national-living-wage`, `base rate` → `bank-rate`). Results are ordered by score, then key.

### 6.3 Auto-resolution in `get`

When `get` receives a key that is not canonical and not an alias, it runs `resolve` and returns the fact **only if** exactly one candidate scores ≥ 0.8 and the runner-up is ≥ 0.2 lower; the record then carries `requestedKey` and `resolved: { score, matched }`. Otherwise it misses (§5.4) with the candidates. The threshold is deliberately strict: a confidently wrong figure is the one failure mode that destroys the product, and the cost of a miss is one more call with a key the agent now has.

## 7. Batch

- HTTPS: `GET /f?keys=k1,k2,k3&max_age=30d` or `POST /f` with `{ "keys": [...], "max_age": "30d", "as_of": "…" }`. Limit 50 keys.
- MCP: `get_fact` with a comma-separated `key` — one tool, no second schema to learn.

Response: `{ protocol, publisher, count, results: [ …one record or miss per requested key, in request order… ], status: "fresh" | "stale" }` where the batch `status` is `stale` if any record is. Each record keeps its own `hash` and `signature`, so a batch is exactly as verifiable as its parts.

## 8. Hashing and signing

### 8.1 What was chosen and why

Three layers, each cheap, each independently useful:

1. **Content hash** on every record (`hash`): SHA-256 over the RFC 8785 (JSON Canonicalization Scheme) form of the *claim* (§8.2). Required at every level. No keys, no infrastructure; a publisher with static files computes it at build time.
2. **Detached Ed25519 JWS** on every record (`signature`): RFC 7515 compact serialisation with the payload omitted (Appendix F), `alg: EdDSA` (RFC 8037), payload = the RFC 8785 form of the *attestation* (§8.3). Optional at L1–L2, required at L3. Public keys as a JWK Set.
3. **Hash-linked changelog** (optional, L3): each changelog entry carries `hash` (the claim hash of its `to` state) and `prevHash`; the document carries `chainHead`. Because entries are immutable (v0.1), the publisher's git history is the transparency log. Deferred for Data Butler until its repository is public; §13.

Why JWS over HTTP Message Signatures (RFC 9421): 9421 signs an HTTP exchange, so the signature dies the moment the record leaves the response — copied into an MCP `text` result, cached by a CDN that rewrites headers, saved to disk by an L1 static site, pasted into a document. A JWS travels inside the JSON and verifies anywhere with the JSON alone. 9421 verifiers exist (Cloudflare's Web Bot Auth builds on it, with Ed25519 keys at `/.well-known/http-message-signatures-directory`), and an L3 publisher may add a 9421 response signature later as a transport-layer extra; it is not the record's signature. Why not C2PA (media manifests), Verifiable Credentials (JSON-LD, large), Sigstore/Rekor (a transparency log for software artefacts; heavy for ~500 figures): none is lighter than one JWS per record, and every JWS library (jose, PyJWT, go-jose, Nimbus) verifies EdDSA detached signatures today.

### 8.2 The claim and its hash

```
claim = { key, value, unit, period, effectiveFrom, source }
hash  = "sha256:" + hex(SHA-256(JCS(claim)))
```

The claim is the publisher-independent statement "fact `key` had `value` `unit` for `period` from `effectiveFrom`, according to `source`". `verifiedDate`, `label`, `publisher` and presentation fields are **excluded on purpose**: two publishers who independently read the same page should produce the **same hash**, so a consumer holding records from both can see corroboration with a string compare and no cryptography. A review pass proposed including `verifiedDate`; it was left out for exactly this reason — the attestation (§8.3) is where "who checked, and when" lives. JCS is specified rather than "stable key order" because number serialisation is where canonicalisations silently diverge, and RFC 8785 pins it to ECMAScript's `Number.prototype.toString`, which Node, browsers and every JCS library implement identically.

### 8.3 The attestation and its signature

```
attestation = { protocol, publisher: <publisher.url>, key, hash, value, unit, period,
                effectiveFrom, effectiveTo, source, verifiedDate }
signingInput = BASE64URL(UTF8(header)) || "." || BASE64URL(JCS(attestation))
header       = { "alg": "EdDSA", "kid": "<key id>" }
signature.jws = BASE64URL(header) || ".." || BASE64URL(Ed25519-sign(signingInput))
```

The record carries `signature: { alg: "EdDSA", kid, jws, keys }` where `keys` is the JWK Set URL. The attestation is rebuilt by the verifier from the record's own fields, so no separate payload is transmitted — the record is the payload. A standard (base64url-encoded payload) detached JWS was chosen over RFC 7797 `b64: false` because every JWS library accepts the former by reinserting the payload between the two dots, and only some accept the latter.

### 8.4 Key publication and rotation

- Public keys: `/.well-known/jwks.json`, a JWK Set (`{ "keys": [ { "kty": "OKP", "crv": "Ed25519", "x": "…", "kid": "db-2026-10", "use": "sig", "alg": "EdDSA", "validFrom": "2026-10-15", "retired": null } ] }`), declared in `facts.json` as `keys`. The path is not an IANA-registered well-known URI (JWKS are normally found via an OAuth metadata document); it is declared in `facts.json` precisely so nothing depends on the path. CORS open, cached one day.
- `kid` is `<publisher-short>-<yyyy>-<mm>`. Rotation: publish the new key in the set at least 7 days before it signs anything; sign new builds with it; set `retired` on the old key; keep retired keys listed for at least 2 years so old citations still verify. A compromised key gets `revoked: "<date>"`; signatures whose attestation `verifiedDate` is after that date are invalid, earlier ones remain valid.
- **Where the private key lives — build time, not request time.** The signature attests a *verification event*: a human read `source` on `verifiedDate`. That happens at curation time, so Data Butler signs at build time (`node scripts/sign-facts.js`, private key on the maintainer's machine, signatures committed in `data/facts-signatures.json`) and the serverless function only serves precomputed signatures. The private key never reaches the hosting platform, a bug in a handler cannot sign a wrong number, and a committed signature set means "every served figure was signed by the person who verified it" is a test (`tests/facts-sign.test.js`) rather than a hope. L1 static publishers sign the same way, necessarily. The cost is that an unsigned data change fails the build until the maintainer signs it, which is the behaviour wanted.

### 8.5 What a verifier actually checks

1. Recompute `hash` from the record's claim fields; it must equal `hash`.
2. Fetch `signature.keys` (cache it), find `kid`; the key must not be `revoked` before `verifiedDate`.
3. Rebuild the attestation from the record, canonicalise, base64url, insert between the two dots of `jws`, verify EdDSA with the JWK.
4. Optionally: `source` host is on the publisher's declared `authorities[]` in `facts.json`; `verifiedDate ≤ today`; `status` against its own `max_age`.

### 8.6 Who verifies today — honestly

Nobody, yet. The MCP specification has no result signing; Claude, ChatGPT, Copilot and Perplexity verify nothing in a tool result; the proposals that do sign in the MCP world (secure-MCP drafts, SMCP, ETDI) sign tool *definitions and messages*, not data. So the signature's value today is: (a) a human following a `cite.url` or a CI job in a sister repo can prove the record is the publisher's and unaltered with one command (`npx verified-facts verify <url>`); (b) two publishers' identical `hash` is corroboration without trust; (c) when clients do start verifying — Web Bot Auth shows the plumbing arriving at the HTTP layer — conforming publishers are already there; (d) in a registry listing, "signed, verifiable, with keys at /.well-known" is a differentiator reviewers understand. The hash is therefore **required** at every level and the signature **optional until L3**, so no publisher is blocked by key management.

## 9. Transports

The same record over three transports; a publisher implements the first and may add the others.

### 9.1 HTTPS

| Request | Answer |
|---|---|
| `GET /f/{key}?max_age=&as_of=&period=` | the record, `application/json; charset=utf-8` |
| `GET /f/{key}?format=txt` or `Accept: text/plain` | one line: `12570 GBP/year (2026-27, from 2026-04-06) verified 2026-10-04 fresh https://www.gov.uk/income-tax-rates` — for shells and for agents that only want the number |
| `GET /f/{key}?format=html` or `Accept: text/html` | an **indexable** page: the record, its source link, its JSON, JSON-LD (§10.4). Unlike v0.1's `/r/` citation pages (noindex), fact pages are meant to be indexed: Bing/Copilot citations are the one discovery channel for which the reference implementation has hard evidence (tens of thousands of Copilot citations a month against hundreds of search clicks), and Copilot cites pages, not APIs |
| `GET /f?keys=…` / `POST /f` | batch (§7) |
| `GET /f` | the index (§5.5) |
| `GET /f/resolve?q=` | resolve (§6) |
| `GET /openapi.json` | the OpenAPI document (§9.3) |

Headers on a record: `ETag: "<hash>"`, `Last-Modified: <verifiedDate>`, `Cache-Control: public, max-age=0, s-maxage=3600, stale-while-revalidate=86400` (curated data moves at most daily; a stale `status` is a function of the day, so one hour is the most a cache may hold it), `X-Facts-Status`, `Link: </.well-known/facts.json>; rel="describedby"`, CORS `*`. Misses are `no-store`. Single-segment paths under `/f/` (`resolve`, `index`) are reserved: a key always has at least two segments.

Why a path, not a query parameter: `/f/uk/income-tax/personal-allowance` is a URL a model can complete from the pattern after seeing one example, appears whole in logs, llms.txt and citations, and is cacheable by every CDN by default. `/f` rather than `/facts` because the brief is compactness and the examples get typed a lot; `/facts` is served as an alias.

### 9.2 MCP

A publisher with an MCP server exposes three tools with these exact names, so a client can look for them: `get_fact`, `resolve_fact`, `what_changed_since` (the v0.1 tool). Data Butler serves them on a dedicated server, `POST https://databutler.dev/api/mcp/facts`, **and** lists `get_fact` and `resolve_fact` at its front door. The dedicated server exists because its three tool definitions cost ~600 tokens — the complaint from the one major assistant vendor that publicly stopped using MCP internally was the context cost of tool definitions, and a three-tool server is the smallest useful answer to it.

Tool definitions are written for model tool-selection: the first sentence is the question the agent has, the second says what comes back, examples are real keys, and the wording is plain statement (the house rule — no "use this", "always", "never"). Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.

**`get_fact`** — title "Get a verified fact"

> The current value of one official figure by key — a tax threshold, rate, allowance, fee, deadline, limit or policy rate — with the date it was verified, the official source URL, the period it applies to and a signature. Keys are `<country>/<topic>/<fact>`, e.g. `uk/income-tax/personal-allowance`, `uk/national-insurance/primary-threshold`, `us/social-security/wage-base`, `de/income-tax/grundfreibetrag`, `uk/bank-rate`, `eu/ecb/deposit-facility`, `uk/gov/passport-renewal-adult/fee-online-uk`. A loose key is resolved when unambiguous; otherwise the answer lists candidate keys. `max_age` (e.g. `30d`) marks the answer `stale` when the verification is older than that. Several keys separated by commas return a batch. Covers UK, US and German rates and thresholds, UK vehicle tax and MOT rules, UK government service fees, UK exam dates and central-bank policy rates; `coverage` lists the rest.

Input schema: `{ key: string (required; one key, or several separated by commas, max 50), max_age?: string, as_of?: date, period?: string }`.

**`resolve_fact`** — title "Find the key for a fact"

> Ranked canonical fact keys for a plain-language question or a guessed key — "NI primary threshold", "ECB deposit rate", "passport renewal fee" — each with label, unit, period and verification date, and the full record of the top match when it is unambiguous. The keys feed `get_fact`. Filter by `namespace` (`uk`, `us`, `de`, `eu`).

Input schema: `{ q: string (required), namespace?: string, limit?: integer (1–20, default 5) }`.

**`what_changed_since`** — unchanged from v0.1, with each entry now also carrying `factKey` so the agent can go straight to `get_fact`.

Front-door placement (Data Butler): `get_fact` and `resolve_fact` join the hub tools; the house cap becomes 5 direct + 6 hub = 11 listed. The initialise `instructions` open with: "For any official figure — a threshold, rate, allowance, fee, deadline — call `get_fact` with the key and the freshness you need rather than quoting a number from memory; `resolve_fact` finds the key."

### 9.3 OpenAPI

`GET /openapi.json`: OpenAPI 3.1, one `servers[]` entry, four operations with `operationId`s `getFact`, `getFacts`, `resolveFact`, `whatChangedSince`, response schemas by `$ref` to the published JSON Schemas, and `x-verified-facts: "0.2"`. This is for the loaders that exist: LangChain's OpenAPI toolkit, LlamaIndex's `OpenAPIToolSpec`, and anything that turns a spec into function-calling tools. The OpenAI Agents SDK has no OpenAPI loader and connects to MCP instead, which is why §9.2 exists; the document is generated from the same tool definitions, so the two never drift.

## 10. Discovery documents

### 10.1 `/.well-known/facts.json`

```json
{
  "protocol": "verified-facts/0.2",
  "publisher": {
    "name": "Data Butler",
    "url": "https://databutler.dev/"
  },
  "conformance": "L3",
  "updated": "2026-10-31",
  "facts": {
    "count": 742,
    "get": "https://databutler.dev/f/{key}",
    "batch": "https://databutler.dev/f?keys={keys}",
    "resolve": "https://databutler.dev/f/resolve?q={q}",
    "index": "https://databutler.dev/f",
    "filtering": "server",
    "examples": [
      "uk/income-tax/personal-allowance",
      "us/social-security/wage-base",
      "de/income-tax/grundfreibetrag",
      "uk/bank-rate"
    ]
  },
  "namespaces": [
    {
      "name": "uk",
      "description": "UK tax/NI thresholds, Bank of England Bank Rate, UK car tax (VED) and MOT rules, UK exam dates and UK government service steps, fees and processing times",
      "count": 404,
      "cadence": "uk-rates: Every 6 April (new tax year) and after each Budget or Autumn Statement; minimum wage on 1 April; every source page re-fetched weekly. policy-rates: After each scheduled decision (eight a year per bank); re-verified within 45 days of verifiedDate; every source page re-fetched weekly. uk-vehicle-rules: Every 1 April (VED rates and the historic-vehicle exemption date move with the Finance Act) and after each Budget; MOT fees and rules when DVSA changes them; every source page re-fetched weekly. uk-exam-dates: Annual, calendar-driven: when JCQ and the boards publish the following summer's final timetables (early in the calendar year) and the results days; the weekly watcher hashes the JCQ and board timetable pages uk-gov-process: Re-verified against the gov.uk pages every 30 days and on fee-change days (Home Office fees usually move in April); every source page re-fetched weekly through the gov.uk content API.",
      "authorities": [
        "qualifications.pearson.com",
        "qualifications.wales",
        "webarchive.nationalarchives.gov.uk",
        "www.aqa.org.uk",
        "www.bankofengland.co.uk",
        "www.gov.uk",
        "www.jcq.org.uk",
        "www.ocr.org.uk",
        "www.sqa.org.uk",
        "www.wjec.co.uk"
      ]
    },
    {
      "name": "us",
      "description": "Federal Reserve federal funds target range and US federal tax thresholds",
      "count": 94,
      "cadence": "policy-rates: After each scheduled decision (eight a year per bank); re-verified within 45 days of verifiedDate; every source page re-fetched weekly. us-rates: Annual: after the IRS tax-year inflation adjustments (October), the retirement-plan limits (November), the SSA Federal Register notice (October/November) and the CMS Medicare amounts (November); source pages re-fetched weekly, ssa.gov read by hand.",
      "authorities": [
        "www.cms.gov",
        "www.ecfr.gov",
        "www.federalregister.gov",
        "www.federalreserve.gov",
        "www.irs.gov",
        "www.medicare.gov",
        "www.ssa.gov"
      ]
    },
    {
      "name": "de",
      "description": "German tax and social-insurance thresholds",
      "count": 44,
      "cadence": "de-rates: Annual: after the Sozialversicherungsrechengrößen-Verordnung and the Zusatzbeitrag announcement (November), and any Steuergesetz changing § 32a EStG for the next Veranlagungszeitraum; every source page re-fetched weekly.",
      "authorities": [
        "www.bmas.de",
        "www.bundesanzeiger.de",
        "www.bundesgesundheitsministerium.de",
        "www.deutsche-rentenversicherung.de",
        "www.gesetze-im-internet.de",
        "www.minijob-zentrale.de",
        "www.recht.bund.de"
      ]
    },
    {
      "name": "eu",
      "description": "ECB key interest rates",
      "count": 3,
      "cadence": "policy-rates: After each scheduled decision (eight a year per bank); re-verified within 45 days of verifiedDate; every source page re-fetched weekly.",
      "authorities": [
        "www.ecb.europa.eu"
      ]
    },
    {
      "name": "jp",
      "description": "Japanese car inspection (車検) statutory costs and car taxes and Japanese minimum wages, social-insurance rates, pensions, benefits, holidays and tax thresholds",
      "count": 197,
      "cadence": "jp-vehicle-costs: Re-verified against the official pages every 35 days and on the known change dates (自賠責 2026-11-01, car taxes each 1 April, weight-tax eco bands 2027-05-01); every source page re-fetched weekly. jp-living-costs: Re-verified against the official pages every 35 days and on the known change dates (prefecture minimum wages 2026-10-01 to 2026-12-02 and each autumn, deductions 2026-12-01, insurance and pension rates each March/April, 高額療養費 2027-08-01, the 2028 holidays in February 2027); every source page re-fetched weekly.",
      "authorities": [
        "www.cfa.go.jp",
        "www.city.koto.lg.jp",
        "www.fsa.go.jp",
        "www.giroj.or.jp",
        "www.kyoukaikenpo.or.jp",
        "www.mhlw.go.jp",
        "www.mlit.go.jp",
        "www.naltec.go.jp",
        "www.nenkin.go.jp",
        "www.nta.go.jp",
        "www.soumu.go.jp",
        "www.tax.metro.tokyo.lg.jp",
        "www8.cao.go.jp"
      ]
    }
  ],
  "hash": "sha256/jcs",
  "signature": "EdDSA/jws-detached",
  "keys": "https://databutler.dev/.well-known/jwks.json",
  "changes": "https://databutler.dev/.well-known/changes.json",
  "openapi": "https://databutler.dev/openapi.json",
  "mcp": {
    "url": "https://databutler.dev/api/mcp/facts",
    "tools": [
      "get_fact",
      "resolve_fact",
      "what_changed_since"
    ],
    "serverCard": "https://databutler.dev/api/mcp/facts/server-card"
  },
  "schema": "https://databutler.dev/schema/fact.v0.json",
  "specification": "https://databutler.dev/protocol/facts",
  "licence": "Free to reuse with attribution to databutler.dev; each figure belongs to its official source and stays under that source's terms (gov.uk: Open Government Licence v3.0).",
  "contact": "https://github.com/physics-star-cat/databutler/issues"
}
```

Schema: `https://databutler.dev/schema/well-known-facts.v0.json`. `facts.get` is an RFC 6570 URI template so a static publisher can serve `…/f/{key}.json`. `filtering` is `server` or `client` (§12 item 1): a `client` publisher ignores `max_age`/`as_of` and the consumer computes `status` from `verifiedDate` itself. `authorities` lets a verifier check that every `source` sits on a declared official host.

### 10.2 Relationship to `/.well-known/changes.json`

Unchanged, plus the optional `"facts": "<facts.json URL>"`. A consumer that starts from either document reaches both; `what_changed_since` entries carry `factKey`; `get_fact` records carry `previous`. The two documents are generated from the same area modules (`scripts/sync-areas.js`), so counts, namespaces and cadences cannot disagree.

### 10.3 `llms.txt`

Evidence says llms.txt is published widely and fetched almost never by assistants (Ahrefs' May 2026 log study: 97% of files received zero requests; AI retrieval bots were 1.1% of what little traffic there was), so the protocol asks for exactly two lines and no more effort:

```
- `GET https://databutler.dev/f/uk/income-tax/personal-allowance?max_age=30d` — one verified official figure by key (value, period, effectiveFrom, source, verifiedDate, signature). Pattern: /f/<country>/<topic>/<fact>; index at /f; /f/resolve?q= finds a key.
- `GET https://databutler.dev/.well-known/facts.json` — Verified Facts protocol discovery (verified-facts/0.2): namespaces, endpoints, keys, OpenAPI, MCP.
```

The first line is an example URL rather than a description because a model that has read one concrete URL can produce the next one.

### 10.4 Dataset JSON-LD

The index page (`GET /f`, HTML) carries a schema.org `Dataset`: `name`, `description`, `url`, `license`, `dateModified` (newest `verifiedDate`), `creator`, `distribution: [{ "@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": "https://databutler.dev/f" }]`, `isBasedOn` (the official source URLs), and `variableMeasured` as one `PropertyValue` per key (`name` = key, `value`, `unitText`). Google documents Dataset markup as feeding Dataset Search only, not rich results, and no evidence was found that AI answer products read it; it is included because it is generated for free from the index and costs nothing to maintain. Each fact page carries a schema.org `Claim` (`text`, `datePublished` = `verifiedDate`, `appearance` = the source page, `author` = publisher) — UNVERIFIED that any consumer reads `Claim`; it is optional at every level.

### 10.5 MCP Server Card and AI Catalog

SEP-2127 (Final, Extensions Track, January 2026) defines a static **Server Card** at `<streamable-http-url>/server-card` describing a remote MCP server's identity and transports, and an **AI Catalog** at `/.well-known/ai-catalog.json` linking a domain's cards. Both are static JSON a publisher with an MCP server generates from the same data as `facts.json`. Data Butler serves `https://databutler.dev/api/mcp/facts/server-card`, cards for its other servers, and the catalog; `facts.json` points at the card. Clients that crawl for cards (Goose demonstrates it) find the server without any registry.

## 11. Conformance levels

A publisher states its level in `facts.json`. Every item is checkable from outside with HTTP and the published schemas; `npx verified-facts check https://<site>` (see the adoption plan) runs them.

**L1 — static files, no server.** The level for a site built with Next.js, Hugo or plain HTML and deployed as files.

1. `/.well-known/facts.json` validates against `well-known-facts.v0.json`, `protocol` = `verified-facts/0.2`, `facts.filtering` = `client`.
2. `facts.index` returns the index (§5.5), one record per key, each with `hash`.
3. `facts.get` with every key in the index returns that record as `application/json`, with `hash` equal to the SHA-256 of the JCS claim.
4. Every `source` is `https:`, on a host in the namespace's `authorities[]`, and fetches with 200.
5. `/.well-known/changes.json` conforms to `verified-changes/0.1` and names `facts`.
6. Keys match the grammar, are unique, and alias targets exist.
7. `generated` in static documents is the newest `verifiedDate`; a byte-identical rebuild produces identical files.

**L2 — served.** L1 plus:

8. `facts.filtering` = `server`; `max_age`, `as_of`, `period` are honoured and `status`, `ageDays`, `maxAgeDays` are present on every record; a request for a period not held answers `covered: false` with `periodsHeld`.
9. `facts.resolve` exists, returns ranked candidates per §6.2, and `get` auto-resolves only under the §6.3 rule.
10. Batch (§7) up to 50 keys; misses inside a batch do not fail the batch.
11. A miss is `404` with `candidates` (HTTPS) / `covered: false` (MCP), `no-store`.
12. `ETag` = hash, `Last-Modified` = `verifiedDate`, `text/plain` and `text/html` representations.
13. `openapi.json` is served and every operation in it routes.
14. If `mcp` is declared: `tools/list` includes `get_fact`, `resolve_fact`, `what_changed_since` with read-only annotations, and a Server Card is served.

**L3 — signed.** L2 (or L1 for a static publisher that signs at build) plus:

15. Every record carries `signature` that verifies per §8.5 against a key in `keys`.
16. `keys` is a JWK Set with `validFrom` on every key and a published rotation and revocation policy (§8.4).
17. Changelog entries carry `hash`; the changes document carries `chainHead`; the publisher states where its history is auditable.
18. The publisher verifies its own live output on a schedule (Data Butler: the Monday watcher) and treats a failure as an incident.

**For an assistant.** On a question about an official figure: `get_fact` (or `GET /f/<key>`) with the key you would guess and the `max_age` your user's question deserves (a tax calculation: `30d`; a general question: omit it). If the answer is a miss, take the top candidate if its score is high, or ask the user. Present `value` with `period`, say `verifiedDate` and quote `source`; if `status` is `stale`, say so. Do not call `resolve` first by habit — `get` resolves for you when it safely can.

## 12. Resolutions of the v0.1 adopter feedback

The five adopters' thirteen points (`docs/PROTOCOL_V02_FEEDBACK.md`) are resolved as optional additions to the changes layer, so no existing document breaks. `changes.v0.json` and `well-known-changes.v0.json` are updated additively; `protocol` may read `verified-changes/0.1` or `verified-changes/0.2`.

| # | Resolution (all optional) |
|---|---|
| 1 | Discovery field `filtering: "server" \| "client"` (default `server`). A `client` publisher's JSON endpoint ignores `?since=`/`?area=`; consumers filter. |
| 2 | For a static document, `generated` is defined as the newest `verifiedDate` among its entries. |
| 3, 4 | Entry field `sourceType: "authority" \| "methodology" \| "derived"` (default `authority`). `methodology`/`derived` entries point `source` at the publisher's own method page and should carry `method` (URL or one line). The same field appears on fact records. |
| 5 | `areas` may be empty (`minItems: 0`); top-level optional `status` string on both documents ("no changes recorded yet", "paused"). |
| 6 | Optional integer `seq` on an entry; identity becomes `area` + `key` + `verifiedDate` + `seq` (absent = 0). |
| 7 | Optional `dateBasis: "verified" \| "commit" \| "source"` on an entry (default `verified`). |
| 8 | Optional `snapshot` date on an entry (the dataset release or download day); `effectiveFrom` keeps the source's own meaning. |
| 9 | `since` stays strictly-after; the discovery document gains optional `sinceHint` (the recommended first `since`, normally `coverageStart − 1 day`), and this spec documents the off-by-one. |
| 10 | `source` may be an official catalogue page; optional `sourceFile` holds the file's own URL. |
| 11 | Optional `cadenceType: "scheduled" \| "on-change" \| "best-effort"` beside the prose `cadence`. |
| 12 | Optional `bundle: true` on a first-coverage entry; optional `heldCount` and `sourceCount` integers. |
| 13 | Trailing-slash and non-slash forms are both acceptable; canonical is without. Same for `/f/<key>`. |

## 13. Prior art and positioning

| | Identifier | Freshness | Source | Signing | Discovery | What v0.2 takes / leaves |
|---|---|---|---|---|---|---|
| **Google Data Commons** (+ MCP server, hosted, `datacommons-mcp` on PyPI) | DCID | observation date | provenance per series | none | MCP (`search_indicators` → `get_observations`) | Statistical time series at scale; agents need a search step first. v0.2 is for legal/administrative thresholds Data Commons does not hold, with keys that need no search. Interop target: expose our keys as DCIDs if they ever want them. |
| **FRED / ALFRED** | series ID (`CPIAUCSL`) | observation date; `realtime_start/end` vintages | St. Louis Fed | none | API key required | The vintage idea is `verifiedDate` + `as_of` done properly; the API key is the anti-pattern (no agent will register). |
| **Wikidata** (+ official MCP server) | `Q…`/`P…` | per-statement references | community | none | SPARQL/MCP | Breadth; no guarantee any statement was read from the authority on a date. Possible later: a Wikidata property pointing at a fact key. |
| **DNS / DNSSEC** | hierarchical name | TTL | authoritative server | RRSIG chain | resolvers | The model: a name, a TTL (`max_age`), an authoritative answer, a signature. v0.2 is DNS for figures, minus the resolver network. |
| **endoflife.date** | `/api/<product>.json` | per-cycle dates | vendor pages | none | guessable URLs | The adoption proof: a plain, guessable JSON URL per thing is what agents call unprompted. Data Butler already republishes it. |
| **RFC 9421 / Web Bot Auth** | — | — | — | Ed25519 over HTTP messages, keys at `/.well-known/http-message-signatures-directory` | — | Transport-layer; shows verifier plumbing is arriving. Not the record signature (§8.1). |
| **C2PA** | — | — | — | manifests for media | — | Media only. |
| **ARP** (IETF individual draft, 2026) | — | — | self-attested | trust levels | `.well-known` | Lets *entities* publish corrections about themselves; v0.2 publishes *third-party-verified* figures with the authority as source. Different trust model; watch it. |
| **gtv / Trustlayer `get_signed_fact`** | — | — | evidence lists | Sigstore / ES256K + JWKS | MCP | Verdict-oriented fact *checking*, pilot or commercial. v0.2 is a *publishing* format any site can serve statically. |
| **Verified Changes v0.1** | `area/key` | `verifiedDate`, `staleness` | authority | none | `/.well-known/changes.json` | The base layer; v0.2 adds the per-fact get. |

Nobody found serves sourced, dated, signed administrative thresholds under guessable keys with a changes feed; that is the niche. Retirement/Monte Carlo and insurance-quote MCP servers exist (reported by a parallel review; not re-verified here) — they are calculators, not fact publishers, and are potential *consumers* of this protocol.

## 14. Versioning

`verified-facts/<major>.<minor>`, same rules as v0.1. v0.2 is a draft: the shape is implemented by Data Butler first; v1.0 may tighten wording after a second publisher implements L2 or three publish L1. Comments: https://github.com/physics-star-cat/databutler/issues.

## References

RFC 8785 (JSON Canonicalization Scheme); RFC 7515 (JWS, Appendix F detached content); RFC 8037 (EdDSA in JOSE); RFC 7517 (JWK); RFC 8615 (well-known URIs); RFC 6570 (URI templates); RFC 9421 (HTTP Message Signatures); MCP SEP-2127 (Server Cards) and the `experimental-ext-server-card` repository; schema.org `Dataset`, `DataDownload`, `PropertyValue`, `Claim`; OpenAPI 3.1; `docs/CHANGES_PROTOCOL.md`; `docs/PROTOCOL_V02_FEEDBACK.md`.
