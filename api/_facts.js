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
const { FACT_KEY, factsFromCategories } = require('./_area_kit');
const { hashOf } = require('./_facts_sign');
const { FACTS_PROTOCOL, PUBLISHER, FACTS_INDEX_URL } = require('./_changelog');

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

  return {
    INDEX, PERIODS, ALIASES, META, FACT_COUNT: INDEX.size, RESERVED,
    factKeyFor, changelogKeyFor, aliasesOf, listFacts, namespaceOf, indexUrl: FACTS_INDEX_URL,
  };
}

const DEFAULT = makeFacts(AREAS);

module.exports = { ...DEFAULT, makeFacts, datasetOf, namespaceOf, RESERVED };
