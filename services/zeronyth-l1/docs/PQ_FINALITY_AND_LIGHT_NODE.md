# PQ finality layer + browser light node (ZERONYTH L1, chain 9127)

## What it is / 概要
- **PQ finality layer** (`scripts/pq-finality.mjs`, started by `start-replit.mjs`, 127.0.0.1:8799, proxied at `/api/pq/*`):
  every QBFT-finalized block is first checked (parent link, block hash, ECDSA committed seals vs. validator set),
  then each validator's **ML-DSA-65** (FIPS 204, @noble/post-quantum) key signs
  `"ZERONYTH-PQ-FINALITY-v1" ‖ chainId ‖ height ‖ blockHash ‖ validatorSetHash ‖ pqSetHash`.
  A certificate with ≥ floor(2N/3)+1 valid ML-DSA signatures is served at `/api/pq/finality/<height>` and `/api/pq/finality/latest`.
- **PQ registry** (`/api/pq/validators`): each ML-DSA public key is bound to its Besu validator address by a dual signature
  (secp256k1 by the validator node key + ML-DSA-65 by the PQ key) over `keccak("ZERONYTH-PQ-BIND-v1" ‖ address ‖ pqPk)`.
- **Light node** (`node.html`, installable PWA): pure browser JS, no keys. It anchors on the latest PQ certificate,
  verifies it (ML-DSA quorum) and every following header (keccak hash chain + ECDSA committed seals, ceil(2N/3) quorum,
  validator-set changes tracked from QBFT votes), shows verified / PQ-final height, and can relay only *locally verified*
  headers to WebRTC peers. 秘密鍵なし・資金なしでブラウザだけで検証します。
- Explorer `index.html` shows a **PQ-final** cell.

## What stays ECDSA / ECDSAのまま残るもの (honest)
| Part | Signature | Notes |
|---|---|---|
| Besu QBFT block proposal + committed seals | secp256k1 ECDSA | Besu consensus is unchanged. Block production does not depend on PQ. |
| Normal EOA transactions (wallets, faucet) | secp256k1 ECDSA | Ethereum tx format. |
| Besu P2P (devp2p/RLPx) | secp256k1 ECDH | loopback/Tailscale only. |
| PQ finality certificates | **ML-DSA-65** | additional layer, verified by light nodes. |
| `pq-native/` research chain | **ML-DSA-65** (node:crypto, Node ≥ 24) | separate lab chain, not the Besu chain. |

日本語: Besuチェーンの合意署名とトランザクション署名はECDSAのままです。耐量子性は「確定証明（ファイナリティ証明）層」として追加されています。

## Threat model / 脅威モデル
- **Protects against:** a future attacker able to forge secp256k1 signatures (quantum) trying to convince a light node of a
  fake history: forged ECDSA seals alone are not enough, the light node also requires an ML-DSA quorum certificate whose
  hash chain covers the header (a certificate at height h finalizes all ancestors via parent hashes; keccak-256 is considered PQ-safe at 128-bit).
- **Does NOT protect against:** theft of EOA funds by forging ECDSA tx signatures (needs PQ accounts, see roadmap);
  a quantum attacker producing blocks on the Besu network itself (Besu still accepts ECDSA); compromise of the host.
- **Trust bootstrapping:** the PQ set is pinned trust-on-first-use in localStorage (warning if it changes). Binding is
  checked against the validator set of the anchor block, which is itself ECDSA-authenticated → first contact is only as strong as ECDSA + TOFU.
- **Co-location (important):** on this testnet all 4 validators and their ML-DSA keys run on **one VPS**. The quorum is
  cryptographically real but not independent; whoever controls the host controls all keys. Real decentralisation needs operators on different machines.
- Seeds: `node-data/node{i}/pq-mldsa65.seed` (32 bytes, mode 0600, never logged/printed, never served).

## Measurements (box, Node 20, 2 vCPU limit for Besu)
- ML-DSA-65 sign: ~38–41 ms per block (4 signatures), quorum self-verify ~14 ms, ECDSA header verify ~7 ms → well under 1 s block period.
- Certificate ≈ 18.2 KB (≈ 13.7 KB gzip). RSS ≈ 92–115 MB (ring of 600 certs, `PQ_RING`).
- Browser (headless Chrome, mobile emulation): header verify ~2.2 ms, PQ cert verify ~8–9 ms for 4 sigs.
- VPS numbers: see deployment report.

## Commands
```
curl -s http://<host>:22673/api/pq/stats
curl -s 'http://<host>:22673/api/pq/finality/latest?summary=1'
open http://<host>:22673/node.html?light=1     # PWA install needs HTTPS (or localhost)
ZERONYTH_PQ_FINALITY=0  # disable the layer
```
