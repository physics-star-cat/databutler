const { makeMcpHandler } = require('../../_mcp');
const { SERVERS } = require('../../_registry');

module.exports = makeMcpHandler(SERVERS.tax);
