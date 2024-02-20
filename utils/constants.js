const { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js')
const { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createTransferInstruction } = require('@solana/spl-token');
const ethers = require('ethers')
const fs = require('fs')

require('dotenv').config()

const conn = new Connection(process.env.SOLANA_RPC_NODE_URL, {commitment:"finalized"})
const ethProvider = ethers.getDefaultProvider(process.env.ETH_RPC_NODE_URL)
const bscProvider = ethers.getDefaultProvider(process.env.BSC_RPC_NODE_URL)
const arbProvider = ethers.getDefaultProvider(process.env.ARB_RPC_NODE_URL)
const EXACT_COUNT = 200;

const SolTokenList = [
    {name: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9},
    {name: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6},
    {name: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6},
]

const EVMContract = "0x0000000000000000000000000000000000000000"

const logFileName = "./Log.csv"

const sleep = (ms) => {return new Promise(resolve => setTimeout(resolve, ms * 1000))}

const saveTransaction = (solWallet, ethWallet, market, tokenIn, inputAmount, tokenOut, tx) => {
    try{
        let line = `${solWallet},${ethWallet},${market},${tokenIn},${inputAmount},${tokenOut},${tx}\r\n`
        fs.appendFileSync(logFileName, line)
    }catch(err){

    }
}

const transferSolOrToken = async(wallet1, wallet2, token, transferAmount) => {
    if(token=='SOL'){
        let tx = new Transaction()
        console.log(`${wallet1.publicKey.toBase58()} is sending ${transferAmount}sol to ${wallet2.publicKey.toBase58()}`)
        tx.add(SystemProgram.transfer({
            fromPubkey: wallet1.publicKey,
            toPubkey: wallet2.publicKey,
            lamports: transferAmount * LAMPORTS_PER_SOL
        }))
        let txId = await conn.sendTransaction(tx, [wallet1])
        console.log(txId)
    }else{
        let tx = new Transaction()
        let tokenMint = new PublicKey(SolTokenList.find((item)=>{return item.name==token}).mint)
        let decimals = SolTokenList.find((item)=>{return item.name==token}).decimals
        const fromTokenAccount = getAssociatedTokenAddressSync(tokenMint, wallet1.publicKey)
        const toTokenAccount = getAssociatedTokenAddressSync(tokenMint, wallet2.publicKey)
        if(await conn.getAccountInfo(toTokenAccount)==null)
            tx.add(createAssociatedTokenAccountInstruction(wallet1.publicKey, toTokenAccount, wallet2.publicKey, tokenMint))
        tx.add(createTransferInstruction(fromTokenAccount, toTokenAccount, wallet1.publicKey, transferAmount*(10**decimals), []))
        await conn.sendTransaction(tx, [wallet1])
    }
}

const transferRemainingAssets = async(wallet1, wallet2) => {
    // Solana
    let solWallet1 = wallet1.solWallet
    let solWallet2 = wallet2.solWallet
    let transactionFee = 0.0005 * LAMPORTS_PER_SOL
    for(let i=SolTokenList.length-1; i>=0; i--){
        let item = SolTokenList[i]
        const tx = new Transaction()
        const balance = await conn.getBalance(solWallet1.publicKey)
        if(item.name=='SOL' && balance>transactionFee){
            tx.add(SystemProgram.transfer({
                fromPubkey: solWallet1.publicKey,
                toPubkey: solWallet2.publicKey,
                lamports: balance - transactionFee
            }))
        }else{
            const mint = new PublicKey(item.mint)
            const tokenAccount = getAssociatedTokenAddressSync(mint, solWallet1.publicKey)
            console.log(tokenAccount.toBase58())
            if(await conn.getAccountInfo(tokenAccount)==null) continue;
            const amount = (await conn.getTokenAccountBalance(tokenAccount)).value.amount
            console.log(amount)
            const toTokenAccount = getAssociatedTokenAddressSync(mint, solWallet2.publicKey)
            if(await conn.getAccountInfo(toTokenAccount)==null)
                tx.add(createAssociatedTokenAccountInstruction(solWallet1.publicKey, toTokenAccount, solWallet2.publicKey, mint))
            tx.add(createTransferInstruction(tokenAccount, toTokenAccount, solWallet1.publicKey, Number(amount)))
        }
        await conn.sendTransaction(tx, [solWallet1], {maxRetries:5, skipPreflight: true})
    }

    // EVM
    ethereum
    let ethWallet1 = wallet1.ethWallet
    let ethWallet2 = wallet2.ethWallet
    let ethAccount = ethWallet1.connect(ethProvider)
    let ethBalance = await ethProvider.getBalance(ethWallet1.address)
    let tx = {from: ethWallet1.address, to: ethWallet2.address, value: ethBalance}
    const ethGasLimit = (await ethProvider.estimateGas(tx)).mul(2)
    const ethGasPrice = (await ethProvider.getGasPrice()).mul(3).div(2)
    const ethGas = ethGasPrice.mul(ethGasLimit)
    if(ethBalance.gt(ethGas)) await ethAccount.sendTransaction({to: ethWallet2.address, value: ethBalance.sub(ethGas), gasPrice: ethGasPrice})
    let bscAccount = ethWallet1.connect(bscProvider)
    let bscBalance = await bscProvider.getBalance(ethWallet1.address)
    const bscGasLimit = (await bscProvider.estimateGas(tx)).mul(2)
    const bscGasPrice = (await bscProvider.getGasPrice()).mul(3).div(2)
    const bscGas = bscGasPrice.mul(bscGasLimit)
    if(bscBalance.gt(bscGas)) await bscAccount.sendTransaction({to: ethWallet2.address, value: bscBalance.sub(bscGas), gasPrice: bscGasPrice}) 
}

const getTokenAmount = async(wallet, token) => {
    try{
        if(token=='SOL'){
            return (await conn.getBalance(wallet) / LAMPORTS_PER_SOL)
        }else{
            let tokenMint = new PublicKey(SolTokenList.find((item)=>{return item.name==token}).mint)
            let tokenAccount = getAssociatedTokenAddressSync(tokenMint, wallet)
            if(await conn.getAccountInfo(tokenAccount) != null){
                return Number((await conn.getTokenAccountBalance(tokenAccount)).value.uiAmount)
            }
        }
        return 0
    }catch(err){
        return 0
    }
}

const getSwapAmountForSol = async(wallet, token, minAmount=0) => {
    try{
        let balance = await getTokenAmount(wallet, token)
        if(token=='SOL'){
            const ratio = ((new Date().getTime()) % 100) / 500 + 0.6
            return Math.floor(balance*ratio * 100) / 100
        }else
            return balance
    }catch(err){
        console.log(err)
        return 0
    }
}

const getSwapAmountForEvm = async(wallet, chain) => {
    let coinAmount;
    if(chain==='ethereum'){
        coinAmount = await ethProvider.getBalance(wallet)
    }else if(chain==='bsc'){
        coinAmount = await bscProvider.getBalance(wallet)
    }else if(chain==='arbitrum'){
        coinAmount = await arbProvider.getBalance(wallet)
    }
    return Number(coinAmount)
}

module.exports = {
    conn, ethProvider, bscProvider, arbProvider, EXACT_COUNT,
    SolTokenList, EVMContract,
    sleep, saveTransaction,
    getSwapAmountForSol, transferSolOrToken, getSwapAmountForEvm, transferRemainingAssets,
}

