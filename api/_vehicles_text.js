/**
 * Text normalisation shared by the vehicles dataset builder (scripts/) and
 * the query-time matcher (api/_vehicles.js). Lives apart from _vehicles.js so
 * the script can require it without loading the datasets.
 */

/** lowercase, accents stripped, anything non-alphanumeric → single space. */
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// marque_produit spellings seen in RappelConso → one slug per brand.
// Anything not listed becomes its own slug (norm → hyphens), so new brands
// still work; this map only merges known variants.
const BRAND_ALIASES = {
  vw: 'volkswagen',
  'mercedes benz': 'mercedes',
  'mercedes amg': 'mercedes',
  mercedes: 'mercedes',
  'ds automobiles': 'ds',
  'citroen ds': 'citroen',
  'citroen et ds automobile': 'citroen',
  'opel vauxhall': 'opel',
  'fiat professional': 'fiat',
  'lexus and toyota': 'toyota',
  'lexus toyota': 'toyota',
  'land rover': 'land-rover',
  'alfa romeo': 'alfa-romeo',
  'harley davidson': 'harley-davidson',
  'can am': 'can-am',
  'renault trucks': 'renault-trucks',
};

/** "citroen, fiat, opel, peugeot" / "opel/vauxhall" / "citroen & ds" → Set of brand slugs. */
function brandSlugs(marque) {
  const out = new Set();
  const parts = String(marque ?? '')
    .toLowerCase()
    .split(/[,/&;]|\bet\b|\band\b/)
    .map((p) => norm(p))
    .filter(Boolean);
  for (const p of parts) {
    const slug = BRAND_ALIASES[p] || p.replace(/ /g, '-');
    out.add(slug);
    // "citroen ds" style doubles name two brands; keep the second too.
    if (p === 'citroen ds' || p === 'citroen et ds automobile') out.add('ds');
    if (p === 'opel vauxhall') out.add('vauxhall');
    if (p === 'lexus and toyota' || p === 'lexus toyota') out.add('lexus');
  }
  return out;
}

/** One brand slug for a caller's query ("VW", "Mercedes-Benz", "land rover"). */
function brandSlug(query) {
  const [first] = [...brandSlugs(query)];
  return first || '';
}

/**
 * The model portion of RappelConso free text: before the vehicle-type keyword
 * ("voiture de tourisme", "véhicule utilitaire léger", "une moto") and any
 * VIN list. Same cut as the sibling site's matcher.
 */
function modelPortion(text) {
  const t = norm(text);
  if (!t) return '';
  const cut = t.search(/\b(voiture|vehicule|fourgonnette|camionnette|une moto|un scooter|moto\b|scooter|quad|niv\b|vin\b|numero|n de serie)\b/);
  return cut >= 0 ? t.slice(0, cut).trim() : t;
}

/** Whole-word occurrence of a normalised alias in normalised text. */
function hasWord(haystack, alias) {
  if (!alias) return false;
  const re = new RegExp(`(?<![a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s')}(?![a-z0-9])`);
  return re.test(haystack);
}

module.exports = { norm, brandSlugs, brandSlug, modelPortion, hasWord, BRAND_ALIASES };
