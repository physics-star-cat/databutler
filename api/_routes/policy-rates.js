const { restMirror } = require('../_rest');

// GET /api/policy-rates?bank=boe|fed|ecb|all (bank=all mirrors the tool's all: true)
module.exports = restMirror({
  tool: 'policy_rate', event: 'agent_api_policy_rates',
  args: (q) => ({ bank: q.bank, ...(q.all !== undefined ? { all: q.all === 'true' || q.all === '1' } : {}) }),
  required: ['bank'],
});
