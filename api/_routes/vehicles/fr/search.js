const { restMirror } = require('../../../_rest');

module.exports = restMirror({
  tool: 'fr_recalls_search', event: 'agent_api_vehicles_fr_search',
  args: (q) => ({ text: q.text, since: q.since }), required: ['text'],
});
