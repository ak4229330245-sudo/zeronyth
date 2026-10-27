# Customization Guide

Always run `make test` after source changes and `make reset && make start` after changing genesis/consensus settings.
Existing chain data is tied to the original genesis file.

## Rename the chain

Update branding in `README.md`, `product.json`, `dashboard/index.html`, `dashboard/assets/app.js`, and
`examples/metamask-network.json`.

## Change chain ID

Update all references to `9127` / `0x23a7` in:

- `config/qbftConfigFile.json`
- `docker-compose.yml` (`--network-id` and faucet `CHAIN_ID`)
- `scripts/validate-config.sh`, `scripts/smoke-test.sh`, and `scripts/wait-for-rpc.sh`
- `dashboard/assets/app.js`
- `examples/metamask-network.json`
- docs/metadata

Pick a chain ID appropriate to the target environment and check for collisions before public use.

## Change validator count

The starter kit is intentionally fixed at four validators. Four is the minimum count that provides QBFT Byzantine
fault tolerance for one faulty validator. Changing the count requires coordinated changes to Compose, key generation,
peer generation, validation, smoke tests, and operational assumptions.

## Change block time

Change `blockperiodseconds` in `config/qbftConfigFile.json`, then reset/regenerate the network. Keep
`requesttimeoutseconds` higher than the block period. Faster blocks increase operational sensitivity and do not
magically increase safe throughput.

## Change the faucet

`FAUCET_PRIVATE_KEY` and `FAUCET_ADDRESS` in `.env` are a matched development pair. If you replace them, derive the
new address correctly and prefund that same address in genesis before first start. Never use the bundled public dev key
on a public network.

## Change EVM fork rules

The sample contracts are pinned to Solidity 0.8.24 and the devnet activates Shanghai at genesis. If you change compiler
or EVM fork targets, verify opcode compatibility and regenerate chain data before testing.
