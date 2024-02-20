const { ethers } = require('ethers')
const { PublicKey, SystemProgram } = require('@solana/web3.js')

const {
	getCurrentEvmTime,
	getAssociatedTokenAddress,
	nativeAddressToHexString,
	getAmountOfFractionalAmount, getWormholeChainIdByName,
	getWormholeChainIdById, getGasDecimal
} = require('./utils')
const { getCurrentSolanaTime } = require('./api')
const MayanSwapArtifact = require('./MayanSwapArtifact')
const addresses  = require('./addresses')
const { Buffer } = require('buffer')

async function getEvmSwapParams(
	quote, destinationAddress,
	timeout, referrerAddress,
	provider, signerAddress,
	signerChainId, payload
){
	const mayanProgram = new PublicKey(addresses.MAYAN_PROGRAM_ID);
	const [mayanMainAccount] = await PublicKey.findProgramAddress(
		[Buffer.from('MAIN')], mayanProgram);
	const recipient = await getAssociatedTokenAddress(
		new PublicKey(quote.fromToken.mint),
		mayanMainAccount,
		true,
	);
	const amountIn = getAmountOfFractionalAmount(
		quote.effectiveAmountIn, quote.fromToken.decimals);
	const recipientHex = nativeAddressToHexString(recipient.toString(), 1);
	const auctionHex = nativeAddressToHexString(
		addresses.AUCTION_PROGRAM_ID, 1
	);
	let referrerHex;
	if (referrerAddress) {
		referrerHex = nativeAddressToHexString(
			referrerAddress, 1
		);
	} else {
		referrerHex = nativeAddressToHexString(
			SystemProgram.programId.toString(), 1
		);
	}
	const signerWormholeChainId = getWormholeChainIdById(Number(signerChainId));
	const fromChainId = getWormholeChainIdByName(quote.fromChain);
	const destinationChainId = getWormholeChainIdByName(quote.toChain);
	if (fromChainId !== signerWormholeChainId) {
		throw new Error('Signer chain id and quote from chain are not same!');
	}

	const contractAddress = addresses.MAYAN_EVM_CONTRACT;

	const recipientStruct = {
		mayanAddr: recipientHex,
		mayanChainId: 1,
		destAddr: nativeAddressToHexString(destinationAddress, destinationChainId),
		destChainId: destinationChainId,
		auctionAddr: auctionHex,
		referrer: referrerHex,
		refundAddr: nativeAddressToHexString(signerAddress, signerWormholeChainId),
	};
	// Times are in seconds
	const currentEvmTime = await getCurrentEvmTime(provider);
	const currentSolanaTime = await getCurrentSolanaTime();

	const unwrapRedeem =
		quote.toToken.contract === ethers.constants.AddressZero;

	const criteria = {
		transferDeadline: ethers.BigNumber.from(currentEvmTime + timeout),
		swapDeadline: ethers.BigNumber.from(currentSolanaTime + timeout),
		amountOutMin: getAmountOfFractionalAmount(
			quote.minAmountOut, Math.min(8, quote.toToken.decimals)
		),
		gasDrop: getAmountOfFractionalAmount(
			quote.gasDrop, Math.min(8, getGasDecimal(quote.toChain))
		),
		unwrap: unwrapRedeem,
		customPayload: payload ? `0x${Buffer.from(payload).toString('hex')}` : '0x',
	};

	const contractRelayerFees = {
		swapFee: getAmountOfFractionalAmount(quote.swapRelayerFee,
			Math.min(8, quote.fromToken.decimals)),
		redeemFee: getAmountOfFractionalAmount(quote.redeemRelayerFee,
			Math.min(8, quote.toToken.decimals)),
		refundFee: getAmountOfFractionalAmount(quote.refundRelayerFee,
			Math.min(8, quote.fromToken.decimals)),
	}
	const tokenOut = nativeAddressToHexString(
		quote.toToken.realOriginContractAddress, quote.toToken.realOriginChainId
	);

	const bridgeFee = getAmountOfFractionalAmount(
		quote.bridgeFee, 18
	);
	return {
		amountIn,
		tokenIn: quote.fromToken.contract,
		tokenOut,
		tokenOutWChainId: quote.toToken.realOriginChainId,
		criteria,
		recipient: recipientStruct,
		relayerFees: contractRelayerFees,
		contractAddress,
		bridgeFee,
	}
}

async function getSwapFromEvmTxPayload(
	quote, destinationAddress,
	timeout, referrerAddress,
	signerAddress, signerChainId,
	provider, payload
){
	const {
		relayerFees, recipient, tokenOut, tokenOutWChainId,
		criteria, tokenIn, amountIn, contractAddress, bridgeFee,
	} = await getEvmSwapParams(
		quote, destinationAddress, timeout, referrerAddress,
		provider, signerAddress, signerChainId, payload
	);
	const mayanSwap = new ethers.Contract(contractAddress, MayanSwapArtifact.abi);
	let data;
	let value;
	if (tokenIn === ethers.constants.AddressZero) {
		data = mayanSwap.interface.encodeFunctionData(
			"wrapAndSwapETH",
			[relayerFees, recipient, tokenOut, tokenOutWChainId, criteria]
		);
		value = ethers.utils.hexlify(amountIn);
	} else {
		data = mayanSwap.interface.encodeFunctionData(
			"swap",
			[relayerFees, recipient, tokenOut, tokenOutWChainId,
				criteria, tokenIn, amountIn]
		)
		value = ethers.utils.hexlify(bridgeFee);
	}
	return {
		to: contractAddress,
		data,
		value,
	}
}
async function swapFromEvm(
	quote, destinationAddress,
	timeout, referrerAddress,
	provider,
	signer, overrides, payload
){
	const signerAddress = await signer.getAddress();
	const signerChainId = await signer.getChainId();
	const swapParams =
		await getEvmSwapParams(
			quote, destinationAddress, timeout, referrerAddress,
			provider, signerAddress, signerChainId, payload
		);

	if (!overrides) {
		overrides = {
			value: swapParams.bridgeFee,
		}
	}

	if(swapParams.tokenIn === ethers.constants.AddressZero) {
		overrides.value = swapParams.amountIn;
		return wrapAndSwapETH(swapParams, signer, overrides);
	} else {
		if (!overrides.value) {
			overrides.value = swapParams.bridgeFee;
		}
		return swap(swapParams, signer, overrides);
	}
}

async function swap(
	swapData,
	signer,
	overrides
) {
	const {
		relayerFees, recipient, tokenOut, contractAddress,
		tokenOutWChainId, criteria, tokenIn, amountIn
	} = swapData;
	const mayanSwap =
		new ethers.Contract(contractAddress, MayanSwapArtifact.abi, signer);

	if (overrides) {
		return  mayanSwap.swap(relayerFees, recipient, tokenOut, tokenOutWChainId,
			criteria, tokenIn, amountIn, overrides);
	} else {
		return  mayanSwap.swap(relayerFees, recipient, tokenOut, tokenOutWChainId,
			criteria, tokenIn, amountIn);
	}
}


async function wrapAndSwapETH(
	swapParams,
	signer,
	overrides,
) {
	const {
		relayerFees, recipient, tokenOut,
		contractAddress, tokenOutWChainId, criteria,
		amountIn
	} = swapParams;
	const mayanSwap =
		new ethers.Contract(contractAddress, MayanSwapArtifact.abi, signer);
	return  mayanSwap.wrapAndSwapETH(
		relayerFees, recipient, tokenOut,
		tokenOutWChainId, criteria, overrides
	);
}

module.exports = {
	getSwapFromEvmTxPayload, swapFromEvm
}