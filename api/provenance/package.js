const { sendJson, handleOptions, queryParams, ATTRIBUTION } = require('../_lib');
const { packageProvenance } = require('../_provenance');
const { trackEvent } = require('../_track');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_provenance_package');
  const { ecosystem, name } = queryParams(req);
  if (!ecosystem || !name) {
    return sendJson(res, 400, {
      error: 'missing ?ecosystem=(npm|pypi)&name=. See /api for usage.',
      ...ATTRIBUTION,
    });
  }
  sendJson(res, 200, { ...(await packageProvenance(ecosystem, name)), ...ATTRIBUTION });
};
