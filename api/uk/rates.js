const { sendJson, handleOptions, queryParams } = require('../_lib');
const { ALL_TOOLS } = require('../_registry');
const { withEnvelope } = require('../_envelope');
const { trackEvent } = require('../_track');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_uk_rates', req);
  const tool = ALL_TOOLS.uk_rates_lookup;
  const args = { category: queryParams(req).category };
  sendJson(res, 200, withEnvelope(tool, args, tool.run(args)));
};
