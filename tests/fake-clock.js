// tests/fake-clock.js — run code as if today were another day.
//
// Whole suite, one day later (proves no test or snapshot embeds the run date):
//   FAKE_NOW=2026-10-05 NODE_OPTIONS="--require ./tests/fake-clock.js" node --test tests/*.test.js
// NODE_OPTIONS reaches the per-file child processes `node --test` spawns; with FAKE_NOW unset,
// requiring this file changes nothing.
//
// In a test: `await withNow('2026-10-04', async () => { … })` runs the callback with the clock
// at that day and restores it afterwards (tests/snapshot.test.js pins asOf-relative answers so).
//
// `new Date()` and `Date.now()` start at the given instant (an ISO day means 12:00Z) and advance
// with the real clock; `new Date(x)` with an argument is untouched.
function parseNow(raw) {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw);
  if (Number.isNaN(t)) throw new Error(`fake clock needs an ISO date or timestamp, got "${raw}"`);
  return t;
}

function fakeDate(Real, target) {
  const offset = target - Real.now();
  return class FakeDate extends Real {
    constructor(...args) {
      if (args.length === 0) super(Real.now() + offset);
      else super(...args);
    }
    static now() { return Real.now() + offset; }
  };
}

async function withNow(raw, fn) {
  const before = globalThis.Date;
  globalThis.Date = fakeDate(before, parseNow(raw));
  try { return await fn(); } finally { globalThis.Date = before; }
}

if (process.env.FAKE_NOW) globalThis.Date = fakeDate(Date, parseNow(process.env.FAKE_NOW));

module.exports = { withNow };
