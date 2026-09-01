#!/usr/bin/env node
/**
 * Generate changelog entries from the data files you just edited.
 *   1. edit data/uk/... against the live source page (docs/CURATION.md)
 *   2. node scripts/changelog.js        (add --no-fetch to skip sources.json refresh)
 *   3. fill in the "note" lines it printed, then commit data/ together
 * Refuses to run with uncommitted changes outside data/ so diffs stay attributable.
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { diffRates, diffExams, mergeEntries } = require('../api/_changelog');
const { refreshSources } = require('./sources');

const ROOT = path.resolve(__dirname, '..');
const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

function changedDataFiles() {
  const dirty = sh('git status --porcelain').split('\n').filter(Boolean).map((l) => l.slice(3).trim());
  const outside = dirty.filter((f) => !f.startsWith('data/'));
  if (outside.length) {
    console.error('Refusing: uncommitted changes outside data/ — commit or stash them first:\n  ' + outside.join('\n  '));
    process.exit(1);
  }
  return dirty.filter((f) => f.startsWith('data/uk/') && f.endsWith('.json'));
}

/** Previous committed version; for a brand-new file, the prior sibling (e.g. last tax year). */
function previousVersion(file) {
  try {
    return JSON.parse(sh(`git show HEAD:${file}`));
  } catch { /* new file */ }
  const dir = path.dirname(file);
  const prior = fs.readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.json') && f < path.basename(file)).sort().pop();
  return prior ? read(path.join(dir, prior)) : null;
}

async function main() {
  const files = changedDataFiles();
  if (!files.length) {
    console.log('No changed data files under data/uk/. Nothing to do.');
    return;
  }
  let entries = [];
  for (const file of files) {
    const next = read(file), prev = previousVersion(file);
    const diff = file.includes('/rates/') ? diffRates(prev, next) : file.includes('/exams/') ? diffExams(prev, next) : [];
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

main().catch((e) => { console.error(e); process.exit(1); });
