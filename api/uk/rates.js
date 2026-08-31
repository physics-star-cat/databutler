const { sendJson, handleOptions, queryParams, ratesLookup, ATTRIBUTION } = require('../_lib');
const { trackEvent } = require('../_track');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_uk_rates');
  const { category } = queryParams(req);
  sendJson(res, 200, { ...ratesLookup(category), ...ATTRIBUTION });
};
