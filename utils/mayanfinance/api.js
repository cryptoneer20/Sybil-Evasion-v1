const fetch = require('cross-fetch')
const addresses = require('./addresses')
const { checkSdkVersionSupport } = require('./utils')

async function fetchAllTokenList() {
	const res = await fetch(`${addresses.PRICE_URL}/tokens`, {
		method: 'GET',
		redirect: 'follow',
	});
	if (res.status === 200) {
		const result = await res.json();
		return result;
	}
	throw new Error('Cannot fetch Mayan tokens!');
}

async function fetchTokenList(chain, nonPortal){
	const res = await fetch(`${addresses.PRICE_URL}/tokens?chain=${chain}${nonPortal ? '&nonPortal=true' : ''}`);
	if (res.status === 200) {
		const result = await res.json();
		return result[chain];
	}
	throw new Error('Cannot fetch Mayan tokens!');
}

async function fetchQuote(params) {
	const { referrer, gasDrop } = params;
	const normalizedSlippage = params.slippage / 100;
	const baseUrl = `${addresses.PRICE_URL}/quote?`;
	const basicQueries = `amountIn=${params.amount}&fromToken=${params.fromToken}&fromChain=${params.fromChain}&toToken=${params.toToken}&toChain=${params.toChain}`;
	const criteriaQueries = `&slippage=${normalizedSlippage}${referrer ? `&referrer=${referrer}` : ''}${gasDrop ? `&gasDrop=${gasDrop}` : ''}`;
	const url = baseUrl + basicQueries + criteriaQueries;
	const res = await fetch(url, {
		method: 'GET',
		redirect: 'follow',
	});
	const result = await res.json();
	if (res.status !== 200) {
		throw {
			code: result?.code || 0,
			message: result?.msg || 'Route not found',
		}
	}
	if (!checkSdkVersionSupport(result.minimumSdkVersion)) {
		throw {
			code: 9999,
			message: 'Swap SDK is outdated!',
		}
	}
	return result;
}

async function getCurrentSolanaTime(){
	const res = await fetch(`${addresses.PRICE_URL}/clock/solana`, {
		method: 'GET',
		redirect: 'follow',
	});
	const result = await res.json();
	if (res.status !== 200) {
		throw result;
	}
	return result.clock;
}

module.exports = {
	fetchAllTokenList, fetchTokenList, fetchQuote, getCurrentSolanaTime
}