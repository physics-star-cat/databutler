const { restMirror } = require('../../_rest');

module.exports = restMirror({
  tool: 'support_timeline', event: 'agent_api_software_eol_timeline',
  args: (q) => ({ product: q.product }), required: ['product'],
});
