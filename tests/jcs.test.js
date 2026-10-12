// tests/jcs.test.js — RFC 8785 JSON Canonicalization Scheme (api/_jcs.js), the input to every fact hash and signature.
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalize } = require('../api/_jcs');

test('RFC 8785 §3.2.3 example: sorted keys, ES number forms, minimal string escapes', () => {
  const input = '{\n  "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],\n' +
    '  "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",\n  "literals": [null, true, false]\n}';
  assert.equal(
    canonicalize(JSON.parse(input)),
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  );
});

test('object keys sort by UTF-16 code units', () => {
  assert.equal(canonicalize({ '\u0080': 1, z: 2, aa: 3, a: 4 }), '{"a":4,"aa":3,"z":2,"\u0080":1}');
  // a non-BMP key sorts by its first surrogate (0xD83D), which is below U+FFFD
  assert.equal(canonicalize({ '�': 1, '\u{1f600}': 2 }), '{"\u{1f600}":2,"�":1}');
});

test('nested arrays and objects keep array order and sort every object', () => {
  assert.equal(canonicalize({ b: [{ y: 1, x: [3, 2, 1] }, []], a: {} }), '{"a":{},"b":[{"x":[3,2,1],"y":1},[]]}');
  assert.equal(canonicalize([1, 'two', null, false, { c: true }]), '[1,"two",null,false,{"c":true}]');
});

test('numbers: -0 → 0, integers plain, exponents as ECMAScript prints them', () => {
  assert.equal(canonicalize(-0), '0');
  assert.equal(canonicalize([12570, 0.1, 1e21, 1e-7, 3.75]), '[12570,0.1,1e+21,1e-7,3.75]');
});

test('rejects values JSON cannot carry', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, () => 1, Symbol('s'), 10n]) {
    assert.throws(() => canonicalize(bad), TypeError, String(bad));
  }
  assert.throws(() => canonicalize({ a: undefined }), TypeError);
  assert.throws(() => canonicalize([1, NaN]), TypeError);
});
