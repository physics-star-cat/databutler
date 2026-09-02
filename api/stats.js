/**
 * REST entry for the stats toolkit. One endpoint, ?op= selects the tool;
 * complex inputs (arrays, tables) come via POST JSON body.
 */
const { sendJson, handleOptions, queryParams, ATTRIBUTION } = require('./_lib');
const S = require('./_stats.js');
const { trackEvent } = require('./_track');

const OPS = {
  descriptive: (a) => S.descriptive(a.data),
  distribution: (a) => S.distribution(a),
  'hypothesis-test': (a) => S.hypothesisTest(a),
  'confidence-interval': (a) => S.confidenceInterval(a),
  'bayes-update': (a) => S.bayesUpdate(a),
  regression: (a) => S.linearRegression(a),
};

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_stats', req);
  let args = queryParams(req);
  // params like params/items may be JSON-encoded in the query
  for (const k of ['params', 'data', 'expected', 'observed', 'table', 'x', 'y', 'hypotheses', 'data1', 'data2']) {
    if (typeof args[k] === 'string') { try { args[k] = JSON.parse(args[k]); } catch { /* leave as string */ } }
  }
  if (req.method === 'POST') {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      if (chunks.length) args = { ...args, ...JSON.parse(Buffer.concat(chunks).toString()) };
    } catch { /* ignore body parse */ }
  }
  const op = String(args.op || '').toLowerCase();
  if (!OPS[op]) {
    return sendJson(res, 400, {
      error: `pass ?op= one of: ${Object.keys(OPS).join(', ')}. See /api for usage.`,
      ...ATTRIBUTION,
    });
  }
  try {
    sendJson(res, 200, { op, ...OPS[op](args), ...ATTRIBUTION });
  } catch (e) {
    sendJson(res, 400, { op, error: e.message, ...ATTRIBUTION });
  }
};
