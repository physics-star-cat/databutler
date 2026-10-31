#!/usr/bin/env node
/**
 * The public Verified Facts conformance checker (docs/FACTS_PROTOCOL.md §11, items 1–18).
 *
 *   node scripts/facts-check.js https://databutler.dev [--level L2] [--offline] [--sample 25]
 *
 * Every item is checked from outside, with HTTP and the published schemas. Output: one line per item
 * ({ item, level, ok, detail }) and the level reached; exit 0 when the requested level (default: the one
 * the publisher declares) is met. --offline skips the two network-bound items (4: every source answers;
 * 18: the publisher's own schedule, never checkable from outside). --sample N checks N keys instead of all.
 *
 * Notes on reading the spec: item 17 (hash-linked changelog) is marked optional by §8.1 and deferred for Data
 * Butler, so a publisher without it is reported, not failed; item 4 counts a 401/403 (a page that blocks
 * automated fetches) as reachable and says so.
 *
 * The core (checkSite) takes a fetch-like function, so tests drive it against fixtures and the router in-process.
 */
const fs = require('node:fs');
const path = require('node:path');
const { hashOf, verifyRecord } = require('../api/_facts_sign');
const { validate } = require('../api/_schema_check');

const ROOT = path.resolve(__dirname, '..');
const schema = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/schema', f), 'utf8'));
const FACT = schema('fact.v0.json');
const WKF = schema('well-known-facts.v0.json');
const WKC = schema('well-known-changes.v0.json');
const sub = (name) => ({ ...FACT.$defs[name], $defs: FACT.$defs });
const KEY = /^[a-z][a-z0-9-]*(\/[a-z0-9][a-z0-9.-]*){1,5}$/;
const LEVEL_OF = (item) => (item <= 7 ? 'L1' : item <= 14 ? 'L2' : 'L3');
const LEVELS = ['L1', 'L2', 'L3'];
const httpDate = (day) => new Date(`${day}T00:00:00Z`).toUTCString();

async function getJson(fetchFn, url, init) {
  const r = await fetchFn(url, init);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, headers: r.headers, body, text };
}

/**
 * Run every item against a site. → { declared, reached, ok, results: [{ item, level, ok, detail, skipped? }] }
 *   fetchFn(url, init) → { status, headers: { get(name) }, text() }
 */
async function checkSite(site, { fetchFn = fetch, offline = false, sample = 0, level, now = new Date() } = {}) {
  const base = site.replace(/\/+$/, '');
  const results = [];
  const add = (item, ok, detail, extra = {}) => results.push({ item, level: LEVEL_OF(item), ok: Boolean(ok), detail, ...extra });
  const skip = (item, detail) => add(item, true, detail, { skipped: true });

  // 1 — the discovery document
  const wk = await getJson(fetchFn, `${base}/.well-known/facts.json`);
  const v1 = wk.body ? validate(WKF, wk.body) : { ok: false, errors: [`HTTP ${wk.status}, not JSON`] };
  add(1, v1.ok && wk.body.protocol === 'verified-facts/0.2', v1.ok ? `${wk.body.protocol}, declares ${wk.body.conformance}, filtering ${wk.body.facts.filtering}` : v1.errors.slice(0, 3).join('; '));
  if (!v1.ok) return summarise(results, null, level);
  const D = wk.body;
  const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/, () => v);

  // 2 — the index
  const idx = await getJson(fetchFn, D.facts.index);
  const v2 = idx.body ? validate(sub('index'), idx.body) : { ok: false, errors: [`HTTP ${idx.status}`] };
  const entries = v2.ok ? idx.body.facts : [];
  add(2, v2.ok && entries.length === D.facts.count && entries.every((e) => e.hash), v2.ok ? `${entries.length} keys (facts.json says ${D.facts.count})` : v2.errors.slice(0, 3).join('; '));

  // 3 — every key (or a sample) answers its record, hash = SHA-256(JCS(claim))
  const picked = sample > 0 ? entries.filter((_, i) => i % Math.max(1, Math.floor(entries.length / sample)) === 0).slice(0, sample) : entries;
  const records = [];
  const bad3 = [];
  for (const e of picked) {
    const r = await getJson(fetchFn, fill(D.facts.get, e.key));
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (r.status !== 200 || !r.body || !ct.includes('json')) { bad3.push(`${e.key}: HTTP ${r.status} ${ct}`); continue; }
    const v = validate(FACT, r.body);
    if (!v.ok) { bad3.push(`${e.key}: ${v.errors[0]}`); continue; }
    if (r.body.hash !== hashOf(r.body)) bad3.push(`${e.key}: hash ${r.body.hash} ≠ ${hashOf(r.body)}`);
    else if (r.body.hash !== e.hash) bad3.push(`${e.key}: index hash differs from the record`);
    records.push({ record: r.body, headers: r.headers }); // still signature-checked (item 15)
  }
  add(3, picked.length > 0 && bad3.length === 0, bad3.length ? `${bad3.length}/${picked.length} failed: ${bad3.slice(0, 3).join('; ')}` : `${picked.length} records, every hash = SHA-256(JCS(claim))`);

  // 4 — sources: https, on a declared authority host, and (online) answering
  const authorities = new Map(D.namespaces.map((n) => [n.name, new Set(n.authorities)]));
  const bad4 = [];
  const sources = new Set();
  for (const { record } of records) {
    let host = '';
    try { host = new URL(record.source).hostname; } catch { /* reported below */ }
    if (!/^https:/.test(record.source)) bad4.push(`${record.key}: not https`);
    else if (!(authorities.get(record.key.split('/')[0]) || new Set()).has(host)) bad4.push(`${record.key}: ${host} is not a declared authority`);
    sources.add(record.source);
  }
  if (!offline && !bad4.length) {
    const blocked = [];
    for (const src of sources) {
      try {
        const r = await fetchFn(src, { method: 'GET', headers: { 'user-agent': 'verified-facts-check/0.2' } });
        if (r.status === 401 || r.status === 403) blocked.push(src);
        else if (r.status >= 400) bad4.push(`${src}: HTTP ${r.status}`);
      } catch (e) { bad4.push(`${src}: ${e.message}`); }
    }
    add(4, !bad4.length, bad4.length ? bad4.slice(0, 3).join('; ') : `${sources.size} source pages answer${blocked.length ? ` (${blocked.length} refuse automated fetches: ${blocked.slice(0, 2).join(', ')})` : ''}`);
  } else if (bad4.length) add(4, false, bad4.slice(0, 3).join('; '));
  else add(4, true, `${sources.size} sources on declared authority hosts (fetch skipped: --offline)`, { skipped: true });

  // 5 — changes.json conforms and names facts
  if (D.changes) {
    const ch = await getJson(fetchFn, D.changes);
    const v = ch.body ? validate(WKC, ch.body) : { ok: false, errors: [`HTTP ${ch.status}`] };
    add(5, v.ok && ch.body.facts === `${base}/.well-known/facts.json`, v.ok ? (ch.body.facts ? `${ch.body.protocol}, facts → ${ch.body.facts}` : 'changes.json does not name facts') : v.errors.slice(0, 2).join('; '));
  } else add(5, false, 'facts.json names no changes document');

  // 6 — keys: grammar, unique, alias targets exist
  const keySet = new Set(entries.map((e) => e.key));
  const bad6 = entries.filter((e) => !KEY.test(e.key)).map((e) => e.key);
  if (keySet.size !== entries.length) bad6.push('duplicate keys');
  for (const e of entries) for (const a of e.aliases || []) if (keySet.has(a)) bad6.push(`alias ${a} is also a key`);
  add(6, entries.length > 0 && !bad6.length, bad6.length ? bad6.slice(0, 3).join('; ') : `${keySet.size} keys match the grammar and are unique`);

  // 7 — generated = newest verifiedDate
  const newest = entries.reduce((m, e) => (e.verifiedDate > m ? e.verifiedDate : m), '');
  add(7, v2.ok && idx.body.generated === newest, `index generated ${v2.ok ? idx.body.generated : '?'}, newest verifiedDate ${newest}`);

  // L2 (8–14) — a static publisher (filtering: client) stops here
  const server = D.facts.filtering === 'server';
  const first = records[0] && records[0].record;
  if (!server || !first) {
    for (const i of [8, 9, 10, 11, 12, 13, 14]) add(i, false, server ? 'no record to test with' : 'filtering is client (static publisher): not served');
  } else {
    // 8 — max_age / as_of / period honoured; status fields on every record; period not held → covered:false
    const missingStatus = records.filter(({ record: r }) => !('status' in r && 'ageDays' in r && 'maxAgeDays' in r)).map(({ record: r }) => r.key);
    const strict = await getJson(fetchFn, `${fill(D.facts.get, first.key)}?max_age=0d`);
    const lax = await getJson(fetchFn, `${fill(D.facts.get, first.key)}?max_age=36500d`);
    const nope = await getJson(fetchFn, `${fill(D.facts.get, first.key)}?period=1900-01`);
    const asOf = await getJson(fetchFn, `${fill(D.facts.get, first.key)}?as_of=1900-01-01`);
    const expectStrict = first.ageDays > 0 ? 'stale' : 'fresh';
    const ok8 = !missingStatus.length && strict.body && strict.body.status === expectStrict && strict.body.maxAgeDays === 0
      && lax.body && lax.body.status === 'fresh' && nope.body && nope.body.covered === false && Array.isArray(nope.body.periodsHeld)
      && asOf.body && asOf.body.covered === false;
    add(8, ok8, missingStatus.length ? `records without status fields: ${missingStatus.slice(0, 3).join(', ')}` : `max_age=0d → ${strict.body && strict.body.status}, period not held → covered:${nope.body && nope.body.covered} with periodsHeld, as_of outside → covered:${asOf.body && asOf.body.covered}`);

    // 9 — resolve ranks candidates; get auto-resolves only when unambiguous
    let ok9 = false; let d9 = 'no resolve endpoint declared';
    if (D.facts.resolve) {
      const rs = await getJson(fetchFn, fill(D.facts.resolve, encodeURIComponent(first.label)));
      const cands = (rs.body && rs.body.candidates) || [];
      const ordered = cands.every((c, i) => i === 0 || cands[i - 1].score > c.score || (cands[i - 1].score === c.score && cands[i - 1].key < c.key));
      const valid = rs.body && validate(sub('resolve'), rs.body).ok;
      const best = rs.body && rs.body.best;
      const ruleOk = !best || (cands[0].score >= 0.8 && (cands.length === 1 || cands[1].score <= cands[0].score - 0.2));
      const nonsense = await getJson(fetchFn, fill(D.facts.get, 'zz/qqq/xxyyzz'));
      ok9 = valid && ordered && ruleOk && cands.some((c) => c.key === first.key) && nonsense.status === 404;
      d9 = `resolve("${first.label}") → ${cands.slice(0, 2).map((c) => `${c.key} ${c.score}`).join(', ')}${best ? ` (best ${best.key})` : ''}; nonsense key → ${nonsense.status}`;
    }
    add(9, ok9, d9);

    // 10 — batch with a miss inside
    let ok10 = false; let d10 = 'no batch endpoint declared';
    if (D.facts.batch) {
      const keys = [first.key, (records[1] || records[0]).record.key, 'zz/qqq/missing'];
      const b = await getJson(fetchFn, fill(D.facts.batch, keys.join(',')));
      ok10 = b.status === 200 && b.body && validate(sub('batch'), b.body).ok && b.body.results.length === 3 && b.body.results[2].covered === false && b.body.results[0].key === first.key;
      d10 = `batch of 3 with a miss → HTTP ${b.status}, ${b.body && b.body.results ? b.body.results.length : 0} results`;
    }
    add(10, ok10, d10);

    // 11 — a miss is 404 + candidates, not cached
    const miss = await getJson(fetchFn, fill(D.facts.get, 'zz/qqq/nothing-here'));
    const cc = (miss.headers.get('cache-control') || '').toLowerCase();
    add(11, miss.status === 404 && miss.body && Array.isArray(miss.body.candidates) && cc.includes('no-store'), `HTTP ${miss.status}, candidates ${miss.body && Array.isArray(miss.body.candidates)}, Cache-Control ${cc || '(none)'}`);

    // 12 — ETag = hash, Last-Modified = verifiedDate, text/plain and text/html
    const h = records[0].headers;
    const txt = await fetchFn(`${fill(D.facts.get, first.key)}?format=txt`);
    const html = await fetchFn(fill(D.facts.get, first.key), { headers: { accept: 'text/html' } });
    const ok12 = h.get('etag') === `"${first.hash}"` && h.get('last-modified') === httpDate(first.verifiedDate)
      && /text\/plain/.test(txt.headers.get('content-type') || '') && /text\/html/.test(html.headers.get('content-type') || '');
    add(12, ok12, `ETag ${h.get('etag') === `"${first.hash}"` ? 'ok' : h.get('etag')}, Last-Modified ${h.get('last-modified')}, txt ${txt.headers.get('content-type')}, html ${html.headers.get('content-type')}`);

    // 13 — openapi.json served, every operation routes
    let ok13 = false; let d13 = 'openapi not declared';
    if (D.openapi) {
      const oa = await getJson(fetchFn, D.openapi);
      const bad = [];
      if (oa.body && oa.body.paths) {
        const server = (oa.body.servers && oa.body.servers[0] && oa.body.servers[0].url) || base;
        for (const [p, ops] of Object.entries(oa.body.paths)) {
          for (const op of Object.values(ops)) {
            const params = (op.parameters || []).filter((x) => x.required && x.in === 'query').map((x) => `${x.name}=${x.name === 'since' ? '2026-01-01' : encodeURIComponent(first.label)}`);
            const url = `${server}${p.replace('{key}', first.key)}${params.length ? `?${params.join('&')}` : ''}`;
            const r = await fetchFn(url);
            if (r.status >= 400) bad.push(`${op.operationId} ${p} → ${r.status}`);
          }
        }
        ok13 = /^3\.1/.test(oa.body.openapi) && !bad.length;
        d13 = bad.length ? bad.join('; ') : `${Object.keys(oa.body.paths).length} paths route (OpenAPI ${oa.body.openapi})`;
      } else d13 = `HTTP ${oa.status}`;
    }
    add(13, ok13, d13);

    // 14 — MCP: the three tools with read-only annotations, and a Server Card
    if (D.mcp) {
      const list = await getJson(fetchFn, D.mcp.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      const tools = (list.body && list.body.result && list.body.result.tools) || [];
      const names = tools.map((t) => t.name);
      const need = ['get_fact', 'resolve_fact', 'what_changed_since'];
      const ro = need.every((n) => { const t = tools.find((x) => x.name === n); return t && t.annotations && t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false; });
      const card = D.mcp.serverCard ? await getJson(fetchFn, D.mcp.serverCard) : { status: 0, body: null };
      add(14, need.every((n) => names.includes(n)) && ro && card.status === 200 && card.body && card.body.name, `tools ${names.join(', ')}; read-only ${ro}; server card HTTP ${card.status}`);
    } else skip(14, 'no mcp declared');
  }

  // L3 (15–18)
  let jwks = null;
  if (D.keys) jwks = (await getJson(fetchFn, D.keys)).body;
  const unsigned = records.filter(({ record: r }) => !r.signature).map(({ record: r }) => r.key);
  const failed = [];
  if (jwks) for (const { record: r } of records) if (r.signature) { const v = verifyRecord(r, jwks, { now }); if (!v.ok) failed.push(`${r.key}: ${v.checks.filter((c) => !c.ok).map((c) => `${c.name} ${c.detail}`).join(', ')}`); }
  add(15, records.length > 0 && jwks && !unsigned.length && !failed.length, !jwks ? 'no key set' : unsigned.length ? `${unsigned.length} unsigned (${unsigned.slice(0, 2).join(', ')})` : failed.length ? failed.slice(0, 2).join('; ') : `${records.length} signatures verify against ${D.keys}`);
  const keysOk = jwks && Array.isArray(jwks.keys) && jwks.keys.length > 0 && jwks.keys.every((k) => k.kty === 'OKP' && k.crv === 'Ed25519' && k.x && k.kid && k.validFrom && !k.d);
  add(16, keysOk, keysOk ? `${jwks.keys.length} key(s): ${jwks.keys.map((k) => `${k.kid} from ${k.validFrom}${k.retired ? ` retired ${k.retired}` : ''}${k.revoked ? ` revoked ${k.revoked}` : ''}`).join(', ')}` : 'no JWK Set with validFrom on every Ed25519 key');
  let d17 = 'no changes document';
  if (D.changes) {
    const ch = await getJson(fetchFn, D.changes);
    d17 = ch.body && ch.body.chainHead ? `chainHead ${ch.body.chainHead}` : 'no chainHead / per-entry hash: the hash-linked changelog is optional (§8.1) — reported, not failed';
  }
  add(17, true, d17, { advisory: true });
  skip(18, 'the publisher\'s own scheduled self-check is not visible from outside (Data Butler: the Monday watcher runs this checker)');

  return summarise(results, D.conformance, level);
}

function summarise(results, declared, requested) {
  let reached = null;
  for (const L of LEVELS) {
    const items = results.filter((r) => LEVELS.indexOf(r.level) <= LEVELS.indexOf(L));
    if (!items.length || items.some((r) => !r.ok)) break;
    // a static publisher reaches L3 by signing at build (L1 + 15–18), skipping the server items 8–14
    reached = L;
  }
  if (reached === 'L1' && declared === 'L3') {
    const l1 = results.filter((r) => r.level === 'L1');
    const l3 = results.filter((r) => r.level === 'L3');
    if (l1.every((r) => r.ok) && l3.length && l3.every((r) => r.ok)) reached = 'L3';
  }
  const want = requested || declared || 'L1';
  return { declared, requested: want, reached, ok: reached !== null && LEVELS.indexOf(reached) >= LEVELS.indexOf(want), results };
}

function format(report) {
  const lines = report.results.map((r) => `${r.skipped ? 'skip' : r.ok ? 'ok  ' : 'FAIL'} ${String(r.item).padStart(2)} ${r.level} ${r.detail}`);
  lines.push(`declared ${report.declared || '?'}, reached ${report.reached || 'none'} — ${report.ok ? 'PASS' : 'FAIL'} at ${report.requested}`);
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const site = argv.find((a, i) => !a.startsWith('--') && !['--level', '--sample'].includes(argv[i - 1]));
  if (!site) { console.error('usage: node scripts/facts-check.js https://<site> [--level L1|L2|L3] [--offline] [--sample N]'); return 2; }
  const at = (n) => { const i = argv.indexOf(n); return i === -1 ? undefined : argv[i + 1]; };
  const report = await checkSite(site, { offline: argv.includes('--offline'), sample: Number(at('--sample') || 0), level: at('--level') });
  console.log(format(report));
  return report.ok ? 0 : 1;
}

if (require.main === module) main().then((c) => process.exit(c), (e) => { console.error(`facts-check: ${e.message}`); process.exit(1); });

module.exports = { checkSite, format, summarise, main };
