# verified-facts

Check, verify and publish **Verified Facts**: one official figure per key, each with its official source, the day a
person verified it, a SHA-256 hash of the claim and an Ed25519 signature. Specification:
<https://databutler.dev/protocol/facts>. Zero dependencies, Node 18 or later.

```sh
npx verified-facts check https://databutler.dev
```

That runs every conformance item the specification defines (levels L1, L2 and L3) from outside, with HTTP and the
published JSON Schemas, prints one line per item and exits 0 when the site meets the level it declares.

## Commands

| Command | What it does |
|---|---|
| `verified-facts check <site> [--level L2] [--offline] [--sample 25]` | The conformance check. `--offline` skips fetching the official source pages. |
| `verified-facts verify <url\|file> [--jwks <path\|url>]` | Recompute a record's hash and verify its detached EdDSA signature against the publisher's key set. A batch or an index verifies every record in it. |
| `verified-facts static <facts-source.json> --out public [--check]` | Write the static L1 files for a site with no server; `--check` then runs the checker over the written directory. Add `--key <private JWK or PEM> --kid <kid> --jwks <jwks.json>` to sign at build (L3). |

## Publish your own figures at L1 (an afternoon)

A site built as static files publishes Verified Facts with no server code:

1. **Write `facts-source.json`** next to your build: your publisher name and URL, one namespace per jurisdiction with
   the official hosts your figures come from (`authorities`), and one entry per figure:

   ```json
   {
     "publisher": { "name": "Example Car Site", "url": "https://cars.example.org/" },
     "namespaces": [{ "name": "uk", "description": "UK MOT rules", "authorities": ["www.gov.uk"] }],
     "changes": "https://cars.example.org/.well-known/changes.json",
     "facts": [{
       "key": "uk/mot/max-fee-car", "label": "Maximum MOT fee (car, class 4)", "value": 54.85, "unit": "GBP",
       "period": "2026-27", "effectiveFrom": "2026-04-01", "effectiveTo": null,
       "source": "https://www.gov.uk/getting-an-mot/mot-test-fees", "verifiedDate": "2026-10-02",
       "changeCadence": "irregular", "nextExpectedChange": null
     }]
   }
   ```

   `verifiedDate` is the day a person read the value on `source`. `changeCadence` and `nextExpectedChange` are
   optional; give `nextExpectedChange` only when the source's own calendar names the day.
2. **Generate** the files into the directory your host serves:

   ```sh
   npx verified-facts static facts-source.json --out public --check
   ```

   This writes `public/.well-known/facts.json`, `public/f/index.json` and one `public/f/<key>.json` per figure, with
   the hash and the collection `digest`, and runs the L1 check over them. A rebuild of the same input is
   byte-identical.
3. **Commit `public/`** and deploy.
4. **Check the live site:** `npx verified-facts check https://your-site.example`.

To list your site on <https://databutler.dev/facts/publishers>, open an issue at
<https://github.com/physics-star-cat/databutler/issues> with your `facts.json` URL.

## The cheap freshness check

Every conforming `facts.json` carries `facts.digest`: SHA-256 over the canonical (RFC 8785) form of the sorted
`[key, hash]` pairs of every fact served. Store it with the date you read it. Next time, compare the stored digest
with the live one; when they differ, call the publisher's `what_changed_since` (or `GET /api/changes?since=<date>` on
Data Butler) with the stored date to fetch only what moved. A served (L2) index also answers `If-None-Match` with
`304` when nothing moved.

## Conformance levels

- **L1, static files:** `/.well-known/facts.json` validates, the index and one JSON file per key, every hash right,
  every source on a declared official host, a `digest` in `facts.json` and the index, a `changes.json` that names the
  facts document.
- **L2, served:** L1 plus `max_age`, `as_of` and `period` honoured with `status` on every record, resolve, batch,
  `404` misses with candidates, `ETag`/`Last-Modified`, text and HTML representations, a page per fact for any
  `Accept`, an index `ETag` equal to the digest, OpenAPI, and the MCP tools if declared.
- **L3, signed:** every record carries an Ed25519 signature that verifies against the publisher's key set, with a
  published rotation policy, and the publisher checks its own output on a schedule.

The full list, item by item, is §11 of the specification.

## Library use

```js
const { run } = require('verified-facts');
await run(['check', 'https://databutler.dev', '--offline']); // → exit code
```

Licence: MIT. Reference implementation and source: <https://github.com/physics-star-cat/databutler>.
