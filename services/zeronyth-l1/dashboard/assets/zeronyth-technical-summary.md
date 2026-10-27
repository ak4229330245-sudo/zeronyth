# ZERONYTH technical summary

Private developer devnet. Unaudited. Not an offer, forecast or investment promise.

## Implemented on the devnet
- Four-validator Hyperledger Besu 26.9 chain using QBFT, chain ID 9127, private.
- Block explorer, injected-wallet (EIP-1193) connection, developer faucet with no real value.
- Interface in Japanese, English, Simplified Chinese and Korean.

## Three separate cryptographic layers (all live layers are classical)
1. EVM transaction authorization: secp256k1 ECDSA.
2. Validator consensus: Besu QBFT with classical validator signatures and commit seals.
3. Node transport: Besu standard classical encrypted peer-to-peer transport.

## Independent experiments
- A separate lab supports ECDSA, ML-DSA and a hybrid that requires BOTH signatures, on its own chain 29127 with separate keys and storage.
- It is NOT compatible with Besu QBFT, does NOT send real EVM transactions and is NOT proof of a post-quantum live chain.
- Localhost four-process TCP tests are being added. They run on one machine and are not multi-host decentralization.
- The browser lab is a bounded computation and invitation-code WebRTC P2P demo. It is not a validator and pays no reward.

## Open acceptance gates (none recorded as passed)
- (a) Actual encrypted offsite backup and approved isolated recovery: not performed.
- (b) Real MetaMask, Rabby and mobile wallet tests: not performed.
- (c) Multi-host transport, adversarial consensus and online key lifecycle: not performed.
- (d) Third-party cryptographic and security review: not performed.
- (e) Public RPC and faucet rate limiting, authentication, monitoring and distinct operators: not performed.
- (f) Real browser validator and rewards: not implemented.

## Evidence
`assets/research-results.json` holds a historical record. It is not a fresh run unless the file states one. Read its `rerunInCurrentWork` field.

## Limits
No audit, no multi-host or public-network performance claim, no commercial throughput or SLA claim, no live post-quantum security claim.
