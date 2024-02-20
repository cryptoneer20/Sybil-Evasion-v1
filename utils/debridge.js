const { VersionedTransaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const { SolTokenList, getSwapAmountForSol, getSwapAmountForEvm, sleep, EVMContract, conn, ethProvider, bscProvider } = require('./constants');
const fetch = require('node-fetch');

const DebridgeChainId = {
    ethereum: 1, bsc: 56, solana: 7565164
}

const DebridgeRoutes = [
    {fromChain: "solana", fromToken: "SOL", toChain: "ethereum", toToken: "ETH"},
    {fromChain: "solana", fromToken: "USDT", toChain: "ethereum", toToken: "ETH"},
    {fromChain: "solana", fromToken: "USDC", toChain: "ethereum", toToken: "ETH"},
    {fromChain: "solana", fromToken: "SOL", toChain: "bsc", toToken: "BNB"},
    {fromChain: "solana", fromToken: "USDT", toChain: "bsc", toToken: "BNB"},
    {fromChain: "solana", fromToken: "USDC", toChain: "bsc", toToken: "BNB"},
    {fromChain: "ethereum", fromToken: "ETH", toChain: "solana", toToken: "SOL"},
    {fromChain: "ethereum", fromToken: "ETH", toChain: "solana", toToken: "USDC"},
    {fromChain: "bsc", fromToken: "BNB", toChain: "solana", toToken: "SOL"},
    {fromChain: "bsc", fromToken: "BNB", toChain: "solana", toToken: "USDC"},
]

const swapInDebridge = async(solWallet, ethWallet) => {
    const rand = new Date().getTime()
    const selectedRoute = DebridgeRoutes[rand % DebridgeRoutes.length]
    let amount = 0
    let swapAmount = 0
    if(selectedRoute.fromChain==="solana"){
        amount = Math.floor((await getSwapAmountForSol(solWallet.publicKey, selectedRoute.fromToken))*(10 ** (selectedRoute.fromToken=="SOL"?9:6)))
        swapAmount = Math.floor(await getSwapAmountForSol(solWallet.publicKey, selectedRoute.fromToken)*100)/100
    }else{
        amount = await getSwapAmountForEvm(ethWallet.address, selectedRoute.fromChain)
    }
    if(amount==0) return false;
    if(selectedRoute.fromChain==="solana")
        console.log("Debridge -> ",solWallet.publicKey.toBase58()+"  :  "+swapAmount+selectedRoute.fromToken+" -> "+selectedRoute.toToken)
    else
        console.log("Debridge -> ",ethWallet.address+"  :  "+amount+selectedRoute.fromToken+" -> "+selectedRoute.toToken)
    const dataQuote = await (await fetch('https://api.dln.trade/v1.0/dln/order/quote?'+new URLSearchParams({
        srcChainId: DebridgeChainId[selectedRoute.fromChain],
        srcChainTokenIn: selectedRoute.fromChain==="solana" ? (selectedRoute.fromToken==="SOL" ? SystemProgram.programId : SolTokenList.find((item)=> {return item.name===selectedRoute.fromToken}).mint) : EVMContract,
        srcChainTokenInAmount: selectedRoute.fromChain==="solana" ? amount : Math.floor(amount*(10**18)),
        dstChainId: DebridgeChainId[selectedRoute.toChain],
        dstChainTokenOut: selectedRoute.toChain==="solana" ? (selectedRoute.toToken==="SOL" ? SystemProgram.programId : SolTokenList.find((item)=> {return item.name===selectedRoute.toToken}).mint) : EVMContract,
        prependOperatingExpense: true,
    }))).json()
    const dataRequestingOrder = await (await fetch('https://api.dln.trade/v1.0/dln/order/create-tx?'+new URLSearchParams({
        srcChainId: DebridgeChainId[selectedRoute.fromChain],
        srcChainTokenIn: selectedRoute.fromChain==="solana" ? (selectedRoute.fromToken==="SOL" ? SystemProgram.programId : SolTokenList.find((item)=>{return item.name===selectedRoute.fromToken}).mint) : EVMContract,
        srcChainTokenInAmount: selectedRoute.fromChain==="solana" ? amount : Math.floor(amount*(10**18)),
        dstChainId: DebridgeChainId[selectedRoute.toChain],
        dstChainTokenOut: selectedRoute.toChain==="solana" ? (selectedRoute.toToken==="SOL" ? SystemProgram.programId : SolTokenList.find((item)=>{return item.name===selectedRoute.toToken}).mint) : EVMContract,
        prependOperatingExpense: true,
        dstChainTokenOutAmount: dataQuote.estimation.dstChainTokenOut.amount,
        srcChainOrderAuthorityAddress: selectedRoute.fromChain==="solana" ? solWallet.publicKey.toBase58() : ethWallet.address,
        dstChainTokenOutRecipient: selectedRoute.toChain==="solana" ? solWallet.publicKey.toBase58() : ethWallet.address,
        dstChainOrderAuthorityAddress: selectedRoute.toChain==="solana" ? solWallet.publicKey.toBase58() : ethWallet.address,
    }))).json()

    if(dataRequestingOrder.errorId!=undefined && dataRequestingOrder.errorId!=null){
        throw new Error(dataRequestingOrder.errorMessage)
    }
    
    if(selectedRoute.fromChain==="solana"){
        const tx = VersionedTransaction.deserialize(Buffer.from(dataRequestingOrder.tx.data.slice(2), 'hex'))
        const {blockhash} = await conn.getLatestBlockhash()
        tx.message.recentBlockhash = blockhash
        tx.sign([solWallet])
        console.log("Swapping...")
        let txId = await conn.sendTransaction(tx,{maxRetries:5, skipPreflight: true})
        saveTransaction(solWallet.publicKey.toBase58(), ethWallet.address, "Debridge", selectedRoute.fromToken+"/"+selectedRoute.fromChain, swapAmount, selectedRoute.toToken+"/"+selectedRoute.toChain, txId)
        console.log(txId)
    }else{
        const wallet = ethWallet.connect(selectedRoute.fromChain==="ethereum" ? ethProvider : bscProvider)
        console.log("Swapping...")
        const txId = await wallet.sendTransaction(dataRequestingOrder.tx)
        saveTransaction(solWallet.publicKey.toBase58(), ethWallet.address, "Debridge", selectedRoute.fromToken+"/"+selectedRoute.fromChain, amount, selectedRoute.toToken+"/"+selectedRoute.toChain, txId.hash)
        console.log(txId.hash)
    }
    const duration = (rand % 50) + 10 // 10s ~ 60s
    await sleep(duration)
    return true;
}

module.exports = {
    swapInDebridge
}