const { VersionedTransaction } = require('@solana/web3.js');
const { conn, SolTokenList, sleep, getSwapAmountForSol, saveTransaction } = require("./constants");
const fetch = require('node-fetch');

const JupiterRoutes = [
    {tokenIn: 'SOL', tokenOut: 'USDC'},
    {tokenIn: 'USDC', tokenOut: 'SOL'},
    {tokenIn: 'SOL', tokenOut: 'USDT'},
    {tokenIn: 'USDT', tokenOut: 'SOL'},
]

const swapInJupiter = async(wallet) => {
    const publicKey = wallet.publicKey
    const rand = new Date().getTime()
    const selectedRoute = JupiterRoutes[rand % JupiterRoutes.length]
    const swapAmount = await getSwapAmountForSol(wallet.publicKey, selectedRoute.tokenIn)
    if(swapAmount==0) return false;
    const inputMint = SolTokenList.find((item)=>{return item.name==selectedRoute.tokenIn}).mint
    const decimals = SolTokenList.find((item)=>{return item.name==selectedRoute.tokenIn}).decimals
    const outputMint = SolTokenList.find((item)=>{return item.name==selectedRoute.tokenOut}).mint
    console.log("Jupiter -> "+wallet.publicKey.toBase58()+"  :  "+swapAmount+selectedRoute.tokenIn+" -> "+selectedRoute.tokenOut)
    const quoteResponse = await (await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(swapAmount*(10**decimals))}&slippageBps=50`)).json()
    const { swapTransaction } = await (await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            quoteResponse,
            userPublicKey: publicKey,
            wrapUnwrapSol: true
        })
    })).json()
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64')
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf)
    const {blockhash} = await conn.getLatestBlockhash()
    transaction.message.recentBlockhash = blockhash
    transaction.sign([wallet])
    const rawTransaction = transaction.serialize()
    console.log("Swapping....")
    const txId = await conn.sendRawTransaction(rawTransaction, {maxRetries: 5, skipPreflight: true})
    console.log(txId)
    saveTransaction(publicKey.toBase58(), "", "Jupiter", selectedRoute.tokenIn, swapAmount, selectedRoute.tokenOut, txId)
    const duration = (rand % 50) + 10 // 10s ~ 60s
    await sleep(duration)
    return true;
}

module.exports = {
    swapInJupiter
}