const {
	Connection,
	PublicKey,
	Keypair,
	SystemProgram,
	SYSVAR_CLOCK_PUBKEY,
	SYSVAR_RENT_PUBKEY,
	Transaction,
	TransactionInstruction, ComputeBudgetProgram
} = require('@solana/web3.js')
const { blob, struct, u16, u8 } = require( '@solana/buffer-layout')
const {
	getAmountOfFractionalAmount,
	getAssociatedTokenAddress, getGasDecimalsInSolana,
	getWormholeChainIdByName,
	hexToUint8Array,
	nativeAddressToHexString,
	getSafeU64Blob,
} = require('./utils')
const { Buffer } = require('buffer')
const addresses  = require('./addresses')
const { ethers } = require('ethers')
const { getCurrentSolanaTime } = require('./api')

const STATE_SIZE = 348;

function createAssociatedTokenAccountInstruction(
	payer,
	associatedToken,
	owner,
	mint,
	programId = new PublicKey(addresses.TOKEN_PROGRAM_ID),
	associatedTokenProgramId = new PublicKey(addresses.ASSOCIATED_TOKEN_PROGRAM_ID)
) {
	const keys = [
		{ pubkey: payer, isSigner: true, isWritable: true },
		{ pubkey: associatedToken, isSigner: false, isWritable: true },
		{ pubkey: owner, isSigner: false, isWritable: false },
		{ pubkey: mint, isSigner: false, isWritable: false },
		{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		{ pubkey: programId, isSigner: false, isWritable: false },
		{ pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
	];

	return new TransactionInstruction({
		keys,
		programId: associatedTokenProgramId,
		data: Buffer.alloc(0),
	});
}

const ApproveInstructionData = struct([
	u8('instruction'), blob(8, 'amount')
]);
function createApproveInstruction(
	account,
	delegate,
	owner,
	amount,
	programId = new PublicKey(addresses.TOKEN_PROGRAM_ID)
) {
	const keys = [
		{ pubkey: account, isSigner: false, isWritable: true },
		{ pubkey: delegate, isSigner: false, isWritable: false },
		{ pubkey: owner, isSigner: true, isWritable: false },
	];

	const data = Buffer.alloc(ApproveInstructionData.span);
	ApproveInstructionData.encode(
		{
			instruction: 4,
			amount: getSafeU64Blob(amount),
		},
		data
	);
	return new TransactionInstruction({ keys, programId, data });
}

const SyncNativeInstructionData = struct([u8('instruction')]);
function createSyncNativeInstruction(
	account) {
	const keys = [{ pubkey: account, isSigner: false, isWritable: true }];

	const data = Buffer.alloc(SyncNativeInstructionData.span);
	SyncNativeInstructionData.encode({ instruction: 17 }, data);

	return new TransactionInstruction({
		keys,
		programId: new PublicKey(addresses.TOKEN_PROGRAM_ID),
		data
	});
}

const CloseAccountInstructionData = struct([
	u8('instruction')
]);
function createCloseAccountInstruction(
	account,
	destination,
	owner,
	programId = new PublicKey(addresses.TOKEN_PROGRAM_ID)
) {
	const keys = [
		{ pubkey: account, isSigner: false, isWritable: true },
		{ pubkey: destination, isSigner: false, isWritable: true },
		{ pubkey: owner, isSigner: true, isWritable: false },
	];

	const data = Buffer.alloc(CloseAccountInstructionData.span);
	CloseAccountInstructionData.encode(
		{
			instruction: 9,
		},
		data
	);
	return new TransactionInstruction({ keys, programId, data });
}

const SplTransferInstructionData = struct([
	u8('instruction'), blob(8, 'amount')
]);
function createSplTransferInstruction(
	source,
	destination,
	owner,
	amount,
	programId = new PublicKey(addresses.TOKEN_PROGRAM_ID)
) {
	const keys = [
		{ pubkey: source, isSigner: false, isWritable: true },
		{ pubkey: destination, isSigner: false, isWritable: true },
		{ pubkey: owner, isSigner: true, isWritable: false },
	];

	const data = Buffer.alloc(SplTransferInstructionData.span);
	SplTransferInstructionData.encode(
		{
			instruction: 3,
			amount: getSafeU64Blob(amount),
		},
		data
	);
	return new TransactionInstruction({ keys, programId, data });
}

const SwapLayout = struct([
	u8('instruction'),
	u8('mainNonce'),
	u8('stateNonce'),
	blob(8, 'amount'),
	blob(8, 'minAmountOut'),
	blob(8, 'deadline'),
	blob(8, 'feeSwap'),
	blob(8, 'feeReturn'),
	blob(8, 'feeCancel'),
	blob(8, 'gasDrop'),
	u16('destinationChain'),
	blob(32, 'destinationAddress'),
	u8('unwrapRedeem'),
	u8('unwrapRefund'),
]);

async function createSwapFromSolanaInstructions(
	quote, swapperWalletAddress, destinationAddress,
	timeout, referrerAddress,
	connection,
){
	let instructions = [];
	const solanaConnection = connection ??
		new Connection('https://rpc.ankr.com/solana');
	const mayanProgram = new PublicKey(addresses.MAYAN_PROGRAM_ID);
	const tokenProgram = new PublicKey(addresses.TOKEN_PROGRAM_ID);
	const swapper = new PublicKey(swapperWalletAddress);

	const auctionAddr = new PublicKey(addresses.AUCTION_PROGRAM_ID);

	if (quote.suggestedPriorityFee > 0) {
		instructions.push(ComputeBudgetProgram.setComputeUnitPrice({
			microLamports: quote.suggestedPriorityFee,
		}))
	}

	let referrerAddr;
	if (referrerAddress) {
		referrerAddr = new PublicKey(referrerAddress);
	} else {
		referrerAddr = SystemProgram.programId;
	}

	const [main, mainNonce] = await PublicKey.findProgramAddress(
		[Buffer.from('MAIN')],
		mayanProgram,
	);
	const msg1 = Keypair.generate();
	const msg2 = Keypair.generate();
	const [state, stateNonce] = await PublicKey.findProgramAddress(
		[
			Buffer.from('V2STATE'),
			Buffer.from(msg1.publicKey.toBytes()),
			Buffer.from(msg2.publicKey.toBytes()),
		],
		mayanProgram,
	);
	const fromMint = new PublicKey(quote.fromToken.mint);
	const toMint = new PublicKey(quote.toToken.mint);
	const fromAccount = await getAssociatedTokenAddress(fromMint, swapper);
	const toAccount = await getAssociatedTokenAddress(fromMint, main, true);



	const fromAccountData = await solanaConnection.getAccountInfo(
		fromAccount, 'finalized');
	if (!fromAccountData || fromAccountData.data.length === 0) {
		instructions.push(createAssociatedTokenAccountInstruction(
			swapper, fromAccount, swapper, fromMint
		));
	}

	const toAccountData = await solanaConnection.getAccountInfo(
		toAccount, 'finalized');
	if (!toAccountData || toAccountData.data.length === 0) {
		instructions.push(createAssociatedTokenAccountInstruction(
			swapper, toAccount, main, fromMint
		));
	}

	if (quote.fromToken.contract === ethers.constants.AddressZero) {
		instructions.push(SystemProgram.transfer({
			fromPubkey: swapper,
			toPubkey: fromAccount,
			lamports: getAmountOfFractionalAmount(
				quote.effectiveAmountIn, 9).toBigInt(),
		}));
		instructions.push(createSyncNativeInstruction(fromAccount));
	}

	const amount = getAmountOfFractionalAmount(
		quote.effectiveAmountIn, quote.mintDecimals.from);

	const delegate = Keypair.generate();
	instructions.push(createApproveInstruction(
		fromAccount, delegate.publicKey, swapper, amount.toBigInt()
	));

	const stateRent =
		await solanaConnection.getMinimumBalanceForRentExemption(STATE_SIZE);
	instructions.push(SystemProgram.transfer({
		fromPubkey: swapper,
		toPubkey: delegate.publicKey,
		lamports: stateRent,
	}));

	const swapKeys = [
		{pubkey: delegate.publicKey, isWritable: false, isSigner: true},
		{pubkey: main, isWritable: false, isSigner: false},
		{pubkey: msg1.publicKey, isWritable: false, isSigner: true},
		{pubkey: msg2.publicKey, isWritable: false, isSigner: true},
		{pubkey: state, isWritable: true, isSigner: false},
		{pubkey: fromAccount, isWritable: true, isSigner: false},
		{pubkey: swapper, isWritable: false, isSigner: false},
		{pubkey: toAccount, isWritable: true, isSigner: false},
		{pubkey: fromMint, isWritable: false, isSigner: false},
		{pubkey: toMint, isWritable: false, isSigner: false},
		{pubkey: auctionAddr, isWritable: false, isSigner: false},
		{pubkey: referrerAddr, isWritable: false, isSigner: false},
		{pubkey: delegate.publicKey, isWritable: true, isSigner: true},
		{pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false},
		{pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false},
		{pubkey: tokenProgram, isWritable: false, isSigner: false},
		{pubkey: SystemProgram.programId, isWritable: false, isSigner: false},
	];

	const solanaTime = await getCurrentSolanaTime();
	const destinationChainId = getWormholeChainIdByName(quote.toChain);

	if (destinationChainId === 1) { //destination address safety check!
		const destinationAccount =
			await solanaConnection.getAccountInfo(new PublicKey(destinationAddress));
		if (destinationAccount && destinationAccount.owner &&
			destinationAccount.owner.equals(tokenProgram)) {
			throw new Error(
				'Destination address is not about token account.' +
				' It should be a owner address'
			);
		}
	}
	const destAddress = Buffer.from(
		hexToUint8Array(
			nativeAddressToHexString(destinationAddress, destinationChainId)
		)
	);

	const minAmountOut = getAmountOfFractionalAmount(
		quote.minAmountOut, quote.mintDecimals.to);
	const feeSwap = getAmountOfFractionalAmount(
		quote.swapRelayerFee, quote.mintDecimals.from);
	const feeReturn = getAmountOfFractionalAmount(
		quote.redeemRelayerFee, quote.mintDecimals.to);
	const feeCancel = getAmountOfFractionalAmount(
		quote.refundRelayerFee, quote.mintDecimals.from);
	const gasDrop = getAmountOfFractionalAmount(
		quote.gasDrop, getGasDecimalsInSolana(quote.toChain));

	const unwrapRedeem =
		quote.toToken.contract === ethers.constants.AddressZero;
	const unwrapRefund =
		quote.fromToken.contract === ethers.constants.AddressZero;


	const deadline = BigInt(solanaTime + timeout);

	const swapData = Buffer.alloc(SwapLayout.span);
	const swapFields = {
		instruction: 101,
		mainNonce,
		stateNonce,
		amount: getSafeU64Blob(amount.toBigInt()),
		minAmountOut: getSafeU64Blob(minAmountOut.toBigInt()),
		deadline: getSafeU64Blob(deadline),
		feeSwap: getSafeU64Blob(feeSwap.toBigInt()),
		feeReturn: getSafeU64Blob(feeReturn.toBigInt()),
		feeCancel: getSafeU64Blob(feeCancel.toBigInt()),
		gasDrop: getSafeU64Blob(gasDrop.toBigInt()),
		destinationChain: destinationChainId,
		destinationAddress: destAddress,
		unwrapRedeem: unwrapRedeem ? 1 : 0,
		unwrapRefund: unwrapRefund ? 1 : 0,
	}
	SwapLayout.encode(swapFields, swapData);
	const swapInstruction = new TransactionInstruction({
		keys: swapKeys,
		data: swapData,
		programId: mayanProgram,
	});
	instructions.push(swapInstruction);

	return {
		instructions,
		signers: [delegate, msg1, msg2],
	};
}
async function swapFromSolana(
	quote, swapperWalletAddress, destinationAddress,
	timeout, referrerAddress,
	signTransaction, connection
) {
	const solanaConnection = connection ??
		new Connection('https://rpc.ankr.com/solana');
	const { instructions, signers } = await createSwapFromSolanaInstructions(
		quote, swapperWalletAddress, destinationAddress,
		timeout, referrerAddress, connection);

	const swapper = new PublicKey(swapperWalletAddress);
	const { blockhash, lastValidBlockHeight } = await solanaConnection.getLatestBlockhash();
	const trx = new Transaction({
		feePayer: swapper,
		blockhash: blockhash,
		lastValidBlockHeight,
	});

	trx.add(...instructions);
	trx.recentBlockhash = blockhash;
	signers.forEach(signer => trx.partialSign(signer));
	const signedTrx = await signTransaction(trx);
	return await solanaConnection.sendRawTransaction(signedTrx.serialize());
}

const solMint = new PublicKey('So11111111111111111111111111111111111111112');

async function wrapSol(
	owner, amount,
	signTransaction, connection
) {
	const solanaConnection = connection ?? new Connection('https://rpc.ankr.com/solana');
	const toAccount = await getAssociatedTokenAddress(solMint, owner, false);

	const trx = new Transaction({
		feePayer: owner,
	});

	const toAccountData = await solanaConnection.getAccountInfo(toAccount, 'finalized');
	if (!toAccountData || toAccountData.data.length === 0) {
		trx.add(createAssociatedTokenAccountInstruction(
			owner, toAccount, owner, solMint
		));
	}

	trx.add(SystemProgram.transfer({
		fromPubkey: owner,
		toPubkey: toAccount,
		lamports: getAmountOfFractionalAmount(amount, 9).toBigInt(),
	}));

	trx.add(createSyncNativeInstruction(toAccount));

	const { blockhash } = await solanaConnection.getLatestBlockhash();
	trx.recentBlockhash = blockhash;
	const signedTrx = await signTransaction(trx);
	return await solanaConnection.sendRawTransaction(signedTrx.serialize());
}

async function unwrapSol(
	owner, amount,
	signTransaction, connection
) {
	const solanaConnection = connection ??
		new Connection('https://rpc.ankr.com/solana');
	const fromAccount = await getAssociatedTokenAddress(solMint, owner, false);
	const delegate = Keypair.generate();

	const trx = new Transaction({
		feePayer: owner,
	});

	const toAccount = await getAssociatedTokenAddress(
		solMint, delegate.publicKey, false);
	trx.add(createAssociatedTokenAccountInstruction(
		owner, toAccount, delegate.publicKey, solMint
	));

	trx.add(createSplTransferInstruction(
		fromAccount, toAccount, owner,
		getAmountOfFractionalAmount(amount, 9).toBigInt()
	));

	trx.add(createCloseAccountInstruction(
		toAccount, owner, delegate.publicKey
	));

	const { blockhash } = await solanaConnection.getLatestBlockhash();
	trx.recentBlockhash = blockhash;
	trx.partialSign(delegate);
	const signedTrx = await signTransaction(trx);
	return await solanaConnection.sendRawTransaction(signedTrx.serialize());
}

module.exports = {
	createSwapFromSolanaInstructions,
	swapFromSolana,
	wrapSol,
	unwrapSol
}