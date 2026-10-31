/**
 * Pure renderers for Verified Facts (docs/FACTS_PROTOCOL.md §9.1): the one-line text form, the
 * indexable fact page (JSON-LD Claim) and the index page (JSON-LD Dataset). No I/O, no clock —
 * the record passed in already carries its computed status. Everything is escaped.
 */
const { STYLE } = require('./_changes_render');
const { FACTS_WELL_KNOWN_URL, FACTS_SPEC_URL, FACT_SCHEMA_URL, FACTS_INDEX_URL, PUBLISHER } = require('./_changelog');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escText = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
/** JSON inside <script>: no "</" can close the element. */
const ldJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const LICENCE = 'Free to reuse with attribution to databutler.dev; each figure belongs to its official source and stays under that source\'s terms (gov.uk: Open Government Licence v3.0).';

/** A value as text: numbers and strings as they are, objects and arrays as compact JSON. */
const valueText = (v) => (v === null || v === undefined ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** "12570 GBP/year (2026-27, from 2026-04-06) verified 2026-10-04 fresh https://…" — spec §9.1. */
function txt(r) {
  if (r.covered === false) return `not found: ${r.requestedKey || r.key || ''}${r.candidates && r.candidates.length ? ` — candidates: ${r.candidates.map((c) => c.key).join(', ')}` : ''}${r.message ? ` — ${r.message}` : ''}`;
  const value = r.withdrawn ? `withdrawn ${r.withdrawn}${r.supersededBy ? ` (superseded by ${r.supersededBy})` : ''}` : `${valueText(r.value)}${r.unit ? ` ${r.unit}` : ''}`;
  const when = [r.period, r.effectiveFrom ? `from ${r.effectiveFrom}` : null].filter(Boolean).join(', ');
  return `${value}${when ? ` (${when})` : ''} verified ${r.verifiedDate} ${r.status} ${r.source}`;
}

function head({ title, description, canonical, alternates = [] }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${alternates.map((a) => `<link rel="alternate" type="${esc(a.type)}"${a.title ? ` title="${esc(a.title)}"` : ''} href="${esc(a.href)}">`).join('\n')}
<link rel="describedby" type="application/json" href="${esc(FACTS_WELL_KNOWN_URL)}">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/icon.png" type="image/png" sizes="512x512">
<style>${STYLE}pre{background:#161b22;padding:12px 14px;border-radius:6px;overflow-x:auto;font-size:.85rem}.big{font-size:1.6rem;color:#7ee787;margin:.4rem 0}.stale{color:#f0883e}table{border-collapse:collapse;font-size:.85rem;width:100%}td,th{text-align:left;padding:3px 8px 3px 0;vertical-align:top;border-bottom:1px solid #21262d}th{color:#8b949e;font-weight:normal}blockquote{border-left:3px solid #30363d;margin:.6rem 0;padding:.1rem .8rem;color:#c9d1d9}</style>`;
}

const nav = `<p class="quiet"><a href="/">databutler.dev</a> · <a href="/f">/f — every fact</a> · <a href="${esc(FACTS_SPEC_URL)}">Verified Facts protocol</a> · <a href="${esc(FACTS_WELL_KNOWN_URL)}">/.well-known/facts.json</a> · <a href="/changes">/changes</a></p>`;
const footer = `<footer class="quiet"><p>verified-facts/0.2 — reference implementation: Data Butler. <a href="/">databutler.dev</a> · <a href="/f">/f</a> · <a href="/api">/api</a> · <a href="/llms.txt">llms.txt</a> · <a href="/privacy">Privacy</a></p></footer></body></html>`;

/** The indexable page for one record (spec §9.1, §10.4): the record, its source, its JSON and a schema.org Claim. */
function html(r) {
  const valueLine = r.withdrawn ? `withdrawn ${r.withdrawn}` : `${valueText(r.value)}${r.unit ? ` ${r.unit}` : ''}`;
  const when = [r.period, r.effectiveFrom ? `from ${r.effectiveFrom}` : null].filter(Boolean).join(', ');
  const canonical = r.cite.url;
  const jsonUrl = `${canonical}${canonical.includes('?') ? '&' : '?'}format=json`;
  const claim = {
    '@context': 'https://schema.org',
    '@type': 'Claim',
    name: r.label,
    text: `${r.label}: ${valueLine}${when ? ` (${when})` : ''}`,
    url: canonical,
    datePublished: r.verifiedDate,
    appearance: { '@type': 'CreativeWork', url: r.source },
    author: { '@type': 'Organization', name: PUBLISHER.name, url: PUBLISHER.url },
    identifier: r.key,
  };
  const rows = [
    ['key', `<code>${escText(r.key)}</code>`],
    ['value', escText(valueLine)],
    ['period', escText(r.period ?? '—')],
    ['effective', escText([r.effectiveFrom || '—', r.effectiveTo ? `to ${r.effectiveTo}` : 'to date'].join(' '))],
    ['source', `<a href="${esc(r.source)}" rel="nofollow">${escText(r.source)}</a>`],
    ['verified', `${escText(r.verifiedDate)} — <span class="${r.status === 'stale' ? 'stale' : ''}">${escText(r.status)}</span> (${escText(r.ageDays)} days ago${r.nextScheduledRefresh ? `; next check by ${escText(r.nextScheduledRefresh)}` : ''})`],
    ...(r.previous ? [['previous', escText(`${valueText(r.previous.value)}${r.unit ? ` ${r.unit}` : ''}${r.previous.period ? ` (${r.previous.period})` : ''}${r.previous.effectiveFrom ? ` from ${r.previous.effectiveFrom}` : ''}`)]] : []),
    ...(r.scope ? [['scope', escText(r.scope)]] : []),
    ['hash', `<code>${escText(r.hash)}</code>`],
    ['signature', r.signature ? `EdDSA, key <code>${escText(r.signature.kid)}</code> — <a href="${esc(r.signature.keys)}">keys</a>` : 'unsigned'],
  ];
  return `${head({
    title: `${r.label}: ${valueLine}${r.period ? ` (${r.period})` : ''} — Data Butler`,
    description: `${r.label}: ${valueLine}${when ? ` (${when})` : ''}. Verified ${r.verifiedDate} against ${r.source}.`,
    canonical,
    alternates: [{ type: 'application/json', title: 'This fact as JSON', href: jsonUrl }, { type: 'text/plain', href: `${canonical}${canonical.includes('?') ? '&' : '?'}format=txt` }],
  })}
<script type="application/ld+json">${ldJson(claim)}</script></head><body>
${nav}
<h1>${escText(r.label)}</h1>
<p class="big">${escText(valueLine)}</p>
<p>${escText(when || 'standing figure')} · verified <strong>${escText(r.verifiedDate)}</strong> against <a href="${esc(r.source)}" rel="nofollow">the official source</a></p>
${r.quote ? `<blockquote>${escText(r.quote)}</blockquote>` : ''}
<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
<h2>As JSON</h2>
<p class="quiet"><code>curl -s ${escText(canonical)}${canonical.includes('?') ? '&amp;' : '?'}max_age=30d</code> — <a href="${esc(FACT_SCHEMA_URL)}">schema</a>; verify with <code>node scripts/verify-fact.js ${escText(canonical)}</code></p>
<pre><code>${escText(JSON.stringify(r, null, 2))}</code></pre>
${footer}`;
}

/** The index page (spec §5.5, §10.4): every key as a table plus a schema.org Dataset with one PropertyValue per key. */
function indexHtml(records, { generated }) {
  const dataset = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Data Butler — Verified Facts',
    description: 'Official figures (tax thresholds and rates, allowances, fees, deadlines, exam dates, policy rates) under short guessable keys, each with its official source, the date it was verified, a content hash and an Ed25519 signature.',
    url: FACTS_INDEX_URL,
    license: LICENCE,
    dateModified: generated,
    creator: { '@type': 'Organization', name: PUBLISHER.name, url: PUBLISHER.url },
    distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: FACTS_INDEX_URL }],
    isBasedOn: [...new Set(records.map((r) => r.source))],
    variableMeasured: records.map((r) => ({ '@type': 'PropertyValue', name: r.key, description: r.label, value: typeof r.value === 'object' && r.value !== null ? JSON.stringify(r.value) : r.value, ...(r.unit ? { unitText: r.unit } : {}) })),
  };
  const groups = new Map();
  for (const r of records) {
    const ns = r.key.split('/')[0];
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns).push(r);
  }
  const cell = (v) => escText(v === null || v === undefined ? '—' : valueText(v));
  const sections = [...groups].map(([ns, rs]) => `<h2>${escText(ns)} <span class="quiet">(${rs.length})</span></h2>
<table><tr><th>key</th><th>value</th><th>period</th><th>verified</th></tr>
${rs.map((r) => `<tr><td><a href="/f/${esc(r.key)}">${escText(r.key)}</a><br><span class="quiet">${escText(r.label)}</span></td><td>${cell(r.value)}${r.unit ? ` ${escText(r.unit)}` : ''}</td><td>${cell(r.period)}</td><td>${escText(r.verifiedDate)}</td></tr>`).join('\n')}
</table>`).join('\n');
  return `${head({
    title: `Verified Facts — ${records.length} official figures by key — Data Butler`,
    description: `${records.length} official figures under short keys (/f/<country>/<topic>/<fact>), each with its official source, verified date, hash and signature.`,
    canonical: FACTS_INDEX_URL,
    alternates: [{ type: 'application/json', title: 'The index as JSON', href: `${FACTS_INDEX_URL}?format=json` }],
  })}
<script type="application/ld+json">${ldJson(dataset)}</script></head><body>
${nav}
<h1>Verified Facts</h1>
<p>${records.length} official figures, one URL each: <code>/f/&lt;country&gt;/&lt;topic&gt;/&lt;fact&gt;</code>. Add <code>?max_age=30d</code> to be told when a verification is older than you need; <code>/f/resolve?q=</code> finds a key from a question. Every record carries its official <code>source</code>, <code>verifiedDate</code>, a SHA-256 <code>hash</code> of the claim and an Ed25519 signature (<a href="/.well-known/jwks.json">keys</a>). Newest verification: ${escText(generated)}.</p>
${sections}
${footer}`;
}

module.exports = { txt, html, indexHtml, valueText, LICENCE };
