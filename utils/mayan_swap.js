const { fetchQuote, createSwapFromSolanaInstructions } = require('@mayanfinance/swap-sdk')
const { SolTokenList, getSwapAmountForSol, sleep, conn, saveTransaction } = require('./constants')
const { Transaction, sendAndConfirmTransaction, SystemProgram } = require('@solana/web3.js')
const { getAssociatedTokenAddressSync, NATIVE_MINT, createAssociatedTokenAccountInstruction, createCloseAccountInstruction, createSyncNativeInstruction, AccountLayout } = require('@solana/spl-token')

const MayanRoutes = [
    {fromChain: "solana", fromToken: "SOL", toChain: "solana", toToken: "USDC"},
    {fromChain: "solana", fromToken: "USDC", toChain: "solana", toToken: "SOL"},
    {fromChain: "solana", fromToken: "SOL", toChain: "solana", toToken: "USDT"},
    {fromChain: "solana", fromToken: "USDT", toChain: "solana", toToken: "SOL"},
]

const swapInMayanSwap = async(wallet) => {
    const rand = new Date().getTime()
    const selectedRoute = MayanRoutes[rand % MayanRoutes.length]
    const swapAmount = await getSwapAmountForSol(wallet.publicKey, selectedRoute.fromToken)
    if(swapAmount==0) return false;
    console.log("Mayan Swap-> ",wallet.publicKey.toBase58()+"  :  "+swapAmount+selectedRoute.fromToken+" -> "+selectedRoute.toToken)
    const quote = await fetchQuote({
        amount: swapAmount,
        fromToken: SolTokenList.find((item)=>{return item.name===selectedRoute.fromToken}).mint,
        fromChain: "solana",
        toToken: SolTokenList.find((item)=>{return item.name===selectedRoute.toToken}).mint,
        toChain: "solana",
        slippage: 0.05,
        gasDrop: 0,
        referrer: null
    })
    const tx = new Transaction()
    const solAccount = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey)
    if(await conn.getAccountInfo(solAccount) == null){
        const accountRentExempt = await conn.getMinimumBalanceForRentExemption(AccountLayout.span)
        tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, solAccount, wallet.publicKey, NATIVE_MINT))
        tx.add(SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: solAccount,
            lamports: 3 * accountRentExempt + quote.effectiveAmountIn * (10**9)
        }))
        // txWrap.add(createSyncNativeInstruction(solAccount))
    }
    const {instructions, signers} = await createSwapFromSolanaInstructions(quote, wallet.publicKey.toString(), wallet.publicKey.toString(), 100, null, conn);
    signers.splice(0,0,wallet)
    tx.add(...instructions)
    tx.add(createCloseAccountInstruction(solAccount, wallet.publicKey, wallet.publicKey))
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
    console.log("Swapping...")
    let txId = await sendAndConfirmTransaction(conn, tx, signers)
    console.log(txId)

    saveTransaction(wallet.publicKey.toBase58(), "", "Mayan Swap", selectedRoute.fromToken, swapAmount, selectedRoute.toToken, txId)
    const duration = (rand % 50) + 200 // 10s ~ 60s
    await sleep(duration)
    return true;
}

module.exports = {
    swapInMayanSwap
}