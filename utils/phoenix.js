const { Transaction, Keypair, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const { conn, sleep, getSwapAmountForSol, saveTransaction } = require("./constants")
const Phoenix = require('@ellipsis-labs/phoenix-sdk');
const {AccountLayout, NATIVE_MINT, createCloseAccountInstruction, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync, createSyncNativeInstruction } = require('@solana/spl-token');

const PhoenixRoutes = [
    {tokenIn: 'SOL', tokenOut: 'USDC', marketName: 'SOL/USDC', side: Phoenix.Side.Ask},
    {tokenIn: 'USDC', tokenOut: 'SOL', marketName: 'SOL/USDC', side: Phoenix.Side.Bid},
    {tokenIn: 'SOL', tokenOut: 'USDT', marketName: 'SOL/USDT', side: Phoenix.Side.Ask},
    {tokenIn: 'USDT', tokenOut: 'SOL', marketName: 'SOL/USDT', side: Phoenix.Side.Bid}
]

const swapInPhoenix = async(wallet) => {
    const rand = new Date().getTime()
    const selectedRoute = PhoenixRoutes[rand % PhoenixRoutes.length]
    const swapAmount = await getSwapAmountForSol(wallet.publicKey, selectedRoute.tokenIn)
    if(swapAmount==0) return false;
    console.log("Phoenix -> "+wallet.publicKey.toBase58()+"  :  "+swapAmount+selectedRoute.tokenIn+" -> "+selectedRoute.tokenOut)
    const phoenix = await Phoenix.Client.create(conn)
    let marketConfig;
    phoenix.marketConfigs.forEach((value, key)=>{
        if(value.name===selectedRoute.marketName) marketConfig = value
    })
    const marketState = phoenix.marketStates.get(marketConfig.marketId)
    const tx = new Transaction()
    const accountRentExempt = await conn.getMinimumBalanceForRentExemption(AccountLayout.span)
    const solAccount = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey)
    if(selectedRoute.tokenIn==="SOL"){
        if(await conn.getAccountInfo(solAccount) == null)
            tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, solAccount, wallet.publicKey, NATIVE_MINT))
        tx.add(SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: solAccount,
            lamports: swapAmount*(10**9) + 3 * accountRentExempt
        }))
        tx.add(createSyncNativeInstruction(solAccount))
    }else{
        if(await conn.getAccountInfo(solAccount) == null)
            tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, solAccount, wallet.publicKey, NATIVE_MINT))
        tx.add(SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: solAccount,
            lamports: 3 * accountRentExempt
        }))
        tx.add(createSyncNativeInstruction(solAccount))
    }
    tx.add(marketState.createSwapInstruction(marketState.getSwapOrderPacket({side: selectedRoute.side ? Phoenix.Side.Ask : Phoenix.Side.Bid, inAmount: swapAmount}), wallet.publicKey))
    tx.add(createCloseAccountInstruction(solAccount, wallet.publicKey, wallet.publicKey))
    console.log("Swapping....")
    const {blockhash} = await conn.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    const txId = await sendAndConfirmTransaction(conn, tx, [wallet], {maxRetries:5, skipPreflight: true})
    console.log(txId)
    saveTransaction(wallet.publicKey.toBase58(), "", "Phoenix", selectedRoute.tokenIn, swapAmount, selectedRoute.tokenOut, txId)
    const duration = (rand % 50) + 10 // 10s ~ 60s
    await sleep(duration)
    return true;
}

module.exports = {
    swapInPhoenix
}