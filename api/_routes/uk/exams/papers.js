const { sendJson, handleOptions, queryParams } = require('../../../_lib');
const { ALL_TOOLS } = require('../../../_registry');
const { withEnvelope } = require('../../../_envelope');
const { trackEvent } = require('../../../_track');

const NOTE =
  'Past papers and mark schemes are exam-board copyright — this index links to the official ' +
  'archive rather than hosting PDFs. Recent series may be locked to teachers for a period.';

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_uk_exams_papers', req);
  const tool = ALL_TOOLS.exam_paper_index;
  const p = queryParams(req);
  sendJson(res, 200, withEnvelope(tool, p, { ...tool.run(p), copyright: NOTE }));
};
