const { sendJson, handleOptions, queryParams } = require('./_lib');
const { withEnvelope } = require('./_envelope');
const { whatChangedSince } = require('./_hub');
const { trackEvent } = require('./_track');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_changes', req);
  const q = queryParams(req);
  sendJson(res, 200, withEnvelope(whatChangedSince, q, whatChangedSince.run(q)));
};
