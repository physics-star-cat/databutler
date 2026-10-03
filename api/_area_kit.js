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

/**
 * Generic changelog diff for the simplest data shape the kit scaffolds:
 *   { categories: { <cat>: { title, source, figures: [{ label, value, unit?, band? }] } }, verifiedDate, ... }
 * One entry per figure whose value (or band) moved, added or was removed. A
 * figure's own `source` (when it carries one) is the entry's source, else the
 * category's. Options:
 *   effectiveFrom(next, figure) — the day the new value applies from (default: next.verifiedDate)
 *   key(figure)                 — the figure's stable id within its category (default: slug(label));
 *                                 the entry key is `<cat>/<key>`
 *   previous: true              — a figure new to the file (first commit included) takes `from` from its
 *                                 own `previous.value` block, so its arrival records its last real change
 *                                 rather than null → value; a new figure without `previous.value` (a
 *                                 `previous` block with no `.value` counts as none), or whose previous
 *                                 equals its value, records nothing (api/_areas/us-rates.js)
 *   extra(next, cat, figure)    — fields merged into every entry
 * Areas with richer data write their own diff — see api/_areas/uk-rates.js for the pattern.
 */
function diffCategories(area, prev, next, { effectiveFrom = (n) => n.verifiedDate, key = (f) => slug(f.label), previous = false, extra = () => ({}) } = {}) {
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
 */
function categoriesLookup(data, area, { exact = true, substring = true, nearest: near = true, header = areaHeader } = {}) {
  const keys = () => Object.keys(data.categories || {});
  return ({ category } = {}) => {
    const cats = data.categories || {};
    if (category === undefined || category === null || String(category).trim() === '') {
      return { ...header(data, area), categories: Object.fromEntries(keys().map((k) => [k, cats[k].title])), usage: 'pass category=<key> for figures' };
    }
    const q = String(category).toLowerCase().trim();
    let hit = exact ? keys().find((k) => k === q) : undefined;
    if (!hit && substring) hit = keys().find((k) => k.includes(q) || String(cats[k].title || '').toLowerCase().includes(q));
    if (!hit) {
      return { covered: false, requested: category, message: `unknown category "${category}"`, ...(near ? { nearest: nearest(q, keys()) } : {}), coverage: keys() };
    }
    return { ...header(data, area), category: hit, ...cats[hit] };
  };
}

/** The figure a changelog entry (`<cat>/<key>`) points at in a categories file, with its category; null when absent. */
function findFigure(data, entryKey, key = (f) => f.key || slug(f.label)) {
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
 * {source} (the entry's), {quote} (the figure's sentence) and {document} — the
 * figure's quote when it has one, else its source URL. Default template:
 * "{label}: {from} → {to} ({document})".
 */
function noteTemplate(template = '{label}: {from} → {to} ({document})', { key } = {}) {
  return (entry, prev, next) => {
    const hit = findFigure(next, entry.key, key) || findFigure(prev, entry.key, key);
    const f = (hit && hit.figure) || {};
    const fields = {
      ...entry, from: fmtValue(entry.from), to: fmtValue(entry.to), unit: entry.unit || '',
      quote: f.quote || '', document: f.quote || entry.source || f.source || '',
    };
    return template.replace(/\{(\w+)\}/g, (m, k) => (k in fields ? fmtValue(fields[k]) : m)).replace(/\s+\(\)$/, '');
  };
}

module.exports = { BASE, joinList, plusDays, qs, coerceNumeric, slug, same, diffCategories, areaHeader, categoriesLookup, findFigure, noteTemplate };
