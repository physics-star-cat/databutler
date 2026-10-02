const { restMirror } = require('../../_rest');

module.exports = restMirror({
  tool: 'jp_recalls_for_model', event: 'agent_api_vehicles_jp_recalls',
  args: (q) => ({ make: q.make, model: q.model }), required: ['make', 'model'],
});
