/**
 * Small helpers shared by the area modules (api/_areas/*.js) and the code that
 * derives everything else from them. Pure; requires nothing from the API, so an
 * area module can use it without creating a require cycle.
 */
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
 * One entry per figure whose value (or band) moved, added or was removed; the
 * category's source is the entry's source. `effectiveFrom(next)` names the day
 * the new figures apply from (default: verifiedDate). Areas with richer data
 * write their own diff — see api/_areas/uk-rates.js for the pattern.
 */
function diffCategories(area, prev, next, { effectiveFrom = (n) => n.verifiedDate, extra = () => ({}) } = {}) {
  const out = [];
  const entry = (cat, c, f, from, to, more = {}) => ({
    area, key: `${cat}/${slug(f.label)}`, label: f.label, from, to, unit: f.unit || null, ...more,
    effectiveFrom: effectiveFrom(next), source: c.source, verifiedDate: next.verifiedDate, note: '', ...extra(next, cat, f),
  });
  for (const [cat, c] of Object.entries(next.categories || {})) {
    const p = prev && prev.categories ? prev.categories[cat] : null;
    const before = new Map(((p && p.figures) || []).map((f) => [slug(f.label), f]));
    for (const f of c.figures || []) {
      const was = before.get(slug(f.label));
      if (was && same(was.value, f.value) && same(was.band, f.band)) continue;
      out.push(entry(cat, c, f, was ? was.value : null, f.value, {
        ...(f.band ? { band: f.band } : {}), ...(was && !same(was.band, f.band) ? { fromBand: was.band || null } : {}),
      }));
    }
  }
  if (prev && prev.categories) {
    for (const [cat, p] of Object.entries(prev.categories)) {
      const c = (next.categories || {})[cat];
      const after = new Map(((c && c.figures) || []).map((f) => [slug(f.label), f]));
      for (const f of p.figures || []) {
        if (after.has(slug(f.label))) continue;
        out.push(entry(cat, { source: (c && c.source) || p.source }, f, f.value, null));
      }
    }
  }
  return out;
}

module.exports = { BASE, joinList, plusDays, qs, coerceNumeric, slug, same, diffCategories };
