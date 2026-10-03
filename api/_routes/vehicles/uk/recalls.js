const { restMirror } = require('../../../_rest');

module.exports = restMirror({
  tool: 'uk_recalls_for_model', event: 'agent_api_vehicles_uk_recalls',
  args: (q) => ({ make: q.make, model: q.model, since: q.since }), required: ['make'],
});
