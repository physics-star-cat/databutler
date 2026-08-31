const { sendJson, handleOptions, queryParams, findSpecs, ATTRIBUTION } = require('../../_lib');
const { trackEvent } = require('../../_track');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('agent_api_uk_exams_papers');
  const specs = findSpecs(queryParams(req)).map((sp) => ({
    board: sp.board,
    level: sp.level,
    subject: sp.subject,
    specCode: sp.specCode,
    officialPastPapers: sp.pastPapersUrl,
    note:
      'Past papers and mark schemes are exam-board copyright — this index links to the official ' +
      'archive rather than hosting PDFs. Recent series may be locked to teachers for a period.',
    source: sp.specUrl,
    verifiedDate: sp.verifiedDate,
  }));
  sendJson(res, 200, { count: specs.length, specs, ...ATTRIBUTION });
};
