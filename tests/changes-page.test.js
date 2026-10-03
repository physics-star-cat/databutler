// tests/changes-page.test.js — the changelog as a product: /changes page, RSS/Atom feeds, ?format= on /api/changes
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { invoke } = require('./helpers');
const CHANGELOG = require('../data/changelog.json');
const { listEntries, entryId, ChangelogFilterError, CHANGELOG_AREAS, COVERAGE_START } = require('../api/_changelog');
const R = require('../api/_changes_render');
const changesPage = require('../api/_routes/changes-page');
const changesFeed = require('../api/_routes/changes-feed');
const changes = require('../api/_routes/changes');
const router = require('../api/router');
const { whatChangedSince } = require('../api/_hub');
const { datasetEntries } = require('../scripts/vehicles');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const get = (handler, url) => invoke(handler, undefined, { method: 'GET', url });
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------- a hand-rolled XML well-formedness checker ---------------- */

const ENTITY = /^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;
const NAME = '[A-Za-z_][\\w.:-]*';
const TAG = new RegExp(`^<(/?)(${NAME})((?:\\s+${NAME}\\s*=\\s*"[^"<&]*(?:&(?:amp|lt|gt|quot|apos|#\\d+|#x[0-9a-fA-F]+);[^"<&]*)*")*)\\s*(/?)>`);

/** Throws on the first well-formedness problem; returns the root element name. */
function checkXml(src) {
  assert.ok(src.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'xml declaration');
  let s = src.slice(src.indexOf('?>') + 2);
  const stack = [];
  let root = null;
  while (s.length) {
    if (s[0] === '<') {
      const m = TAG.exec(s);
      assert.ok(m, `bad tag at: ${s.slice(0, 60)}`);
      const [whole, close, name, , selfClose] = m;
      if (close) {
        assert.equal(stack.pop(), name, `mismatched close </${name}>`);
      } else {
        if (!root) root = name;
        else assert.ok(stack.length, `content after root: <${name}>`);
        if (!selfClose) stack.push(name);
      }
      s = s.slice(whole.length);
    } else if (s[0] === '&') {
      const m = ENTITY.exec(s);
      assert.ok(m, `bare ampersand at: ${s.slice(0, 40)}`);
      s = s.slice(m[0].length);
    } else {
      const i = s.search(/[<&]/);
      const text = i === -1 ? s : s.slice(0, i);
      assert.ok(!/>/.test(text) || stack.length, 'stray >');
      if (!stack.length) assert.equal(text.trim(), '', `text outside root: ${text.slice(0, 40)}`);
      s = i === -1 ? '' : s.slice(i);
    }
  }
  assert.deepEqual(stack, [], `unclosed: ${stack.join(', ')}`);
  return root;
}

const tagText = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
const count = (s, re) => (s.match(re) || []).length;

/* ---------------- fixtures ---------------- */

const FIX = [
  { area: 'uk-rates', key: 'income-tax/personal-allowance', label: 'Personal Allowance', from: 12570, to: 13070, unit: 'GBP/year', taxYear: '2027-28', effectiveFrom: '2027-04-06', source: 'https://www.gov.uk/income-tax-rates', verifiedDate: '2026-11-27', note: 'Autumn Budget 2026' },
  { area: 'uk-exams', key: '8463/paper-1/topics', label: 'Paper 1 topics', board: 'AQA', level: 'GCSE', subject: 'Physics', specCode: '8463', from: ['Energy', 'Electricity'], to: ['Energy'], effectiveFrom: null, source: 'https://www.aqa.org.uk/8463', verifiedDate: '2026-09-02', note: '' },
  { area: 'vehicles', key: 'fr-recalls/count', label: 'RappelConso automobile fiches', from: 1663, to: 1700, effectiveFrom: '2026-11-02', source: 'https://rappel.conso.gouv.fr/', verifiedDate: '2026-11-02', note: 'Monthly refresh <script>alert(1)</script> & "quotes"' },
];

/* ---------------- live data ---------------- */

const EOL_PRODUCTS = ['nodejs', 'python', 'ubuntu', 'debian', 'android', 'ios', 'macos', 'windows', 'oracle-jdk', 'go', 'ruby', 'php', 'postgresql', 'react'];

test('live changelog: three vehicles + fourteen software-eol dataset entries in the dataset-script shape (+ six policy-rates figure entries)', () => {
  // 3 vehicles + 14 software-eol dataset entries + 6 policy-rates figure entries (the latter are checked in tests/policy-rates.test.js)
  assert.equal(CHANGELOG.length, 23);
  const DATASETS = CHANGELOG.filter((e) => e.area !== 'policy-rates');
  const keys = DATASETS.map((e) => e.key).sort();
  assert.deepEqual(keys, ['eu-safety-gate/dataset', 'fr-recalls/dataset', 'jp-recalls/dataset', ...EOL_PRODUCTS.map((p) => `${p}/dataset`)].sort());
  for (const e of DATASETS) {
    assert.deepEqual(Object.keys(e), ['area', 'key', 'label', 'from', 'to', 'effectiveFrom', 'source', 'verifiedDate', 'note'], e.key);
    assert.equal(e.area, /\/dataset$/.test(e.key) && EOL_PRODUCTS.includes(e.key.split('/')[0]) ? 'software-eol' : 'vehicles', e.key);
    assert.equal(e.from, null);
    assert.match(e.effectiveFrom, ISO); assert.match(e.verifiedDate, ISO);
    assert.ok(e.effectiveFrom <= e.verifiedDate, `${e.key} effectiveFrom <= verifiedDate`);
    assert.ok(e.verifiedDate >= COVERAGE_START);
    assert.match(e.source, /^https:\/\//);
    assert.ok(e.note.length > 40, `${e.key} note has provenance`);
  }
  const fr = CHANGELOG.find((e) => e.key === 'fr-recalls/dataset');
  assert.equal(fr.to, 'covered'); assert.equal(fr.verifiedDate, '2026-10-02'); assert.equal(fr.effectiveFrom, '2026-10-02');
  assert.equal(fr.source, 'https://rappel.conso.gouv.fr/'); assert.match(fr.note, /1,663/); assert.match(fr.note, /94 curated models/);
  const jp = CHANGELOG.find((e) => e.key === 'jp-recalls/dataset');
  assert.equal(jp.to, 'covered'); assert.equal(jp.effectiveFrom, '2026-08-30'); assert.equal(jp.verifiedDate, '2026-10-03');
  assert.equal(jp.source, 'https://renrakuda.mlit.go.jp/'); assert.match(jp.note, /919/); assert.match(jp.note, /19,659/); assert.match(jp.note, /75 models/);
  const eu = CHANGELOG.find((e) => e.key === 'eu-safety-gate/dataset');
  assert.equal(eu.to, 'stub'); assert.equal(eu.verifiedDate, '2026-10-03');
  assert.equal(eu.source, 'https://ec.europa.eu/safety-gate-alerts/screen/webReport');
  for (const p of EOL_PRODUCTS) {
    const e = CHANGELOG.find((x) => x.key === `${p}/dataset`);
    assert.equal(e.to, 'covered'); assert.equal(e.verifiedDate, '2026-10-03'); assert.equal(e.effectiveFrom, '2026-10-03');
    assert.equal(e.source, `https://endoflife.date/${p}`); assert.match(e.note, /endoflife\.date/); assert.match(e.note, /MIT/); assert.match(e.note, /\d+ release cycles/);
  }
  // ids are unique: the dedupe key for mergeEntries and the basis of feed guids
  assert.equal(new Set(CHANGELOG.map(entryId)).size, 23);
  assert.equal(entryId(fr), 'vehicles|fr-recalls/dataset|2026-10-02');
});

test('live data: the dataset entries match what the data files say', () => {
  const FR = require('../data/vehicles/fr-recalls.json'), JP = require('../data/vehicles/jp-recalls.json');
  const fr = CHANGELOG.find((e) => e.key === 'fr-recalls/dataset');
  assert.equal(fr.source, FR.source); assert.equal(fr.effectiveFrom, FR.verifiedDate);
  assert.match(fr.note, new RegExp(FR.count.toLocaleString('en-GB')));
  const jp = CHANGELOG.find((e) => e.key === 'jp-recalls/dataset');
  assert.equal(jp.source, JP.source); assert.equal(jp.effectiveFrom, JP.verifiedDate);
  assert.match(jp.note, new RegExp(String(JP.counts.recallFilings)));
  assert.match(jp.note, new RegExp(JP.counts.complaints.toLocaleString('en-GB')));
  const EOL = require('../data/software-eol.json');
  for (const p of Object.values(EOL.products)) {
    const e = CHANGELOG.find((x) => x.key === `${p.id}/dataset`);
    assert.equal(e.source, p.page); assert.equal(e.effectiveFrom, EOL.verifiedDate);
    assert.match(e.note, new RegExp(`${p.cycleCount} release cycles`));
  }
});

test('scripts/vehicles.js: first derivation yields the <name>/dataset entry; later runs only metric moves', () => {
  const data = { verifiedDate: '2026-11-02', source: 'https://rappel.conso.gouv.fr/', count: 1700, curatedFicheCount: 580 };
  const metrics = [['count', 'RappelConso automobile fiches', (d) => d.count], ['curated-fiches', 'fiches matched to curated models', (d) => d.curatedFicheCount]];
  const first = datasetEntries('fr-recalls', null, data, metrics, { label: 'RappelConso automobile recalls', today: '2026-11-03' });
  assert.equal(first.length, 1);
  assert.deepEqual(Object.keys(first[0]), Object.keys(CHANGELOG[0]));
  assert.equal(first[0].key, 'fr-recalls/dataset'); assert.equal(first[0].from, null); assert.equal(first[0].to, 'covered');
  assert.equal(first[0].effectiveFrom, '2026-11-02'); assert.equal(first[0].verifiedDate, '2026-11-03');
  assert.equal(first[0].label, 'RappelConso automobile recalls dataset');
  assert.match(first[0].note, /RappelConso automobile fiches: 1700/);
  const again = datasetEntries('fr-recalls', { count: 1663, curatedFicheCount: 580 }, data, metrics);
  assert.deepEqual(again.map((e) => [e.key, e.from, e.to]), [['fr-recalls/count', 1663, 1700]]);
  assert.equal(again[0].note, '');
  assert.deepEqual(datasetEntries('fr-recalls', data, data, metrics), []);
});

/* ---------------- listEntries ---------------- */

test('listEntries: newest first, area + since filters, since optional', () => {
  const all = listEntries({}, FIX);
  assert.deepEqual(all.map((e) => e.verifiedDate), ['2026-11-27', '2026-11-02', '2026-09-02']);
  assert.deepEqual(listEntries({ area: 'vehicles' }, FIX).map((e) => e.key), ['fr-recalls/count']);
  assert.deepEqual(listEntries({ area: 'UK-Rates ' }, FIX).map((e) => e.key), ['income-tax/personal-allowance']);
  assert.equal(listEntries({ area: 'all' }, FIX).length, 3);
  assert.equal(listEntries({ area: '' }, FIX).length, 3);
  assert.deepEqual(listEntries({ since: '2026-11-02' }, FIX).map((e) => e.key), ['income-tax/personal-allowance']);
  assert.equal(listEntries({ since: '2026-11-01' }, FIX).length, 2);
  assert.equal(listEntries({ since: '2030-01-01' }, FIX).length, 0);
  // effectiveFrom after since counts even when verified earlier
  const e = { ...FIX[0], verifiedDate: '2026-01-01', effectiveFrom: '2027-04-06' };
  assert.equal(listEntries({ since: '2026-06-01' }, [e]).length, 1);
  // live data: three vehicles + fourteen software-eol + six policy-rates entries, newest first (same day: area, then key)
  const live = listEntries();
  assert.equal(live.length, 23);
  assert.equal(live[0].verifiedDate, '2026-10-03'); assert.equal(live[0].area, 'policy-rates'); assert.equal(live[live.length - 1].key, 'fr-recalls/dataset');
  assert.equal(listEntries({ area: 'software-eol' }).length, 14);
  assert.equal(listEntries({ area: 'policy-rates' }).length, 6);
  assert.equal(listEntries({ area: 'uk-rates' }).length, 0);
});

test('listEntries: unknown area and malformed since throw ChangelogFilterError', () => {
  assert.throws(() => listEntries({ area: 'stats' }, FIX), (e) => e instanceof ChangelogFilterError && e.field === 'area' && /uk-rates, uk-exams, vehicles/.test(e.message));
  assert.throws(() => listEntries({ since: 'yesterday' }, FIX), (e) => e instanceof ChangelogFilterError && e.field === 'since');
  assert.throws(() => listEntries({ since: '2026-13-45' }, FIX), ChangelogFilterError);
  assert.throws(() => listEntries({ since: '2026-06-01T00:00:00Z' }, FIX), ChangelogFilterError);
});

/* ---------------- HTML render ---------------- */

test('renderChangesHtml: every field, month grouping newest first, context lines', () => {
  const html = R.renderChangesHtml({ entries: listEntries({}, FIX) });
  const months = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(months, ['November 2026', 'September 2026']);
  assert.equal(count(html, /<article /g), 3);
  // field set on the rates entry
  assert.match(html, /<span class="area">uk-rates<\/span>Personal Allowance/);
  assert.match(html, /<code>12570 GBP\/year<\/code> → <code>13070 GBP\/year<\/code>/);
  assert.match(html, /<dt>Context<\/dt><dd>tax year 2027-28<\/dd>/);
  assert.match(html, /<dt>Effective from<\/dt><dd>2027-04-06<\/dd>/);
  assert.match(html, /<a href="https:\/\/www\.gov\.uk\/income-tax-rates" rel="nofollow">https:\/\/www\.gov\.uk\/income-tax-rates<\/a>/);
  assert.match(html, /<dt>Maintainer note<\/dt><dd>Autumn Budget 2026<\/dd>/);
  assert.match(html, /<dt>Verified<\/dt><dd>2026-11-27<\/dd>/);
  assert.match(html, /<code>income-tax\/personal-allowance<\/code>/);
  // exams: array values, context, undated effectiveFrom, blank note
  assert.match(html, /<code>Energy, Electricity<\/code> → <code>Energy<\/code>/);
  assert.match(html, /<dd>AQA GCSE Physics \(8463\)<\/dd>/);
  assert.match(html, /not dated by the source/);
  assert.match(html, /none yet/);
  // anchors are the guid fragments
  assert.match(html, /<article id="uk-rates-income-tax-personal-allowance-2026-11-27">/);
  assert.equal(R.entryGuid(FIX[0]), 'https://databutler.dev/changes#uk-rates-income-tax-personal-allowance-2026-11-27');
  // order inside the page: November entries before September
  assert.ok(html.indexOf('Personal Allowance') < html.indexOf('Paper 1 topics'));
});

test('renderChangesHtml: escapes notes, header explains the product and how to get JSON/RSS/Atom/MCP', () => {
  const html = R.renderChangesHtml({ entries: listEntries({}, FIX) });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot;/);
  assert.match(html, /changelog of verified official facts/);
  assert.match(html, /UK tax and National Insurance thresholds, exam specifications, and official vehicle datasets/);
  assert.match(html, /href="https:\/\/databutler\.dev\/changes\.rss">RSS<\/a>/);
  assert.match(html, /href="https:\/\/databutler\.dev\/changes\.atom">Atom<\/a>/);
  assert.match(html, /\/api\/changes\?since=YYYY-MM-DD/);
  assert.match(html, /<code>what_changed_since<\/code> tool at <code>POST \/api\/mcp<\/code>/);
  assert.match(html, /<title>Data Butler changelog — what changed in the official facts<\/title>/);
  assert.match(html, /<meta name="description" content="A changelog of verified official facts/);
});

test('renderChangesHtml: canonical + alternate links, indexable (no noindex), area carried into feeds', () => {
  const all = R.renderChangesHtml({ entries: listEntries({}, FIX) });
  assert.match(all, /<link rel="canonical" href="https:\/\/databutler\.dev\/changes">/);
  assert.match(all, /<link rel="alternate" type="application\/rss\+xml" title="[^"]*" href="https:\/\/databutler\.dev\/changes\.rss">/);
  assert.match(all, /<link rel="alternate" type="application\/atom\+xml" title="[^"]*" href="https:\/\/databutler\.dev\/changes\.atom">/);
  assert.doesNotMatch(all, /noindex/);
  const v = R.renderChangesHtml({ entries: listEntries({ area: 'vehicles' }, FIX), area: 'vehicles' });
  assert.match(v, /<link rel="canonical" href="https:\/\/databutler\.dev\/changes\?area=vehicles">/);
  assert.match(v, /href="https:\/\/databutler\.dev\/changes\.rss\?area=vehicles"/);
  assert.match(v, /href="https:\/\/databutler\.dev\/changes\.atom\?area=vehicles"/);
  assert.match(v, /<title>[^<]*\(vehicles\)<\/title>/);
  assert.match(v, /<a href="\/changes\?area=vehicles" class="on">vehicles<\/a>/);
  assert.equal(count(v, /<article /g), 1);
  // since view: canonical drops since (infinite query space) but the filter is shown
  const s = R.renderChangesHtml({ entries: listEntries({ since: '2026-11-01' }, FIX), since: '2026-11-01' });
  assert.match(s, /<link rel="canonical" href="https:\/\/databutler\.dev\/changes">/);
  assert.match(s, /since <code>2026-11-01<\/code>/);
  assert.match(s, /2 entries since 2026-11-01/);
});

test('renderChangesHtml: empty states and the 400 page', () => {
  const empty = R.renderChangesHtml({ entries: [] });
  assert.match(empty, /No entries recorded yet/);
  assert.match(empty, new RegExp(COVERAGE_START));
  assert.equal(count(empty, /<article /g), 0);
  const since = R.renderChangesHtml({ entries: [], since: '2030-01-01', area: 'uk-rates' });
  assert.match(since, /No recorded changes since 2030-01-01 in uk-rates/);
  const err = R.renderErrorHtml('unknown area "x" <b>');
  assert.match(err, /Bad changelog filter/);
  assert.match(err, /unknown area &quot;x&quot; &lt;b&gt;/);
  assert.match(err, /<meta name="robots" content="noindex">/);
  assert.match(err, /href="\/changes\?area=vehicles"/);
});

test('groupByMonth / monthLabel / changeText helpers', () => {
  assert.equal(R.monthLabel('2026-04'), 'April 2026');
  const g = R.groupByMonth(listEntries({}, FIX));
  assert.deepEqual(g.map((x) => [x.key, x.entries.length]), [['2026-11', 2], ['2026-09', 1]]);
  assert.equal(R.changeText(FIX[0]), '12570 GBP/year → 13070 GBP/year');
  assert.equal(R.changeText({ from: null, to: 'covered' }), 'none → covered');
  assert.equal(R.changeText({ from: 20, to: 20, fromBand: '£12,571 to £50,270', band: '£13,071 to £50,270' }), '20 → 20 (band £12,571 to £50,270 → £13,071 to £50,270)');
  assert.equal(R.rfc822('2026-10-02'), 'Fri, 02 Oct 2026 00:00:00 GMT');
});

/* ---------------- RSS ---------------- */

test('RSS: well-formed, one item per entry, guid/link/pubDate/category/description', () => {
  const entries = listEntries({}, FIX);
  const rss = R.renderRss({ entries });
  assert.equal(checkXml(rss), 'rss');
  assert.match(rss, /<rss version="2.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.equal(count(rss, /<item>/g), 3);
  assert.deepEqual(tagText(rss, 'link').slice(0, 1), ['https://databutler.dev/changes']);
  assert.match(rss, /<atom:link href="https:\/\/databutler\.dev\/changes\.rss" rel="self" type="application\/rss\+xml"\/>/);
  const items = tagText(rss, 'item');
  // newest first
  assert.match(items[0], /<guid isPermaLink="true">https:\/\/databutler\.dev\/changes#uk-rates-income-tax-personal-allowance-2026-11-27<\/guid>/);
  assert.match(items[0], /<link>https:\/\/www\.gov\.uk\/income-tax-rates<\/link>/);
  assert.match(items[0], /<pubDate>Fri, 27 Nov 2026 00:00:00 GMT<\/pubDate>/);
  assert.match(items[0], /<category>uk-rates<\/category>/);
  assert.match(items[0], /<title>uk-rates: Personal Allowance — 12570 GBP\/year → 13070 GBP\/year<\/title>/);
  assert.match(items[0], /<description>[^<]*Effective from 2027-04-06; verified 2026-11-27\. Official source: https:\/\/www\.gov\.uk\/income-tax-rates Note: Autumn Budget 2026<\/description>/);
  assert.match(items[2], /<pubDate>Wed, 02 Sep 2026 00:00:00 GMT<\/pubDate>/);
  // the hostile note is escaped, not emitted as markup
  assert.doesNotMatch(rss, /<script>/);
  assert.match(rss, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot;/);
  // no lastBuildDate / now-dependent content
  assert.doesNotMatch(rss, /lastBuildDate/);
});

test('RSS: byte-stable re-render, area filter, empty feed is still a valid channel', () => {
  const entries = listEntries({}, FIX);
  assert.equal(R.renderRss({ entries }), R.renderRss({ entries }));
  const v = R.renderRss({ entries: listEntries({ area: 'vehicles' }, FIX), area: 'vehicles' });
  assert.equal(checkXml(v), 'rss');
  assert.equal(count(v, /<item>/g), 1);
  assert.match(v, /<title>[^<]*\(vehicles\)<\/title>/);
  assert.match(v, /<link>https:\/\/databutler\.dev\/changes\?area=vehicles<\/link>/);
  assert.match(v, /<atom:link href="https:\/\/databutler\.dev\/changes\.rss\?area=vehicles"/);
  const empty = R.renderRss({ entries: [] });
  assert.equal(checkXml(empty), 'rss');
  assert.equal(count(empty, /<item>/g), 0);
  assert.match(empty, /<channel>[\s\S]*<title>/);
});

/* ---------------- Atom ---------------- */

test('Atom: well-formed, ids/links/dates, updated = newest verifiedDate, byte-stable, empty feed', () => {
  const entries = listEntries({}, FIX);
  const atom = R.renderAtom({ entries });
  assert.equal(checkXml(atom), 'feed');
  assert.match(atom, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.equal(count(atom, /<entry>/g), 3);
  assert.match(atom, /<id>https:\/\/databutler\.dev\/changes<\/id>/);
  assert.match(atom, /<link rel="self" type="application\/atom\+xml" href="https:\/\/databutler\.dev\/changes\.atom"\/>/);
  assert.match(atom, /<link rel="alternate" type="text\/html" href="https:\/\/databutler\.dev\/changes"\/>/);
  assert.equal(tagText(atom, 'updated')[0], '2026-11-27T00:00:00Z');
  const items = tagText(atom, 'entry');
  assert.match(items[0], /<id>https:\/\/databutler\.dev\/changes#uk-rates-income-tax-personal-allowance-2026-11-27<\/id>/);
  assert.match(items[0], /<link rel="alternate" href="https:\/\/www\.gov\.uk\/income-tax-rates"\/>/);
  assert.match(items[0], /<published>2026-11-27T00:00:00Z<\/published>/);
  assert.match(items[0], /<category term="uk-rates"\/>/);
  assert.match(items[0], /<summary type="text">/);
  assert.equal(R.renderAtom({ entries }), atom);
  const v = R.renderAtom({ entries: listEntries({ area: 'uk-exams' }, FIX), area: 'uk-exams' });
  assert.equal(checkXml(v), 'feed');
  assert.equal(count(v, /<entry>/g), 1);
  assert.match(v, /<id>https:\/\/databutler\.dev\/changes\?area=uk-exams<\/id>/);
  const empty = R.renderAtom({ entries: [] });
  assert.equal(checkXml(empty), 'feed');
  assert.equal(tagText(empty, 'updated')[0], `${COVERAGE_START}T00:00:00Z`);
});

test('the hand-rolled XML checker rejects broken XML', () => {
  const decl = '<?xml version="1.0" encoding="UTF-8"?>';
  assert.throws(() => checkXml(`${decl}<a><b></a>`));
  assert.throws(() => checkXml(`${decl}<a>x & y</a>`));
  assert.throws(() => checkXml(`${decl}<a>1</a><b>2</b>`));
  assert.throws(() => checkXml(`${decl}<a x=y></a>`));
  assert.equal(checkXml(`${decl}\n<a x="1"><b/>t &amp; u</a>\n`), 'a');
});

/* ---------------- handlers ---------------- */

test('GET /changes handler: 200 HTML, indexable, public cache headers, live entries rendered', async () => {
  const r = await get(changesPage, '/api/changes-page');
  assert.equal(r.status, 200);
  assert.equal(r.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['Cache-Control'], 'public, max-age=300, s-maxage=3600');
  assert.equal(r.headers['X-Robots-Tag'], undefined);
  assert.equal(r.headers['Access-Control-Allow-Origin'], '*');
  const html = String(r.raw);
  assert.doesNotMatch(html, /noindex/);
  assert.equal(count(html, /<article /g), 23);
  assert.match(html, /<h2>October 2026<\/h2>/);
  assert.match(html, /Node\.js support lifecycle dataset/);
  assert.match(html, /<dt>Context<\/dt><dd>Bank of England, decision 2025-12-18<\/dd>/);
  assert.match(html, /RappelConso automobile recalls dataset/);
  assert.match(html, /https:\/\/renrakuda\.mlit\.go\.jp\//);
  assert.match(html, /<code>none<\/code> → <code>stub<\/code>/);
  // byte-stable across requests
  assert.equal(String((await get(changesPage, '/api/changes-page')).raw), html);
});

test('GET /changes handler: area and since filters; empty since-view; 400 no-store on bad filters', async () => {
  const v = await get(changesPage, '/api/changes-page?area=vehicles');
  assert.equal(v.status, 200);
  assert.equal(count(String(v.raw), /<article /g), 3);
  assert.match(String(v.raw), /rel="canonical" href="https:\/\/databutler\.dev\/changes\?area=vehicles"/);
  const s = await get(changesPage, '/api/changes-page?since=2026-10-02');
  assert.equal(count(String(s.raw), /<article /g), 22);
  assert.equal(count(String((await get(changesPage, '/api/changes-page?area=software-eol')).raw), /<article /g), 14);
  assert.equal(count(String((await get(changesPage, '/api/changes-page?area=policy-rates')).raw), /<article /g), 6);
  const none = await get(changesPage, '/api/changes-page?area=uk-rates');
  assert.equal(none.status, 200);
  assert.match(String(none.raw), /No entries recorded yet for uk-rates/);
  const future = await get(changesPage, '/api/changes-page?since=2030-01-01');
  assert.match(String(future.raw), /No recorded changes since 2030-01-01/);
  for (const url of ['/api/changes-page?area=stats', '/api/changes-page?since=last-week', '/api/changes-page?area=<script>']) {
    const bad = await get(changesPage, url);
    assert.equal(bad.status, 400, url);
    assert.equal(bad.headers['Cache-Control'], 'no-store');
    assert.match(bad.headers['Content-Type'], /text\/html/);
    assert.doesNotMatch(String(bad.raw), /<script>/);
    assert.match(String(bad.raw), /Bad changelog filter/);
  }
  // format is ignored by the page handler (it arrives via /api/changes?format=html)
  assert.equal((await get(changesPage, '/api/changes-page?format=html')).status, 200);
});

test('GET /changes.rss|.atom handler: content types, cache, well-formed, area filter, 400s', async () => {
  const rss = await get(changesFeed, '/api/changes-feed?format=rss');
  assert.equal(rss.status, 200);
  assert.equal(rss.headers['Content-Type'], 'application/rss+xml; charset=utf-8');
  assert.equal(rss.headers['Cache-Control'], 'public, max-age=300, s-maxage=3600');
  assert.equal(checkXml(String(rss.raw)), 'rss');
  assert.equal(count(String(rss.raw), /<item>/g), 23);
  assert.match(String(rss.raw), /<guid isPermaLink="true">https:\/\/databutler\.dev\/changes#vehicles-fr-recalls-dataset-2026-10-02<\/guid>/);
  assert.match(String(rss.raw), /<guid isPermaLink="true">https:\/\/databutler\.dev\/changes#software-eol-nodejs-dataset-2026-10-03<\/guid>/);
  assert.match(String(rss.raw), /<pubDate>Fri, 02 Oct 2026 00:00:00 GMT<\/pubDate>/);
  assert.equal(String((await get(changesFeed, '/api/changes-feed?format=rss')).raw), String(rss.raw));
  const atom = await get(changesFeed, '/api/changes-feed?format=atom&area=vehicles');
  assert.equal(atom.headers['Content-Type'], 'application/atom+xml; charset=utf-8');
  assert.equal(checkXml(String(atom.raw)), 'feed');
  assert.equal(count(String(atom.raw), /<entry>/g), 3);
  const empty = await get(changesFeed, '/api/changes-feed?format=rss&area=uk-exams');
  assert.equal(empty.status, 200);
  assert.equal(count(String(empty.raw), /<item>/g), 0);
  for (const url of ['/api/changes-feed', '/api/changes-feed?format=json', '/api/changes-feed?format=rss&area=nope']) {
    const bad = await get(changesFeed, url);
    assert.equal(bad.status, 400, url);
    assert.equal(bad.headers['Cache-Control'], 'no-store');
    assert.match(bad.body.error, /format must be rss or atom|unknown area/);
  }
});

test('GET /api/changes?format= switches output; JSON envelope and cite.url unaffected by format', async () => {
  const json = await get(changes, '/api/changes?since=2026-06-01&area=vehicles');
  assert.equal(json.status, 200);
  assert.match(json.headers['Content-Type'], /application\/json/);
  assert.equal(json.body.count, 3);
  assert.equal(json.body.attribution, 'databutler.dev');
  assert.equal(json.body.cite.url, 'https://databutler.dev/r/changes?since=2026-06-01&area=vehicles');
  const explicit = await get(changes, '/api/changes?since=2026-06-01&area=vehicles&format=json');
  assert.deepEqual(explicit.body, json.body);
  assert.equal(explicit.body.cite.url, json.body.cite.url, 'format stripped from tool args');
  const html = await get(changes, '/api/changes?format=html&area=vehicles');
  assert.equal(html.status, 200);
  assert.equal(html.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.match(String(html.raw), /rel="canonical" href="https:\/\/databutler\.dev\/changes\?area=vehicles"/);
  const rss = await get(changes, '/api/changes?format=rss');
  assert.equal(rss.headers['Content-Type'], 'application/rss+xml; charset=utf-8');
  assert.equal(checkXml(String(rss.raw)), 'rss');
  const atom = await get(changes, '/api/changes?format=ATOM');
  assert.equal(atom.headers['Content-Type'], 'application/atom+xml; charset=utf-8');
  const bad = await get(changes, '/api/changes?format=yaml');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /json, html, rss, atom/);
});

/* ---------------- routing + rewrites ---------------- */

test('router: changes-page and changes-feed are registered and reachable; vercel rewrites precede /api/(.+)', async () => {
  assert.ok(router.ROUTES['changes-page']); assert.ok(router.ROUTES['changes-feed']);
  const page = await get(router, '/api/router?route=changes-page&area=vehicles');
  assert.equal(page.status, 200);
  assert.match(String(page.raw), /<link rel="canonical"/);
  const feed = await get(router, '/api/router?route=changes-feed&format=rss&area=vehicles');
  assert.equal(feed.status, 200);
  assert.equal(checkXml(String(feed.raw)), 'rss');
  const atom = await get(router, '/api/router?route=changes-feed&format=atom');
  assert.equal(atom.headers['Content-Type'], 'application/atom+xml; charset=utf-8');

  const { rewrites } = JSON.parse(read('vercel.json'));
  const idx = (source) => rewrites.findIndex((r) => r.source === source);
  const generic = idx('/api/(.+)');
  assert.ok(generic >= 0);
  assert.equal(rewrites[idx('/changes')].destination, '/api/router?route=changes-page');
  assert.equal(rewrites[idx('/changes.rss')].destination, '/api/router?route=changes-feed&format=rss');
  assert.equal(rewrites[idx('/changes.atom')].destination, '/api/router?route=changes-feed&format=atom');
  for (const s of ['/changes', '/changes.rss', '/changes.atom', '/r/(.*)']) assert.ok(idx(s) < generic, `${s} before the generic rewrite`);
});

/* ---------------- discoverability ---------------- */

test('discoverability: index.html, robots.txt, sitemap.xml, llms.txt, /api index, tool description, README, CURATION', async () => {
  const index = read('public/index.html');
  assert.match(index, /<link rel="alternate" type="application\/rss\+xml" title="[^"]*" href="\/changes\.rss">/);
  assert.match(index, /<link rel="alternate" type="application\/atom\+xml" title="[^"]*" href="\/changes\.atom">/);
  assert.match(index, /<a href="\/changes">/);

  const robots = read('public/robots.txt');
  assert.match(robots, /^User-agent: \*\nAllow: \/\nAllow: \/changes\*/m);
  assert.match(robots, /^Sitemap: https:\/\/databutler\.dev\/sitemap\.xml$/m);
  assert.doesNotMatch(robots, /Disallow: \/changes/);

  const sitemap = read('public/sitemap.xml');
  assert.equal(checkXml(sitemap), 'urlset');
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.deepEqual(tagText(sitemap, 'loc'), [
    'https://databutler.dev/', 'https://databutler.dev/changes',
    ...CHANGELOG_AREAS.map((a) => `https://databutler.dev/changes?area=${a}`),
    'https://databutler.dev/protocol', 'https://databutler.dev/privacy', 'https://databutler.dev/api',
  ]);
  assert.doesNotMatch(sitemap, /lastmod/);
  for (const a of CHANGELOG_AREAS) assert.match(sitemap, new RegExp(`changes\\?area=${a}<`));

  const llms = read('public/llms.txt');
  assert.match(llms, /https:\/\/databutler\.dev\/changes` — the changelog as a page/);
  assert.match(llms, /https:\/\/databutler\.dev\/changes\.rss/);
  assert.match(llms, /https:\/\/databutler\.dev\/changes\.atom/);
  assert.match(llms, /format=html\|rss\|atom/);

  const api = await invoke(require('../api/index'), undefined, { method: 'GET', url: '/api' });
  for (const k of ['GET /changes', 'GET /changes.rss', 'GET /changes.atom']) assert.ok(api.body.endpoints[k], k);
  assert.match(api.body.endpoints['GET /api/changes'].params.format, /json.*html.*rss.*atom/);
  assert.match(api.body.endpoints['GET /api/changes'].params.area, /vehicles/);

  assert.match(whatChangedSince.description, /vehicle datasets/);
  assert.match(whatChangedSince.description, /https:\/\/databutler\.dev\/changes\b/);
  assert.match(whatChangedSince.description, /changes\.rss/);
  assert.match(whatChangedSince.description, /changes\.atom/);

  assert.match(read('README.md'), /^## The changelog is a product$/m);
  assert.match(read('README.md'), /\| Page \| `GET \/changes`/);
  const curation = read('docs/CURATION.md');
  assert.match(curation, /^## Where the changelog is served$/m);
  assert.match(curation, /^## How to add a changelog entry when a dataset is refreshed$/m);
  assert.match(curation, /node scripts\/vehicles\.js fr\|jp\|all/);
});
