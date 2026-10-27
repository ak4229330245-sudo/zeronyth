# ZERONYTH / ZNYT — unified local testnet identity (v1.8.30)

## Status and boundaries

- New network/project brand: **ZERONYTH**.
- New intended native/gas/governance/compute-payment ticker: **ZNYT**.
- Existing uploaded or deployed **QSH / QTM** assets are **not ZNYT**. They are
  not migrated, burned, converted, merged, or given a new contract address.
- This ZIP contains an **experimental private developer kit**, not a public
  ZERONYTH blockchain. Never claim mainnet, an accessible public testnet,
  trading liquidity, token investment rights, or guaranteed provider rewards.
- The bundled EVM developer network is chain ID **9127 / 0x23a7** with Besu
  QBFT. The default RPC `http://127.0.0.1:8545`, Explorer
  `http://127.0.0.1:8080`, and faucet are **local only**. ZNYT is its native
  display unit; there is **no ZNYT ERC-20 contract address**.
- Keep the existing Besu chain/genesis, validator keys and node volumes unless
  deliberately provisioning a **fresh isolated devnet**. Changing wallet
  display metadata does not rewrite existing chain state or on-chain balances.

## New independent ZNYT namespace

- Development configuration uses `FAUCET_DRIP_ZNYT`. The faucet API exposes
  `balanceZNYT`, `dripZNYT`, and `amountZNYT` and the wallet identifies the
  EVM development network as ZERONYTH / ZNYT.
- The Explorer, local AI lab, security-engine network selector and tests use
  ZNYT. The faucet transfers the **native chain unit** via
  `eth_sendRawTransaction`, not a publicly issued ERC-20 token.
- The isolated research market now uses `znyt` / `ZNYT_LAB_NOT_REAL_TOKEN`
  for mock accounting and new domain separation. Old QTM-LAB signatures,
  serialized state and client schemas are **not compatible**. Do not reuse
  legacy test-ledger data in this new experimental version.
- The ML-DSA research chain is **not** this EVM chain and must not be
  represented as an on-chain ZNYT payment network.
- The separate chain's internal provider-config chain ID `19127` is not the
  EVM wallet chain ID `9127`.

## What remains to build

1. Fresh EVM chain and wallet-network verification, faucet tests, and explicit
   governance/fee-burn implementation (neither are active native tokenomics).
2. Authenticated optional nodes with independent capacity checks, sandboxed
   VPS and GPU execution, signed receipts, metering and anti-abuse controls.
3. AI deployment and verifiable consumption accounting; provider AI quota.
4. Local-to-public testnet deployment with real remote RPC and faucets only
   after security review and independent operator permission.

No existing third-party token, wallet, chain deployment, credential, private
key or previous ZIP is modified by this separate developer-kit version.
