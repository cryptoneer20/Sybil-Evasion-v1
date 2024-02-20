
# Sybil Evasion

## logic

1. Select a random wall

If it's the first time, we use global solana(id.json file) and etherem(set in .env file) wallet.
Sometimes, we create a pair of solana and evm wallet. At that time, we send Sol from last created one to the new account so that it can make transactions.

2. Select the market and swap router

There are several markets(Jupiter, Phoenix, Mayan....) and various router(sol->usdc, sol->eth, bnb->eth...) for each market.

We repeat above strategies. When new account is created, it's saved automatically in wallet.json file