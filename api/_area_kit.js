/**
 * Small helpers shared by the area modules (api/_areas/*.js) and the code that
 * derives everything else from them. Pure; requires nothing from the API, so an
 * area module can use it without creating a require cycle.
 */
const { nearest } = require('./_text');

const BASE = 'https://databutler.dev';

/** "a", "a and b", "a, b and c" — the house list style in tool descriptions. */
function joinList(items, { sep = ', ', last = ' and ' } = {}) {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(sep)}${last}${xs[xs.length - 1]}`;
}

/** ISO day + n days, in UTC. */
function plusDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Query string for a REST/citation link, "" when empty. */
function qs(q) {
  const s = new URLSearchParams(Object.entries(q || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return s ? `?${s}` : '';
}

/** Coerce the named keys to numbers when they arrived as numeric strings (REST). */
function coerceNumeric(args, keys = []) {
  const out = { ...args };
  for (const k of keys) if (typeof out[k] === 'string' && out[k] !== '' && !Number.isNaN(Number(out[k]))) out[k] = Number(out[k]);
  return out;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** A figure's stable id within its category: its own `key` when it carries one, else slug(label). */
const figureKey = (f) => f.key || slug(f.label);

/** Changelog entry identity: one entry per area, key and verification day (the dedupe key). */
const entryId = (e) => `${e.area}|${e.key}|${e.verifiedDate}`;
/**
 * Append the entries whose id is new. Pure and here (not only in api/_changelog) so a dataset
 * script can require it at the top without loading the area modules — whose data file the
 * script may be about to write for the first time.
 */
function mergeEntries(existing, incoming) {
  const seen = new Set(existing.map(entryId));
  const added = incoming.filter((e) => !seen.has(entryId(e)));
  return { merged: [...existing, ...added], added };
}

/**
 * Generic changelog diff for the simplest data shape the kit scaffolds:
 *   { categories: { <cat>: { title, source, figures: [{ label, value, unit?, band? }] } }, verifiedDate, ... }
 * One entry per figure whose value (or band) moved, added or was removed. A
 * figure's own `source` (when it carries one) is the entry's source, else the
 * category's. Options:
 *   effectiveFrom(next, figure) — the day the new value applies from (default: next.verifiedDate)
 *   key(figure)                 — the figure's stable id within its category (default: figureKey —
 *                                 its own `key` when it carries one, else slug(label)); the entry key is `<cat>/<key>`
 *   previous: true              — a figure new to the file (first commit included) takes `from` from its
 *                                 own `previous.value` block, so its arrival records its last real change
 *                                 rather than null → value; a new figure without `previous.value` (a
 *                                 `previous` block with no `.value` counts as none), or whose previous
 *                                 equals its value, records nothing (api/_areas/us-rates.js)
 *   extra(next, cat, figure)    — fields merged into every entry
 * Areas with richer data write their own diff — see api/_areas/uk-rates.js for the pattern.
 */
function diffCategories(area, prev, next, { effectiveFrom = (n) => n.verifiedDate, key = figureKey, previous = false, extra = () => ({}) } = {}) {
  const out = [];
  const entry = (cat, c, f, from, to, more = {}) => ({
    area, key: `${cat}/${key(f)}`, label: f.label, from, to, unit: f.unit || null, ...more,
    effectiveFrom: effectiveFrom(next, f), source: f.source || c.source, verifiedDate: next.verifiedDate, note: '', ...extra(next, cat, f),
  });
  for (const [cat, c] of Object.entries(next.categories || {})) {
    const p = prev && prev.categories ? prev.categories[cat] : null;
    const before = new Map(((p && p.figures) || []).map((f) => [key(f), f]));
    for (const f of c.figures || []) {
      const was = before.get(key(f));
      if (was && same(was.value, f.value) && same(was.band, f.band)) continue;
      if (!was && previous) {
        if (!f.previous || f.previous.value === undefined || same(f.previous.value, f.value)) continue;
        out.push(entry(cat, c, f, f.previous.value, f.value, { ...(f.band ? { band: f.band } : {}) }));
        continue;
      }
      out.push(entry(cat, c, f, was ? was.value : null, f.value, {
        ...(f.band ? { band: f.band } : {}), ...(was && !same(was.band, f.band) ? { fromBand: was.band || null } : {}),
      }));
    }
  }
  if (prev && prev.categories) {
    for (const [cat, p] of Object.entries(prev.categories)) {
      const c = (next.categories || {})[cat];
      const after = new Map(((c && c.figures) || []).map((f) => [key(f), f]));
      for (const f of p.figures || []) {
        if (after.has(key(f))) continue;
        out.push(entry(cat, { source: (c && c.source) || p.source }, f, f.value, null));
      }
    }
  }
  return out;
}


/**
 * The fields every answer of a categories area opens with: area, then the file's
 * taxYear / taxYearRuns / jurisdiction / currency when it declares them, then
 * verifiedDate — the header us_rates_lookup and de_rates_lookup print.
 */
function areaHeader(data, area) {
  const out = { area };
  for (const k of ['taxYear', 'taxYearRuns', 'jurisdiction', 'currency']) if (data[k] !== undefined) out[k] = data[k];
  out.verifiedDate = data.verifiedDate;
  return out;
}

/**
 * The house categories lookup (uk_rates_lookup's behaviour) over the
 * `{ categories: { <key>: { title, source, figures } } }` shape — returns the
 * tool's run function. Nothing / blank → the listing (header, categories →
 * titles, usage); a key → the header plus that category; otherwise, in order and
 * each switchable off: `exact` (the key as typed, lower-cased and trimmed),
 * `substring` (the first key or title containing the input) and finally a
 * covered:false near-miss carrying `nearest` (when true) and `coverage`.
 *   header(data, area)  — the fields on every answer (default areaHeader)
 *   param               — the argument that names the category (default 'category'; e.g. 'kind')
 *   filters             — further arguments that narrow the category's figures to those whose field of
 *                         the same name matches (case-insensitive), e.g. ['board', 'region']; a value no
 *                         figure in the category carries answers covered:false with `field`, `nearest`
 *                         and the values that exist
 */
function categoriesLookup(data, area, { exact = true, substring = true, nearest: near = true, header = areaHeader, param = 'category', filters = [] } = {}) {
  const keys = () => Object.keys(data.categories || {});
  const blank = (v) => v === undefined || v === null || String(v).trim() === '';
  const low = (v) => String(v).toLowerCase().trim();
  return (args = {}) => {
    const cats = data.categories || {};
    const category = args[param];
    if (blank(category)) {
      const usage = [`pass ${param}=<key> for figures`, ...filters.map((f) => `${f}=<value> to narrow them`)].join('; ');
      return { ...header(data, area), categories: Object.fromEntries(keys().map((k) => [k, cats[k].title])), usage };
    }
    const q = low(category);
    let hit = exact ? keys().find((k) => k === q) : undefined;
    if (!hit && substring) hit = keys().find((k) => k.includes(q) || String(cats[k].title || '').toLowerCase().includes(q));
    if (!hit) {
      return { covered: false, requested: category, message: `unknown ${param} "${category}"`, ...(near ? { nearest: nearest(q, keys()) } : {}), coverage: keys() };
    }
    let figures = cats[hit].figures || [];
    const applied = {};
    for (const field of filters) {
      if (blank(args[field])) continue;
      const want = low(args[field]);
      const values = [...new Set(figures.map((f) => f[field]).filter((v) => !blank(v)).map(low))];
      if (!values.includes(want)) {
        return { covered: false, requested: args[field], field, message: `unknown ${field} "${args[field]}" in ${hit}`, ...(near ? { nearest: nearest(want, values) } : {}), coverage: values };
      }
      figures = figures.filter((f) => !blank(f[field]) && low(f[field]) === want);
      applied[field] = want;
    }
    return { ...header(data, area), category: hit, ...cats[hit], ...(Object.keys(applied).length ? { filters: applied, figures } : {}) };
  };
}

/**
 * The watcher list for a categories file — `sources()` for the module: every category's
 * `source`, then (figures: true, the default) every figure's own `source`, then `extra`, each URL
 * once (the first label wins). An entry may carry `unreachable: '<reason>'` (403, CAPTCHA): the
 * watcher records it as such in data/sources.json and skips it on Mondays, and coverage and
 * docs/CURATION.md list it — so a page the watcher cannot read is never silently dropped.
 *   unreachable — { <url or hostname>: '<reason>' } applied to every matching entry
 */
function categorySources(data, { figures = true, extra = [], unreachable = {} } = {}) {
  const out = new Map();
  const add = (url, label, more = {}) => { if (url && !out.has(url)) out.set(url, { url, label, ...more }); };
  for (const [k, c] of Object.entries(data.categories || {})) {
    add(c.source, c.title || k);
    if (figures) for (const f of c.figures || []) add(f.source, `${c.title || k} — ${f.label}`);
  }
  for (const e of extra) add(e.url, e.label, e);
  const reasonFor = (url) => {
    if (unreachable[url]) return unreachable[url];
    let host = null;
    try { host = new URL(url).hostname; } catch { /* not a URL */ }
    return host && unreachable[host] ? unreachable[host] : null;
  };
  return [...out.values()].map((e) => (reasonFor(e.url) && !e.unreachable ? { ...e, unreachable: reasonFor(e.url) } : e));
}

/** The figure a changelog entry (`<cat>/<key>`) points at in a categories file, with its category; null when absent. */
function findFigure(data, entryKey, key = figureKey) {
  const i = String(entryKey).indexOf('/');
  if (i === -1) return null;
  const cat = entryKey.slice(0, i), fk = entryKey.slice(i + 1);
  const c = data && data.categories ? data.categories[cat] : null;
  const f = c && (c.figures || []).find((x) => key(x) === fk);
  return f ? { cat, category: c, figure: f } : null;
}

const fmtValue = (v) => (v === null || v === undefined ? 'none' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * A changelog.note(entry, prev, next) for the module, from a template:
 * `scripts/changelog.js` fills every blank note with it (the maintainer still
 * reviews). Placeholders: {label} {key} {from} {to} {unit} {effectiveFrom}
 * {source} (the entry's), {title} (the category's title), {quote} (the figure's
 * sentence), {document} — the figure's quote when it has one, else its source
 * URL — and {previousDocument}: the figure's `previous.title`, else
 * `previous.document`, else `previous.source` (where the old value was read).
 * An empty "()" left by a blank placeholder is dropped. Default template:
 * "{label}: {from} → {to} ({document})". `key` must match the diff's (default figureKey).
 */
function noteTemplate(template = '{label}: {from} → {to} ({document})', { key } = {}) {
  return (entry, prev, next) => {
    const hit = findFigure(next, entry.key, key) || findFigure(prev, entry.key, key);
    const f = (hit && hit.figure) || {};
    const p = (f.previous && typeof f.previous === 'object') ? f.previous : {};
    const fields = {
      ...entry, from: fmtValue(entry.from), to: fmtValue(entry.to), unit: entry.unit || '',
      title: (hit && hit.category && hit.category.title) || '',
      quote: f.quote || '', document: f.quote || entry.source || f.source || '',
      previousDocument: p.title || p.document || p.source || '',
    };
    return template.replace(/\{(\w+)\}/g, (m, k) => (k in fields ? fmtValue(fields[k]) : m)).replace(/\s*\(\)/g, '').trim();
  };
}

module.exports = {
  BASE, joinList, plusDays, qs, coerceNumeric, slug, same, figureKey, entryId, mergeEntries,
  diffCategories, areaHeader, categoriesLookup, categorySources, findFigure, noteTemplate,
};
