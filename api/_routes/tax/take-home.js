const { restMirror } = require('../../_rest');

module.exports = restMirror({
  tool: 'take_home_pay', event: 'agent_api_tax_take_home',
  args: (q) => ({ country: q.country, gross: q.gross, period: q.period, state: q.state, filingStatus: q.filingStatus, province: q.province, region: q.region }),
  required: ['country', 'gross'], numeric: ['gross'],
});
