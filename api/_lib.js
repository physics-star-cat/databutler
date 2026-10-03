/** Shared helpers: CORS, JSON responses, datasets, lookup logic. */
const RATES = require('../data/uk/rates/2026-27.json');
const AQA_GCSE = require('../data/uk/exams/aqa-gcse.json');
const { nearest } = require('./_text');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Protocol-Version',
};

const ATTRIBUTION = {
  attribution: 'databutler.dev',
  docs: 'https://databutler.dev/api',
  note: 'Verified UK public data for AI agents. Every figure carries source + verifiedDate.',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(data));
}

function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return true;
  }
  return false;
}

function queryParams(req) {
  return Object.fromEntries(new URL(req.url, 'https://databutler.dev').searchParams);
}

/** Query values that look like JSON (arrays, objects, numbers, booleans, null) → parsed; the rest stay strings. */
function parseJsonValues(q) {
  const out = {};
  for (const [k, v] of Object.entries(q)) {
    if (typeof v === 'string' && /^[\[{]|^-?\d+(\.\d+)?([eE][-+]?\d+)?$|^(true|false|null)$/.test(v)) {
      try { out[k] = JSON.parse(v); continue; } catch { /* keep string */ }
    }
    out[k] = v;
  }
  return out;
}

/* ---------------- rates ---------------- */

function ratesLookup(category) {
  const cats = RATES.categories;
  if (!category) {
    return {
      taxYear: RATES.taxYear,
      taxYearRuns: RATES.taxYearRuns,
      categories: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, v.title])),
      usage: 'pass category=<key> for figures',
    };
  }
  const key = String(category).toLowerCase().trim();
  const hit = cats[key] || Object.entries(cats).find(([k, v]) =>
    k.includes(key) || v.title.toLowerCase().includes(key))?.[1];
  if (!hit) {
    return {
      covered: false,
      requested: category,
      message: `unknown category "${category}"`,
      nearest: nearest(key, Object.keys(cats)),
      coverage: Object.keys(cats),
    };
  }
  return {
    taxYear: RATES.taxYear,
    taxYearRuns: RATES.taxYearRuns,
    verifiedDate: RATES.verifiedDate,
    ...(typeof hit === 'object' ? hit : cats[key]),
  };
}

/* ---------------- exams ---------------- */

const BOARDS = { aqa: [AQA_GCSE] }; // more boards/levels append here

function normalise(s) {
  return String(s || '').toLowerCase().trim();
}

function findSpecs({ board, subject, level }) {
  let sets = board ? (BOARDS[normalise(board)] || []) : Object.values(BOARDS).flat();
  let specs = sets.flatMap((set) =>
    set.specs.map((sp) => ({ ...sp, board: set.board, level: set.level, verifiedDate: set.verifiedDate })),
  );
  if (subject) {
    const q = normalise(subject);
    specs = specs.filter((sp) => {
      const names = [normalise(sp.subject), ...(sp.subjectAliases || []).map(normalise)];
      return names.some((n) => n.includes(q) || q.includes(n));
    });
  }
  if (level) specs = specs.filter((sp) => normalise(sp.level) === normalise(level));
  return specs;
}

function allSubjects() {
  return [...new Set(findSpecs({}).map((sp) => normalise(sp.subject)))];
}

/** The headline query: which paper is <topic> on, for <board> <subject> <level>? */
function topicLookup({ board, subject, level, topic }) {
  const specs = findSpecs({ board, subject, level });
  if (!specs.length) {
    return {
      covered: false,
      requested: { board, subject, level, topic },
      message: 'no matching spec',
      nearest: {
        boards: nearest(normalise(board), Object.keys(BOARDS)),
        subjects: nearest(normalise(subject), allSubjects()),
      },
      coverage: coverageSummary(),
    };
  }
  const needle = normalise(topic);
  const results = [];
  for (const sp of specs) {
    for (const paper of sp.papers) {
      for (const t of paper.topics) {
        const hay = [normalise(t.name), ...(t.keywords || []).map(normalise)];
        if (hay.some((h) => h.includes(needle) || needle.includes(h))) {
          results.push({
            board: sp.board,
            specCode: sp.specCode,
            subject: sp.subject,
            level: sp.level,
            topic: t.name,
            paper: paper.paper,
            paperDetails: {
              durationMinutes: paper.durationMinutes,
              marks: paper.marks,
              weighting: paper.weighting,
              ...(paper.calculator !== undefined ? { calculator: paper.calculator } : {}),
            },
            siblingTopicsOnPaper: paper.topics.map((x) => x.name).filter((n) => n !== t.name),
            source: sp.specUrl,
            verifiedDate: sp.verifiedDate,
          });
        }
      }
    }
    // Specs with no topic mapping (e.g. maths) still deserve an answer —
    // but only when the caller asked about this subject specifically, so a
    // broad topic search doesn't drag in "any paper" noise.
    if (subject && !sp.papers.some((p) => p.topics.length) && needle) {
      results.push({
        board: sp.board,
        specCode: sp.specCode,
        subject: sp.subject,
        level: sp.level,
        answer: 'any paper',
        notes: sp.notes,
        source: sp.specUrl,
        verifiedDate: sp.verifiedDate,
      });
    }
  }
  if (!results.length) {
    const topicNames = [...new Set(specs.flatMap((sp) => sp.papers.flatMap((p) => p.topics.map((t) => t.name))))];
    return {
      covered: false,
      requested: { board, subject, level, topic },
      message: `topic "${topic}" not found in matched specs`,
      nearest: { topics: nearest(needle, topicNames, 5) },
      matchedSpecs: specs.map((sp) => `${sp.board} ${sp.level} ${sp.subject} (${sp.specCode})`),
      coverage: coverageSummary(),
      hint: 'try a broader keyword, e.g. "electricity", "forces", "ecology"',
    };
  }
  return { query: { board, subject, level, topic }, results };
}

function coverageSummary() {
  return Object.values(BOARDS).flat().flatMap((set) =>
    set.specs.map((sp) => `${set.board} ${set.level} ${sp.subject} (${sp.specCode})`));
}

module.exports = {
  CORS,
  ATTRIBUTION,
  RATES,
  AQA_GCSE,
  sendJson,
  handleOptions,
  queryParams,
  parseJsonValues,
  ratesLookup,
  findSpecs,
  topicLookup,
  coverageSummary,
  BOARDS,
  normalise,
  allSubjects,
};
