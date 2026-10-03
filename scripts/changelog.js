#!/usr/bin/env node
/**
 * Generate changelog entries from the data files you just edited.
 *   1. edit an area's data file against the live source page (docs/CURATION.md, docs/ADDING_AN_AREA.md)
 *   2. node scripts/changelog.js        (add --no-fetch to skip sources.json refresh)
 *   3. fill in the "note" lines it printed, then commit data/ together
 * Refuses to run with uncommitted changes outside data/ so diffs stay attributable.
 *
 * Which diff runs is decided by the area modules (api/_areas/<area>.js): a
 * changed data file belongs to the area whose changelog.files prefix matches
 * (default: its freshness dataFile), and that area's changelog.diff(prev, next)
 * produces the entries. Areas whose entries come from their own build script
 * (changelog.script) are reported, not diffed. When the area declares
 * freshness.cadenceDays, nextScheduledRefresh is stamped to verifiedDate + N.
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { mergeEntries } = require('../api/_changelog');
const { AREAS, datasets } = require('../api/_areas');
const { plusDays } = require('../api/_area_kit');
const { refreshSources } = require('./sources');

const ROOT = path.resolve(__dirname, '..');
// Not trimmed: porcelain status codes can start with a leading space (e.g. " M"),
// and String.trim() on the whole multi-line output would eat that space off the
// first line only, shifting the fixed-width status/path split for that one entry.
const shRaw = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/** Parse `git status --porcelain` output. For renames/copies (R/C status), path is
 *  the part after " -> " (the new path) — the raw line would otherwise read as the
 *  literal string "old/path -> new/path". */
function parsePorcelain(text) {
  return text.split('\n').filter(Boolean).map((line) => {
    const status = line.slice(0, 2);
    let p = line.slice(3).trim();
    if (/[RC]/.test(status)) {
      const arrow = p.indexOf(' -> ');
      if (arrow !== -1) p = p.slice(arrow + 4);
    }
    return { status, path: p };
  });
}

/** The data-file prefixes each changelog area claims (explicit files, else its dataset files). */
function claims(area) {
  if (!area.changelog) return [];
  if (area.changelog.files) return area.changelog.files;
  return datasets().filter((d) => d.area === area.area).map((d) => d.dataFile);
}

/** Which changelog area a data path belongs to, or null. */
function areaFor(file) {
  return AREAS.find((a) => claims(a).some((prefix) => file === prefix || file.startsWith(prefix))) || null;
}

function changedDataFiles() {
  const entries = parsePorcelain(shRaw('git status --porcelain'));
  const outside = entries.filter((e) => !e.path.startsWith('data/'));
  if (outside.length) {
    console.error('Refusing: uncommitted changes outside data/ — commit or stash them first:\n  ' + outside.map((e) => e.path).join('\n  '));
    process.exit(1);
  }
  const files = [];
  for (const e of entries.filter((e) => e.path.endsWith('.json') && e.path !== 'data/changelog.json' && e.path !== 'data/sources.json')) {
    if (/D/.test(e.status)) {
      console.log(`${e.path} was deleted — removals are recorded when the surviving file is refreshed; nothing to diff`);
      continue;
    }
    files.push(e.path);
  }
  return files;
}

/** Previous committed version; for a brand-new file in an area with previousSibling, the prior sibling (e.g. last tax year). */
function previousVersion(file, area) {
  try {
    // stderr dropped: a brand-new file makes git print "fatal: path … not in HEAD", which is the expected case here
    return JSON.parse(execSync(`git show HEAD:"${file.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch { /* new file */ }
  if (!area.changelog.previousSibling) return null;
  const dir = path.dirname(file);
  const prior = fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.json') && f < path.basename(file)).sort().pop();
  return prior ? read(path.join(dir, prior)) : null;
}

/** Areas with a day cadence keep nextScheduledRefresh = verifiedDate + cadenceDays in step with verifiedDate. */
function stampRefresh(file, data, area) {
  const ds = datasets().find((d) => d.area === area.area && d.dataFile === file);
  if (!ds || !ds.cadenceDays) return;
  const due = plusDays(data.verifiedDate, ds.cadenceDays);
  if (data.nextScheduledRefresh === due) return;
  data.nextScheduledRefresh = due;
  fs.writeFileSync(path.join(ROOT, file), JSON.stringify(data, null, 2) + '\n');
  console.log(`${file}: nextScheduledRefresh set to ${due} (verifiedDate + ${ds.cadenceDays} days)`);
}

async function main() {
  const files = changedDataFiles();
  if (!files.length) {
    console.log('No changed data files under data/. Nothing to do.');
    return;
  }
  let entries = [];
  for (const file of files) {
    const area = areaFor(file);
    if (!area) { console.log(`${file}: no area module claims this file (api/_areas/*.js changelog.files) — skipped`); continue; }
    if (!area.changelog.diff) { console.log(`${file}: ${area.area} entries are written by ${area.changelog.script} — run that instead`); continue; }
    const next = read(file), prev = previousVersion(file, area);
    stampRefresh(file, next, area);
    const diff = area.changelog.diff(prev, next);
    console.log(`${file} (${area.area}): ${diff.length} change(s)`);
    entries = entries.concat(diff);
  }
  const clPath = path.join(ROOT, 'data/changelog.json');
  const { merged, added } = mergeEntries(read('data/changelog.json'), entries);
  fs.writeFileSync(clPath, JSON.stringify(merged, null, 2) + '\n');
  for (const e of added) console.log(`  + ${e.area} ${e.key}: ${JSON.stringify(e.from)} → ${JSON.stringify(e.to)}`);
  console.log(`\n${added.length} new entr${added.length === 1 ? 'y' : 'ies'} appended to data/changelog.json.`);
  if (added.length) console.log('Fill in each "note" (e.g. "Autumn Budget 2026"), then commit data/ together.');
  if (!process.argv.includes('--no-fetch')) await refreshSources();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { parsePorcelain, areaFor, claims };
