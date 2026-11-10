# ZERONYTH

ZERONYTH is a public, quantum-resistant EVM network built on Hyperledger Besu.
The live chain runs **QBFT with Falcon-1024 consensus signatures** and publishes **ML-DSA-65** (NIST FIPS 204) finality proofs.
Since 5 November 2026 it also supports **native post-quantum transactions**: Falcon-1024 (type `0x7E`) and ML-DSA-65 (type `0x7F`)
accounts spend directly in the EVM, alongside ordinary ECDSA transactions (standard wallets work as usual).
Since 6 November 2026 a **zk-STARK privacy pool** (PrivatePoolG1) is deployed on the chain as the proof and privacy layer —
shielded transfers run as native ZK transactions (type `0x7D`) verified by STARK proofs.
The stack is four pillars: **ECDSA · Falcon · ML-DSA · zk-STARK**.
See the **[Whitepaper](WHITEPAPER.md)** for the full design, formats, and verification evidence.

| | |
|---|---|
| Network | ZERONYTH Falcon (production) |
| Chain ID | `912701` (`0xded3d`) |
| Native coin | **ZNYT** (no monetary value) |
| Consensus | Besu QBFT (custom build), Falcon-1024 seals, 4 validators, ~1 s blocks |
| Post-quantum | Falcon-1024 consensus signatures + ML-DSA-65 finality proofs + native PQ transactions + zk-STARK proofs |
| Tx signing | ECDSA (secp256k1) + **Falcon-1024 (`0x7E`)** + **ML-DSA-65 (`0x7F`)**, live since activation block `157773` (2026-11-05) |
| Proof / privacy | **zk-STARK** privacy pool (PrivatePoolG1, [`0xb69ba292…7862`](https://scan.zeronyth.dpdns.org/address/0xb69ba292fb84d3ab86aed617ba2a8fb4b38e7862)) — native ZK transactions (`0x7D`), STARKVERIFY precompile (`0x7d1`), deployed 2026-11-06 |
| Website | https://zeronyth.dpdns.org/ |
| Explorer | https://scan.zeronyth.dpdns.org/ |
| RPC | https://zeronyth.dpdns.org/rpc |
| Telegram | https://t.me/+5MZDdz-3_R9hYWI1 |
| Discord | https://discord.gg/qJTYpkbYNm |

> ZNYT has no monetary value. Never share a private key or seed phrase with anyone.

## Add the network to a wallet

```js
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '0xded3d',
    chainName: 'ZERONYTH Falcon',
    nativeCurrency: { name: 'ZNYT', symbol: 'ZNYT', decimals: 18 },
    rpcUrls: ['https://zeronyth.dpdns.org/rpc'],
    blockExplorerUrls: ['https://scan.zeronyth.dpdns.org/'],
  }],
});
```

The same values are in [`network/zeronyth-912701.json`](network/zeronyth-912701.json).

## Current status

| Item | Status |
|---|---|
| Faucet | 100 ZNYT per claim, 1 hour cooldown; claims are paid in the requested scheme — ECDSA, Falcon-1024 (`0x7E`) or ML-DSA-65 (`0x7F`) (live values: `/api/faucet/health`) |
| Supply | Planned design: **100,000,000 ZNYT** (see Tokenomics on the site). The production genesis holds **2,000,000,000 ZNYT**. |
| Full nodes | Published: [zeronyth-falcon-node](https://github.com/ak4229330245-sudo/zeronyth-falcon-node), release [`falcon-912701-v0.2.0`](https://github.com/ak4229330245-sudo/zeronyth-falcon-node/releases/tag/falcon-912701-v0.2.0). Outside nodes join as **non-validator** full nodes first. (The older v0.1.1 PQ-era build predates the ZK activation and stalls around blocks 241,814–242,419 — use v0.2.0.) |
| Production binary | 912701 runs the **besu-zk** build since 2026-11-06 (SHA-256 `c275a90b…` in [docs/BINARY-RELEASE.md](docs/BINARY-RELEASE.md)); outside nodes use node kit [falcon-912701-v0.2.0](https://github.com/ak4229330245-sudo/zeronyth-falcon-node/releases/tag/falcon-912701-v0.2.0). Source: [`besu-912701/`](besu-912701/), incl. the ZK part reconstructed from the production bytecode ([docs/ZK-SOURCE-RECONSTRUCTION.md](docs/ZK-SOURCE-RECONSTRUCTION.md)). |
| Site AI | Qwen3-1.7B (Q4_K_M) on Ollama, CPU (live value: `/api/ai/status`); every completed worker response is ML-DSA-65-signed and verified by the gateway before it is relayed (`/api/ai/worker-identity`) |
| Rewards | Three separate things: **points** (off-chain, Merkle root recorded on-chain daily), **test ZNYT** (no value), and **simulations** (display only). |
| VPS market | **Live — accepting orders.** AI VPS starter: 100 ZNYT / 10 days, paid with a native PQ transaction (Falcon-1024 `0x7E` / ML-DSA-65 `0x7F`); operator-fulfilled. Order at https://zeronyth.dpdns.org/vps.html — source: [`ai-vps-market/`](ai-vps-market/). Older plans are marked as legacy. |
| Quantum wallet | **v13** — the multi-scheme web wallet at [`/quantum-wallet/`](https://zeronyth.dpdns.org/quantum-wallet/): one vault for ECDSA, Falcon-1024 (`0x7E`) and ML-DSA-65 (`0x7F`) accounts across 16 networks. Keys never leave the device: it signs locally and submits native raw PQ transactions directly — no gateway transcoding. |
| PQ transactions | **Live** since block `157773` (2026-11-05). First production PQ tx (ML-DSA-65): [`0x8120159e…a3f9`](https://scan.zeronyth.dpdns.org/tx/0x8120159eb72a8a5462878636e858225661c304a3e87f4cb9687937b2d4a8a3f9) in block `165913`. Falcon-1024 production proof completed 2026-11-05 (tx `0x5cbfde62…6676`, block `184874`). Design and evidence: [WHITEPAPER.md](WHITEPAPER.md). |
| zk-STARK pool | **Deployed** 2026-11-06: PrivatePoolG1 at [`0xb69ba292fb84d3ab86aed617ba2a8fb4b38e7862`](https://scan.zeronyth.dpdns.org/address/0xb69ba292fb84d3ab86aed617ba2a8fb4b38e7862). Deposits become notes (commitments) in a depth-10 Merkle tree; shielded transfers spend notes with nullifiers + STARK proofs and run as native ZK transactions (`0x7D`); withdrawals verify a proof and return ZNYT. Cairo + Stone prover + StarkEx verifier contracts; in-statement Poseidon (in-program) and a Keccak-256 channel — hash-family assumptions only, no trusted setup. **v1 limits:** amounts are not hidden (note linkage is), proving takes ~5 min per action (off-chain, by the operator), practical capacity ≈1 ZK tx per block, unaudited (external audit deferred). |
| AMM | **Live** on 912701: on-chain swaps (WZNYT + 11 SwapLabPair pools, ZnytAmmRouters), usable from all three signing schemes; price keeper running. |
| Bridge | **Live (Gen2)**: wZNYT bridging between 912701 and Base / Ethereum / Arbitrum Sepolia + Robinhood; dual attestation (ECDSA on-chain + ML-DSA-65 by relayers); fully timelock-governed (24 h delay) on all five chains. |

## Repository layout

```
WHITEPAPER.md                  Design, PQ transaction formats, gas schedule, verification evidence
docs/                          Engineering record: port reports, provenance, upgrade plan, E2E evidence
besu-912701/                   Production node source (Besu 26.9.0 + ZERONYTH PQ + ZK patches; see besu-912701/ZERONYTH-SOURCE.md)
ai-vps-market/                 AI VPS rental service source — order market in the site gateway, PQ-tx payments, ML-DSA-signed admin + Discord notifications; live at zeronyth.dpdns.org/vps.html
network/                       Current network parameters (chain 912701)
services/zeronyth-discord/     Discord bot (verify, language roles, GM streaks, /faucet, /status)
artifacts/, lib/               Workspace packages (API server, UI sandbox, shared libs)
tools/vendor-build/            Browser vendor bundle build
```

The node software for the current chain is in
[zeronyth-falcon-node](https://github.com/ak4229330245-sudo/zeronyth-falcon-node).

## History: chain 9127

The first ZERONYTH testnet was a Besu QBFT chain with chain ID `9127` (`0x23a7`), using classic ECDSA seals
and ML-DSA-65 finality checkpoints. It has been **stopped and retired** and replaced by chain 912701.
Its codebase was removed from this repository in November 2026 so that this repository covers chain 912701
only; the 9127 code remains available in this repository's git history and in the operator's archives.

Secrets (validator keys, ML-DSA / Falcon keys, bot tokens, wallet keys) are never stored in this repository.

## Security

Please report vulnerabilities privately via Discord rather than in public issues.

## License

MIT. See [LICENSE](LICENSE).
