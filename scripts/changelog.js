#!/usr/bin/env node
/**
 * Generate changelog entries from the data files you just edited.
 *   1. edit an area's data file against the live source page (docs/CURATION.md, docs/ADDING_AN_AREA.md)
 *   2. node scripts/changelog.js        (add --no-fetch to skip sources.json refresh)
 *   3. review the "note" lines it printed, then commit data/ together
 * Flags:
 *   --only <area>   diff only that area's files and re-hash only its watched sources — every
 *                   other area's watcher baseline (data/sources.json) stays as it was. Without it the
 *                   script re-hashes ALL watched pages, which resets the Monday watcher for every area.
 *   --redo <area>   first remove that area's entries added since the last commit (data/changelog.json
 *                   vs HEAD), then re-run as --only <area> — for a fixed note template or parser. For a
 *                   script area (changelog.script) the script itself is re-run after the removal.
 *                   Without it a re-run is still safe: diffs are against the committed file and entries
 *                   dedupe by area|key|verifiedDate, so nothing spurious is appended — but notes already
 *                   written stay as they were.
 *   --allow-dirty   skip the clean-tree check below
 *   --no-fetch      do not touch data/sources.json
 * Refuses to run with uncommitted changes outside data/ so diffs stay attributable — except the
 * files a NEW area brings with it (an area whose data is not yet in git): its module, test,
 * manifest, fetch script (scripts/<area>.js), logic module (api/_<area>.js, hyphens or
 * underscores), test fixtures (tests/fixtures/<area>…), CURATION section, the refreshed snapshots
 * and everything scripts/sync-areas.js generates are expected to be uncommitted at that point, so
 * no WIP commit and no --allow-dirty is needed before the first changelog run.
 *
 * Which diff runs is decided by the area modules (api/_areas/<area>.js): a
 * changed data file belongs to the area whose changelog.files prefix matches
 * (default: its freshness dataFile), and that area's changelog.diff(prev, next)
 * produces the entries. Areas whose entries come from their own build script
 * (changelog.script) are reported, not diffed. When the area declares
 * freshness.cadenceDays, nextScheduledRefresh is stamped to verifiedDate + N.
 */
const { execSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { AREAS, datasets } = require('../api/_areas');
const { plusDays, mergeEntries } = require('../api/_area_kit');
const { refreshSources } = require('./sources');
const { GENERATED } = require('./sync-areas');
const { previousSnapshot, dropUncommittedEntries } = require('./_git');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const REDO = valueOf('--redo');
const ONLY = REDO || valueOf('--only');

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

/** Areas none of whose claimed data paths is in git yet — the area being added right now. */
function newAreas() {
  return AREAS.filter((a) => a.changelog && claims(a).length && claims(a).every((prefix) => shRaw(`git ls-files -- "${prefix}"`).trim() === ''));
}

/** Paths a new area legitimately leaves uncommitted before its first changelog run. */
function expectedDirty() {
  const fresh = newAreas();
  if (!fresh.length) return new Set();
  const out = new Set([...GENERATED(), 'docs/CURATION.md', ...fs.readdirSync(path.join(ROOT, 'tests/snapshots')).map((f) => `tests/snapshots/${f}`)]);
  for (const a of fresh) for (const p of newAreaFiles(a)) out.add(p);
  return out;
}

/** The files (and path prefixes ending in /) a new area may leave uncommitted besides data/ and the generated set. */
function newAreaFiles(a) {
  const under = a.area.replace(/-/g, '_');
  return [
    `api/_areas/${a.area}.js`, `tests/${a.area}.test.js`,
    `scripts/${a.area}.js`, `scripts/${under}.js`, `api/_${a.area}.js`, `api/_${under}.js`,
    `tests/fixtures/${a.area}/`, `tests/fixtures/${a.area}.`, `tests/fixtures/${under}.`,
    ...(a.server ? [`server-${a.server.key || a.area}.json`] : []),
  ];
}

const allowedPath = (allowed, p) => allowed.has(p) || [...allowed].some((x) => (x.endsWith('/') || x.endsWith('.')) && p.startsWith(x));

function changedDataFiles() {
  // --untracked-files=all: a brand-new directory (the per-year layout's data/<slug>/) is listed file by file, not as "data/<slug>/"
  const entries = parsePorcelain(shRaw('git status --porcelain --untracked-files=all'));
  const allowed = expectedDirty();
  const outside = entries.filter((e) => !e.path.startsWith('data/') && !allowedPath(allowed, e.path));
  if (outside.length && !flag('--allow-dirty')) {
    console.error('Refusing: uncommitted changes outside data/ — commit or stash them first (or pass --allow-dirty):\n  ' + outside.map((e) => e.path).join('\n  '));
    process.exit(1);
  }
  if (ONLY && !AREAS.some((a) => a.area === ONLY)) {
    console.error(`${REDO ? '--redo' : '--only'} ${ONLY}: no such area (${AREAS.map((a) => a.area).join(', ')})`);
    process.exit(1);
  }
  const files = [];
  for (const e of entries.filter((e) => e.path.startsWith('data/') && e.path.endsWith('.json') && e.path !== 'data/changelog.json' && e.path !== 'data/sources.json')) {
    if (/D/.test(e.status)) {
      console.log(`${e.path} was deleted — removals are recorded when the surviving file is refreshed; nothing to diff`);
      continue;
    }
    files.push(e.path);
  }
  return ONLY ? files.filter((f) => areaFor(f) && areaFor(f).area === ONLY) : files;
}

/** Previous committed version; for a brand-new file in an area with previousSibling, the prior sibling (e.g. last tax year). */
function previousVersion(file, area) {
  const committed = previousSnapshot(file);
  if (committed) return committed;
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

/** Blank notes get the module's changelog.note(entry, prev, next) when it has one (api/_area_kit.js noteTemplate). */
function prefillNotes(area, entries, prev, next) {
  if (typeof area.changelog.note !== 'function') return 0;
  let n = 0;
  for (const e of entries) if (!e.note) { e.note = String(area.changelog.note(e, prev, next) || ''); if (e.note) n++; }
  return n;
}

/** The plain statement for an area whose entries come from its own script (changelog.diff null). */
const scriptAreaMessage = (area, fetched) => `${area.area}: this area's entries come from ${area.changelog.script}; ` +
  (fetched ? 'changelog.js only re-hashed its sources.' : 'changelog.js wrote nothing for it (--no-fetch: sources not re-hashed either).');

async function main() {
  const files = changedDataFiles();
  if (REDO) {
    const area = AREAS.find((a) => a.area === REDO);
    const n = dropUncommittedEntries(REDO);
    console.log(`--redo ${REDO}: removed ${n} ${REDO} entr${n === 1 ? 'y' : 'ies'} added since the last commit.`);
    if (area.changelog && !area.changelog.diff) {
      console.log(`Re-running ${area.changelog.script} (it diffs against the committed file).`);
      execFileSync(process.execPath, [path.join(ROOT, area.changelog.script)], { cwd: ROOT, stdio: 'inherit' });
    }
  }
  const scriptOnly = ONLY && AREAS.find((a) => a.area === ONLY && a.changelog && !a.changelog.diff);
  if (!files.length && !scriptOnly) {
    console.log(ONLY ? `No changed data files for ${ONLY}. Nothing to do.` : 'No changed data files under data/. Nothing to do.');
    return;
  }
  let entries = [];
  let prefilled = 0;
  const touched = new Set();
  const scriptAreas = new Set(scriptOnly ? [scriptOnly] : []);
  for (const file of files) {
    const area = areaFor(file);
    if (!area) { console.log(`${file}: no area module claims this file (api/_areas/*.js changelog.files) — skipped`); continue; }
    if (!area.changelog.diff) { scriptAreas.add(area); continue; }
    const next = read(file), prev = previousVersion(file, area);
    stampRefresh(file, next, area);
    const diff = area.changelog.diff(prev, next);
    prefilled += prefillNotes(area, diff, prev, next);
    touched.add(area);
    const first = prev === null;
    console.log(`${file} (${area.area}): ${diff.length} change(s)${first ? (area.changelog.previous ? ' — first commit: previous.value → value for figures carrying a previous; the rest record nothing' : ' — first commit: null → value') : ''}`);
    entries = entries.concat(diff);
  }
  const clPath = path.join(ROOT, 'data/changelog.json');
  const { merged, added } = mergeEntries(read('data/changelog.json'), entries);
  fs.writeFileSync(clPath, JSON.stringify(merged, null, 2) + '\n');
  for (const e of added) console.log(`  + ${e.area} ${e.key}: ${JSON.stringify(e.from)} → ${JSON.stringify(e.to)}${e.note ? `  note: ${e.note}` : ''}`);
  console.log(`\n${added.length} new entr${added.length === 1 ? 'y' : 'ies'} appended to data/changelog.json.`);
  if (added.length) console.log(prefilled ? `${prefilled} note(s) pre-filled from the module's changelog.note — review each, then commit data/ together.` : 'Fill in each "note" (e.g. "Autumn Budget 2026"), then commit data/ together.');
  const fetching = !flag('--no-fetch');
  if (fetching && ONLY) {
    const only = [...touched].find((a) => a.area === ONLY) || AREAS.find((a) => a.area === ONLY);
    const urls = only.sources().map((x) => x.url);
    console.log(`Re-hashing ${urls.length} ${ONLY} source(s) only; other areas' watcher baselines untouched.`);
    await refreshSources(urls);
  } else if (fetching) {
    console.log('Re-hashing EVERY watched source (resets the Monday watcher baseline for all areas; use --only <area> to limit).');
    await refreshSources();
  }
  for (const a of scriptAreas) console.log(scriptAreaMessage(a, fetching));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { parsePorcelain, areaFor, claims, newAreas, expectedDirty, newAreaFiles, allowedPath, prefillNotes, scriptAreaMessage };
