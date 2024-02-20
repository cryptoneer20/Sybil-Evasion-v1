const {swapInJupiter} = require("./jupiter")
const {swapInPhoenix} = require("./phoenix")
const {swapInMayanSwap} = require("./mayan_swap")
const {swapInMayan} = require("./mayan")
const {swapInDebridge} = require("./debridge")
const {depositInZeta, withdrawInZeta, loadZetaMarket, prepareForZeta, workOnZeta} = require('./zetamarkets')
const {bridgeInMayanV2} = require('./mayan_v2')
const {bridgeInDebridgeV2} = require('./debridge_v2')

const constants = require('./constants')

module.exports = {
    swapInJupiter,
    swapInPhoenix,
    swapInMayanSwap,
    swapInMayan,
    swapInDebridge,
    bridgeInMayanV2,
    bridgeInDebridgeV2,

    depositInZeta,
    withdrawInZeta,
    prepareForZeta,
    workOnZeta,
    loadZetaMarket,
    ...constants
}