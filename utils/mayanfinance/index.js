const api = require('./api')
const evm = require('./evm')
const solana = require('./solana')
const addresses = require('./addresses')

module.exports = {
    ...api, ...evm, ...solana, addresses
}
