# ZERONYTH

ZERONYTH is a public, quantum-resistant EVM **testnet** built on Hyperledger Besu.
The live chain runs **QBFT with Falcon-1024 consensus signatures** and publishes **ML-DSA-65** (NIST FIPS 204) finality proofs.
EVM transaction signing is still ECDSA (standard wallets work as usual).

| | |
|---|---|
| Network | ZERONYTH Falcon Testnet |
| Chain ID | `912701` (`0xded3d`) |
| Native coin | **ZNYT** (test coin, no monetary value) |
| Consensus | Besu QBFT (custom build), Falcon-1024 seals, 4 validators, ~1 s blocks |
| Post-quantum | Falcon-1024 consensus signatures + ML-DSA-65 finality proofs |
| Tx signing | ECDSA (secp256k1), unchanged |
| Website | https://zeronyth.dpdns.org/ |
| Explorer | https://scan.zeronyth.dpdns.org/ |
| RPC | https://zeronyth.dpdns.org/rpc |
| Telegram | https://t.me/+5MZDdz-3_R9hYWI1 |
| Discord | https://discord.gg/qJTYpkbYNm |

> Testnet only. ZNYT has no value and the network may be reset. Never share a private key or seed phrase with anyone.

## Add the network to a wallet

```js
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '0xded3d',
    chainName: 'ZERONYTH Falcon Testnet',
    nativeCurrency: { name: 'ZNYT', symbol: 'ZNYT', decimals: 18 },
    rpcUrls: ['https://zeronyth.dpdns.org/rpc'],
    blockExplorerUrls: ['https://scan.zeronyth.dpdns.org/'],
  }],
});
```

The same values are in [`network/zeronyth-testnet.json`](network/zeronyth-testnet.json).

## Current status

| Item | Status |
|---|---|
| Faucet | 100 test ZNYT per claim, 1 hour cooldown (live values: `/api/faucet/health`) |
| Supply | Planned design: **100,000,000 ZNYT** (see Tokenomics on the site). The testnet genesis holds **2,000,000,000 test ZNYT** for testing only. |
| Full nodes | Published: [zeronyth-falcon-node](https://github.com/ak4229330245-sudo/zeronyth-falcon-node), release [`falcon-912701-v0.1.1`](https://github.com/ak4229330245-sudo/zeronyth-falcon-node/releases/tag/falcon-912701-v0.1.1). Outside nodes join as **non-validator** full nodes first. |
| Site AI | Qwen3-1.7B (Q4_K_M) on Ollama, CPU (live value: `/api/ai/status`) |
| Rewards | Three separate things: **points** (off-chain, Merkle root recorded on-chain daily), **test ZNYT** (no value), and **simulations** (display only). |
| VPS market | Preview only; not accepting orders. Older plans are marked as legacy. |
| Quantum wallet | Experimental ML-DSA-65 wallet on the site (`/quantum-wallet/`); key generation and signing only, it cannot send transactions yet. |

## Repository layout

```
network/                       Current network parameters (chain 912701)
services/zeronyth-l1/          Archived codebase of the previous chain 9127 (history, see below)
services/zeronyth-discord/     Discord bot (verify, language roles, GM streaks, /faucet, /status)
artifacts/, lib/               Workspace packages (API server, UI sandbox, shared libs)
tools/vendor-build/            Browser vendor bundle build
```

The node software for the current chain is in
[zeronyth-falcon-node](https://github.com/ak4229330245-sudo/zeronyth-falcon-node).

## History: chain 9127

The first ZERONYTH testnet was a Besu QBFT chain with chain ID `9127` (`0x23a7`), using classic ECDSA seals
and ML-DSA-65 finality checkpoints. It has been **stopped and archived** and replaced by chain 912701.
The code under `services/zeronyth-l1/` is kept as it was for reference; its chain IDs, genesis, scripts and
pages still refer to 9127 on purpose. Do not use them to connect to the current network.

Secrets (validator keys, ML-DSA / Falcon keys, bot tokens, wallet keys) are never stored in this repository.
Hostnames and IPs in ops scripts are placeholders (`YOUR_VPS_IP`, `YOUR_TAILSCALE_IP`).

## Security

See `services/zeronyth-l1/SECURITY.md`. Please report vulnerabilities privately via Discord rather than in public issues.

## License

MIT. See [LICENSE](LICENSE).
