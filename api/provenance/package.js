const { sendJson, handleOptions, queryParams, ATTRIBUTION } = require('../_lib');
const { ALL_TOOLS } = require('../_registry');
const { withEnvelope } = require('../_envelope');
const { trackEvent } = require('../_track');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_provenance_package', req);
  const { ecosystem, name } = queryParams(req);
  if (!ecosystem || !name) {
    return sendJson(res, 400, {
      error: 'missing ?ecosystem=(npm|pypi)&name=. See /api for usage.',
      ...ATTRIBUTION,
    });
  }
  const tool = ALL_TOOLS.package_provenance;
  const args = { ecosystem, name };
  sendJson(res, 200, withEnvelope(tool, args, await tool.run(args)));
};
