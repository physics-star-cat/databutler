const { restMirror } = require('../../../_rest');

module.exports = restMirror({
  tool: 'jp_complaints_summary', event: 'agent_api_vehicles_jp_complaints',
  args: (q) => ({ make: q.make, model: q.model }), required: ['make', 'model'],
});
