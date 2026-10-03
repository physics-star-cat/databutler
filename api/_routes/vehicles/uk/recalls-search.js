const { restMirror } = require('../../../_rest');

module.exports = restMirror({
  tool: 'uk_recalls_search', event: 'agent_api_vehicles_uk_recalls_search',
  args: (q) => ({ text: q.text, since: q.since }), required: ['text'],
});
