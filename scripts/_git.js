/**
 * Git-side helpers for the scripts that write data/changelog.json (scripts/changelog.js and the
 * dataset scripts). Requires nothing from api/ that loads the area modules, so a dataset script can
 * use it at the top even before its own data file exists.
 *
 * The rule they implement: a re-run diffs against the COMMITTED file, never against the working
 * copy a previous uncommitted run wrote, so re-running a script (or scripts/changelog.js) before
 * committing never appends spurious "later-run" entries; and `--redo <area>` drops that area's
 * entries added since the last commit before re-running (note fixes, parser fixes).
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { entryId } = require('../api/_area_kit');

const ROOT = path.resolve(__dirname, '..');
const CHANGELOG = 'data/changelog.json';

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
}

let inRepo;
const insideRepo = () => {
  if (inRepo === undefined) { try { inRepo = git(['rev-parse', '--is-inside-work-tree']).trim() === 'true'; } catch { inRepo = false; } }
  return inRepo;
};

/** HEAD's version of a repo-relative JSON file: the parsed object, null when HEAD has no such file, undefined outside a git checkout. */
function committedJson(rel) {
  if (!insideRepo()) return undefined;
  try { return JSON.parse(git(['show', `HEAD:${rel}`])); } catch { return null; }
}

/**
 * What a dataset script diffs against: the committed file (null on a first derivation, when the
 * file is not in git yet), or — outside a git checkout — the file on disk.
 */
function previousSnapshot(rel) {
  const c = committedJson(rel);
  if (c !== undefined) return c;
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, 'utf8')) : null;
}

/** Split the working changelog: `area`'s entries that HEAD does not have (dropped) and everything else (kept). */
function splitUncommitted(entries, area) {
  const head = committedJson(CHANGELOG);
  const committed = new Set((Array.isArray(head) ? head : []).map(entryId));
  const dropped = entries.filter((e) => e.area === area && !committed.has(entryId(e)));
  const gone = new Set(dropped.map(entryId));
  return { kept: entries.filter((e) => !gone.has(entryId(e))), dropped };
}

/** Remove `area`'s entries added since the last commit from data/changelog.json; returns how many went. */
function dropUncommittedEntries(area) {
  const abs = path.join(ROOT, CHANGELOG);
  const entries = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const { kept, dropped } = splitUncommitted(entries, area);
  if (dropped.length) fs.writeFileSync(abs, JSON.stringify(kept, null, 2) + '\n');
  return dropped.length;
}

module.exports = { committedJson, previousSnapshot, splitUncommitted, dropUncommittedEntries, ROOT };
