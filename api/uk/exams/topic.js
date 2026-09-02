const { sendJson, handleOptions, queryParams, topicLookup, ATTRIBUTION } = require('../../_lib');
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
  sendJson(res, 200, { ...topicLookup(p), ...ATTRIBUTION });
};
