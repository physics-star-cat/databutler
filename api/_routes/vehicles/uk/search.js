const { restMirror } = require('../../../_rest');

module.exports = restMirror({
  tool: 'uk_mot_vehicle_search', event: 'agent_api_vehicles_uk_search',
  args: (q) => ({ q: q.q }), required: ['q'],
});
