/**
 * RFC 8785 JSON Canonicalization Scheme — the byte form every Verified Facts
 * hash and signature is computed over (docs/FACTS_PROTOCOL.md §8). Pure, no
 * dependencies, so sister sites can vendor this one file.
 *
 *   objects  keys sorted by UTF-16 code units (JS's default string order), no whitespace
 *   arrays   in order
 *   strings  JSON.stringify (ES2019 well-formed: the minimal escapes RFC 8785 §3.2.2.2 prescribes)
 *   numbers  ECMAScript Number::toString (JSON.stringify), -0 → 0; NaN/±Infinity throw
 *   null, true, false as literals; undefined, functions, symbols and bigints throw
 */
function canonicalize(v) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean': return v ? 'true' : 'false';
    case 'string': return JSON.stringify(v);
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError(`JCS: ${v} is not a JSON number`);
      return Object.is(v, -0) ? '0' : JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
      const keys = Object.keys(v).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`JCS: a ${typeof v} is not a JSON value`);
  }
}

module.exports = { canonicalize };
