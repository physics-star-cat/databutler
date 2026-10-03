const { sendJson, handleOptions, queryParams } = require('../../../_lib');
const { ALL_TOOLS } = require('../../../_registry');
const { withEnvelope } = require('../../../_envelope');
const { trackEvent } = require('../../../_track');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_uk_exams_specs', req);
  const tool = ALL_TOOLS.exam_spec_lookup;
  const p = queryParams(req);
  sendJson(res, 200, withEnvelope(tool, p, tool.run(p)));
};
