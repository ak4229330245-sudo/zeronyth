# ZERONYTH testnet bridge (ZNYT ⇄ wZNYT)

**Testnet only. No real funds.** ZNYT is locked in `ZnytBridgeVault` on ZERONYTH (chain 9127).
A `BridgeMinter` on each EVM testnet then mints `wZNYT` (ERC-20, 18 decimals). Bridging back works the same way in reverse: you burn wZNYT and the vault releases ZNYT.

## Addresses
| Contract | Address |
|---|---|
| ZnytBridgeVault (9127) | `0x6a3d246c51721898095f88b491af6DED74e3E420` |
| BridgeMinter (all EVM testnets, CREATE2) | `0xA7c6c381CD599f5847f77c32e62c78a3b68581C1` |
| wZNYT (all EVM testnets) | `0x3700fC4f257fA7336Ae531C5f5a8B47e4d19FAFB` |
| BridgeAttestationBoard (9127) | `0x4a337b749c2c973C6f9e47e97A4E0247544a81D1` |
| Timelock, 24 h (9127, owns the vault) | `0xFeeE0734d180B1936b1f377bf6EE590814Ae753B` |
| Timelock, 24 h (each live EVM testnet, CREATE2, owns the minter) | `0x7834424B3718F1a0F2D2DaeaA6dE09faa69b09d4` |

The CREATE2 salt is `keccak256("ZERONYTH_BRIDGE_V1/minter")` and the factory is the deterministic-deployment proxy `0x4e59…956C`.
The token is the minter's CREATE nonce 1. Deploy txs and status are recorded in `deployments/main.json`.

Remote chains (status as of 2026-10-27; each live chain passed one real lock → mint → burn → release round trip, see `deployments/main-e2e-<chain>.json`):
- Base Sepolia 84532: live
- Ethereum Sepolia 11155111: live
- Arbitrum Sepolia 421614: live
- Robinhood Testnet 46630: live
- BNB Testnet 97: waiting for gas (registered in the vault as disabled)
- Monad Testnet 10143: waiting for gas (registered in the vault as disabled). The faucets need a mainnet balance: faucet.monad.xyz needs ≥0.03 ETH and 3 txs on Ethereum mainnet.

Base Sepolia and Arbitrum Sepolia gas was bridged from Sepolia through the official canonical bridges with `script/l1-deposit.mjs`. Base uses L1StandardBridge `0xfd0B…3120` and Arbitrum uses the Delayed Inbox `0xaAe2…ae21`.

Some public RPCs cap the `eth_getLogs` range: Base accepts 200 blocks and Monad 100. The relayer uses `LOG_RANGE` in `lib/chains.mjs` for these chains.

Mints toward a remote chain need 2 confirmations on 9127, so they land in seconds. Releases wait until the remote chain reports the burn block as `finalized`, which takes about 15–30 minutes on Sepolia and the L2s.

## Trust model (honest version)
- The relayers sign `keccak256(abi.encode(TAG, srcChainId, srcContract, dstChainId, dstContract, nonce, recipient, amount))` with EIP-191.
- A mint or release needs **3-of-4 relayer ECDSA signatures, verified on-chain** (since 2026-10-27 16:41 JST; before that 2-of-3).
- Relayer set: box `r0 0x0512…a6b7`, box `r1 0xeec4…f856`, ABLENET VPS `k0 0x9B19…297c`, VPS `k1 0x387b…B6bb`.
  The VPS keys were generated on the VPS and never left it. **No single machine holds the threshold.**
  Both machines are still run by one operator (ZeroLayer), so the bridge is *not* operator-decentralized yet. See `OPERATORS.md`.
- Signatures are gossiped through the public **BridgeAttestationBoard** on 9127 (`0x4a337b749c2c973C6f9e47e97A4E0247544a81D1`).
  Any relayer that sees `threshold` valid signatures submits the mint/release with its own gas (rank-staggered). The admin wallet does not submit.
- Each relayer also signs `"ZERONYTH_BRIDGE_V1/ML-DSA-65:" || digest` with **ML-DSA-65** and posts it to the board next to its ECDSA signature.
  Every relayer fully verifies the ML-DSA-65 signatures against the public keys registered on the board before counting a signer.
  - **ML-DSA is NOT verified on-chain.** It is an additional post-quantum check by the relayers and a public audit trail.
- Admin rights (`setRelayers`, `setGuardian`, `unpause`, `setChain`, `setLimits`, ownership) sit behind a **24 h TimelockController** on 9127 and on every minter.
  The admin is the only proposer; admin and guardian can cancel; anyone can execute after the delay. `pause()` stays instant for the guardian.
  `node script/timelock.mjs` lists queued operations (`--execute` runs ready ones).
- Safety measures:
  - Replay protection: a `processed[srcChain][nonce]` mapping, plus a digest bound to the chain IDs and contract addresses.
  - Caps: 0.01–1000 ZNYT per tx, and 10,000 ZNYT per chain per day, in each direction.
  - Guardian `pause()`.
  - Finality waits: 2 confirmations on 9127, and the `finalized` block tag on remote chains.
- Invariant checked every 30s: for each chain, wZNYT supply ≤ ZNYT outstanding to that chain, and Σ supply ≤ totalLocked ≤ vault balance.
  - On a violation the guardian pauses the vault automatically.
  - The auto-pause path is unit-tested but has not been exercised live.
  - The manual guardian pause was tested live.

## Running
- `pm2.config.cjs` starts the 2 box relayers (`zeronyth-bridge-relayer-0/1`) at nice 10 and 127.0.0.1 only. Relayer 2 was retired at the rotation.
  - The relayers write their state to `state/main/` (gitignored).
  - Keys are in `.secrets/` (0600, gitignored) and are backed up in `~/.zeronyth-secrets/`.
- `pm2.operator.config.cjs` runs an outside / second-machine relayer (used on the ABLENET VPS as `zeronyth-bridge-relayer-vps`, ~80 MB).
  It talks to 9127 through that machine's own node RPC and to remote chains through public RPCs. `script/operator-bundle.sh` builds the key-free kit.
- `script/decentralize.mjs --step=board|fund|rotate|timelock` performed the migration (records txs in `deployments/main.json`).
- Relayer 0 serves a read-only API on 127.0.0.1:9811. The gateway proxies it at `/api/bridge/*` (GET only, 5 req/s per IP).
  - Routes: `status` (includes `relayerSet`), `invariant`, `transfers?address=`, `transfer?id=`, `events?since=&limit=` and `attestations?id=`.
- **Points hook:** `GET /api/bridge/events?since=<seq>` returns `bridge_lock`, `attested`, `mint`, `burn` and `release` events with a monotonically increasing `seq`.
- Tests: `forge test` (21 tests: 15 bridge + 6 board/timelock/rotation). End-to-end tests: `node script/e2e.mjs` (against local anvil stand-ins with chain IDs 31337001–5).

## Activating a remote chain
1. Get that chain's test gas into the admin address `0xC9a31489E18AF737a3f4A105d3c97CC42edddec8`. You need about 0.005 for the deploy plus about 0.0003 per mint. Faucets are listed in `lib/chains.mjs`.
2. Run `BRIDGE_NETWORK=main node script/deploy.mjs --targets=real`. This deploys the minter and token at the addresses above and enables the chain in the vault.
3. The relayers pick up the newly enabled chain automatically.

## Solana Devnet (designed, not implemented)
- The bridge chain ID is `1_000_000_103`.
- The planned design has two parts:
  - an SPL mint whose mint authority is a PDA of a small Anchor program
  - that program, which verifies 2-of-3 secp256k1 relayer signatures over the same digest (via the secp256k1 precompile instruction) and records `processed` nonces in PDAs
- Burns would emit an event that the relayers turn into a vault `release`.
- None of this is built yet.
