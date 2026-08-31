const { sendJson, handleOptions, queryParams, findSpecs, ATTRIBUTION } = require('../../_lib');
const { trackEvent } = require('../../_track');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_uk_exams_specs');
  const specs = findSpecs(queryParams(req)).map((sp) => ({
    board: sp.board,
    level: sp.level,
    subject: sp.subject,
    specCode: sp.specCode,
    tiers: sp.tiers,
    papers: sp.papers.map((p) => ({
      paper: p.paper,
      durationMinutes: p.durationMinutes,
      marks: p.marks,
      weighting: p.weighting,
      ...(p.calculator !== undefined ? { calculator: p.calculator } : {}),
      topics: p.topics.map((t) => t.name),
    })),
    notes: sp.notes,
    source: sp.specUrl,
    verifiedDate: sp.verifiedDate,
  }));
  sendJson(res, 200, { count: specs.length, specs, ...ATTRIBUTION });
};
