const test = require('node:test');
const assert = require('node:assert/strict');
const { rpc } = require('./helpers');
const { SERVERS, ALL_TOOLS } = require('../api/_registry');
const frontDoor = require('../api/_routes/mcp');

// Tools that fetch live external data on the caller's behalf. Everything else
// answers from local datasets or pure computation.
const OPEN_WORLD = ['domain_provenance', 'package_provenance', 'uk_mot_reliability', 'uk_mot_vehicle_search', 'call'];
const MCP_TOOL_KEYS = ['annotations', 'description', 'inputSchema', 'name', 'title'];

async function listedTools() {
  const out = [];
  for (const key of Object.keys(SERVERS)) {
    const r = await rpc(require(`../api/_routes/mcp/${key}`), 'tools/list');
    out.push(...r.body.result.tools.map((t) => ({ ...t, _server: key })));
  }
  const fd = await rpc(frontDoor, 'tools/list');
  out.push(...fd.body.result.tools.map((t) => ({ ...t, _server: 'front-door' })));
  return out;
}

test('every listed tool on every server carries a title and read-only annotations', async () => {
  const tools = await listedTools();
  assert.ok(tools.length >= Object.keys(ALL_TOOLS).length + 4);
  for (const t of tools) {
    assert.deepEqual(Object.keys(t).filter((k) => k !== '_server').sort(), MCP_TOOL_KEYS, `${t._server}/${t.name} keys`);
    assert.ok(typeof t.title === 'string' && t.title.length > 2 && t.title.length <= 40, `${t.name} title`);
    assert.equal(t.annotations.title, t.title);
    assert.equal(t.annotations.readOnlyHint, true, `${t.name} readOnlyHint`);
    assert.equal(t.annotations.destructiveHint, false, `${t.name} destructiveHint`);
    assert.equal(t.annotations.idempotentHint, true, `${t.name} idempotentHint`);
    assert.equal(t.annotations.openWorldHint, OPEN_WORLD.includes(t.name), `${t.name} openWorldHint`);
  }
});

test('internal fields (run, freshness, cite, openWorld, server) never leak into tools/list', async () => {
  for (const t of await listedTools()) {
    for (const k of ['run', 'freshness', 'cite', 'delegate', 'openWorld', 'server', 'serverUrl']) assert.equal(t[k], undefined, `${t.name}.${k}`);
  }
});

test('titles are unique across the registry', () => {
  const titles = Object.values(ALL_TOOLS).map((t) => t.title);
  assert.equal(new Set(titles).size, titles.length);
});
