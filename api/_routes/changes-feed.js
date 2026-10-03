/**
 * GET /changes.rss and /changes.atom (?area=), rewritten to
 * /api/router?route=changes-feed&format=rss|atom. RSS 2.0 / Atom of the same
 * entries as /changes; guid is the entry's permalink on that page, link is
 * the official source, pubDate is the verifiedDate. Rendering is pure, so a
 * feed re-renders byte-for-byte until the changelog changes.
 */
const { CORS, handleOptions, queryParams, ATTRIBUTION } = require('../_lib');
const { listEntries, ChangelogFilterError } = require('../_changelog');
const { renderRss, renderAtom } = require('../_changes_render');
const { trackEvent } = require('../_track');

const CACHE = 'public, max-age=300, s-maxage=3600';
const FORMATS = {
  rss: { type: 'application/rss+xml; charset=utf-8', render: renderRss },
  atom: { type: 'application/atom+xml; charset=utf-8', render: renderAtom },
};

function bad(res, message) {
  res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS });
  res.end(JSON.stringify({ error: message, ...ATTRIBUTION }));
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('changes_feed_view', req);
  const { format, area } = queryParams(req);
  const f = FORMATS[String(format || '').toLowerCase().trim()];
  if (!f) return bad(res, `format must be rss or atom (got "${format ?? ''}"). Feeds: /changes.rss, /changes.atom; page: /changes.`);
  let entries;
  try {
    entries = listEntries({ area });
  } catch (e) {
    if (e instanceof ChangelogFilterError) return bad(res, e.message);
    throw e;
  }
  const a = String(area ?? 'all').toLowerCase().trim() || 'all';
  res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': CACHE, ...CORS });
  res.end(f.render({ entries, area: a }));
};

module.exports.FORMATS = Object.keys(FORMATS);
