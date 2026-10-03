/**
 * Software end-of-life vertical — "is this version still supported, and until
 * when" for 14 runtimes, operating systems, a database and a framework, from
 * the committed monthly snapshot data/software-eol.json (endoflife.date open
 * data, MIT; built by scripts/software-eol.js). Query-time work only: resolve
 * a version string to its release cycle, then read the dates as published.
 */
const DATA = require('../data/software-eol.json');
const { nearest } = require('./_text');

const PRODUCT_IDS = Object.keys(DATA.products);

// Names callers use for a product, mapped to endoflife.date's id. Distinct
// distributions stay distinct: "openjdk" is not an alias of oracle-jdk (its
// cycles end six months apart), so it falls through to the near-miss answer.
const ALIASES = {
  node: 'nodejs', 'node.js': 'nodejs', nodejs: 'nodejs',
  python: 'python', python3: 'python', py: 'python', cpython: 'python',
  ubuntu: 'ubuntu', debian: 'debian', android: 'android',
  ios: 'ios', ipados: 'ios',
  macos: 'macos', 'mac-os': 'macos', 'mac-os-x': 'macos', 'os-x': 'macos', osx: 'macos', mac: 'macos',
  windows: 'windows', win: 'windows', 'microsoft-windows': 'windows',
  'oracle-jdk': 'oracle-jdk', java: 'oracle-jdk', jdk: 'oracle-jdk', 'java-se': 'oracle-jdk', 'oracle-java': 'oracle-jdk',
  go: 'go', golang: 'go',
  ruby: 'ruby', php: 'php',
  postgresql: 'postgresql', postgres: 'postgresql', pg: 'postgresql', psql: 'postgresql',
  react: 'react', reactjs: 'react', 'react.js': 'react',
};

// `source` on every result is the product's own endoflife.date page (what the
// envelope cites); the dataset-level fields ride alongside.
const ATTRIBUTION = {
  dataset: DATA.dataset,
  datasetHome: DATA.source,
  publisher: DATA.publisher,
  licence: DATA.licence,
  attributionNote: DATA.attribution,
};

const DEFINITIONS = {
  supported: 'true while the cycle has not reached its eol date (or has no eol date set) as of asOf; security fixes are still published',
  eol: 'end of life — the date security updates stop under standard support, as endoflife.date records it from the vendor; null when no date is set',
  activeSupportEnds: 'end of active (feature and bug-fix) support; after it a supported cycle receives security fixes only; null when not tracked',
  extendedSupportEnds: 'end of the vendor\'s extended or paid support where one exists (Ubuntu Pro, Debian LTS/ELTS, Windows ESU, Oracle extended support)',
  lts: 'long-term-support cycle as of asOf (Node.js cycles become LTS on ltsFrom)',
  latest: 'latest release in the cycle at the snapshot (verifiedDate); a newer patch may exist since',
};

const day = (d) => new Date(d).toISOString().slice(0, 10);
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const normProduct = (s) => String(s ?? '').toLowerCase().trim().replace(/[\s_]+/g, '-');

function provenance(p) {
  return {
    attribution: 'endoflife.date', link: p.page, api: p.api, repository: DATA.repository, licence: 'MIT License',
    fetched: DATA.fetched, verifiedDate: DATA.verifiedDate,
  };
}

function productList() {
  return Object.fromEntries(PRODUCT_IDS.map((id) => [id, DATA.products[id].name]));
}

function findProduct(product) {
  const key = normProduct(product);
  if (!key) return { miss: { covered: false, requested: { product }, message: 'pass a product', coverage: { products: productList() } } };
  const id = ALIASES[key] || (DATA.products[key] ? key : null);
  if (!id) {
    const near = [...new Set(nearest(key, [...PRODUCT_IDS, ...Object.keys(ALIASES)], 5).map((k) => ALIASES[k] || k))].slice(0, 3);
    return {
      miss: {
        covered: false, requested: { product }, message: `"${product}" is not one of the ${PRODUCT_IDS.length} products covered`,
        nearest: near, coverage: { products: productList() },
        hint: 'product ids are endoflife.date\'s (nodejs, python, ubuntu, debian, android, ios, macos, windows, oracle-jdk, go, ruby, php, postgresql, react); "java" and "jdk" resolve to oracle-jdk',
      },
    };
  }
  return { id, p: DATA.products[id] };
}

/** Caller's version string → the form cycle ids take: lower case, no product name, no leading "v", hyphens for spaces. */
function parseVersion(p, raw) {
  let v = String(raw ?? '').trim().toLowerCase();
  const names = [p.id, p.name.toLowerCase(), ...Object.keys(ALIASES).filter((k) => ALIASES[k] === p.id)];
  for (const n of names.sort((a, b) => b.length - a.length)) {
    if (!v.startsWith(n)) continue;
    const next = v.charAt(n.length);
    // "ubuntu 22.04", "node-18", "go1.22", "python3.11" — but not "python3" + ".11"
    if (next === ' ' || next === '-' || (/\d/.test(next) && !/\d$/.test(n))) { v = v.slice(n.length).replace(/^[\s-]+/, ''); break; }
  }
  v = v.replace(/^v(?=\d)/, '').replace(/\s+/g, '-');
  // Legacy Java numbering: 1.5 … 1.8 are Java 5 … 8 (1.4 and earlier keep their ids).
  if (p.id === 'oracle-jdk') v = v.replace(/^1\.([5-9])(?:[._]|$)/, '$1.').replace(/\.$/, '');
  return v;
}

/**
 * Version → cycle. exact (the id itself), codename ("bookworm", "jammy"),
 * prefix ("18.19.0" → "18", "3.11.4" → "3.11", "22.04.3" → "22.04"), or
 * edition tokens ("11-24h2-w"; "11 24h2" alone matches several Windows cycles
 * and comes back as candidates). Returns null when nothing matches.
 */
function resolveCycle(p, raw) {
  const v = parseVersion(p, raw);
  if (!v) return null;
  const cycles = p.cycles;
  const exact = cycles.find((c) => c.cycle.toLowerCase() === v);
  if (exact) return { cycle: exact, matchedBy: 'exact', version: v };
  const spaced = v.replace(/-/g, ' ');
  const codename = cycles.find((c) => c.codename && (c.codename.toLowerCase() === spaced || c.codename.toLowerCase().split(' ')[0] === v));
  if (codename) return { cycle: codename, matchedBy: 'codename', version: v };
  const prefix = cycles.filter((c) => v.startsWith(`${c.cycle.toLowerCase()}.`)).sort((a, b) => b.cycle.length - a.cycle.length)[0];
  if (prefix) return { cycle: prefix, matchedBy: 'prefix', version: v };
  const tokens = v.split('-').filter(Boolean);
  const edition = cycles.filter((c) => { const parts = c.cycle.toLowerCase().split('-'); return tokens.every((t) => parts.includes(t)); });
  if (edition.length === 1) return { cycle: edition[0], matchedBy: 'edition', version: v };
  if (edition.length > 1) return { candidates: edition, version: v };
  return null;
}

function isSupported(c, asOf) {
  if (c.eol === false) return true;
  if (c.eol === true) return false;
  return c.eol > asOf;
}
const ltsAsOf = (c, asOf) => (c.lts === true ? true : isDay(c.lts) ? c.lts <= asOf : false);

/** Compact per-cycle row for timelines and candidate lists. */
function row(c, asOf) {
  return {
    cycle: c.cycle,
    ...(c.releaseLabel ? { releaseLabel: c.releaseLabel } : {}),
    ...(c.codename ? { codename: c.codename } : {}),
    releaseDate: c.releaseDate,
    supported: isSupported(c, asOf),
    eol: isDay(c.eol) ? c.eol : null,
    ...(c.eol === true ? { eolDateUnknown: true } : {}),
    lts: ltsAsOf(c, asOf),
    ...(isDay(c.lts) ? { ltsFrom: c.lts } : {}),
    latest: c.latest,
    ...(c.latestReleaseDate ? { latestReleaseDate: c.latestReleaseDate } : {}),
    activeSupportEnds: isDay(c.support) ? c.support : null,
    ...(isDay(c.extendedSupport) ? { extendedSupportEnds: c.extendedSupport } : {}),
  };
}

/** Newest cycle still supported (preferring LTS where the product has LTS cycles) — the upgrade target a reader asks for next. */
function newestSupported(p, asOf) {
  const supported = p.cycles.filter((c) => isSupported(c, asOf) && c.releaseDate && c.releaseDate <= asOf);
  const lts = supported.filter((c) => ltsAsOf(c, asOf));
  return { any: supported[0] || null, lts: lts[0] || null };
}

function recommendation(p, c, s, asOf) {
  const name = `${p.name} ${c.releaseLabel || c.cycle}`;
  const parts = [];
  if (s.supported) {
    if (s.eol) parts.push(`${name} is supported until ${s.eol}, ${s.daysRemaining} days from ${asOf}.`);
    else parts.push(`${name} is supported; endoflife.date records no end-of-life date for it yet.`);
    if (s.inActiveSupport === false) parts.push(`Active support ended ${s.activeSupportEnds}; the cycle receives security fixes only.`);
    if (c.latest) parts.push(`The latest ${name} release at the snapshot is ${c.latest}.`);
  } else {
    if (s.eol) parts.push(`${name} reached end of life on ${s.eol}, ${s.daysSinceEol} days before ${asOf}; no further security fixes are published for it.`);
    else parts.push(`${name} is end of life (endoflife.date records no date); no further security fixes are published for it.`);
    if (s.extendedSupportEnds && s.extendedSupportEnds > asOf) parts.push(`Extended support from the vendor runs to ${s.extendedSupportEnds}.`);
  }
  const target = newestSupported(p, asOf);
  const t = target.lts || target.any;
  if (t && t.cycle !== c.cycle) {
    const until = isDay(t.eol) ? `, supported until ${t.eol}` : '';
    parts.push(`The newest supported ${target.lts ? 'LTS ' : ''}cycle is ${p.name} ${t.releaseLabel || t.cycle} (latest ${t.latest || 'n/a'}${until}).`);
  }
  return parts.join(' ');
}

function status(p, c, asOf, matchedBy, requested) {
  const supported = isSupported(c, asOf);
  const eol = isDay(c.eol) ? c.eol : null;
  const s = {
    supported,
    eol,
    ...(c.eol === true ? { eolDateUnknown: true } : {}),
    ...(supported && eol ? { daysRemaining: daysBetween(asOf, eol) } : {}),
    ...(!supported && eol ? { daysSinceEol: daysBetween(eol, asOf) } : {}),
    activeSupportEnds: isDay(c.support) ? c.support : null,
    inActiveSupport: isDay(c.support) ? c.support > asOf : c.support === true ? true : null,
    ...(isDay(c.extendedSupport) ? { extendedSupportEnds: c.extendedSupport } : {}),
    lts: ltsAsOf(c, asOf),
    ...(isDay(c.lts) ? { ltsFrom: c.lts } : {}),
  };
  const newest = p.cycles[0];
  const target = newestSupported(p, asOf);
  return {
    product: p.id, productName: p.name, kind: p.kind, requested,
    cycle: c.cycle, matchedBy,
    ...(c.releaseLabel ? { releaseLabel: c.releaseLabel } : {}),
    ...(c.codename ? { codename: c.codename } : {}),
    ...(c.apiVersion ? { apiVersion: c.apiVersion } : {}),
    releaseDate: c.releaseDate,
    ...s,
    latest: c.latest,
    ...(c.latestReleaseDate ? { latestReleaseDate: c.latestReleaseDate } : {}),
    isNewestCycle: newest.cycle === c.cycle,
    newestCycle: row(newest, asOf),
    ...(target.lts && target.lts.cycle !== c.cycle ? { newestSupportedLts: row(target.lts, asOf) } : {}),
    ...(target.any && target.any.cycle !== c.cycle && target.any.cycle !== newest.cycle && (!target.lts || target.any.cycle !== target.lts.cycle) ? { newestSupported: row(target.any, asOf) } : {}),
    recommendation: recommendation(p, c, s, asOf),
    asOf,
    source: p.page,
    ...(c.link ? { vendorLink: c.link } : {}),
    verifiedDate: DATA.verifiedDate,
    definitions: DEFINITIONS,
    ...ATTRIBUTION,
    upstreamProvenance: provenance(p),
  };
}

/** support_status {product, version}; `now` is injectable for tests. */
function supportStatus({ product, version } = {}, now = new Date()) {
  const asOf = day(now);
  const f = findProduct(product);
  if (f.miss) return f.miss;
  const { p } = f;
  const requested = { product, version };
  const cycleIds = p.cycles.map((c) => c.cycle);
  if (version === undefined || version === null || String(version).trim() === '') {
    return {
      covered: false, requested, product: p.id, productName: p.name,
      message: `pass a version of ${p.name}, e.g. "${cycleIds[0]}" or a full release such as "${p.cycles[0].latest || cycleIds[0]}"`,
      cycles: cycleIds, hint: 'support_timeline {product} lists every cycle with its dates',
    };
  }
  const r = resolveCycle(p, version);
  if (!r) {
    return {
      covered: false, requested, product: p.id, productName: p.name,
      message: `no ${p.name} release cycle matches "${version}"`,
      nearest: nearest(parseVersion(p, version), cycleIds), cycles: cycleIds,
      hint: `cycle ids are endoflife.date's: ${cycleIds.slice(0, 4).join(', ')}…; a full release ("${p.cycles[0].latest || cycleIds[0]}") resolves to its cycle; codenames resolve where the vendor uses them`,
    };
  }
  if (r.candidates) {
    return {
      product: p.id, productName: p.name, kind: p.kind, requested, resolved: false,
      message: `"${version}" matches ${r.candidates.length} ${p.name} release cycles; each is listed with its status`,
      candidates: r.candidates.map((c) => row(c, asOf)),
      hint: `pass one cycle id, e.g. "${r.candidates[0].cycle}"${r.candidates[0].releaseLabel ? ` (${r.candidates[0].releaseLabel})` : ''}`,
      asOf, source: p.page, verifiedDate: DATA.verifiedDate, ...ATTRIBUTION, upstreamProvenance: provenance(p),
    };
  }
  return status(p, r.cycle, asOf, r.matchedBy, requested);
}

/** support_timeline {product}: every cycle, newest first, with supported/eol/lts as of today. */
function supportTimeline({ product } = {}, now = new Date()) {
  const asOf = day(now);
  const f = findProduct(product);
  if (f.miss) return f.miss;
  const { p } = f;
  const cycles = p.cycles.map((c) => row(c, asOf));
  const supported = cycles.filter((c) => c.supported);
  const target = newestSupported(p, asOf);
  return {
    product: p.id, productName: p.name, kind: p.kind, requested: { product },
    cycleCount: cycles.length,
    supportedCycles: supported.map((c) => c.cycle),
    ...(target.lts ? { newestSupportedLts: target.lts.cycle } : {}),
    summary:
      `${p.name}: ${cycles.length} release cycles on record, ${supported.length} supported as of ${asOf}` +
      (supported.length ? ` (${supported.map((c) => c.releaseLabel || c.cycle).join(', ')})` : '') +
      `; newest cycle ${cycles[0].releaseLabel || cycles[0].cycle}${cycles[0].latest ? `, latest release ${cycles[0].latest}` : ''}.`,
    cycles,
    asOf,
    source: p.page,
    verifiedDate: DATA.verifiedDate,
    definitions: DEFINITIONS,
    ...ATTRIBUTION,
    upstreamProvenance: provenance(p),
  };
}

function softwareEolCoverage() {
  const products = {};
  for (const id of PRODUCT_IDS) {
    const p = DATA.products[id];
    products[id] = { name: p.name, kind: p.kind, cycles: p.cycleCount, newestCycle: p.cycles[0].cycle, page: p.page };
  }
  return {
    products,
    aliases: ALIASES,
    cycles: DATA.cycleCount,
    verifiedDate: DATA.verifiedDate,
    nextScheduledRefresh: DATA.nextScheduledRefresh,
    source: DATA.source,
    licence: DATA.licence,
    scope:
      'release cycles with release, active-support, extended-support and end-of-life dates as endoflife.date publishes them (compiled from vendor ' +
      'lifecycle pages), a committed monthly snapshot — not a live lookup; a version string resolves to its cycle (18.19.0 → 18, 3.11.4 → 3.11, 22.04.3 → 22.04, bookworm → 12)',
    notCovered: [
      'Java distributions other than Oracle JDK (openjdk-builds-from-oracle, redhat-build-of-openjdk, microsoft-build-of-openjdk, Eclipse Temurin, Amazon Corretto, Azul Zulu)',
      'Linux distributions other than Ubuntu and Debian (RHEL, Alma, Rocky, Fedora, Alpine, SUSE, Arch)',
      'Windows Server, Windows Embedded/IoT beyond the cycles endoflife.date lists under windows',
      'databases other than PostgreSQL (MySQL, MariaDB, MongoDB, Redis, SQLite)',
      'frameworks and libraries other than React (Angular, Vue, Django, Rails, Spring, .NET)',
      'Kubernetes, Docker, browsers, mobile SDK minimum-version policies',
      'CVEs, security advisories and patch contents for a release',
      'vendor paid-support contracts beyond the extendedSupport date endoflife.date records',
      'the several hundred other products endoflife.date tracks (the site itself answers those: https://endoflife.date/)',
    ],
  };
}

module.exports = {
  supportStatus, supportTimeline, softwareEolCoverage, resolveCycle, parseVersion, findProduct,
  DATA, PRODUCT_IDS, ALIASES, DEFINITIONS,
};
