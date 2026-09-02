const { sendJson, handleOptions, queryParams, ATTRIBUTION } = require('../_lib');
const { domainProvenance } = require('../_provenance');
const { trackEvent } = require('../_track');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_provenance_domain', req);
  const { domain } = queryParams(req);
  if (!domain) {
    return sendJson(res, 400, { error: 'missing ?domain= (e.g. example.com). See /api for usage.', ...ATTRIBUTION });
  }
  sendJson(res, 200, { ...(await domainProvenance(domain)), ...ATTRIBUTION });
};
