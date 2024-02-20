require('dotenv').config();

const { Keypair } = require('@solana/web3.js');
const ethers = require('ethers')
const fs = require('fs')
const bs58 = require('bs58')

const {swapInJupiter, swapInPhoenix, swapInMayan, swapInDebridge, transferRemainingAssets, EXACT_COUNT, sleep, withdrawInZeta, depositInZeta, loadZetaMarket, prepareForZeta, workOnZeta} = require('./utils');
const globalTunnel = require('global-tunnel-ng');
const fetch = require('node-fetch');
const proxy = require("node-global-proxy").default;

let walletList = [];
let ProxyList = []

const GlobalSolWallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('./id.json', 'utf8'))))
const GlobalEthWallet = new ethers.Wallet(process.env.eth_wallet)

const loadWallets = () => {
    try{
        const fileName = './wallet.json'
        const rawData = fs.readFileSync(fileName, 'utf-8')
        const jsonData = JSON.parse(rawData)
        walletList = jsonData.map((item)=>{
            return {solWallet: Keypair.fromSecretKey(bs58.decode(item.solWallet)), ethWallet: new ethers.Wallet(item.ethWallet), count: item.count}
        })
    }catch(err){
    }
    if(walletList.length==0){
        walletList.push({solWallet: GlobalSolWallet, ethWallet: GlobalEthWallet, count: 0})
        saveWalletList()
    }
    for(let item of walletList){
        console.log(item.solWallet.publicKey.toBase58()+"  -  "+item.ethWallet.address+" : "+item.count)
    }
}

const saveWalletList = () => {
    const fileName = './wallet.json'
    fs.writeFile(fileName, JSON.stringify(walletList.map(item=>{
        return {solWallet: bs58.encode(item.solWallet.secretKey), ethWallet: item.ethWallet.privateKey, count: item.count}
    })), () => {})
}

const addNewWallet = () => {
    const solWallet = Keypair.generate()
    const ethWallet = ethers.Wallet.createRandom()
    walletList.push({solWallet: solWallet, ethWallet: ethWallet, count: 0})
    saveWalletList()
    return {solWallet, ethWallet}
}

const loadProxy = () => {
    try{
        const fileName = "./proxy.txt"
        const rawData = fs.readFileSync(fileName, 'utf-8')
        ProxyList = rawData.split(/\r?\n/)
        console.log("Proxy Count: ", ProxyList.length)
    }catch(err){

    }
}

const setProxy = (proxyNum) => {
    const proxy = ProxyList[proxyNum]
    const infos = proxy.split(":")
    globalTunnel.initialize({
        host: infos[0],
        port: Number(infos[1]),
        proxyAuth: infos[2]+":"+infos[3],
        connect: "both"
    })
}

const scenario = async() => {
    await loadZetaMarket()
    loadWallets()
    loadProxy()
    let selectedWalletNum = walletList.length - 1
    let selectedMarket = 4
    setProxy(selectedWalletNum % ProxyList.length)
    while(1){
        try{
            let selectedWallet = walletList[selectedWalletNum]
            // selectedMarket = (new Date().getTime()) % 5
            if(selectedWallet.count >= EXACT_COUNT){
                console.log("Going to new wallet...")
                if(selectedWalletNum==walletList.length-1){
                    addNewWallet()
                }
                await withdrawInZeta(walletList[walletList.length-2])
                await transferRemainingAssets(walletList[walletList.length-2], walletList[walletList.length-1])
                selectedWalletNum++;
                console.log(walletList[selectedWalletNum].solWallet.publicKey.toBase58(), "   ", walletList[selectedWalletNum].ethWallet.address)
                setProxy(selectedWalletNum % ProxyList.length)
                selectedWallet = walletList[selectedWalletNum]
            }
            const response = await fetch("https://ident.me/ip")
            console.log("Current IP: ",await response.text())
            let res = false
            if(selectedMarket==0)
                res = await swapInJupiter(selectedWallet.solWallet)
            else if(selectedMarket==1)
                res = await swapInPhoenix(selectedWallet.solWallet)
            else if(selectedMarket==2)
                res = await swapInMayan(selectedWallet.solWallet, selectedWallet.ethWallet)
            else if(selectedMarket==3)
                res = await swapInDebridge(selectedWallet.solWallet, selectedWallet.ethWallet)
            else if(selectedMarket==4){
                if(selectedWalletNum==walletList.length-1){
                    addNewWallet()
                }
                if(await prepareForZeta(selectedWallet.solWallet, walletList[walletList.length-1].solWallet))
                    await workOnZeta(selectedWallet.solWallet, walletList[walletList.length-1].solWallet)
                // res = true;
            }
            if(res){
                walletList[selectedWalletNum].count = walletList[selectedWalletNum].count + 1
                saveWalletList()
                selectedMarket = (selectedMarket + 1) % 6;
            }
        }catch(err){
            console.log(err)
        }
    }
}

scenario()

