const { sendJson, handleOptions, queryParams, ATTRIBUTION } = require('../../_lib');
const { ALL_TOOLS } = require('../../_registry');
const { withEnvelope } = require('../../_envelope');
const { trackEvent } = require('../../_track');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_provenance_domain', req);
  const { domain } = queryParams(req);
  if (!domain) {
    return sendJson(res, 400, { error: 'missing ?domain= (e.g. example.com). See /api for usage.', ...ATTRIBUTION });
  }
  const tool = ALL_TOOLS.domain_provenance;
  sendJson(res, 200, withEnvelope(tool, { domain }, await tool.run({ domain })));
};
