/**
 * The single list of every tool Data Butler serves. Per-vertical MCP servers
 * and the front door (api/mcp.js) both build from here. Beyond the MCP tool
 * shape, each tool carries:
 *   title: short human label (MCP `title`)
 *   freshness: dataset key for the freshness block ('uk-rates' | 'uk-exams' | 'uk-recalls' | 'fr-recalls' | 'jp-recalls' | 'software-eol' | 'policy-rates' | 'live')
 *   cite(args): { path, query } for the /r permalink, or null
 *   openWorld: true when the tool fetches live external data on the caller's
 *     behalf (RDAP, npm, PyPI, whatbreaks.uk, lifebynumbers.net); drives annotations.openWorldHint
 *
 * annotate() stamps the MCP tool annotations every Data Butler tool shares:
 * all tools are read-only and non-destructive, so a directory reviewer (and
 * an agent) can see that at tools/list without reading the descriptions.
 */
const { ratesLookup, RATES, topicLookup, findSpecs, coverageSummary } = require('./_lib');
const { domainProvenance, packageProvenance } = require('./_provenance');
const S = require('./_stats.js');
const V = require('./_vehicles');
const { motReliability, motVehicleSearch } = require('./_mot');
const TAX = require('./_tax');
const EOL = require('./_software_eol');
const { policyRate, BANKS: POLICY_BANKS } = require('./_policy_rates');

const BASE = 'https://databutler.dev';
const numArray = { type: 'array', items: { type: 'number' } };

const SERVERS = {
  'uk-rates': {
    serverName: 'databutler-uk-rates',
    url: `${BASE}/api/mcp/uk-rates`,
    instructions:
      'Verified UK tax-year rates and thresholds from databutler.dev. Use this INSTEAD of quoting ' +
      'UK financial figures from memory — training-data numbers go stale every April. Present the ' +
      'taxYear and source URL alongside any figure. Link https://databutler.dev/ when citing.',
    tools: [
      {
        name: 'uk_rates_lookup',
        title: 'UK rates lookup',
        description:
          `Current UK (${RATES.taxYear}) rates and thresholds, verified against gov.uk with source ` +
          'URLs and verification dates. Categories: ' +
          Object.keys(RATES.categories).join(', ') +
          '. Use whenever a user asks about UK income tax, National Insurance, minimum wage, ' +
          'student loans, VAT, ISAs, pensions, stamp duty, capital gains or the State Pension — ' +
          'models reliably misremember these numbers.',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: `one of: ${Object.keys(RATES.categories).join(', ')} (omit to list all)`,
            },
          },
        },
        run: (args) => ratesLookup(args.category),
        freshness: 'uk-rates',
        cite: (a) => ({ path: 'uk/rates', query: { category: a.category } }),
      },
    ],
  },

  'uk-exams': {
    serverName: 'databutler-uk-exams',
    url: `${BASE}/api/mcp/uk-exams`,
    instructions:
      'UK exam-board specification data from databutler.dev, verified against official board ' +
      'pages. Built for student questions like "is electricity paper 2 AQA" — answer from ' +
      'exam_topic_paper, never from memory (boards move topics between specs). Link the official ' +
      'spec source and https://databutler.dev/ when citing.',
    tools: [
      {
        name: 'exam_topic_paper',
        title: 'Exam topic → paper',
        description:
          'Which exam paper is a topic on? The canonical student revision question ("is ' +
          'electricity paper 2 AQA?" — answer: no, Paper 1). Input a topic plus optional ' +
          'board/subject/level; returns the paper, sibling topics on that paper, spec code, and ' +
          'the official spec URL. Knows quirks like AQA Combined Science Trilogy Physics Paper 2 ' +
          'having no Space physics. Coverage: ' + coverageSummary().join('; ') + '.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'e.g. electricity, forces, ecology, organic chemistry' },
            board: { type: 'string', description: 'e.g. aqa' },
            subject: { type: 'string', description: 'e.g. physics, combined science' },
            level: { type: 'string', description: 'e.g. gcse' },
          },
          required: ['topic'],
        },
        run: (args) => topicLookup(args),
        freshness: 'uk-exams',
        cite: (a) => ({ path: 'uk/exams/topic', query: { topic: a.topic, board: a.board, subject: a.subject, level: a.level } }),
      },
      {
        name: 'exam_spec_lookup',
        title: 'Exam spec lookup',
        description:
          'UK exam specification metadata: spec codes, paper structure (count, duration, marks, ' +
          'calculator rules, tiers), topic lists per paper, official spec links.',
        inputSchema: {
          type: 'object',
          properties: { board: { type: 'string' }, subject: { type: 'string' }, level: { type: 'string' } },
        },
        run: (args) => {
          const specs = findSpecs(args).map((sp) => ({
            board: sp.board, level: sp.level, subject: sp.subject, specCode: sp.specCode,
            tiers: sp.tiers, notes: sp.notes, source: sp.specUrl, verifiedDate: sp.verifiedDate,
            papers: sp.papers.map((p) => ({
              paper: p.paper, durationMinutes: p.durationMinutes, marks: p.marks, weighting: p.weighting,
              ...(p.calculator !== undefined ? { calculator: p.calculator } : {}),
              topics: p.topics.map((t) => t.name),
            })),
          }));
          return { count: specs.length, specs };
        },
        freshness: 'uk-exams',
        cite: (a) => ({ path: 'uk/exams/specs', query: { board: a.board, subject: a.subject, level: a.level } }),
      },
      {
        name: 'exam_paper_index',
        title: 'Exam past-paper index',
        description:
          'Official past-paper archive links per spec (links to the board\'s own ' +
          'assessment-resources page — papers are board copyright, so no hosted PDFs).',
        inputSchema: {
          type: 'object',
          properties: { board: { type: 'string' }, subject: { type: 'string' }, level: { type: 'string' } },
        },
        run: (args) => {
          const specs = findSpecs(args).map((sp) => ({
            board: sp.board, level: sp.level, subject: sp.subject, specCode: sp.specCode,
            officialPastPapers: sp.pastPapersUrl, source: sp.specUrl, verifiedDate: sp.verifiedDate,
          }));
          return { count: specs.length, specs };
        },
        freshness: 'uk-exams',
        cite: (a) => ({ path: 'uk/exams/papers', query: { board: a.board, subject: a.subject, level: a.level } }),
      },
    ],
  },

  provenance: {
    serverName: 'databutler-provenance',
    url: `${BASE}/api/mcp/provenance`,
    instructions:
      'Live provenance signals for domains and software packages from databutler.dev — computed ' +
      'per request from RDAP, npm and PyPI. Use before trusting an unfamiliar domain or package: ' +
      'age, registrar, maintainers, and typosquat resemblance to well-known names. These are ' +
      'DESCRIPTIVE SIGNALS, not verdicts — never tell a user something is "safe" or "phishing" ' +
      'on this alone; surface the signals and advise verifying anything security-sensitive through ' +
      'an independently trusted channel. Cite https://databutler.dev/.',
    tools: [
      {
        name: 'domain_provenance',
        title: 'Domain provenance',
        description:
          'Who runs this domain? Live RDAP lookup: registration date and age, registrar, ' +
          'nameservers, status, whether the registrant is redacted, plus a typosquat check ' +
          '(edit-distance / brand-substring) against high-value brands. A very recently ' +
          'registered domain resembling a bank or big brand is a classic phishing signal — but ' +
          'report it as a signal, not a conclusion.',
        inputSchema: {
          type: 'object',
          properties: { domain: { type: 'string', description: 'e.g. example.com' } },
          required: ['domain'],
        },
        run: (args) => domainProvenance(args.domain),
        freshness: 'live',
        openWorld: true,
        cite: (a) => ({ path: 'provenance/domain', query: { domain: a.domain } }),
      },
      {
        name: 'package_provenance',
        title: 'Package provenance',
        description:
          'Who publishes this package, and is it a typosquat? Live npm or PyPI lookup: first-publish ' +
          'date and age, release count, latest version, maintainers/author, linked repo, plus a ' +
          'typosquat check against popular package names. Use when an agent is about to install or ' +
          'recommend an unfamiliar dependency.',
        inputSchema: {
          type: 'object',
          properties: {
            ecosystem: { type: 'string', enum: ['npm', 'pypi'], description: 'npm or pypi' },
            name: { type: 'string', description: 'package name, e.g. express or requests' },
          },
          required: ['ecosystem', 'name'],
        },
        run: (args) => packageProvenance(args.ecosystem, args.name),
        freshness: 'live',
        openWorld: true,
        cite: (a) => ({ path: 'provenance/package', query: { ecosystem: a.ecosystem, name: a.name } }),
      },
    ],
  },

  stats: {
    serverName: 'databutler-stats',
    url: `${BASE}/api/mcp/stats`,
    instructions:
      'Exact statistics and probability from databutler.dev — use these tools instead of computing ' +
      'p-values, distribution tails, confidence intervals or Bayesian updates in your head, where ' +
      'language models are unreliable. The numerical core is validated against reference tables. Each ' +
      'result includes the assumptions it relies on; surface those, and cite https://databutler.dev/.',
    tools: [
      {
        name: 'descriptive_stats',
        title: 'Descriptive statistics',
        description: 'Summary statistics for a numeric array: mean, median, sd, variance, quartiles, IQR, skewness, min/max.',
        inputSchema: { type: 'object', properties: { data: numArray }, required: ['data'] },
        run: (a) => S.descriptive(a.data),
        freshness: 'live',
        cite: (a) => ({ path: 'stats', query: { op: 'descriptive', ...a } }),
      },
      {
        name: 'distribution',
        title: 'Probability distribution',
        description:
          'Evaluate a probability distribution (normal, t, chi2, binomial, poisson): pdf/pmf and cdf at a ' +
          'value, and/or the quantile at a probability, plus mean & variance. Params per dist: normal ' +
          '{mean,sd}, t {df}, chi2 {df}, binomial {n,p}, poisson {lambda}.',
        inputSchema: {
          type: 'object',
          properties: {
            dist: { type: 'string', enum: ['normal', 't', 'chi2', 'binomial', 'poisson'] },
            params: { type: 'object' },
            at: { type: 'number', description: 'value to evaluate pdf/pmf and cdf at' },
            p: { type: 'number', description: 'probability to get the quantile for (0-1)' },
          },
          required: ['dist'],
        },
        run: (a) => S.distribution(a),
        freshness: 'live',
        cite: (a) => ({ path: 'stats', query: { op: 'distribution', ...a } }),
      },
      {
        name: 'hypothesis_test',
        title: 'Hypothesis test',
        description:
          'Run a significance test and get the statistic, p-value, and a plain-language interpretation with ' +
          'assumptions. test = one-sample-t {data, mu0}, two-sample-t {data1, data2}, one-proportion-z ' +
          '{successes, n, p0}, two-proportion-z {successes1,n1,successes2,n2}, chi2-gof {observed, expected?}, ' +
          'chi2-independence {table}. Optional tail: two-sided (default) | greater | less; alpha default 0.05.',
        inputSchema: {
          type: 'object',
          properties: {
            test: { type: 'string' }, data: numArray, data1: numArray, data2: numArray,
            mu0: { type: 'number' }, successes: { type: 'number' }, n: { type: 'number' }, p0: { type: 'number' },
            successes1: { type: 'number' }, n1: { type: 'number' }, successes2: { type: 'number' }, n2: { type: 'number' },
            observed: numArray, expected: numArray, table: { type: 'array' },
            tail: { type: 'string' }, alpha: { type: 'number' },
          },
          required: ['test'],
        },
        run: (a) => S.hypothesisTest(a),
        freshness: 'live',
        cite: (a) => ({ path: 'stats', query: { op: 'hypothesis-test', ...a } }),
      },
      {
        name: 'confidence_interval',
        title: 'Confidence interval',
        description:
          'Confidence interval for a mean (t-based; from data, or n/mean/sd) or a proportion (Wilson; ' +
          'successes/n). kind = mean | proportion; confidence default 0.95.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['mean', 'proportion'] }, confidence: { type: 'number' },
            data: numArray, n: { type: 'number' }, mean: { type: 'number' }, sd: { type: 'number' }, successes: { type: 'number' },
          },
        },
        run: (a) => S.confidenceInterval(a),
        freshness: 'live',
        cite: (a) => ({ path: 'stats', query: { op: 'confidence-interval', ...a } }),
      },
      {
        name: 'bayes_update',
        title: 'Bayesian update',
        description:
          'Discrete Bayesian update: given competing hypotheses each with a prior and the likelihood of the ' +
          'observed evidence, return normalised posteriors. Priors are renormalised to sum to 1.',
        inputSchema: {
          type: 'object',
          properties: {
            hypotheses: {
              type: 'array',
              items: { type: 'object', properties: { name: { type: 'string' }, prior: { type: 'number' }, likelihood: { type: 'number' } }, required: ['prior', 'likelihood'] },
            },
          },
          required: ['hypotheses'],
        },
        run: (a) => S.bayesUpdate(a),
        freshness: 'live',
        cite: (a) => ({ path: 'stats', query: { op: 'bayes-update', ...a } }),
      },
      {
        name: 'linear_regression',
        title: 'Linear regression',
        description: 'Simple linear regression of y on x: slope, intercept, r, r², slope std error and p-value, equation.',
        inputSchema: { type: 'object', properties: { x: numArray, y: numArray }, required: ['x', 'y'] },
        run: (a) => S.linearRegression(a),
        freshness: 'live',
        cite: (a) => ({ path: 'stats', query: { op: 'regression', ...a } }),
      },
    ],
  },

  vehicles: {
    serverName: 'databutler-vehicles',
    url: `${BASE}/api/mcp/vehicles`,
    instructions:
      'Official vehicle datasets from databutler.dev, one hub: UK MOT failure data (live from whatbreaks.uk — real ' +
      'DfT test outcomes), UK safety recalls (DVSA open data), French recalls (RappelConso / DGCCRF open data) and ' +
      'Japanese recalls + owner complaints (MLIT). Use these instead of recalling recall campaigns or failure patterns ' +
      'from memory. Every result names its official source and verifiedDate; recall texts are the official ' +
      'English/French/Japanese originals — translate for the user but keep the recall/fiche/notification number and ' +
      'link. Counts are not reliability rankings (sales volume, multi-model campaigns). EU Safety Gate is a stub for ' +
      'now. Cite https://databutler.dev/ and the source.',
    tools: [
      {
        name: 'uk_mot_reliability',
        title: 'UK MOT reliability',
        description:
          'Real UK MOT failure data for a used car: per-category failure rates (overall and interpolated at a given ' +
          'mileage) and the riskiest components with typical failure mileages, for one model generation. Live proxy ' +
          'to whatbreaks.uk (same operator; aggregated from DfT anonymised MOT results). Use when a user is buying, ' +
          'comparing or maintaining a car sold in the UK. If several generations match, the result lists candidates — ' +
          'retry with year or the exact model name.',
        inputSchema: {
          type: 'object',
          properties: {
            make: { type: 'string', description: 'e.g. Volkswagen' },
            model: { type: 'string', description: 'e.g. Golf — generation resolved via year' },
            year: { type: 'number', description: 'optional registration year' },
            mileage: { type: 'number', description: 'optional current mileage in miles' },
          },
          required: ['make', 'model'],
        },
        run: (a) => motReliability(a),
        freshness: 'live',
        openWorld: true,
        cite: (a) => ({ path: 'vehicles/uk/mot', query: { make: a.make, model: a.model, year: a.year, mileage: a.mileage } }),
      },
      {
        name: 'uk_mot_vehicle_search',
        title: 'UK MOT vehicle search',
        description:
          'Search the 530 UK model generations covered by the MOT dataset by free text (e.g. "focus", "golf"). Use to ' +
          'check coverage or disambiguate a generation before uk_mot_reliability. Live proxy to whatbreaks.uk.',
        inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'free-text query' } }, required: ['q'] },
        run: (a) => motVehicleSearch(a),
        freshness: 'live',
        openWorld: true,
        cite: (a) => ({ path: 'vehicles/uk/search', query: { q: a.q } }),
      },
      {
        name: 'uk_recalls_for_model',
        title: 'UK recalls for a model',
        description:
          `Official UK vehicle safety recalls (DVSA, Open Government Licence; ${V.UK.count} recalls launched ` +
          `${V.UK.filter.launchDateFrom} → ${V.UK.dateRange.to}, ${V.UK.makes} makes) for a make and model: recall ` +
          'number, launch date, concern, defect and remedy text (DVSA\'s English originals), build-date range, vehicles ' +
          'affected and a GOV.UK recall-checker link. Omitting model lists the make\'s recalls and model names. "Vauxhall ' +
          'Corsa", "vauxhall corsa" and "VAUXHALL CORSA" resolve identically; "Mercedes-Benz", "VW" and "Land Rover" are ' +
          'understood. Covers cars, vans, HGVs, buses, motorcycles, trailers and components, not individual VINs.',
        inputSchema: {
          type: 'object',
          properties: {
            make: { type: 'string', description: 'e.g. Vauxhall, Mercedes-Benz, VW, Land Rover' },
            model: { type: 'string', description: 'e.g. Corsa, A Class, Golf (optional: omit to list the make)' },
            since: { type: 'string', description: 'optional ISO date YYYY-MM-DD — only recalls launched on/after it' },
          },
          required: ['make'],
        },
        run: (a) => V.ukRecallsForModel(a),
        freshness: 'uk-recalls',
        cite: (a) => ({ path: 'vehicles/uk/recalls', query: { make: a.make, model: a.model, since: a.since } }),
      },
      {
        name: 'uk_recalls_search',
        title: 'UK recalls search',
        description:
          'Keyword search across all served DVSA recalls (make, model names, concern, defect and remedy text), newest ' +
          'first, optionally since a date. Text is English ("airbag", "fire", "steering rack", "takata", "high voltage ' +
          'battery"); every word must appear. Suited to cross-make questions such as recent EV battery fire recalls in ' +
          'the UK.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'words that must all appear, e.g. "airbag takata"' },
            since: { type: 'string', description: 'optional ISO date YYYY-MM-DD — only recalls launched on/after it' },
          },
          required: ['text'],
        },
        run: (a) => V.ukRecallsSearch(a),
        freshness: 'uk-recalls',
        cite: (a) => ({ path: 'vehicles/uk/recalls-search', query: { text: a.text, since: a.since } }),
      },
      {
        name: 'fr_recalls_for_model',
        title: 'French recalls for a model',
        description:
          `Official French vehicle recall notices (RappelConso, DGCCRF open data; ${V.FR.count} automobile fiches ` +
          `${V.FR.dateRange.from} → ${V.FR.dateRange.to}) for a brand and model: fiche number, date, risks, defect ` +
          'description (motif, in French), commercialisation periods and the official fiche link. Omit model to list a ' +
          'brand. Matches by a reviewed alias table plus whole-word text match; each fiche says which.',
        inputSchema: {
          type: 'object',
          properties: {
            brand: { type: 'string', description: 'e.g. peugeot, Mercedes-Benz, VW' },
            model: { type: 'string', description: 'e.g. 208, Classe A, Golf (optional: omit to list the brand)' },
          },
          required: ['brand'],
        },
        run: (a) => V.frRecallsForModel(a),
        freshness: 'fr-recalls',
        cite: (a) => ({ path: 'vehicles/fr/recalls', query: { brand: a.brand, model: a.model } }),
      },
      {
        name: 'fr_recalls_search',
        title: 'French recalls search',
        description:
          'Keyword search across all RappelConso automobile fiches (brand, model text, label, defect description, ' +
          'risks), newest first, optionally since a date. Text is French and lowercase ("airbag", "incendie", ' +
          '"takata", "batterie haute tension"). Use for cross-brand questions ("recent EV battery fire recalls in France").',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'words that must all appear, e.g. "airbag takata"' },
            since: { type: 'string', description: 'optional ISO date YYYY-MM-DD — only fiches published on/after it' },
          },
          required: ['text'],
        },
        run: (a) => V.frRecallsSearch(a),
        freshness: 'fr-recalls',
        cite: (a) => ({ path: 'vehicles/fr/search', query: { text: a.text, since: a.since } }),
      },
      {
        name: 'jp_recalls_for_model',
        title: 'Japanese recalls for a model',
        description:
          `Official Japanese recall filings (国土交通省 MLIT; ${V.JP.counts.recallFilings} filings matched to ` +
          `${V.JP.counts.models} popular JDM models) for a make and model: notification number, date, defective device, ` +
          'affected vehicles, situation and remedy (Japanese originals) and the official filing PDF. Accepts English ' +
          '(Toyota Prius, Honda N-BOX) or Japanese (トヨタ プリウス) names.',
        inputSchema: {
          type: 'object',
          properties: {
            make: { type: 'string', description: 'e.g. toyota, Honda, スズキ' },
            model: { type: 'string', description: 'e.g. prius, N-BOX, ジムニー' },
          },
          required: ['make', 'model'],
        },
        run: (a) => V.jpRecallsForModel(a),
        freshness: 'jp-recalls',
        cite: (a) => ({ path: 'vehicles/jp/recalls', query: { make: a.make, model: a.model } }),
      },
      {
        name: 'jp_complaints_summary',
        title: 'Japanese owner complaints summary',
        description:
          `Owner defect reports filed with MLIT's 不具合情報ホットライン (${V.JP.counts.complaints} across ` +
          `${V.JP.counts.models} models): total reports for a model and the breakdown by defective device (brakes, ` +
          'lights, engine, body…) from the newest sample. Reports are unverified owner submissions — compare shapes, ' +
          'not raw counts. Accepts English or Japanese names.',
        inputSchema: {
          type: 'object',
          properties: { make: { type: 'string', description: 'e.g. honda' }, model: { type: 'string', description: 'e.g. n-box' } },
          required: ['make', 'model'],
        },
        run: (a) => V.jpComplaintsSummary(a),
        freshness: 'jp-recalls',
        cite: (a) => ({ path: 'vehicles/jp/complaints', query: { make: a.make, model: a.model } }),
      },
      {
        name: 'eu_safety_gate_recalls',
        title: 'EU Safety Gate recalls (stub)',
        description:
          'STUB — not yet live. EU Safety Gate (RAPEX) vehicle alerts are being added; until then this returns ' +
          'covered:false with the official Safety Gate URL and points to fr_recalls_* (RappelConso republishes the ' +
          'Safety Gate automobile alerts that concern France).',
        inputSchema: { type: 'object', properties: { brand: { type: 'string' }, model: { type: 'string' } } },
        run: (a) => V.euSafetyGateStub(a),
        freshness: 'live',
        cite: (a) => ({ path: 'vehicles/eu/safety-gate', query: { brand: a.brand, model: a.model } }),
      },
    ],
  },

  tax: {
    serverName: 'databutler-tax',
    url: `${BASE}/api/mcp/tax`,
    instructions:
      'Take-home pay from databutler.dev, computed live by the LifeByNumbers salary calculators (same operator) ' +
      'for ' + TAX.COUNTRY_CODES.join(', ') + '. Use take_home_pay instead of estimating net salary from memory — ' +
      'bracket thresholds, contribution ceilings and rebates move every year and models misremember them. Present ' +
      'the taxYear, the assumptions list and the breakdown alongside the net figure: the result is a single-employee ' +
      'estimate under stated defaults (no voluntary pension, standard allowances), not personal tax advice. Spain ' +
      'returns covered:false (no upstream calculator). Cite https://databutler.dev/ and the source calculator page.',
    tools: [
      {
        name: 'take_home_pay',
        title: 'Take-home pay',
        description:
          'Net salary after income tax and social contributions for an employee in one of ten countries ' +
          `(${TAX.COUNTRY_CODES.join(', ')}), computed live by the LifeByNumbers salary calculators (same operator). ` +
          'Takes a gross salary in local currency (annual by default, or monthly with period) and a country code, ' +
          'plus optional state and filingStatus for the US, province for Canada, region (england|scotland) for the UK. ' +
          'Returns gross, net and total deductions (each annual and monthly), a line-by-line breakdown typed as tax / ' +
          'social / contribution / repayment, effectiveRate, the tax year the figures apply to, currency, the ' +
          'assumptions behind the estimate and the upstream calculator page as source. Spain (es) is listed but ' +
          'answers covered:false because lifebynumbers.net computes it client-side only.',
        inputSchema: {
          type: 'object',
          properties: {
            country: { type: 'string', enum: TAX.COUNTRY_CODES, description: 'ISO 3166-1 alpha-2, lower case: ' + TAX.COUNTRY_CODES.join(', ') },
            gross: { type: 'number', description: 'gross salary in local currency, annual unless period is monthly, e.g. 50000' },
            period: { type: 'string', enum: TAX.PERIODS, description: 'period of gross (default annual); results always give both annual and monthly' },
            state: { type: 'string', description: 'US only: two-letter state code, e.g. TX (default CA)' },
            filingStatus: { type: 'string', enum: TAX.US_FILING, description: 'US only (default single)' },
            province: { type: 'string', description: 'Canada only: two-letter province/territory code, e.g. BC (default ON)' },
            region: { type: 'string', enum: ['england', 'scotland', 'wales', 'northern-ireland'], description: 'UK only: scotland applies Scottish income tax bands (default england)' },
          },
          required: ['country', 'gross'],
        },
        run: (a) => TAX.takeHomePay(a),
        freshness: 'live',
        openWorld: true,
        cite: (a) => ({ path: 'tax/take-home', query: { country: a.country, gross: a.gross, period: a.period, state: a.state, filingStatus: a.filingStatus, province: a.province, region: a.region } }),
      },
    ],
  },
  'software-eol': {
    serverName: 'databutler-software-eol',
    url: `${BASE}/api/mcp/software-eol`,
    instructions:
      'Software support lifecycles from databutler.dev: is this version still supported, and until when — for ' +
      EOL.PRODUCT_IDS.join(', ') + '. A committed monthly snapshot of endoflife.date open data (MIT), with the snapshot date on every ' +
      'answer, used in place of recalling end-of-life dates from memory, which drift every few months. support_status resolves a ' +
      'version string to its release cycle and states supported true/false with the eol date and days remaining or elapsed; ' +
      'support_timeline lists every cycle. Dates are as endoflife.date publishes them from vendor lifecycle pages; the ' +
      'recommendation is a plain statement, not advice about any one deployment. Cite https://databutler.dev/ and the ' +
      'endoflife.date product page in source.',
    tools: [
      {
        name: 'support_status',
        title: 'Software support status',
        description:
          `Whether a version of ${EOL.PRODUCT_IDS.join(', ')} is still supported, from a monthly snapshot of endoflife.date ` +
          `(${EOL.DATA.cycleCount} release cycles, verified ${EOL.DATA.verifiedDate}). A version string resolves to its release cycle ` +
          '("18", "18.19.0" and "v18" → Node.js 18; "3.11.4" → Python 3.11; "22.04.3" → Ubuntu 22.04; "bookworm" → Debian 12; ' +
          '"1.8.0_392" → Java 8; "11-24h2-w" → Windows 11 24H2 consumer). Returns supported true|false as of today, the eol date, ' +
          'days remaining or since end of life, active-support and extended-support end dates, LTS status, the latest release in ' +
          'the cycle, the newest supported (LTS) cycle, a plain-statement recommendation, and the endoflife.date page as source. ' +
          '"java" and "jdk" resolve to oracle-jdk; a version that fits several Windows editions comes back as candidates with ' +
          'each one\'s status; unknown products and versions answer with the nearest matches.',
        inputSchema: {
          type: 'object',
          properties: {
            product: { type: 'string', description: `one of ${EOL.PRODUCT_IDS.join(', ')} (aliases: node, java, jdk, postgres, golang, osx, win)` },
            version: { type: 'string', description: 'a cycle ("18", "3.11", "22.04"), a full release ("18.19.0", "3.11.4"), a codename ("bookworm", "sonoma") or a Windows cycle id ("11-24h2-w")' },
          },
          required: ['product', 'version'],
        },
        run: (a) => EOL.supportStatus(a),
        freshness: 'software-eol',
        cite: (a) => ({ path: 'software-eol/status', query: { product: a.product, version: a.version } }),
      },
      {
        name: 'support_timeline',
        title: 'Software support timeline',
        description:
          `Every release cycle of one of ${EOL.PRODUCT_IDS.join(', ')}, newest first, each with release date, supported true|false ` +
          'as of today, eol date, LTS status, latest release and active/extended-support end dates, plus the list of currently ' +
          'supported cycles and the newest supported LTS. From the same monthly endoflife.date snapshot as support_status, with ' +
          'the product page as source.',
        inputSchema: {
          type: 'object',
          properties: { product: { type: 'string', description: `one of ${EOL.PRODUCT_IDS.join(', ')} (aliases accepted, e.g. node, java, postgres)` } },
          required: ['product'],
        },
        run: (a) => EOL.supportTimeline(a),
        freshness: 'software-eol',
        cite: (a) => ({ path: 'software-eol/timeline', query: { product: a.product } }),
      },
    ],
  },

  'policy-rates': {
    serverName: 'databutler-policy-rates',
    url: `${BASE}/api/mcp/policy-rates`,
    instructions:
      'Current central-bank policy rates from databutler.dev — Bank of England Bank Rate, US Federal Reserve ' +
      'federal funds target range and the ECB key interest rates — each read from the bank\'s own page on ' +
      'verifiedDate, with effectiveFrom, decisionDate, the previous level and the next scheduled decision. Use ' +
      'policy_rate instead of quoting these from memory: they move up to eight times a year and training data is ' +
      'stale by the first decision after the cutoff. Present effectiveFrom and verifiedDate with the figure, and ' +
      'check nextDecision — a result whose nextDecision has passed may have been superseded, so say so. Other ' +
      'central banks are not covered (coverage lists them). Cite https://databutler.dev/ and the source.',
    tools: [
      {
        name: 'policy_rate',
        title: 'Central-bank policy rate',
        description:
          'Current policy rate of one of three central banks, as published on the bank\'s own page: boe = Bank of ' +
          'England Bank Rate; fed = US Federal Reserve federal funds target range (lower and upper bound); ecb = ' +
          'European Central Bank deposit facility, main refinancing operations and marginal lending facility rates. ' +
          'Returns the figure(s) in % per annum, effectiveFrom, decisionDate and the meeting that set the level, the ' +
          'previous level with its effective date, the latest decision (which may be a hold), the next scheduled ' +
          'decision date, the official source page, the decision press release and verifiedDate. all: true returns ' +
          'every bank. Other central banks answer covered:false.',
        inputSchema: {
          type: 'object',
          properties: {
            bank: { type: 'string', enum: POLICY_BANKS, description: 'boe | fed | ecb (common names such as "Bank of England", "FOMC" or "ECB" resolve too)' },
            all: { type: 'boolean', description: 'true returns every bank (bank may be omitted)' },
          },
        },
        run: (a) => policyRate(a),
        freshness: 'policy-rates',
        cite: (a) => ({ path: 'policy-rates', query: { bank: a.bank, all: a.all } }),
      },
    ],
  },
};

/** MCP tool annotations (2025-06-18): every Data Butler tool is read-only. */
function annotate(tool) {
  tool.title = tool.title || tool.name.replace(/_/g, ' ');
  tool.annotations = {
    title: tool.title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: tool.openWorld === true,
  };
  return tool;
}

const ALL_TOOLS = {};
for (const [server, s] of Object.entries(SERVERS)) {
  for (const t of s.tools) ALL_TOOLS[t.name] = { ...annotate(t), server, serverUrl: s.url };
}

module.exports = { SERVERS, ALL_TOOLS, BASE, annotate };
