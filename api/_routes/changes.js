/**
 * GET /api/changes?since=&area=&format=json|html|rss|atom — REST mirror of
 * what_changed_since. JSON (default) keeps the tool envelope unchanged; the
 * other formats hand off to the /changes page and feed handlers. `format` is
 * stripped from the tool args so cite.url stays the same permalink.
 */
const { sendJson, handleOptions, queryParams, ATTRIBUTION } = require('../_lib');
const { withEnvelope } = require('../_envelope');
const { whatChangedSince } = require('../_hub');
const { trackEvent } = require('../_track');
const changesPage = require('./changes-page');
const changesFeed = require('./changes-feed');

const FORMATS = ['json', 'html', 'rss', 'atom'];

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  const { format, ...q } = queryParams(req);
  const f = String(format || 'json').toLowerCase().trim();
  if (f === 'html') return changesPage(req, res);
  if (f === 'rss' || f === 'atom') return changesFeed(req, res);
  if (f !== 'json') {
    return sendJson(res, 400, { error: `format must be one of ${FORMATS.join(', ')} (got "${format}")`, ...ATTRIBUTION });
  }
  await trackEvent('agent_api_changes', req);
  sendJson(res, 200, withEnvelope(whatChangedSince, q, whatChangedSince.run(q)));
};

module.exports.FORMATS = FORMATS;
