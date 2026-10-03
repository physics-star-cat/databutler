/**
 * GET /changes?area=&since= (rewritten to /api/router?route=changes-page).
 * The public, INDEXABLE changelog of verified official facts — the human
 * and crawler read side of what_changed_since. Same minimal style as /r/,
 * but with a canonical link and no noindex: this one is meant to be found.
 * Cached 5 min in browsers, 1 h at the edge; a bad filter is a 400, no-store.
 */
const { CORS, handleOptions, queryParams } = require('../_lib');
const { listEntries, ChangelogFilterError } = require('../_changelog');
const { renderChangesHtml, renderErrorHtml } = require('../_changes_render');
const { trackEvent } = require('../_track');

const CACHE = 'public, max-age=300, s-maxage=3600';

function html(res, status, body, { noStore = false } = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': noStore ? 'no-store' : CACHE,
    ...CORS,
  });
  res.end(body);
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  await trackEvent('changes_page_view', req);
  const { area, since } = queryParams(req);
  let entries;
  try {
    entries = listEntries({ area, since });
  } catch (e) {
    if (e instanceof ChangelogFilterError) return html(res, 400, renderErrorHtml(e.message), { noStore: true });
    throw e;
  }
  const a = String(area ?? 'all').toLowerCase().trim() || 'all';
  const s = since !== undefined && String(since).trim() !== '' ? String(since).trim() : null;
  html(res, 200, renderChangesHtml({ entries, area: a, since: s }));
};

module.exports.CACHE = CACHE;
