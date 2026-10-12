/**
 * MCP Server Cards and the AI Catalog (SEP-2127; docs/FACTS_PROTOCOL.md §10.5), static JSON derived
 * from the same server definitions the MCP handlers use.
 *
 * Shapes pinned against the published schemas on 2026-10-12 (they win over the plan where they differ):
 *   Server Card  github.com/modelcontextprotocol/ext-server-card schema.json @ 526201bb (blob a93de948) —
 *                required $schema (…/schemas/v1/server-card.schema.json), name (reverse-DNS, one slash),
 *                description (≤ 100), version; optional title, websiteUrl, repository, remotes[{ type,
 *                url, supportedProtocolVersions }], icons, _meta (reverse-DNS keys).
 *   AI Catalog   github.com/Agent-Card/ai-catalog specification/ai-catalog.md @ 9316f00d — { specVersion: "1.0",
 *                host?: { displayName, identifier?, documentationUrl? }, entries: [{ identifier (urn:air:…),
 *                type: "application/mcp-server-card+json", url, displayName?, description? }] }.
 */
const { BASE } = require('./_area_kit');
const { PROTOCOL_VERSION } = require('./_mcp');
const { FACTS_WELL_KNOWN_URL } = require('./_changelog');

const CARD_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';
const CARD_TYPE = 'application/mcp-server-card+json';
const cardUrl = (server) => `${server.url}/server-card`;

function serverCard(server) {
  return {
    $schema: CARD_SCHEMA,
    name: `io.github.physics-star-cat/${server.serverName}`,
    ...(server.title ? { title: server.title } : {}),
    description: server.description,
    version: server.version || '1.0.0',
    websiteUrl: `${BASE}/api`,
    repository: { url: 'https://github.com/physics-star-cat/databutler', source: 'github' },
    remotes: [{ type: 'streamable-http', url: server.url, supportedProtocolVersions: [PROTOCOL_VERSION] }],
    icons: [{ src: `${BASE}/icon.png`, mimeType: 'image/png', sizes: ['512x512'] }],
    _meta: { 'dev.databutler/facts': FACTS_WELL_KNOWN_URL },
  };
}

/** The domain's AI Catalog: one MCP Server Card entry per server. */
function aiCatalog(servers) {
  return {
    specVersion: '1.0',
    host: { displayName: 'Data Butler', identifier: 'databutler.dev', documentationUrl: `${BASE}/api` },
    entries: servers.map((s) => ({
      identifier: `urn:air:databutler.dev:mcp:${s.serverName}`,
      displayName: s.title || s.serverName,
      type: CARD_TYPE,
      url: cardUrl(s),
      description: s.description,
    })),
  };
}

module.exports = { serverCard, aiCatalog, cardUrl, CARD_SCHEMA, CARD_TYPE };
