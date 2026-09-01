/**
 * Live provenance signals for domains and packages. No stored dataset —
 * everything is fetched per request from RDAP / npm / PyPI. Descriptive
 * only: we return signals, never a verdict ("official", "phishing").
 */
const POPULAR = require('../data/provenance/popular.json');

const FETCH_TIMEOUT_MS = 8000;

const PROVENANCE_NOTE =
  'Descriptive signals only, computed live — not a verdict. A typosquat match ' +
  'means string similarity to a well-known name, NOT that this domain/package ' +
  'is malicious or that the popular one is the sole official option. The calling ' +
  'agent should weigh these signals, and tell the user to verify anything ' +
  'security-sensitive through an independently trusted channel.';

// RDAP (rdap.org) and some registries 403 requests with no User-Agent.
const UA = 'databutler.dev-provenance/1.0 (+https://databutler.dev)';
const { levenshtein } = require('./_text');

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json, application/rdap+json', ...headers },
      redirect: 'follow',
    });
    if (!r.ok) return { _error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { _error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Registrable label: "databutler" from "databutler.dev", "stripe-help" from "stripe-help.com". */
function registrableLabel(domain) {
  const parts = String(domain).toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split('.');
  // second-level label (handle co.uk etc. loosely)
  if (parts.length >= 3 && ['co', 'org', 'gov', 'ac', 'me'].includes(parts[parts.length - 2])) {
    return parts[parts.length - 3];
  }
  return parts[parts.length - 2] || parts[0];
}

// Collapse common homoglyph substitutions so "paypa1", "g00gle", "amaz0n"
// resolve toward the brand they imitate.
function deHomoglyph(s) {
  return s.replace(/1/g, 'l').replace(/0/g, 'o').replace(/3/g, 'e')
    .replace(/5/g, 's').replace(/\$/g, 's').replace(/@/g, 'a').replace(/7/g, 't');
}

/** Typosquat check of a name against a reference list. */
function typosquatCheck(name, referenceList) {
  const raw = String(name).toLowerCase();
  const n = deHomoglyph(raw);
  const flags = [];
  for (const ref of referenceList) {
    const refLabel = ref.includes('.') ? registrableLabel(ref) : ref;
    if (raw === refLabel) return { exactMatchOfPopular: ref }; // it *is* the popular one
    const d = levenshtein(n, refLabel);
    if (d > 0 && d <= 2 && Math.abs(n.length - refLabel.length) <= 2) {
      flags.push({ resembles: ref, editDistance: d, ...(n !== raw ? { viaHomoglyph: true } : {}) });
    } else if (refLabel.length >= 4 && n.includes(refLabel) && raw !== refLabel) {
      flags.push({ resembles: ref, containsBrand: true, ...(n !== raw ? { viaHomoglyph: true } : {}) });
    }
  }
  flags.sort((a, b) => (a.editDistance ?? 9) - (b.editDistance ?? 9));
  return flags.length ? { possibleTyposquats: flags.slice(0, 4) } : { possibleTyposquats: [] };
}

/* ---- domain ---- */

function daysBetween(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

async function domainProvenance(domain) {
  const host = String(domain || '').toLowerCase().replace(/^https?:\/\//, '').split('/')[0].trim();
  if (!host || !host.includes('.')) return { error: 'pass a domain, e.g. example.com' };

  const rdap = await fetchJson(`https://rdap.org/domain/${encodeURIComponent(host)}`);
  const result = { domain: host };

  if (rdap._error) {
    result.registration = { error: `RDAP lookup failed (${rdap._error}) — TLD may not support RDAP` };
  } else {
    const events = Object.fromEntries((rdap.events || []).map((e) => [e.eventAction, e.eventDate]));
    const regDate = events.registration || events['last changed'];
    const registrarEntity = (rdap.entities || []).find((e) => (e.roles || []).includes('registrar'));
    const registrarName = registrarEntity
      ? (registrarEntity.vcardArray?.[1]?.find((f) => f[0] === 'fn')?.[3] || null)
      : null;
    result.registration = {
      registeredOn: regDate || null,
      ageDays: daysBetween(regDate),
      expiresOn: events.expiration || null,
      registrar: registrarName,
      nameservers: (rdap.nameservers || []).map((n) => n.ldhName).slice(0, 6),
      status: rdap.status || [],
      registrantRedacted: !(rdap.entities || []).some((e) => (e.roles || []).includes('registrant')),
    };
    if (result.registration.ageDays !== null && result.registration.ageDays <= 30) {
      result.registration.freshDomainWarning =
        `registered ${result.registration.ageDays} day(s) ago — new domains warrant extra caution`;
    }
  }

  result.similarity = typosquatCheck(registrableLabel(host), POPULAR.brandDomains);
  result.note = PROVENANCE_NOTE;
  return result;
}

/* ---- package ---- */

async function packageProvenance(ecosystem, name) {
  const eco = String(ecosystem || '').toLowerCase();
  const pkg = String(name || '').trim();
  if (!pkg) return { error: 'pass a package name' };

  if (eco === 'npm') {
    const d = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(pkg).replace('%2F', '/')}`);
    if (d._error) return { error: `npm lookup failed (${d._error}) — package may not exist`, ecosystem: eco, name: pkg };
    const created = d.time?.created;
    return {
      ecosystem: 'npm', name: d.name,
      firstPublished: created || null,
      ageDays: daysBetween(created),
      latestVersion: d['dist-tags']?.latest || null,
      releaseCount: d.time ? Object.keys(d.time).filter((k) => k !== 'created' && k !== 'modified').length : null,
      maintainers: (d.maintainers || []).map((m) => m.name).slice(0, 8),
      repository: d.repository?.url || null,
      homepage: d.homepage || null,
      similarity: typosquatCheck(pkg, POPULAR.npmPackages),
      note: PROVENANCE_NOTE,
    };
  }
  if (eco === 'pypi') {
    const d = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`);
    if (d._error) return { error: `PyPI lookup failed (${d._error}) — package may not exist`, ecosystem: eco, name: pkg };
    const releases = d.releases || {};
    const dates = Object.values(releases).flat().map((f) => f.upload_time_iso_8601).filter(Boolean).sort();
    return {
      ecosystem: 'pypi', name: d.info?.name || pkg,
      firstPublished: dates[0] || null,
      ageDays: daysBetween(dates[0]),
      latestVersion: d.info?.version || null,
      releaseCount: Object.keys(releases).length,
      author: d.info?.author || d.info?.author_email || null,
      repository: d.info?.project_urls?.Source || d.info?.project_urls?.Homepage || d.info?.home_page || null,
      similarity: typosquatCheck(pkg, POPULAR.pypiPackages),
      note: PROVENANCE_NOTE,
    };
  }
  return { error: 'ecosystem must be "npm" or "pypi"' };
}

module.exports = { domainProvenance, packageProvenance, PROVENANCE_NOTE };
