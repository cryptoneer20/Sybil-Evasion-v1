const { zeroPad } = require('@ethersproject/bytes')
const { ethers } = require( 'ethers')
const { PublicKey } = require( '@solana/web3.js')
const { Buffer } = require( 'buffer')
const addresses = require('./addresses')
const sha3 = require('js-sha3')
const sha3_256 = sha3.sha3_256;

const isValidAptosType = (str) =>
	/^(0x)?[0-9a-fA-F]+::\w+::\w+$/.test(str);

function nativeAddressToHexString(
	address, wChainId) {
	let padded;
	if (wChainId === 1) {
		padded = zeroPad(new PublicKey(address).toBytes(), 32);
	} else if (
		wChainId === 2 || wChainId === 4 || wChainId === 5 ||
		wChainId === 6 || wChainId === 22 || wChainId === 23) {
		if (wChainId === 22 && isValidAptosType(address)) {
			return `0x${sha3_256(address)}`
		}
		let hex = (address).substring(2);
		const result = [];
		for (let i = 0; i < hex.length; i += 2) {
			result.push(parseInt(hex.substring(i, i + 2), 16));
		}
		padded = zeroPad(new Uint8Array(result), 32);
	} else {
		console.log(`Unsupported chain id: ${wChainId}`, address);
		throw new Error('Unsupported token chain');
	}
	const hex = Buffer.from(padded).toString("hex");
	return `0x${hex}`;
}

function hexToUint8Array(input) {
	return new Uint8Array(Buffer.from(input.substring(2), "hex"));
}

async function getCurrentEvmTime(
	provider
){
	const latestBlock = await provider.getBlock('latest');
	return latestBlock.timestamp;
}

async function getAssociatedTokenAddress(
	mint,
	owner,
	allowOwnerOffCurve = false,
	programId = new PublicKey(addresses.TOKEN_PROGRAM_ID),
	associatedTokenProgramId = new PublicKey(addresses.ASSOCIATED_TOKEN_PROGRAM_ID)
) {
	if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
		throw new Error('TokenOwnerOffCurveError');
	}

	const [address] = await PublicKey.findProgramAddress(
		[owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
		associatedTokenProgramId
	);

	return address;
}

function getAmountOfFractionalAmount(
	amount, decimals){
	const fixedAmount = Number(amount).toFixed(Math.min(8, Number(decimals)));
	return ethers.utils.parseUnits(fixedAmount, Number(decimals))
}

function getDisplayAmount(
	inputAmount, decimals){
	return  Number(ethers.utils.formatUnits(inputAmount, decimals))
}

const chains = {
	solana: 1,
	ethereum: 2,
	bsc: 4,
	polygon: 5,
	avalanche: 6,
	arbitrum: 23,
	aptos: 22,
};

function getWormholeChainIdByName(chain){
	return chains[chain];
}

const evmChainIdMap = {
	[1]: 2,
	[56]: 4,
	[137]: 5,
	[43114]: 6,
	[42161]: 23,
};

function getWormholeChainIdById(chainId){
	return evmChainIdMap[chainId];
}

const sdkVersion = [4, 5, 1];

function checkSdkVersionSupport(minimumVersion) {
	//major
	if (sdkVersion[0] < minimumVersion[0]) {
		return false;
	}
	if (sdkVersion[0] > minimumVersion[0]) {
		return true;
	}
	//minor
	if (sdkVersion[1] < minimumVersion[1]) {
		return false;
	}
	if (sdkVersion[1] > minimumVersion[1]) {
		return true;
	}
	//patch
	if (sdkVersion[2] >= minimumVersion[2]) {
		return true;
	}
	return false;
}

function getGasDecimal(chain) {
	if (chain === 'solana') {
		return 9;
	}
	return 18;
}

function getGasDecimalsInSolana(chain) {
	if (chain === 'solana') {
		return 9;
	}
	return 8;
}

const MAX_U64 = BigInt(2) ** BigInt(64) - BigInt(1);
function getSafeU64Blob(value) {
	if (value < BigInt(0) || value > MAX_U64) {
		throw new Error(`Invalid u64: ${value}`);
	}
	const buf = Buffer.alloc(8);
	buf.writeBigUInt64LE(value);
	return buf;
}

module.exports = {
	getSafeU64Blob,
	getGasDecimalsInSolana,
	getGasDecimal,
	checkSdkVersionSupport,
	getWormholeChainIdById,
	getDisplayAmount,
	getAmountOfFractionalAmount,
	getWormholeChainIdByName,
	getAssociatedTokenAddress,
	getCurrentEvmTime,
	hexToUint8Array,
	nativeAddressToHexString,
	isValidAptosType,
}