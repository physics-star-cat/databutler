/**
 * The Verified Facts index (docs/FACTS_PROTOCOL.md): one record per published figure, built at cold
 * start from the area modules' `facts` blocks (api/_areas/README.md), so it can never disagree with
 * the data files. Facts are a view, like the hub — this module adds no figure.
 *
 *   INDEX      key → the current record (frozen; protocol fields + hash + publisher)
 *   PERIODS    key → [current, previous?] — every period the publisher holds (spec §5.2)
 *   ALIASES    alias → key: curated module aliases, `gb/…` → `uk/…`, and the changelog form
 *              `<area>:<changelog key>` (spec §3.4)
 *   factKeyFor(entry) → the fact key of a v0.1 changelog entry, or null
 *
 * makeFacts(areas) builds the same API over any list of area modules (tests use fixture areas).
 */
const { AREAS } = require('./_areas');
const { FACT_KEY, factsFromCategories, BASE: PROTOCOL_BASE } = require('./_area_kit');
const { hashOf, attestationOf, attestationHash, fromB64url } = require('./_facts_sign');
const { levenshtein } = require('./_text');
const { freshnessOf } = require('./_freshness');
const { FACTS_PROTOCOL, PUBLISHER, FACTS_INDEX_URL, JWKS_URL } = require('./_changelog');

/**
 * Build-time signatures (scripts/sign-facts.js): { kid, signedAt, count, signatures: { <attestation hash>: <jws> } }.
 * Required statically so Vercel's tracer ships it; absent until the first signing run.
 */
let SIGNATURES = { signatures: {} };
try { SIGNATURES = require('../data/facts-signatures.json'); } catch { /* unsigned: tests/facts-sign.test.js fails until signed */ }

const BATCH_LIMIT = 50;
const DAY_MS = 86400000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (s) => ISO_DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const today = (now) => now.toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * max_age → days (spec §5.1): 30d, 12w, 6m (30-day months), 1y (365 days), or ISO 8601 P30D / P12W / P6M / P1Y
 * (components add up). A bare number is days. Returns null for a value that is none of these.
 */
function parseMaxAge(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  const s = String(v ?? '').trim();
  let m = /^(\d+)\s*([dwmy])$/i.exec(s);
  if (m) return Number(m[1]) * { d: 1, w: 7, m: 30, y: 365 }[m[2].toLowerCase()];
  if (/^\d+$/.test(s)) return Number(s);
  m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/i.exec(s);
  if (m && s.length > 1 && (m[1] || m[2] || m[3] || m[4])) return Number(m[1] || 0) * 365 + Number(m[2] || 0) * 30 + Number(m[3] || 0) * 7 + Number(m[4] || 0);
  return null;
}

const RESERVED = new Set(['resolve', 'index']);
/** Field order of a served record (spec §4); computed fields slot in after nextScheduledRefresh. */
const HEAD = ['label', 'value', 'unit', 'period', 'effectiveFrom', 'effectiveTo', 'source', 'sourceType', 'quote', 'verifiedDate', 'nextScheduledRefresh'];
const TAIL = ['previous', 'scope', 'withdrawn', 'supersededBy'];

const namespaceOf = (key) => String(key).split('/')[0];

/* resolve's tokeniser (spec §6.2): lowercase, split on anything but letters, digits and dots, light stemming. */
const HARD_STOP = new Set(['the', 'what', 'whats', 'is', 'are', 'was', 'a', 'an', 'of', 'for', 'in', 'on', 'to', 'and', 'or', 'how', 'much', 'many', 'does', 'do', 'my', 'i', 'me', 'please', 'tell', 'by', 'at', 'with', 'this', 'that', 'it']);
const STOP = new Set([...HARD_STOP, 'current', 'currently', 'now', 'today', 'latest', 'value', 'rate']);
/** Jurisdiction words → namespace (they filter candidates and are not matched as words). */
const JURISDICTION = {
  uk: 'uk', gb: 'uk', british: 'uk', britain: 'uk', hmrc: 'uk', 'gov.uk': 'uk', england: 'uk', dvla: 'uk',
  us: 'us', usa: 'us', american: 'us', america: 'us', irs: 'us', federal: 'us', ssa: 'us',
  de: 'de', german: 'de', germany: 'de', deutschland: 'de', bund: 'de',
  eu: 'eu', ecb: 'eu', euro: 'eu', eurozone: 'eu', european: 'eu',
  jp: 'jp', japan: 'jp', japanese: 'jp', '日本': 'jp',
};
const stem = (t) => (t.length > 4 && /(x|ss|sh|ch)es$/.test(t) ? t.slice(0, -2) : t.length > 3 && /[^s]s$/.test(t) ? t.slice(0, -1) : t);
function tokens(text, { keepStop = false, stop = STOP } = {}) {
  const out = String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}.]+/u).map((t) => t.replace(/^\.+|\.+$/g, '')).filter(Boolean)
    .map((t) => (t.includes('.') && !/^\d+(\.\d+)+$/.test(t) && t !== 'gov.uk' ? t.split('.') : [t])).flat().filter(Boolean).map(stem);
  return keepStop ? out : out.filter((t) => !stop.has(t) && !JURISDICTION[t]);
}

/** The dataset an area's facts are dated by: { key, data } (the area's single dataset). */
function datasetOf(a) {
  if (a.facts && a.facts.dataset) return a.facts.dataset;
  if (Array.isArray(a.freshness)) return { key: a.freshness[0].key, data: a.freshness[0].data };
  return { key: a.area, data: a.freshness.data };
}

/** protocol, key, aliases?, the claim and its dates, previous, scope, hash, publisher — in spec order. */
function finish(r, aliases) {
  const out = { protocol: FACTS_PROTOCOL, key: r.key };
  if (aliases && aliases.length) out.aliases = aliases;
  for (const k of [...HEAD, ...TAIL]) if (r[k] !== undefined) out[k] = r[k];
  out.hash = hashOf(r);
  out.publisher = PUBLISHER;
  return Object.freeze(out);
}

function makeFacts(areas = AREAS, { signatures = SIGNATURES } = {}) {
  const entries = [];
  const META = new Map();
  for (const a of areas.filter((x) => x.facts)) {
    const f = a.facts;
    const list = f.list ? f.list() : factsFromCategories(datasetOf(a).data, f);
    for (const e of list) {
      const k = e.record.key;
      if (!FACT_KEY.test(k)) throw new Error(`api/_areas/${a.area}.js: fact key "${k}" does not match the key grammar ${FACT_KEY}`);
      if (META.has(k)) throw new Error(`api/_areas/${a.area}.js: fact key "${k}" is also published by ${META.get(k).area}`);
      META.set(k, { area: a.area, dataset: datasetOf(a), topic: e.topic, changelogKey: e.changelogKey, synonyms: f.synonyms || {} });
      entries.push(e);
    }
  }

  // Aliases: curated (listed on the record) first, then the two mechanical classes.
  const ALIASES = new Map();
  const curated = new Map();
  const addAlias = (alias, key, area, listed) => {
    if (META.has(alias)) throw new Error(`api/_areas/${area}.js: alias "${alias}" is itself a fact key`);
    if (!META.has(key)) throw new Error(`api/_areas/${area}.js: alias "${alias}" targets "${key}", which is not a fact key`);
    if (ALIASES.has(alias) && ALIASES.get(alias) !== key) throw new Error(`api/_areas/${area}.js: alias "${alias}" already targets "${ALIASES.get(alias)}"`);
    ALIASES.set(alias, key);
    if (listed) curated.set(key, [...(curated.get(key) || []), alias]);
  };
  for (const a of areas.filter((x) => x.facts)) {
    for (const [alias, key] of Object.entries(a.facts.aliases || {})) addAlias(alias, key, a.area, true);
  }
  const BY_CHANGELOG = new Map();
  for (const [key, m] of META) {
    if (namespaceOf(key) === 'uk') addAlias(`gb${key.slice(2)}`, key, m.area, false);
    const form = `${m.area}:${m.changelogKey}`;
    addAlias(form, key, m.area, false);
    BY_CHANGELOG.set(form, key);
  }
  for (const [alias, key] of [...ALIASES]) {
    if (!alias.startsWith('gb/') && namespaceOf(alias) === 'uk' && !ALIASES.has(`gb${alias.slice(2)}`)) addAlias(`gb${alias.slice(2)}`, key, META.get(key).area, false);
  }

  const INDEX = new Map();
  const PERIODS = new Map();
  for (const e of entries) {
    const k = e.record.key;
    const current = finish(e.record, curated.get(k));
    INDEX.set(k, current);
    PERIODS.set(k, e.previous ? [current, finish(e.previous, curated.get(k))] : [current]);
  }

  /** The fact key of a v0.1 changelog entry ({ area, key }), or null when its area publishes no facts. */
  const factKeyFor = (entry) => (entry ? BY_CHANGELOG.get(`${entry.area}:${entry.key}`) || null : null);
  /** The v0.1 changelog entry key ({ area, key }) of a fact key, or null. */
  const changelogKeyFor = (key) => (META.has(key) ? { area: META.get(key).area, key: META.get(key).changelogKey } : null);
  /** Aliases of a key, every class (for the index). */
  const aliasesOf = (key) => [...ALIASES].filter(([, k]) => k === key).map(([a]) => a);

  /** Index entries (spec §5.5), optionally one namespace. */
  function listFacts({ namespace } = {}) {
    const ns = namespace ? String(namespace).toLowerCase().trim() : null;
    const out = [];
    for (const r of INDEX.values()) {
      if (ns && namespaceOf(r.key) !== ns) continue;
      out.push({ key: r.key, label: r.label, unit: r.unit, period: r.period, verifiedDate: r.verifiedDate, hash: r.hash, ...(r.aliases ? { aliases: r.aliases } : {}) });
    }
    return out;
  }

  /* ---------------- get (spec §5) ---------------- */

  /** fresh | stale against max_age, or (none given) against the publisher's own freshness: overdue → stale (§5.3). */
  function statusFor(record, maxAgeDays, now) {
    const ageDays = daysBetween(record.verifiedDate, today(now));
    if (maxAgeDays !== null && maxAgeDays !== undefined) return { status: ageDays <= maxAgeDays ? 'fresh' : 'stale', ageDays, maxAgeDays };
    const m = META.get(record.key);
    const overdue = m && freshnessOf(m.dataset.data, now).staleness === 'overdue';
    return { status: overdue ? 'stale' : 'fresh', ageDays, maxAgeDays: null };
  }

  /** The periods held for a key, as { period, effectiveFrom, effectiveTo } (covered:false answers list them). */
  const periodsOf = (key) => (PERIODS.get(key) || []).map((r) => ({ period: r.period, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo }));

  /** In force on day d: effectiveFrom ≤ d (unknown start: the current record only) and d ≤ effectiveTo (inclusive last day, §4). */
  const inForce = (r, d, isCurrent) => (r.effectiveFrom ? r.effectiveFrom <= d : isCurrent) && (r.effectiveTo === null || r.effectiveTo === undefined || d <= r.effectiveTo);

  /** The record for { as_of } / { period } / neither (the current record), or null when that period is not held. */
  function selectPeriod(key, { as_of, period } = {}) {
    const periods = PERIODS.get(key) || [];
    if (period !== undefined) return periods.find((r) => r.period !== null && String(r.period) === String(period)) || null;
    if (as_of !== undefined) return periods.find((r, i) => inForce(r, as_of, i === 0)) || null;
    return periods[0] || null;
  }

  /** Validated get options → { maxAgeDays, as_of, period } or a covered:false answer. */
  function parseOptions(opts = {}) {
    const blank = (v) => v === undefined || v === null || String(v).trim() === '';
    const out = { maxAgeDays: null };
    if (!blank(opts.max_age)) {
      out.maxAgeDays = parseMaxAge(opts.max_age);
      if (out.maxAgeDays === null) return { error: { protocol: FACTS_PROTOCOL, covered: false, error: 'bad max_age', requested: opts.max_age, message: 'max_age is a duration: 30d, 12w, 6m (30-day months), 1y (365 days) or ISO 8601 (P30D, P6M)', example: '30d' } };
    }
    if (!blank(opts.as_of) && !blank(opts.period)) return { error: { protocol: FACTS_PROTOCOL, covered: false, error: 'as_of and period are mutually exclusive', requested: { as_of: opts.as_of, period: opts.period }, message: 'pass as_of (a day) or period (a label such as 2025-26), not both' } };
    if (!blank(opts.as_of)) {
      const d = String(opts.as_of).trim();
      if (!realDay(d)) return { error: { protocol: FACTS_PROTOCOL, covered: false, error: 'bad as_of', requested: opts.as_of, message: 'as_of is a day, YYYY-MM-DD', example: '2026-03-01' } };
      out.as_of = d;
    }
    if (!blank(opts.period)) out.period = String(opts.period).trim();
    return { options: out };
  }

  const normaliseKey = (k) => String(k ?? '').trim().toLowerCase().replace(/^\/?f\//, '').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
  const citeOf = (r, isCurrent) => ({
    url: `${PROTOCOL_BASE}/f/${r.key}${isCurrent || r.period === null ? (isCurrent ? '' : `?as_of=${r.effectiveFrom}`) : `?period=${encodeURIComponent(r.period)}`}`,
    text: `databutler.dev, verified ${r.verifiedDate} against ${r.source}`,
  });

  /** A served record: the stored one with requestedKey/resolved, status, ageDays, maxAgeDays, signature and cite in spec order. */
  function present(r, { requestedKey, resolved, maxAgeDays, now, isCurrent }) {
    const out = { protocol: r.protocol, key: r.key };
    if (requestedKey && requestedKey !== r.key) out.requestedKey = requestedKey;
    if (resolved) out.resolved = resolved;
    if (r.aliases) out.aliases = r.aliases;
    for (const k of HEAD) if (r[k] !== undefined) out[k] = r[k];
    Object.assign(out, statusFor(r, maxAgeDays, now));
    for (const k of TAIL) if (r[k] !== undefined) out[k] = r[k];
    out.hash = r.hash;
    const sig = signatureOf(r);
    if (sig) out.signature = sig;
    out.publisher = r.publisher;
    out.cite = citeOf(r, isCurrent);
    return out;
  }

  function miss(requestedKey, candidates) {
    return {
      protocol: FACTS_PROTOCOL, covered: false, error: 'unknown key', requestedKey, candidates, index: FACTS_INDEX_URL,
      hint: candidates.length ? 'no confident match — pick a candidate key and call get again' : 'GET /f lists every key; /f/resolve?q= finds one from a question',
    };
  }

  /** One key (canonical, alias, or loose — auto-resolved only when unambiguous, §6.3); a comma list is a batch (§7). */
  function getFact(key, opts = {}, now = new Date()) {
    if (Array.isArray(key) || String(key ?? '').includes(',')) return getFacts(key, opts, now);
    const req = normaliseKey(key);
    if (!req) return { protocol: FACTS_PROTOCOL, covered: false, error: 'key is required', index: FACTS_INDEX_URL, example: 'uk/income-tax/personal-allowance' };
    const parsed = parseOptions(opts);
    if (parsed.error) return parsed.error;
    return getOne(req, parsed.options, now);
  }

  function getOne(req, options, now) {
    let canonical = INDEX.has(req) ? req : ALIASES.get(req);
    let resolved = null;
    if (!canonical) {
      const r = resolveFact(req.replace(/[/_:]+/g, ' '), { limit: 5, keyLike: req }, now);
      if (!r.auto) return miss(req, r.candidates || []);
      canonical = r.auto.key;
      resolved = { score: r.auto.score, matched: r.auto.matched };
    }
    const record = selectPeriod(canonical, options);
    if (!record) {
      const asked = options.period !== undefined ? { period: options.period } : { as_of: options.as_of };
      return {
        protocol: FACTS_PROTOCOL, covered: false, key: canonical, ...(req !== canonical ? { requestedKey: req } : {}), requested: asked,
        periodsHeld: (PERIODS.get(canonical) || []).map((r) => r.period).filter((p) => p !== null),
        held: periodsOf(canonical),
        message: `${canonical} is held for the periods listed; no value is served for ${options.period !== undefined ? `period ${options.period}` : `as_of ${options.as_of}`}`,
      };
    }
    return present(record, { requestedKey: req, resolved, maxAgeDays: options.maxAgeDays, now, isCurrent: record === INDEX.get(canonical) });
  }

  /** Batch (§7): up to 50 keys, results in request order; a miss inside a batch does not fail the batch. */
  function getFacts(keys, opts = {}, now = new Date()) {
    const list = (Array.isArray(keys) ? keys : String(keys ?? '').split(',')).map((k) => String(k ?? '').trim()).filter(Boolean);
    if (!list.length) return { protocol: FACTS_PROTOCOL, covered: false, error: 'keys is required', example: 'uk/income-tax/personal-allowance,us/social-security/wage-base' };
    if (list.length > BATCH_LIMIT) return { protocol: FACTS_PROTOCOL, covered: false, error: 'too many keys', count: list.length, limit: BATCH_LIMIT, message: `a batch takes at most ${BATCH_LIMIT} keys` };
    const parsed = parseOptions(opts);
    if (parsed.error) return parsed.error;
    const results = list.map((k) => {
      const req = normaliseKey(k);
      return req ? getOne(req, parsed.options, now) : miss(k, []);
    });
    return {
      protocol: FACTS_PROTOCOL, publisher: PUBLISHER, count: results.length, results,
      status: results.some((r) => r.status === 'stale') ? 'stale' : 'fresh',
    };
  }

  /* ---------------- resolve (spec §6) ---------------- */

  // Query-side synonyms from every area (word or phrase → key words); each is an alternative, never a replacement.
  const SYNONYMS = new Map();
  for (const a of areas.filter((x) => x.facts)) {
    for (const [from, to] of Object.entries(a.facts.synonyms || {})) {
      const k = from.toLowerCase().trim();
      SYNONYMS.set(k, [...new Set([...(SYNONYMS.get(k) || []), to.toLowerCase()])]);
    }
  }
  const PHRASES = [...SYNONYMS.keys()].filter((k) => /[\s-]/.test(k)).sort((x, y) => y.length - x.length || x.localeCompare(y));

  // Search surface per record, precomputed at cold start: key, label, topic, period and curated alias tokens.
  const SURFACE = new Map();
  for (const [key, r] of INDEX) {
    const m = META.get(key);
    // The surface keeps soft stop words ("rate" alone can match); names (precision) drop them.
    const t = (x) => tokens(x, { stop: HARD_STOP });
    const fields = {
      key: t(key), label: t(r.label), topic: t(m.topic), period: t(r.period === null ? '' : String(r.period)),
      alias: (r.aliases || []).flatMap((a) => t(a)),
    };
    const names = [tokens(key.split('/').pop()), tokens(r.label), ...(r.aliases || []).map((a) => tokens(a.split('/').pop()))].map((t) => new Set(t)).filter((n) => n.size);
    SURFACE.set(key, { fields, all: new Set(Object.values(fields).flat()), keyTokens: new Set(fields.key), names });
  }

  /** Query → { namespaces, units } where each unit is a query word or synonym concept with its alternatives (token lists). */
  function parseQuery(q) {
    let text = ` ${String(q).toLowerCase().replace(/[’']s\b/g, '')} `;
    const units = [];
    for (const phrase of PHRASES) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+')}(?=$|[^\\p{L}\\p{N}])`, 'u');
      if (re.test(text)) {
        text = text.replace(re, '$1 ');
        units.push({ word: phrase, synonym: true, alts: [tokens(phrase), ...SYNONYMS.get(phrase).map(tokens)].filter((t) => t.length) });
      }
    }
    const raw = tokens(text, { keepStop: true });
    const namespaces = new Set(raw.map((t) => JURISDICTION[t]).filter(Boolean));
    let words = raw.filter((t) => !JURISDICTION[t] && !STOP.has(t));
    if (!words.length && !units.length) words = raw.filter((t) => !JURISDICTION[t] && !HARD_STOP.has(t)); // "rate" alone stays
    for (const w of [...new Set(words)]) {
      const syn = SYNONYMS.get(w);
      units.push(syn ? { word: w, synonym: true, alts: [[w], ...syn.map(tokens)].filter((t) => t.length) } : { word: w, alts: [[w]] });
    }
    return { namespaces, units };
  }

  /** Spec §6.2 scoring of one record against a parsed query; null when nothing matches. */
  function scoreRecord(key, parsed) {
    const S = SURFACE.get(key);
    if (!parsed.units.length) return null;
    const matched = new Set();
    const hit = new Set(); // surface tokens the query reached
    let weight = 0, exactUnits = 0, keyHits = 0;
    for (const u of parsed.units) {
      const ok = u.alts.filter((alt) => alt.every((t) => S.all.has(t))).sort((x, y) => y.length - x.length)[0];
      if (ok) {
        weight += 1; exactUnits += 1;
        ok.forEach((t) => hit.add(t));
        if (ok.every((t) => S.keyTokens.has(t))) keyHits += 1;
        if (u.synonym && ok.join(' ') !== u.word) matched.add(`synonym:${u.word}`);
        for (const [field, toks] of Object.entries(S.fields)) if (ok.every((t) => toks.includes(t))) { matched.add(field); break; }
        continue;
      }
      const w = u.alts[0].length === 1 ? u.alts[0][0] : null;
      const near = w && w.length >= 4 ? [...S.all].find((t) => t.length >= 4 && Math.abs(t.length - w.length) <= 2 && levenshtein(w, t) <= (w.length >= 5 ? 2 : 1)) : null;
      if (near) { weight += 0.4; hit.add(near); matched.add(`fuzzy:${w}→${near}`); }
    }
    if (!weight) return null;
    const coverage = weight / parsed.units.length;
    const precision = Math.max(0, ...S.names.map((n) => [...n].filter((t) => hit.has(t)).length / n.size));
    const keyFraction = keyHits / parsed.units.length;
    const parts = hit.size;
    let score = exactUnits === parsed.units.length
      ? 0.39 + 0.5 * precision * precision + 0.01 * keyFraction
      : 0.74 * coverage * (0.4 + 0.6 * precision) + 0.01 * keyFraction;
    // One content word cannot carry a confident answer on its own ("rate", "threshold"): cap below the §6.3 bar.
    if (parts < 2) score = Math.min(score, 0.79);
    return { score: Math.round(score * 1000) / 1000, matched: [...matched] };
  }

  /** Ranked candidates (score desc, then key) for a question or loose key; exact key 1.0, alias 0.95, key suffix 0.9. */
  function rank(q, { namespace, keyLike } = {}) {
    const asKey = normaliseKey(keyLike || q);
    if (INDEX.has(asKey)) return [{ key: asKey, score: 1, matched: ['key'] }];
    if (ALIASES.has(asKey)) return [{ key: ALIASES.get(asKey), score: 0.95, matched: ['alias'] }];
    const parsed = parseQuery(q);
    const ns = namespace ? new Set([String(namespace).toLowerCase().trim()]) : parsed.namespaces;
    const suffix = asKey.includes('/') ? `/${asKey}` : null;
    const out = [];
    for (const key of INDEX.keys()) {
      if (ns.size && !ns.has(namespaceOf(key))) continue;
      if (suffix && key.endsWith(suffix)) { out.push({ key, score: 0.9, matched: ['key-suffix'] }); continue; }
      const s = scoreRecord(key, parsed);
      if (s) out.push({ key, ...s });
    }
    return out.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key));
  }

  /** The §6.3 rule: exactly one candidate ≥ 0.8 and the runner-up at least 0.2 lower. */
  const confident = (list) => (list.length && list[0].score >= 0.8 && (list.length === 1 || list[1].score <= list[0].score - 0.2) ? list[0] : null);

  /** resolve (spec §6.2): ranked canonical keys for a question or a guessed key, with the full record of an unambiguous top match. */
  function resolveFact(q, opts = {}, now = new Date()) {
    const query = String(q ?? '').trim();
    if (!query) return { protocol: FACTS_PROTOCOL, covered: false, error: 'q is required', example: 'NI primary threshold' };
    const n = Number(opts.limit);
    const limit = Number.isInteger(n) && n >= 1 ? Math.min(n, 20) : 5;
    const ranked = rank(query, opts);
    const top = confident(ranked);
    const candidates = ranked.slice(0, limit).map((c) => {
      const r = INDEX.get(c.key);
      return { key: c.key, label: r.label, unit: r.unit, period: r.period, verifiedDate: r.verifiedDate, score: c.score, matched: c.matched };
    });
    const out = { protocol: FACTS_PROTOCOL, query, ...(opts.namespace ? { namespace: String(opts.namespace).toLowerCase().trim() } : {}), candidates };
    if (top) out.best = present(INDEX.get(top.key), { requestedKey: top.key, maxAgeDays: null, now, isCurrent: true });
    out.hint = top ? 'best is the unambiguous top candidate; get takes its key' : 'no unambiguous match — best is present only when the top candidate is; pick a key and call get';
    Object.defineProperty(out, 'auto', { value: top, enumerable: false });
    return out;
  }

  /* ---------------- signatures (spec §8.3) ---------------- */

  const SIGNED = new WeakMap();
  /** The precomputed signature object for a stored record, or null when the signatures file has none. */
  function signatureOf(r) {
    if (SIGNED.has(r)) return SIGNED.get(r);
    const jws = (signatures.signatures || {})[attestationHash(attestationOf(r))];
    let sig = null;
    if (jws) {
      let kid = signatures.kid;
      try { kid = JSON.parse(fromB64url(jws.split('.')[0]).toString('utf8')).kid || kid; } catch { /* header unreadable: the verifier reports it */ }
      sig = { alg: 'EdDSA', kid, jws, keys: JWKS_URL };
    }
    SIGNED.set(r, sig);
    return sig;
  }

  return {
    INDEX, PERIODS, ALIASES, META, FACT_COUNT: INDEX.size, RESERVED, BATCH_LIMIT,
    factKeyFor, changelogKeyFor, aliasesOf, listFacts, namespaceOf, indexUrl: FACTS_INDEX_URL,
    getFact, getFacts, resolveFact, statusFor, selectPeriod, periodsOf, parseMaxAge, normaliseKey, present, signatureOf,
  };
}

const DEFAULT = makeFacts(AREAS);

module.exports = { ...DEFAULT, makeFacts, datasetOf, namespaceOf, parseMaxAge, tokens, RESERVED, BATCH_LIMIT };
