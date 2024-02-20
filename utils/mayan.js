const { fetchQuote, swapFromEvm, createSwapFromSolanaInstructions } = require('@mayanfinance/swap-sdk')
const { SolTokenList, getSwapAmountForSol, getSwapAmountForEvm, sleep, EVMContract, conn, ethProvider, bscProvider, saveTransaction } = require('./constants')
const { Transaction, sendAndConfirmTransaction } = require('@solana/web3.js')

const MayanRoutes = [
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

    {fromChain: "solana", fromToken: "SOL", toChain: "solana", toToken: "USDC"},
    {fromChain: "solana", fromToken: "USDC", toChain: "solana", toToken: "SOL"},
]

const swapInMayan = async(solWallet, ethWallet) => {
    const rand = new Date().getTime()
    const selectedRoute = MayanRoutes[rand % MayanRoutes.length]
    if(selectedRoute.fromChain==="solana"){
        const swapAmount = Math.floor(await getSwapAmountForSol(solWallet.publicKey, selectedRoute.fromToken) * 100) / 100
        if(swapAmount==0) return false;
        console.log("Mayan -> ",solWallet.publicKey.toBase58()+"  :  "+swapAmount+selectedRoute.fromToken+" -> "+selectedRoute.toToken)
        const quote = await fetchQuote({
            amount: swapAmount,
            fromToken: SolTokenList.find((item)=>{return item.name===selectedRoute.fromToken}).mint,
            fromChain: "solana",
            toToken: selectedRoute.toChain==="solana" ? SolTokenList.find((item)=>{return item.name===selectedRoute.toToken}).mint : EVMContract,
            toChain: selectedRoute.toChain,
            slippage: 0.05,
            gasDrop: 0,
            referrer: null
        })
        const {instructions, signers} = await createSwapFromSolanaInstructions(quote, solWallet.publicKey.toString(), selectedRoute.toChain==="solana" ? solWallet.publicKey : ethWallet.address, 100, null, conn);
        signers.splice(0,0,solWallet)
        const tx = new Transaction()
        tx.add(...instructions)
        tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
        console.log("Swapping...")
        let txId = await conn.sendTransaction(tx, signers, {maxRetries: 5, skipPreflight: true})
        console.log(txId)
        saveTransaction(solWallet.publicKey.toBase58(), ethWallet.address, "Mayan", selectedRoute.fromToken+"/"+selectedRoute.fromChain, swapAmount, selectedRoute.toToken+"/"+selectedRoute.toChain, txId)
    }else{
        const swapAmount = await getSwapAmountForEvm(ethWallet.address, selectedRoute.fromChain)
        if(swapAmount==0) return;
        console.log("Mayan -> ",ethWallet.address+"  :  "+swapAmount+selectedRoute.fromToken+" -> "+selectedRoute.toToken)
        const quote = await fetchQuote({
            amount: swapAmount/(10**18),
            fromToken: EVMContract,
            fromChain: selectedRoute.fromChain,
            toToken: SolTokenList.find((item)=>{return item.name===selectedRoute.toToken}).mint,
            toChain: "solana",
            slippage: 0.05,
            gasDrop: 0,
            referrer: null
        })
        const wallet = ethWallet.connect(selectedRoute.fromChain==="ethereum" ? ethProvider : bscProvider)
        console.log("Swapping...")
        let txId = await swapFromEvm(quote, solWallet.publicKey.toBase58(), 100, null, selectedRoute.fromChain==="ethereum" ? ethProvider : bscProvider, wallet)
        console.log(txId)
        saveTransaction(solWallet.publicKey.toBase58(), ethWallet.address, "Mayan", selectedRoute.fromToken+"/"+selectedRoute.fromChain, swapAmount, selectedRoute.toToken+"/"+selectedRoute.toChain, txId)
    }
    const duration = (rand % 50) + 100 // 10s ~ 60s
    await sleep(duration)
    return true;
}

module.exports = {
    swapInMayan
}