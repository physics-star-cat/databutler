/**
 * GET /api — the human/agent-readable index of every endpoint. The generic
 * entries (front door, changelog, protocol, citations) are written here; the
 * per-area REST entries, the `POST /api/mcp/<server>` one-liners and the
 * coverage summary come from each area module's docs.api() (api/_areas/*.js).
 */
const { sendJson, handleOptions, ATTRIBUTION } = require('./_lib');
const { AREAS } = require('./_areas');
const { SERVERS } = require('./_registry');
const { DIRECT, HUB_TOOLS } = require('./_hub');
const { CHANGELOG_AREAS } = require('./_changelog');
const { joinList } = require('./_area_kit');

const areaFilter = [...CHANGELOG_AREAS, 'all'].join(' | ');
const changedPhrase = joinList(AREAS.filter((a) => a.changelog).map((a) => a.short));

module.exports = (req, res) => {
  if (handleOptions(req, res)) return;
  const perArea = AREAS.map((a) => ({ area: a, api: a.docs.api() }));
  const endpoints = {
    'POST /api/mcp': {
      description:
        'THE FRONT DOOR — one remote MCP server for the whole estate. Lists ' +
        `${DIRECT.join(', ')} directly, plus what_changed_since ` +
        '(changes since your training cutoff), coverage, catalogue and call (run any tool by name). ' +
        'Every result carries freshness + a cite.url permalink.',
      example: 'add https://databutler.dev/api/mcp to any MCP client',
    },
    'GET /api/changes': {
      description: 'What changed in the verified datasets since a date (REST mirror of what_changed_since). format=html|rss|atom serves the /changes page or feeds instead of JSON.',
      params: { since: 'YYYY-MM-DD', area: areaFilter, format: 'json (default) | html | rss | atom' },
      example: 'https://databutler.dev/api/changes?since=2026-06-01',
    },
    'GET /protocol': {
      description:
        'The Verified Changes protocol v0.1 specification — the open convention /api/changes, /changes, the feeds and ' +
        'what_changed_since follow, so any site can publish dated, sourced from/to entries and any assistant can consume them. ' +
        'Indexable HTML; ?format=md returns the markdown.',
      example: 'https://databutler.dev/protocol',
    },
    'GET /.well-known/changes.json': {
      description: 'Protocol discovery document: areas tracked, cadence, endpoints (json/html/rss/atom/mcp), schema URL, licence, contact.',
      example: 'https://databutler.dev/.well-known/changes.json',
    },
    'GET /schema/changes.v0.json': {
      description: 'JSON Schema (draft 2020-12) for a changes document and a single entry; /schema/well-known-changes.v0.json covers the discovery document.',
      example: 'https://databutler.dev/schema/changes.v0.json',
    },
    'GET /changes': {
      description:
        `The changelog as a page: every verified change to ${changedPhrase}, newest first by month — area, from → to, effectiveFrom, official source, maintainer note, verifiedDate. Indexable, cached 1 h at the edge.`,
      params: { area: `optional: ${CHANGELOG_AREAS.join(' | ')}`, since: 'optional YYYY-MM-DD' },
      example: 'https://databutler.dev/changes?area=vehicles',
    },
    'GET /changes.rss': {
      description: 'RSS 2.0 feed of the changelog (?area= optional). guid = permalink on /changes, link = official source, pubDate = verifiedDate.',
      example: 'https://databutler.dev/changes.rss',
    },
    'GET /changes.atom': {
      description: 'Atom feed of the changelog (?area= optional); same entries as /changes.rss.',
      example: 'https://databutler.dev/changes.atom?area=uk-rates',
    },
    'GET /r/<route>?…': {
      description: 'Citation permalinks (human-readable answer + official source + verified date). Every API/MCP result includes one as cite.url.',
      example: 'https://databutler.dev/r/uk/rates?category=income-tax',
    },
  };
  for (const { api } of perArea) Object.assign(endpoints, api.endpoints || {});
  for (const { area, api } of perArea) {
    if (!area.server) continue;
    const names = area.server.tools.map((t) => t.name);
    endpoints[`POST ${area.server.url.replace('https://databutler.dev', '')}`] = api.mcp || `Remote MCP server — tool${names.length > 1 ? 's' : ''} ${names.join(', ')}.`;
  }
  const coverage = {};
  for (const { api } of perArea) Object.assign(coverage, api.coverage || {});

  sendJson(res, 200, {
    name: 'Data Butler',
    description:
      'Verified reference data for AI agents. Every figure carries an official source URL and a ' +
      'verifiedDate — built for the questions agents misquote from memory. No auth, CORS-open. ' +
      'Country-prefixed: /api/uk/*; more countries later.',
    endpoints,
    coverage,
    protocol: {
      name: 'verified-changes/0.1',
      specification: 'https://databutler.dev/protocol',
      discovery: 'https://databutler.dev/.well-known/changes.json',
      schema: 'https://databutler.dev/schema/changes.v0.json',
    },
    privacy: 'https://databutler.dev/privacy',
    ...ATTRIBUTION,
  });
};

// Exposed for the sync script / tests: the servers and hub tools the index documents.
module.exports.SERVERS = SERVERS;
module.exports.HUB_TOOLS = HUB_TOOLS;
