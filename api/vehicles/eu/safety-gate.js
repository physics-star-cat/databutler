const { restMirror } = require('../../_rest');

module.exports = restMirror({
  tool: 'eu_safety_gate_recalls', event: 'agent_api_vehicles_eu_safety_gate',
  args: (q) => ({ brand: q.brand, model: q.model }),
});
