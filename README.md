# ZERONYTH

ZERONYTH is a public, quantum-resistant EVM testnet built on Hyperledger Besu with QBFT consensus.
Blocks are finalized by QBFT and additionally checkpointed with **ML-DSA-65** (NIST FIPS 204) post-quantum signatures.

| | |
|---|---|
| Chain ID | `9127` (`0x23a7`) |
| Native coin | **ZNYT** (test coin, no monetary value) |
| Consensus | Besu QBFT, 4 validators, ~1 s blocks |
| Post-quantum | ML-DSA-65 finality checkpoints and PQ lab |
| Website | https://zeronyth.dpdns.org/ |
| Explorer | https://scan.zeronyth.dpdns.org/ |
| RPC | https://zeronyth.dpdns.org/rpc |
| Discord | https://discord.gg/qJTYpkbYNm |

> Testnet only. Do not send real funds. Never share a private key or seed phrase with anyone.

## Repository layout

```
services/zeronyth-l1/          Chain, site and services
  config/                      Genesis and QBFT config (no keys)
  scripts/                     Gateway, network init/start, PQ finality signer, tooling
  dashboard/                   Website (static HTML/JS, 4 languages: en / ja / zh-CN / ko)
  explorer/                    ZERONYTH Scan (block explorer)
  faucet/                      Test ZNYT faucet
  ai-chat/                     Site AI assistant (retrieval + safety filters)
  points/                      Points service and test AMM contracts
  bridge/                      Test bridge contracts and relayers (testnets only)
  economy/                     Plans / access economy contracts and coordinator
  pq-native/                   ML-DSA-65 native PQ lab and light-node logic
  launch/                      Public launch, validator-join and load-test tooling
  deploy/box-primary/          Ops: pm2 configs, watchdogs, tunnel, edge fallback (placeholders for hosts)
  docs/                        Design notes and runbooks
  tests/                       Node and Python tests
services/zeronyth-discord/     Discord bot (verify, language roles, GM streaks, /faucet, /status)
artifacts/, lib/               Workspace packages (API server, UI sandbox, shared libs)
tools/vendor-build/            Browser vendor bundle build
```

## Getting started

1. Install Node.js 20+, Java 21 and Hyperledger Besu 26.x.
2. Copy `services/zeronyth-l1/.env.example` to `.env` and fill in your own test-only values.
3. See `services/zeronyth-l1/README.md` for network init, start and test commands, and
   `services/zeronyth-l1/launch/public/fullnode-join.md` to join the public testnet as a full node.

Secrets (validator keys, ML-DSA keys, bot tokens, wallet keys) are never stored in this repository.
Hostnames and IPs in ops scripts are placeholders (`YOUR_VPS_IP`, `YOUR_TAILSCALE_IP`); set them via env vars.

## Security

See `services/zeronyth-l1/SECURITY.md`. Please report vulnerabilities privately via Discord rather than in public issues.

## License

MIT. See [LICENSE](LICENSE).
