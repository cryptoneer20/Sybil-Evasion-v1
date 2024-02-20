const {conn, sleep, saveTransaction, getSwapAmountForSol, transferSolOrToken} = require('./constants')
const {CrossClient,
    Exchange,
    Network,
    Wallet,
    utils,
    types,
    constants} = require('@zetamarkets/sdk')

const confirmOptions = {maxRetries:5, skipPreflight: true, commitment: 'confirmed'}

const prepareForZeta = async(srcWallet, dstWallet) => {
    try{
        const srcZetaWallet = new Wallet(srcWallet)
        const dstZetaWallet = new Wallet(dstWallet)
        const srcClient = await CrossClient.load(conn, srcZetaWallet, confirmOptions)
        const dstClient = await CrossClient.load(conn, dstZetaWallet, confirmOptions)
        if((srcClient.account!=null && srcClient.account.balance.toNumber()>0) && (dstClient.account!=null && dstClient.account.balance.toNumber()>0)) return true;
        const usdcAmount = await getSwapAmountForSol(srcWallet.publicKey, 'USDC', 5)
        const solAmount = await getSwapAmountForSol(srcWallet.publicKey, 'SOL', 0.01)
        if(usdcAmount>0)
            await transferSolOrToken(srcWallet, dstWallet, 'USDC', usdcAmount/2)
        if(solAmount>0)
            await transferSolOrToken(srcWallet, dstWallet, 'SOL', solAmount/2)
        if(srcClient.account==null || srcClient.account.balance.toNumber()==0)
            await depositInZeta(srcWallet, usdcAmount/2)
        if(dstClient.account==null || dstClient.account.balance.toNumber()==0){
            const dstUSDCAmount = await getSwapAmountForSol(dstWallet.publicKey, 'USDC', 5)
            await depositInZeta(dstWallet, dstUSDCAmount)
        }
        return true
    }catch(err){
        console.log(err)
        return false
    }
}

const workOnZeta = async(wallet1, wallet2) => {
    try{
        const asset = constants.Asset.SOL
        const orderLots = utils.convertDecimalToNativeLotSize(1)
        const amount = utils.convertDecimalToNativeInteger(0.1)
        const zetaWallet1 = new Wallet(wallet1)
        const zetaWallet2 = new Wallet(wallet2)
        const client1 = await CrossClient.load(conn, zetaWallet1, confirmOptions)
        const client2 = await CrossClient.load(conn, zetaWallet2, confirmOptions)
        // const ratio = ((new Date().getTime()) % 100) / 200 + 0.5
        // const positionAmount = Math.floor(client1.account.balance.toNumber() > client2.account.balance.toNumber() ? client2.account.balance.toNumber() * ratio : client1.account.balance.toNumber() * ratio)
        try{
            await client1.placeOrder(asset, amount, orderLots, types.Side.BID)
        }catch(err){
            console.log(err)
        }
        try{
            await client2.placeOrder(asset, amount, 100, types.Side.ASK)
        }catch(err){
            console.log(err)
        }
        await sleep(20)
        try{
            await client1.updateState()
        }catch(err){
            console.log(err)
        }
        try{
            await client2.updateState()
        }catch(err){
            console.log(err)
        }
        await sleep(20)
        try{
            await client1.cancelAllMarketOrders()
        }catch(err){
            console.log(err)
        }
        try{
            await client2.cancelAllMarketOrders()
        }catch(err){
            console.log(err)
        }
        await sleep(200)
    }catch(err){
    }
}

const depositInZeta = async(wallet, depositAmount) => {
    const amount = depositAmount * (10**6)
    const zetaWallet = new Wallet(wallet)
    const client = await CrossClient.load(conn, zetaWallet, confirmOptions)
    console.log("Zeta Market: ", wallet.publicKey.toBase58()," depositing ", amount/(10**6), "USDC")
    const txId = await client.deposit(amount)
    console.log(txId)
    saveTransaction(wallet.publicKey.toBase58(), "", "Zeta Deposit", "USDC", amount/(10**6), "", txId)
    const rand = new Date().getTime()
    const duration = (rand % 50) + 10 // 10s ~ 60s
    await sleep(duration)
    return true;
}

const withdrawInZeta = async(wallet) => {
    const zetaWallet = new Wallet(wallet)
    const client = await CrossClient.load(conn, zetaWallet, confirmOptions)
    const amount = client.account.balance.toNumber()
    if(amount==0){
        return false;
    }
    console.log("Zeta Market: ", wallet.publicKey.toBase58(), " withdrawing ", amount/(10**6), "USDC")
    const txId = await client.withdrawAndCloseAccount(amount)
    console.log(txId)
    saveTransaction(wallet.publicKey.toBase58(), "", "Zeta Withdraw", "USDC", amount/(10**6), "", txId)
    const rand = new Date().getTime()
    const duration = (rand % 50) + 10 // 10s ~ 60s
    await sleep(duration)
    return true;
}

const loadZetaMarket = async() => {
    const loadExchangeConfig = types.defaultLoadExchangeConfig(
        'mainnet', conn
    )
    await Exchange.load(loadExchangeConfig, undefined)
}

module.exports = {
    prepareForZeta,
    workOnZeta,
    depositInZeta,
    withdrawInZeta,
    loadZetaMarket,
}