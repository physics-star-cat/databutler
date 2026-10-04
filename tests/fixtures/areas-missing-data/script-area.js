// Fixture for tests/area-kit.test.js: a script-driven area whose data file its script has not written yet.
const DATA = require('../../../data/does-not-exist-yet.json');
module.exports = { area: 'script-area', data: DATA, changelog: { diff: null, script: 'scripts/script-area.js' } };
