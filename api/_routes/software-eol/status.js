const { restMirror } = require('../../_rest');

module.exports = restMirror({
  tool: 'support_status', event: 'agent_api_software_eol_status',
  args: (q) => ({ product: q.product, version: q.version }), required: ['product', 'version'],
});
