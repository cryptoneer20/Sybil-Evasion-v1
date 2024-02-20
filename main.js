require('dotenv').config();

const { Keypair } = require('@solana/web3.js');
const ethers = require('ethers')
const fs = require('fs')
const bs58 = require('bs58')

const {swapInJupiter, swapInPhoenix, transferRemainingAssets, swapInMayanSwap, bridgeInDebridgeV2, bridgeInMayanV2} = require('./utils');
const globalTunnel = require('global-tunnel-ng');
const fetch = require('node-fetch');
const { sleep } = require('@zetamarkets/sdk/dist/utils');
const proxy = require("node-global-proxy").default;

let walletList = []
let ProxyList = []

const WALLET_FILE_DIR = "./wallet_main.json"

const loadWallets = () => {
    try{
        const fileName = WALLET_FILE_DIR
        const rawData = fs.readFileSync(fileName, 'utf-8')
        const jsonData = JSON.parse(rawData)
        walletList = jsonData.map((item)=>{
            return {
                ...item,
                solWallet: Keypair.fromSecretKey(bs58.decode(item.solWallet)),
                ethWallet: new ethers.Wallet(item.ethWallet),
            }
        })
    }catch(err){
    }
    if(walletList.length==0){
        const GlobalSolWallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('./id.json', 'utf8'))))
        const GlobalEthWallet = new ethers.Wallet(process.env.eth_wallet)
        walletList.push({
            solWallet: GlobalSolWallet,
            ethWallet: GlobalEthWallet,
            count: 0,
            countJupiter: 0,
            countPhoenix: 0,
            countBridge: 0,
            countMayanSwap: 0,
        })
        saveWalletList()
    }
    for(let item of walletList){
        console.log(`${item.solWallet.publicKey.toBase58()}  &  ${item.ethWallet.address} - Total: ${item.count}  Jupiter: ${item.countJupiter}   Phoenix: ${item.countPhoenix}  Bridge: ${item.countBridge}  MayanSwap: ${item.countMayanSwap}`)
    }
}

const saveWalletList = () => {
    const fileName = WALLET_FILE_DIR
    fs.writeFile(fileName, JSON.stringify(walletList.map(item=>{
        return {
            ...item,
            solWallet: bs58.encode(item.solWallet.secretKey),
            ethWallet: item.ethWallet.privateKey,
        }
    })), () => {})
}

const addNewWallet = () => {
    const solWallet = Keypair.generate()
    const ethWallet = ethers.Wallet.createRandom()
    walletList.push({
        solWallet: solWallet,
        ethWallet: ethWallet,
        count: 0,
        countJupiter: 0,
        countPhoenix: 0,
        countBridge: 0,
        countMayanSwap: 0,
    })
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

const MIN_COUNT = 40
const MIN_JUPITER_COUNT = 17
const MAX_JUPITER_COUNT = 23
const MIN_PHOENIX_COUNT = 12
const MAX_PHOENIX_COUNT = 15
const MIN_MAYAN_DEBRIDGE_COUNT = 6
const MAX_MAYAN_DEBRIDGE_COUNT = 8
const MIN_MAYAN_SWAP_COUNT = 4
const MAX_MAYAN_SWAP_COUNT = 8

const selectNextDefi = (wallet) => {
    let defi = -1
    
    if(wallet.count > MIN_COUNT){
        if(wallet.countJupiter < MIN_JUPITER_COUNT) defi = 0;
        else if(wallet.countPhoenix < MIN_PHOENIX_COUNT) defi = 1;
        else if(wallet.countBridge < MIN_MAYAN_DEBRIDGE_COUNT) defi = 2;
        else if(wallet.countMayanSwap < MIN_MAYAN_SWAP_COUNT) defi = 3;
        else if(wallet.countBridge % 2 == 1) defi = 2
        else defi = -1
    }else{
        let isFound = false;
        while(!isFound){
            const rand = Math.round(Math.random() * 100) % 50
            if(rand<22){ //Jupiter
                defi = 0
                if(wallet.countJupiter<MAX_JUPITER_COUNT)
                    isFound = true
            }else if(rand<34){ //Phoenix
                defi = 1
                if(wallet.countPhoenix<MAX_PHOENIX_COUNT)
                    isFound = true
            }else if (rand<42){ //Mayan & Debridge
                defi = 2
                if(wallet.countBridge<MAX_MAYAN_DEBRIDGE_COUNT)
                    isFound = true
            }else{ // Mayan Swap
                defi = 3
                if(wallet.countMayanSwap<MAX_MAYAN_SWAP_COUNT)
                    isFound = true
            }
        }
    }

    return defi
}

const scenario = async() => {
    loadWallets()
    loadProxy()
    let selectedWalletNum = walletList.length - 1
    setProxy(selectedWalletNum % ProxyList.length)
    while(1){
        try{
            const response = await fetch("https://ident.me/ip")
            console.log("Current IP: ",await response.text())
            let selectedWallet = walletList[selectedWalletNum]
            let selectedDefi = selectNextDefi(selectedWallet)
            if(selectedDefi==-1){
                console.log("Going to new wallet...")
                addNewWallet()
                console.log("New wallet: "+walletList[selectedWalletNum+1].solWallet.publicKey.toBase58()+"   -   "+walletList[selectedWalletNum+1].ethWallet.address)
                transferRemainingAssets(selectedWallet, walletList[selectedWalletNum+1])
                selectedWalletNum++;
                setProxy(selectedWalletNum % ProxyList.length)
            }else{
                if(selectedDefi==0){
                    while(!(await swapInJupiter(selectedWallet.solWallet))) await sleep(5);
                    walletList[selectedWalletNum].countJupiter = walletList[selectedWalletNum].countJupiter + 1
                }else if(selectedDefi==1){
                    while(!(await swapInPhoenix(selectedWallet.solWallet))) await sleep(5);
                    walletList[selectedWalletNum].countPhoenix = walletList[selectedWalletNum].countPhoenix + 1
                }else if(selectedDefi==2){
                    let mayanOrDebridge = (new Date().getTime()) % 2
                    if(mayanOrDebridge==0){
                        while(!(await bridgeInMayanV2(selectedWallet.solWallet, selectedWallet.ethWallet, selectedWallet.countBridge%2))) await sleep(5);
                    }else{
                        while(!(await bridgeInDebridgeV2(selectedWallet.solWallet, selectedWallet.ethWallet, selectedWallet.countBridge%2))) await sleep(5);
                    }
                    walletList[selectedWalletNum].countBridge = walletList[selectedWalletNum].countBridge + 1
                }else if(selectedDefi==3){
                    while(!(await swapInMayanSwap(selectedWallet.solWallet)));
                    walletList[selectedWalletNum].countMayanSwap = walletList[selectedWalletNum].countMayanSwap + 1
                }
                walletList[selectedWalletNum].count = walletList[selectedWalletNum].count + 1
                saveWalletList()
            }
        }catch(err){
            console.log(err)
        }
    }
}

scenario()

