const { restMirror } = require('../../../_rest');

module.exports = restMirror({
  tool: 'uk_mot_reliability', event: 'agent_api_vehicles_uk_mot',
  args: (q) => ({ make: q.make, model: q.model, year: q.year, mileage: q.mileage }),
  required: ['make', 'model'], numeric: ['year', 'mileage'],
});
