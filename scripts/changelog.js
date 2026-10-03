#!/usr/bin/env node
/**
 * Generate changelog entries from the data files you just edited.
 *   1. edit data/uk/... or data/policy-rates.json against the live source page (docs/CURATION.md)
 *   2. node scripts/changelog.js        (add --no-fetch to skip sources.json refresh)
 *   3. fill in the "note" lines it printed, then commit data/ together
 * Refuses to run with uncommitted changes outside data/ so diffs stay attributable.
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { diffRates, diffExams, diffPolicyRates, mergeEntries } = require('../api/_changelog');
const { refreshSources } = require('./sources');

const ROOT = path.resolve(__dirname, '..');
const POLICY_FILE = 'data/policy-rates.json';
const POLICY_REFRESH_DAYS = 45; // central-bank rates are re-verified within 45 days (docs/CURATION.md)
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

function changedDataFiles() {
  const entries = parsePorcelain(shRaw('git status --porcelain'));
  const outside = entries.filter((e) => !e.path.startsWith('data/'));
  if (outside.length) {
    console.error('Refusing: uncommitted changes outside data/ — commit or stash them first:\n  ' + outside.map((e) => e.path).join('\n  '));
    process.exit(1);
  }
  const dataFiles = entries.filter((e) => (e.path.startsWith('data/uk/') || e.path === POLICY_FILE) && e.path.endsWith('.json'));
  const files = [];
  for (const e of dataFiles) {
    if (/D/.test(e.status)) {
      console.log(`${e.path} was deleted — removals are recorded when the surviving file is refreshed; nothing to diff`);
      continue;
    }
    files.push(e.path);
  }
  return files;
}

/** Previous committed version; for a brand-new file, the prior sibling (e.g. last tax year). */
function previousVersion(file) {
  try {
    // stderr dropped: a brand-new file makes git print "fatal: path … not in HEAD", which is the expected case here
    return JSON.parse(execSync(`git show HEAD:"${file.replace(/"/g, '\\"')}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch { /* new file */ }
  if (!file.includes('/rates/')) return null; // only tax-year files have a prior sibling to diff against
  const dir = path.dirname(file);
  const prior = fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.json') && f < path.basename(file)).sort().pop();
  return prior ? read(path.join(dir, prior)) : null;
}

/** Policy rates are re-verified within 45 days: keep nextScheduledRefresh = verifiedDate + 45 in step with verifiedDate. */
function stampPolicyRefresh(file, data) {
  const d = new Date(`${data.verifiedDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + POLICY_REFRESH_DAYS);
  const due = d.toISOString().slice(0, 10);
  if (data.nextScheduledRefresh === due) return;
  data.nextScheduledRefresh = due;
  fs.writeFileSync(path.join(ROOT, file), JSON.stringify(data, null, 2) + '\n');
  console.log(`${file}: nextScheduledRefresh set to ${due} (verifiedDate + ${POLICY_REFRESH_DAYS} days)`);
}

async function main() {
  const files = changedDataFiles();
  if (!files.length) {
    console.log(`No changed data files under data/uk/ or ${POLICY_FILE}. Nothing to do.`);
    return;
  }
  let entries = [];
  for (const file of files) {
    const next = read(file), prev = previousVersion(file);
    if (file === POLICY_FILE) stampPolicyRefresh(file, next);
    const diff = file === POLICY_FILE ? diffPolicyRates(prev, next)
      : file.includes('/rates/') ? diffRates(prev, next) : file.includes('/exams/') ? diffExams(prev, next) : [];
    console.log(`${file}: ${diff.length} change(s)`);
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

module.exports = { parsePorcelain, POLICY_REFRESH_DAYS };
