# Publish your figures as Verified Facts in an afternoon

If your site states official figures (a fee, a threshold, an inspection interval, a rate) and you checked each one against the official page, you can publish them so an AI assistant can fetch any one by key, see where it came from and when you checked it, and tell whether it has moved since. No server, no account, no API key: a handful of static JSON files that any host serves. This page is the recipe. The specification is [Verified Facts](https://databutler.dev/protocol/facts) (`verified-facts/0.3`); Data Butler is the reference implementation and [lists every publisher that passes the check](https://databutler.dev/facts/publishers).

```
facts-source.json  →  npx verified-facts static  →  commit public/  →  npx verified-facts check
```

## 1. Write `facts-source.json`

One file, kept in your repository next to the build. It names you, the jurisdictions your figures belong to, the official hosts they are read from, and the figures themselves.

```json
{
  "publisher": { "name": "Example Car Site", "url": "https://cars.example.org/" },
  "namespaces": [
    { "name": "uk", "description": "UK MOT rules", "cadence": "checked every 1 April and when DVSA changes a fee", "authorities": ["www.gov.uk"] }
  ],
  "changes": "https://cars.example.org/.well-known/changes.json",
  "licence": "Free to reuse with attribution; each figure stays under its official source's terms.",
  "contact": "https://cars.example.org/contact",
  "facts": [
    {
      "key": "uk/mot/max-fee-car",
      "label": "Maximum MOT fee (car, class 4)",
      "value": 54.85,
      "unit": "GBP",
      "period": "2026-27",
      "effectiveFrom": "2026-04-01",
      "effectiveTo": null,
      "source": "https://www.gov.uk/getting-an-mot/mot-test-fees",
      "quote": "Car: £54.85",
      "verifiedDate": "2026-10-02",
      "changeCadence": "irregular",
      "nextExpectedChange": null
    }
  ]
}
```

The rules that matter:

- **Keys** are lowercase, slash-separated, two to six segments: `<country>/<topic>/<fact>`. Use the key a person would guess. If another publisher already serves the same fact, use their key: two publishers with the same key and the same reading produce the same hash, which is corroboration anyone can check with a string compare.
- **`source`** is the official page you read the value from, on a host listed in that namespace's `authorities`. The generator refuses any other host.
- **`verifiedDate`** is the day a person read `value` on `source`. Never the build date.
- **`changeCadence`** (optional) says how the source changes the value: `scheduled` (a published decision calendar), `annual` (a fixed day each year), `irregular` (a statute or fee order, no fixed date), `continuous` (a fixed release frequency).
- **`nextExpectedChange`** (optional) is the next day the source's own calendar allows the value to move. Give it only when the source names that day; otherwise `null`. A consumer treats your figure as stale once that day passes and you have not re-verified, so a wrong date costs you, and a guessed one is worse than none.
- **`sourceCheckedAt`** (optional) is the newest day an automated check of yours fetched `source` successfully. Leave it out unless something really fetched the page.

## 2. Generate the files

```sh
npx verified-facts static facts-source.json --out public --check
```

This writes, under `public/`:

- `.well-known/facts.json`, the discovery document: your level (`L1`), the URL templates, your namespaces and the collection `digest`;
- `f/index.json`, every key with its label, period, verification date and hash;
- `f/<key>.json`, one record per figure, with its `hash`.

`--check` then runs the conformance checker over the written directory, exactly as a static host would serve it, and fails the command if anything is wrong. A rebuild of the same input is byte-identical, so the files only change in a commit when a figure does.

To sign at build (level L3), generate an Ed25519 key once, keep the private half out of the repository, and add `--key <private JWK or PEM> --kid <you>-2026-11 --jwks public/.well-known/jwks.json`. Signing is optional at L1.

If you would rather not depend on npm in CI, vendor the generator instead: copy `scripts/facts-static.js`, `scripts/facts-check.js`, `api/_jcs.js`, `api/_facts_sign.js` and `api/_schema_check.js` from [the repository](https://github.com/physics-star-cat/databutler) into one directory, with `fact.v0.json`, `well-known-facts.v0.json` and `well-known-changes.v0.json` from `public/schema/` in a `schema/` subdirectory beside them. They have no dependencies and find each other there.

## 3. Commit `public/` and deploy

The files are plain JSON with no server logic, so any static host serves them. If you already publish a `/.well-known/changes.json` (Verified Changes), add `"facts": "https://<your site>/.well-known/facts.json"` to it, so a consumer that finds either document finds both. The checker requires that link.

## 4. Check the live site

```sh
npx verified-facts check https://cars.example.org
```

One line per conformance item, then the level reached. Add `--offline` to skip fetching every official source page (item 4), or `--sample 25` to check 25 keys instead of all of them. Run it in CI after each deploy. To be listed on [the publishers page](https://databutler.dev/facts/publishers), open an issue at <https://github.com/physics-star-cat/databutler/issues> with your `facts.json` URL. The listing is re-checked every Monday and shows the level the check reached, not the level a site claims.

## The digest: the cheap way to know whether anything moved

Every 0.3 `facts.json` carries `facts.digest`: SHA-256 over the canonical (RFC 8785) form of the `[key, hash]` pairs of every fact you serve, sorted by key. Each namespace carries its own. The index carries the same value.

A consumer stores the digest with the day it read it. Next time it fetches only `facts.json` and compares the two strings. Equal: no figure has moved, and it is done. Different: it calls `what_changed_since` (MCP), or `GET /api/changes?since=<stored day>` on Data Butler, with the stored day, and fetches only what moved. A served publisher also sends the digest as the index's `ETag`, so `If-None-Match` answers `304` with no body. The digest covers the claims (key, value, unit, period, effective date, source), not the verification dates: a re-verification that confirms a value does not move it, and a changed value always does.

## Conformance levels

Every item is checkable from outside with HTTP and the published schemas; §11 of the specification lists them one by one.

| Level | For | What it asks |
|---|---|---|
| **L1** | a site deployed as files | `facts.json` validates; the index and one JSON record per key; every hash is the SHA-256 of the record's claim; every source is `https:` on a declared official host; `digest` in `facts.json` and the index; a `changes.json` that names the facts document; keys match the grammar; a byte-identical rebuild |
| **L2** | a site with a server | L1, plus `max_age`, `as_of` and `period` honoured with `status` on every record, resolve, batch, `404` misses with candidate keys, `ETag` and `Last-Modified`, text and HTML representations, a page per fact (`facts.page`) that answers HTML to any `Accept`, an index `ETag` equal to the digest, OpenAPI, and the three MCP tools if MCP is declared |
| **L3** | either, signed | L1 or L2, plus an Ed25519 signature on every record that verifies against your published key set, a key rotation and revocation policy, and a scheduled check of your own output that lists every figure whose `nextExpectedChange` has passed unverified |

Most sites stop at L1, and L1 is enough to be found, cited and checked.
