/**
 * Minimal JSON Schema checker (a draft 2020-12 subset) for the Verified
 * Changes protocol documents: type, required, properties, additionalProperties,
 * items, minItems, enum, const, pattern, minLength, minimum/maximum, format
 * (date, date-time, uri) and $ref into the same document's $defs. No
 * dependencies. Enough to validate data/changelog.json, /api/changes output
 * and /.well-known/changes.json in tests, and for another publisher to
 * self-check — not a general-purpose validator.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

const FORMATS = {
  // A real calendar day, not just the shape: 2026-02-30 round-trips to 2026-03-02 and fails.
  date: (s) => { if (!DAY.test(s)) return false; const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; },
  'date-time': (s) => DAY_TIME.test(s) && !Number.isNaN(Date.parse(s)),
  uri: (s) => { try { return /^(https?|mailto):$/.test(new URL(s).protocol); } catch { return false; } },
};

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const hasType = (v, t) => (t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeOf(v) === t);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function resolveRef(ref, root) {
  if (ref === '#') return root;
  const m = /^#\/\$defs\/([^/]+)$/.exec(ref);
  const def = m && root.$defs && root.$defs[m[1]];
  if (!def) throw new Error(`unsupported $ref "${ref}" (only #/$defs/<name> within the same schema)`);
  return def;
}

function check(schema, value, path, root, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === false) { errors.push(`${path}: not allowed`); return; }
  if (schema.$ref) check(resolveRef(schema.$ref, root), value, path, root, errors);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => hasType(value, t))) { errors.push(`${path}: expected ${types.join('|')}, got ${typeOf(value)}`); return; }
  }
  if (schema.const !== undefined && !same(value, schema.const)) errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => same(e, value))) errors.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: "${value}" does not match ${schema.pattern}`);
    if (schema.format) {
      const f = FORMATS[schema.format];
      if (!f) throw new Error(`unsupported format "${schema.format}"`);
      if (!f(value)) errors.push(`${path}: "${value}" is not a valid ${schema.format}`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items !== undefined) value.forEach((v, i) => check(schema.items, v, `${path}[${i}]`, root, errors));
  }
  if (typeOf(value) === 'object') {
    for (const k of schema.required || []) if (!(k in value)) errors.push(`${path}: missing required "${k}"`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (k in props) check(props[k], v, `${path}.${k}`, root, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${k}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') check(schema.additionalProperties, v, `${path}.${k}`, root, errors);
    }
  }
}

/** { ok, errors[] } — errors are "path: problem" strings, root path is "$". */
function validate(schema, value) {
  const errors = [];
  check(schema, value, '$', schema, errors);
  return { ok: errors.length === 0, errors };
}

/** Throws with every problem listed; for tests and scripts. */
function assertValid(schema, value, label = 'document') {
  const { ok, errors } = validate(schema, value);
  if (!ok) throw new Error(`${label} does not validate:\n  ${errors.join('\n  ')}`);
  return value;
}

module.exports = { validate, assertValid, FORMATS };
