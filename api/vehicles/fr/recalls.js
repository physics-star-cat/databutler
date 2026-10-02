const { restMirror } = require('../../_rest');

module.exports = restMirror({
  tool: 'fr_recalls_for_model', event: 'agent_api_vehicles_fr_recalls',
  args: (q) => ({ brand: q.brand, model: q.model }), required: ['brand'],
});
