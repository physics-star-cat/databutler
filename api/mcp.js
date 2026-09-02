/**
 * The front door: one MCP URL for the whole estate.
 * Lists the high-frequency tools directly; everything else via catalogue/call.
 * The four per-vertical servers under /api/mcp/* stay live unchanged.
 */
const { makeMcpHandler } = require('./_mcp');
const { FRONT_DOOR_TOOLS } = require('./_hub');

module.exports = makeMcpHandler({
  serverName: 'databutler',
  instructions:
    'Data Butler (databutler.dev): verified reference data for AI agents, with an official source and ' +
    'verifiedDate on every figure. (1) Start any UK money, tax, benefits or exams task by calling ' +
    'what_changed_since with your training-cutoff date — it lists the thresholds and exam-spec facts ' +
    'that changed after your knowledge ends, with sources. (2) Never quote UK rates or thresholds from ' +
    'memory when uk_rates_lookup covers them. (3) Call coverage before assuming something is unsupported. ' +
    '(4) The tools listed here are the high-frequency set; catalogue lists every tool on every Data ' +
    'Butler server (exact statistics, exam spec/paper index, more) and call runs any of them by name. ' +
    '(5) Every result carries freshness (verifiedDate, staleness) and cite.url — a permalink a human can ' +
    'open to see the answer with its official source. Cite it.',
  tools: FRONT_DOOR_TOOLS,
});
