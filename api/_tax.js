/**
 * Take-home pay — a live proxy to the LifeByNumbers salary calculators (same
 * operator; the Flask backend behind lifebynumbers.net). Proxy, don't copy:
 * the rate tables stay in one place (flask-backend/app.py), databutler adds
 * the envelope and a uniform shape across countries. 8 s timeout; any failure
 * returns a clean result object (never a throw) so the envelope and
 * isError:false contract hold.
 *
 * Upstream contract (verified with real calls on 2026-10-03):
 *   POST {UPSTREAM}/calculate   Content-Type: application/json
 *   body  { calculatorId: '<cc>-salary', input: { ...fields } }
 *   200   { ...per-country result fields, _cached: bool }
 *   400   { error: 'Unknown calculator: …' | 'Calculator ID is required' }
 *   500   { error: '<python exception text>' }  (e.g. non-numeric salary)
 *
 * Per-country input (field the backend reads → what it defaults to):
 *   uk-salary  grossSalary (annual GBP); taxRegion 'england'|'scotland' (england);
 *              studentLoan none|plan1|plan2|plan4|postgrad (none); pensionPercent (0);
 *              pensionType standard|nhs|teachers (standard); taxCode ('1257L')
 *   us-salary  annualSalary (annual USD; alias grossIncome); filingStatus
 *              single|married_joint|head_of_household (single); state 2-letter (CA);
 *              k401Percent (0); healthInsurancePremium monthly (0)
 *   ca-salary  annualSalary (annual CAD); province 2-letter (ON); rrspContribution % (0)
 *              — note the web UI sends rrspPercent, which the backend ignores
 *   au-salary  annualSalary (annual AUD); residencyStatus resident|non-resident (resident);
 *              hasHelpDebt bool (false) — the web UI sends hasHELP, which the backend ignores
 *   in-salary  annualSalary (annual INR); taxRegime new|old (new); basicPercent (50);
 *              includeEpf (true); deductions80c, deductions80d (0, old regime only)
 *   br-salary  monthlySalary (BRL); dependents (0); useSimplified (false);
 *              include13th (true); includeVacation (true)
 *   pl-salary  monthlySalary (PLN); includePpk (true); ppkRate (0.02); youthRelief (false)
 *   fr-salary  monthlySalary (EUR); taxParts (1); includeMutuelle (true); mutuelleAmount (50)
 *   de-salary  monthlySalary (EUR); taxClass 1-6 (1); churchTax (false);
 *              state 'bavaria'|'other' (other); hasChildren (false)
 *   es-salary  DOES NOT EXIST upstream ("Unknown calculator: es-salary"): the Spain
 *              page computes IRPF client-side in SpainSalaryCalculator.tsx, so Spain
 *              is reported as covered:false here rather than reimplemented.
 *
 * Tax years are the ones hard-coded in app.py at verification time (see
 * COUNTRIES[].taxYear); the backend does not report them, so they must be
 * re-checked whenever LifeByNumbers updates its rates.
 */
const { nearest } = require('./_text');

const UPSTREAM = 'https://i5ekfakccqsvfbpq54infstkca0subvq.lambda-url.us-east-1.on.aws';
const SITE = 'https://www.lifebynumbers.net';
const UA = 'databutler-hub/1.0 (+https://databutler.dev)';
const TIMEOUT_MS = 8000;

// Injectable for tests (offline). Production uses the global fetch.
const deps = { fetch: (...a) => globalThis.fetch(...a) };

const DATA_ORIGIN =
  'Statutory income tax and social-contribution rules as implemented by the LifeByNumbers salary calculators ' +
  '(same operator). Figures are estimates for a single employee on PAYE-style employment income with the stated ' +
  'assumptions, not tax advice — see the calculator page for its method and caveats.';

const US_STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
const CA_PROVINCES = 'AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' ');
const US_FILING = ['single', 'married_joint', 'head_of_household'];

/**
 * One entry per supported country. `period` is the period the upstream
 * calculator works in; `input(gross, a)` builds the upstream input from the
 * gross in that period; `lines` maps upstream fields to breakdown lines
 * (type: tax | social | contribution | repayment); `net` names the upstream
 * net field (in the upstream period). `assumptions` are the defaults this
 * proxy fixes so results are comparable across countries.
 */
const COUNTRIES = {
  uk: {
    name: 'United Kingdom', currency: 'GBP', calculatorId: 'uk-salary', period: 'annual', taxYear: '2025/26',
    page: `${SITE}/uk/calculators/uk-salary`,
    input: (gross, a) => ({ grossSalary: gross, taxRegion: a.region === 'scotland' ? 'scotland' : 'england', studentLoan: 'none', pensionPercent: 0, pensionType: 'standard', taxCode: '1257L' }),
    net: 'annualTakeHome',
    lines: [
      ['incomeTax', 'Income tax', 'tax'],
      ['nationalInsurance', 'National Insurance (Class 1 employee)', 'social'],
      ['pensionContribution', 'Pension contribution', 'contribution'],
      ['studentLoanRepayment', 'Student loan repayment', 'repayment'],
    ],
    extra: (r) => ({ marginalRate: r.marginalRate, employerPensionContribution: r.employerPensionContribution }),
    assumptions: (a) => [
      `tax region: ${a.region === 'scotland' ? 'Scotland (Scottish income tax bands)' : 'England, Wales or Northern Ireland'}`,
      'tax code 1257L (standard Personal Allowance £12,570); no student loan; no pension contributions (set region only — other options exist on the calculator page)',
    ],
  },
  us: {
    name: 'United States', currency: 'USD', calculatorId: 'us-salary', period: 'annual', taxYear: '2026',
    page: `${SITE}/us/calculators/us-salary`,
    input: (gross, a) => ({ annualSalary: gross, filingStatus: a.filingStatus || 'single', state: a.state || 'CA', k401Percent: 0, healthInsurancePremium: 0 }),
    net: 'netAnnual',
    lines: [
      ['federalTax', 'Federal income tax', 'tax'],
      ['stateTax', 'State income tax', 'tax'],
      ['socialSecurity', 'Social Security (FICA)', 'social'],
      ['medicare', 'Medicare (FICA, incl. Additional Medicare)', 'social'],
      ['contribution401k', '401(k) contribution', 'contribution'],
      ['healthInsurance', 'Health insurance premiums (pre-tax)', 'contribution'],
    ],
    assumptions: (a) => [
      `filing status: ${a.filingStatus || 'single'}; standard deduction, no itemising`,
      `state: ${a.state || 'CA (default when omitted)'} — state tax is a simplified flat rate on income after pre-tax deductions, no state standard deduction, no local/city tax`,
      'no 401(k) or health-premium deductions',
    ],
  },
  ca: {
    name: 'Canada', currency: 'CAD', calculatorId: 'ca-salary', period: 'annual', taxYear: '2026',
    page: `${SITE}/ca/calculators/ca-salary`,
    input: (gross, a) => ({ annualSalary: gross, province: a.province || 'ON', rrspContribution: 0 }),
    net: 'netAnnual',
    lines: [
      ['federalTax', 'Federal income tax', 'tax'],
      ['provincialTax', 'Provincial income tax', 'tax'],
      ['cpp', 'CPP contribution', 'social'],
      ['ei', 'EI premium', 'social'],
      ['rrsp', 'RRSP contribution', 'contribution'],
    ],
    assumptions: (a) => [
      `province: ${a.province || 'ON (default when omitted)'} — Ontario uses full 2026 brackets (no surtax); other provinces use a single simplified rate`,
      'federal 2026 brackets and income-tested basic personal amount; CPP and EI use 2025 maxima; no RRSP contributions',
    ],
  },
  au: {
    name: 'Australia', currency: 'AUD', calculatorId: 'au-salary', period: 'annual', taxYear: '2026-27',
    page: `${SITE}/au/calculators/au-salary`,
    input: (gross) => ({ annualSalary: gross, residencyStatus: 'resident', hasHelpDebt: false }),
    net: 'netAnnual',
    lines: [
      ['incomeTax', 'Income tax (after LITO)', 'tax'],
      ['medicareLevy', 'Medicare levy', 'social'],
      ['helpRepayment', 'HELP/HECS repayment', 'repayment'],
    ],
    extra: (r) => ({ lito: r.lito, superannuationEmployer: r.superannuation }),
    assumptions: () => [
      'Australian tax resident claiming the tax-free threshold; 2026-27 resident rates (15% band from 1 July 2026); Low Income Tax Offset applied',
      'Medicare levy single threshold is the 2025-26 figure; no HELP debt; superannuation (12% SG) is employer-paid and reported separately, not deducted',
    ],
  },
  in: {
    name: 'India', currency: 'INR', calculatorId: 'in-salary', period: 'annual', taxYear: 'FY 2026-27',
    page: `${SITE}/in/calculators/in-salary`,
    input: (gross) => ({ annualSalary: gross, taxRegime: 'new', basicPercent: 50, includeEpf: true, deductions80c: 0, deductions80d: 0 }),
    net: 'netAnnual',
    lines: [
      ['incomeTax', 'Income tax (after s.87A rebate)', 'tax'],
      ['surcharge', 'Surcharge', 'tax'],
      ['cess', 'Health and education cess (4%)', 'tax'],
      ['epf', 'Employee Provident Fund (12% of basic)', 'social'],
      ['professionalTax', 'Professional tax', 'tax'],
    ],
    extra: (r) => ({ taxRegime: r.taxRegime, standardDeduction: r.standardDeduction, taxableIncome: r.taxableIncome, employerEpf: r.employerEpf }),
    assumptions: () => [
      'new tax regime (standard deduction ₹75,000; s.87A rebate up to ₹60,000 with marginal relief); old regime not applied',
      'basic salary = 50% of gross; employee EPF 12% of basic included; professional tax ₹2,500/yr above ₹1.8 lakh',
    ],
  },
  br: {
    name: 'Brazil', currency: 'BRL', calculatorId: 'br-salary', period: 'monthly', taxYear: '2026',
    page: `${SITE}/br/calculators/br-salary`,
    input: (gross) => ({ monthlySalary: gross, dependents: 0, useSimplified: false, include13th: false, includeVacation: false }),
    net: 'salarioLiquido',
    lines: [
      ['inss', 'INSS (social security, progressive)', 'social'],
      ['irrf', 'IRRF (income tax withheld, after 2026 redutor)', 'tax'],
    ],
    extra: (r) => ({ irrfBracketRate: r.faixaIrrf, inssCeiling: r.tetoInss }),
    assumptions: () => [
      'CLT employee, no dependents, legal (not simplified) deduction; 2026 INSS brackets and reformed IRRF table with the up-to-R$5,000 exemption redutor',
      'annual figures are 12 × monthly: the statutory 13th salary and 1/3 vacation bonus are excluded (the calculator page includes them by default)',
    ],
  },
  pl: {
    name: 'Poland', currency: 'PLN', calculatorId: 'pl-salary', period: 'monthly', taxYear: '2024/2025',
    page: `${SITE}/pl/calculators/pl-salary`,
    input: (gross) => ({ monthlySalary: gross, includePpk: false, ppkRate: 0.02, youthRelief: false }),
    net: 'wynagrodzeniNetto',
    lines: [
      ['zusEmerytalne', 'ZUS pension (emerytalne, 9.76%)', 'social'],
      ['zusRentowe', 'ZUS disability (rentowe, 1.5%)', 'social'],
      ['zusChorobowe', 'ZUS sickness (chorobowe, 2.45%)', 'social'],
      ['nfz', 'NFZ health insurance (9%)', 'social'],
      ['pit', 'PIT income tax', 'tax'],
      ['ppkEmployee', 'PPK employee contribution', 'contribution'],
    ],
    extra: (r) => ({ pitRate: r.stawkaPit, taxFreeAmount: r.kwotaWolna, employerCostMonthly: r.kosztPracodawcy }),
    assumptions: () => [
      'umowa o pracę (employment contract), over 26 (no youth relief), 12%/32% PIT with 30,000 PLN tax-free amount; no PPK',
      'rates as implemented upstream for 2024/2025 (the ZUS annual cap 234,720 PLN is the 2024 figure); the monthly 30% ZUS cap is not applied',
    ],
  },
  fr: {
    name: 'France', currency: 'EUR', calculatorId: 'fr-salary', period: 'monthly', taxYear: '2024',
    page: `${SITE}/fr/calculators/fr-salary`,
    input: (gross) => ({ monthlySalary: gross, taxParts: 1, includeMutuelle: false, mutuelleAmount: 0 }),
    net: 'salaireNet',
    lines: [
      ['assuranceVieillesse', 'Old-age insurance (assurance vieillesse)', 'social'],
      ['retraiteComplementaire', 'Supplementary pension (AGIRC-ARRCO)', 'social'],
      ['csgDeductible', 'CSG (deductible)', 'social'],
      ['csgNonDeductible', 'CSG (non-deductible)', 'social'],
      ['crds', 'CRDS', 'social'],
      ['prevoyance', 'Prévoyance', 'social'],
      ['mutuelle', 'Mutuelle (complementary health)', 'contribution'],
      ['impotSurRevenu', 'Income tax (prélèvement à la source)', 'tax'],
    ],
    extra: (r) => ({ taxableNetMonthly: r.revenuNetImposable, employerCostMonthly: r.coutEmployeur }),
    assumptions: () => [
      'single person, 1 part fiscale (quotient familial), cadre/non-cadre average employee contribution rates; no mutuelle',
      '2024 income-tax brackets and 2024 social-security ceiling (3,864 €/month) as implemented upstream',
    ],
  },
  de: {
    name: 'Germany', currency: 'EUR', calculatorId: 'de-salary', period: 'monthly', taxYear: '2026',
    page: `${SITE}/de/calculators/de-salary`,
    input: (gross) => ({ monthlySalary: gross, taxClass: 1, churchTax: false, state: 'other', hasChildren: false }),
    net: 'nettolohn',
    lines: [
      ['krankenversicherung', 'Health insurance (Krankenversicherung)', 'social'],
      ['pflegeversicherung', 'Care insurance (Pflegeversicherung)', 'social'],
      ['rentenversicherung', 'Pension insurance (Rentenversicherung)', 'social'],
      ['arbeitslosenversicherung', 'Unemployment insurance (Arbeitslosenversicherung)', 'social'],
      ['lohnsteuer', 'Income tax (Lohnsteuer)', 'tax'],
      ['solidaritaetszuschlag', 'Solidarity surcharge (Soli)', 'tax'],
      ['kirchensteuer', 'Church tax (Kirchensteuer)', 'tax'],
    ],
    extra: (r) => ({ taxClass: r.steuerklasse, basicAllowance: r.grundfreibetrag, employerCostMonthly: r.arbeitgeberkosten }),
    assumptions: () => [
      'Steuerklasse 1, no church tax, childless (2.4% care-insurance employee share), statutory health insurance with the 2.9% average Zusatzbeitrag',
      '2026 §32a EStG tariff (Grundfreibetrag 12,348 €) and 2026 contribution ceilings',
    ],
  },
  es: {
    name: 'Spain', currency: 'EUR', calculatorId: null, period: 'annual', taxYear: '2025',
    page: `${SITE}/es/calculators/es-salary`,
  },
};

const COUNTRY_CODES = Object.keys(COUNTRIES);
const PERIODS = ['annual', 'monthly'];

async function upstreamPost(body) {
  const url = `${UPSTREAM}/calculate`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await deps.fetch(url, {
      method: 'POST', signal: controller.signal, body: JSON.stringify(body),
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
    });
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    return { url, status: r.status, ok: r.ok, body: json };
  } catch (e) {
    return { url, status: 0, ok: false, body: null, failure: e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
const both = (annual) => ({ annual: round2(annual), monthly: round2(annual / 12) });
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

function provenance(c, res) {
  return {
    attribution: 'lifebynumbers.net', link: c.page, docs: `${SITE}/`, calculatorId: c.calculatorId,
    ...(res ? { requested: res.url } : {}),
  };
}

/**
 * take_home_pay({ country, gross, period, state, filingStatus, region, province })
 * gross is in `period` (default annual); every figure in the result is given
 * both annual and monthly.
 */
async function takeHomePay(args = {}) {
  const code = String(args.country || '').toLowerCase().trim();
  const c = COUNTRIES[code];
  if (!c) {
    return {
      covered: false, requested: { country: args.country }, message: code ? `unknown country "${args.country}"` : 'pass country and gross',
      nearest: code ? nearest(code, COUNTRY_CODES) : [], coverage: COUNTRY_CODES,
      example: { country: 'uk', gross: 50000 },
    };
  }
  const period = args.period === undefined || args.period === null || args.period === '' ? 'annual' : String(args.period).toLowerCase();
  if (!PERIODS.includes(period)) {
    return { covered: false, requested: { period: args.period }, message: `period must be one of ${PERIODS.join(', ')}`, coverage: PERIODS };
  }
  const gross = Number(args.gross);
  if (!Number.isFinite(gross) || gross <= 0) {
    return { covered: false, requested: { gross: args.gross }, message: 'gross must be a positive number (salary in local currency)', example: { country: code, gross: 50000 } };
  }
  const invalid = validateExtras(code, args);
  if (invalid) return invalid;

  if (!c.calculatorId) {
    return {
      covered: false, country: code, countryName: c.name, currency: c.currency,
      message: 'Spain is not computed by the LifeByNumbers backend: its salary page calculates IRPF client-side, so there is no verified upstream figure to proxy.',
      hint: `open ${c.page} for the interactive Spain calculator, or use another country code`,
      coverage: COUNTRY_CODES.filter((k) => COUNTRIES[k].calculatorId),
      source: c.page, upstreamProvenance: provenance(c, null),
    };
  }

  const annualGross = period === 'monthly' ? gross * 12 : gross;
  const upstreamGross = c.period === 'monthly' ? annualGross / 12 : annualGross;
  const res = await upstreamPost({ calculatorId: c.calculatorId, input: c.input(upstreamGross, args) });
  return shape(c, code, res, { gross, period, annualGross, args });
}

function validateExtras(code, a) {
  const bad = (field, value, allowed) => ({
    covered: false, requested: { country: code, [field]: value }, message: `${field} "${value}" is not valid for ${code}`,
    nearest: nearest(String(value), allowed), coverage: allowed,
  });
  if (code === 'us') {
    if (a.state !== undefined && a.state !== null && a.state !== '' && !US_STATES.includes(String(a.state).toUpperCase())) return bad('state', a.state, US_STATES);
    if (a.filingStatus !== undefined && a.filingStatus !== null && a.filingStatus !== '' && !US_FILING.includes(String(a.filingStatus).toLowerCase())) return bad('filingStatus', a.filingStatus, US_FILING);
    if (a.state) a.state = String(a.state).toUpperCase();
    if (a.filingStatus) a.filingStatus = String(a.filingStatus).toLowerCase();
  }
  if (code === 'ca') {
    if (a.province !== undefined && a.province !== null && a.province !== '' && !CA_PROVINCES.includes(String(a.province).toUpperCase())) return bad('province', a.province, CA_PROVINCES);
    if (a.province) a.province = String(a.province).toUpperCase();
  }
  if (code === 'uk' && a.region !== undefined && a.region !== null && a.region !== '') {
    const r = String(a.region).toLowerCase();
    const allowed = ['england', 'scotland', 'wales', 'northern-ireland'];
    if (!allowed.includes(r)) return bad('region', a.region, allowed);
    a.region = r;
  }
  return null;
}

/** Shape any upstream outcome into one result object. */
function shape(c, code, res, { gross, period, annualGross, args }) {
  const upstream = provenance(c, res);
  if (res.failure || res.status === 0) {
    return {
      error: 'upstream unavailable', upstream: 'lifebynumbers.net', reason: res.failure || 'no response',
      retry: true, message: `lifebynumbers.net did not answer within ${TIMEOUT_MS / 1000}s — retry shortly, or use the calculator at ${c.page} directly.`,
      source: c.page, upstreamProvenance: upstream,
    };
  }
  if (!res.ok || !res.body || typeof res.body !== 'object' || res.body.error) {
    const upstreamError = (res.body && res.body.error) || null;
    return {
      error: `upstream HTTP ${res.status}`, upstream: 'lifebynumbers.net', ...(upstreamError ? { upstreamError } : {}),
      retry: res.status >= 500 || res.status === 429, source: c.page, upstreamProvenance: upstream,
    };
  }
  const { _cached, ...raw } = res.body;
  const toAnnual = c.period === 'monthly' ? 12 : 1;
  const netAnnual = num(raw[c.net]) * toAnnual;
  const breakdown = c.lines.map(([key, label, type]) => ({ key, label, type, ...both(num(raw[key]) * toAnnual) }));
  const deductionsAnnual = annualGross - netAnnual;
  const linesSum = breakdown.reduce((s, l) => s + l.annual, 0);
  const reconciled = Math.abs(linesSum - deductionsAnnual) < 1;
  return {
    country: code, countryName: c.name, currency: c.currency, taxYear: c.taxYear,
    input: { gross, period },
    gross: both(annualGross),
    net: both(netAnnual),
    totalDeductions: both(deductionsAnnual),
    effectiveRate: annualGross > 0 ? Math.round((deductionsAnnual / annualGross) * 1000) / 10 : 0,
    effectiveRateDefinition: 'total deductions (taxes, social contributions, repayments) as a percentage of gross; the upstream calculator may define its own rate differently',
    breakdown,
    ...(reconciled ? {} : { breakdownNote: 'breakdown lines do not sum exactly to totalDeductions (upstream rounding or an unlisted item); totalDeductions = gross − net is authoritative' }),
    ...(c.extra ? { details: c.extra(raw) } : {}),
    assumptions: c.assumptions(args),
    upstreamResult: raw,
    source: c.page,
    dataOrigin: DATA_ORIGIN,
    upstreamProvenance: upstream,
  };
}

module.exports = { takeHomePay, COUNTRIES, COUNTRY_CODES, PERIODS, US_STATES, CA_PROVINCES, US_FILING, deps, UPSTREAM, SITE, UA, TIMEOUT_MS };
