const { sendJson, handleOptions, queryParams, ATTRIBUTION } = require('../../_lib');
const { ALL_TOOLS } = require('../../_registry');
const { withEnvelope } = require('../../_envelope');
const { trackEvent } = require('../../_track');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_uk_exams_topic', req);
  const p = queryParams(req);
  if (!p.topic) {
    return sendJson(res, 400, {
      error: 'missing ?topic= (plus optional board, subject, level). See /api for usage.',
      ...ATTRIBUTION,
    });
  }
  const tool = ALL_TOOLS.exam_topic_paper;
  sendJson(res, 200, withEnvelope(tool, p, tool.run(p)));
};
