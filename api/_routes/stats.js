/**
 * REST entry for the stats toolkit. One endpoint, ?op= selects the tool;
 * complex inputs (arrays, tables) come via POST JSON body.
 */
const { sendJson, handleOptions, queryParams, ATTRIBUTION } = require('../_lib');
const { ALL_TOOLS } = require('../_registry');
const { withEnvelope } = require('../_envelope');
const { trackEvent } = require('../_track');

const OPS = {
  descriptive: 'descriptive_stats',
  distribution: 'distribution',
  'hypothesis-test': 'hypothesis_test',
  'confidence-interval': 'confidence_interval',
  'bayes-update': 'bayes_update',
  regression: 'linear_regression',
};

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_stats', req);
  let args = queryParams(req);
  for (const k of ['params', 'data', 'expected', 'observed', 'table', 'x', 'y', 'hypotheses', 'data1', 'data2']) {
    if (typeof args[k] === 'string') { try { args[k] = JSON.parse(args[k]); } catch { /* leave as string */ } }
  }
  for (const k of ['at', 'p', 'mu0', 'successes', 'n', 'p0', 'successes1', 'n1', 'successes2', 'n2', 'alpha', 'confidence', 'mean', 'sd']) {
    if (typeof args[k] === 'string' && args[k] !== '' && !Number.isNaN(Number(args[k]))) args[k] = Number(args[k]);
  }
  if (req.method === 'POST') {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      if (chunks.length) args = { ...args, ...JSON.parse(Buffer.concat(chunks).toString()) };
    } catch { /* ignore body parse */ }
  }
  const op = String(args.op || '').toLowerCase();
  const tool = ALL_TOOLS[OPS[op]];
  if (!tool) {
    return sendJson(res, 400, {
      error: `pass ?op= one of: ${Object.keys(OPS).join(', ')}. See /api for usage.`,
      ...ATTRIBUTION,
    });
  }
  const { op: _op, ...toolArgs } = args;
  try {
    sendJson(res, 200, { op, ...withEnvelope(tool, toolArgs, tool.run(toolArgs)) });
  } catch (e) {
    sendJson(res, 400, { op, error: e.message, ...ATTRIBUTION });
  }
};
