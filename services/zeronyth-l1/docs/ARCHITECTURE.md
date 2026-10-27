# Architecture

```text
Browser / Wallet
   │
   ├── http://127.0.0.1:8080 ── nginx explorer
   │                                ├── /rpc ───────────────┐
   │                                └── /api/faucet/* ──┐   │
   │                                                   │   │
   └── http://127.0.0.1:8545 ──────────────────────────┼───▼
                                                       │  Besu node1 (validator + RPC)
                                                       │        │
                                                       ▼        │ QBFT P2P (Docker-only)
                                                   Faucet       ├── node2 validator
                                                   service      ├── node3 validator
                                                                └── node4 validator
```

All four validators use generated node identities. Static peer lists contain only the other three peers for each
validator. Discovery is disabled for the local deterministic devnet.

The v1.8.6 Explorer also provides a static `/node.html` **opt-in browser research
lab** backed by same-origin Web Workers. It performs local SHA-256 verification
only; no traffic to actual P2P providers or reward ledgers. See
[`WEB_NODE_LAB.md`](WEB_NODE_LAB.md) for security/lifecycle boundaries.

In v1.8.7, `/node.html` also includes a consent-gated **browser WebRTC P2P
transport lab**: participants join a 128-bit random invite room through the
same-origin `/api/p2p/*` proxy to an in-memory, private Docker signaling service;
the service relays SDP/ICE only. Once WebRTC connectivity succeeds, browsers
exchange small cryptographic hash challenges over a directly encrypted data
channel, with independent result verification. This is not validator state
sync, permissionless L1 P2P discovery or durable public infrastructure.
See [`WEBRTC_P2P_LAB.md`](WEBRTC_P2P_LAB.md).

In v1.8.8 there is also a strictly **opt-in four-independent-host Besu QBFT**
configuration exporter (`scripts/prepare-remote-validators.py`) for a private
operator VPN. It preserves the same generated genesis and distributes one
validator identity to each separately operated host, with static peer URLs for
the other three. This is distinct from browser WebRTC P2P and ML-DSA-native
research. The existing single-host Docker developer stack is unchanged. See
[`INDEPENDENT_VALIDATOR_P2P.md`](INDEPENDENT_VALIDATOR_P2P.md).

Sample security modules are deliberately separate from consensus:

- `QuantumAccount.sol` — hybrid/PQC metadata + delayed guardian recovery.
- `MEVShield.sol` — commit/reveal primitive.
- `PrivateCommitment.sol` — commitment registry primitive.
- `pqc/ml_dsa_adapter.py` — optional off-chain ML-DSA-65 adapter.

The package separates *PQC experimentation* from *PQC claims*. Standard EVM transactions remain classically signed
until a verified validation path is integrated.

## Operational safety

`./scripts/start.sh` preserves existing validator identities and chain data during routine starts. `scripts/init-network.sh` validates and reuses a complete existing network, and fails closed if it detects partial generated state. It never deletes existing chain state. To intentionally discard the local chain, back it up and explicitly run `./scripts/reset-network.sh`, then `./scripts/init-network.sh`. `./scripts/doctor.sh` checks Docker availability and localhost ports before a fresh startup.

The faucet validates that `FAUCET_PRIVATE_KEY` matches `FAUCET_ADDRESS`, serializes nonce use, bounds its transaction queue, requires JSON claim requests, and remains Docker-internal behind the localhost-only explorer proxy.
