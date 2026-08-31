const { makeMcpHandler } = require('../_mcp');
const { domainProvenance, packageProvenance } = require('../_provenance');

module.exports = makeMcpHandler({
  serverName: 'databutler-provenance',
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
    },
    {
      name: 'package_provenance',
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
    },
  ],
});
