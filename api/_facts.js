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
const { hashOf } = require('./_facts_sign');
const { freshnessOf } = require('./_freshness');
const { FACTS_PROTOCOL, PUBLISHER, FACTS_INDEX_URL } = require('./_changelog');

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

function makeFacts(areas = AREAS) {
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
      const r = resolveFact(req.replace(/[/_]+/g, ' '), { limit: 5, keyLike: req }, now);
      if (!r.auto) return miss(req, r.candidates);
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

  /* ---------------- resolve (spec §6) — Task 4 ---------------- */

  function resolveFact(q, opts = {}) {
    return { protocol: FACTS_PROTOCOL, query: q, candidates: [], auto: null };
  }

  /* ---------------- signatures (spec §8) — attached in Task 6 ---------------- */

  function signatureOf() { return null; }

  return {
    INDEX, PERIODS, ALIASES, META, FACT_COUNT: INDEX.size, RESERVED, BATCH_LIMIT,
    factKeyFor, changelogKeyFor, aliasesOf, listFacts, namespaceOf, indexUrl: FACTS_INDEX_URL,
    getFact, getFacts, resolveFact, statusFor, selectPeriod, periodsOf, parseMaxAge, normaliseKey, present,
  };
}

const DEFAULT = makeFacts(AREAS);

module.exports = { ...DEFAULT, makeFacts, datasetOf, namespaceOf, parseMaxAge, RESERVED, BATCH_LIMIT };
