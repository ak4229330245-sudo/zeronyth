# ZERONYTH Fast Chain + Quantum Resistance + Privacy (2026-10)

## Goal
User request: make the L1 much faster (no slow L1), while properly protecting quantum resistance and privacy. All chains remain testnet-only.

## Speed improvements (local / testnet)
- QBFT `blockperiodseconds kept at 1 (Besu compatibility) with requesttimeoutseconds=2 (1-second blocks with reduced request timeout; research native path targets much higher TPS).
- `requesttimeoutseconds` reduced to 2.
- Existing research labs already demonstrate:
  - Conflict-aware parallel execution of account-disjoint transfers.
  - CPU-aware worker pools.
  - Signature prefetch.
  - Asynchronous ordering with serial state-root cross-check.
- Local measured research path: hundreds of TPS on single machine with ML-DSA-65 (see PERFORMANCE_1_8_10.md). Production multi-region still requires further P2P and hardware validation.

## Quantum resistance
- Main Besu/EVM path remains ECDSA for compatibility (testnet only).
- Dedicated native ML-DSA-65 laboratory (pq-native/) provides post-quantum signatures for ordering, votes, and transactions.
- All research path signatures, 3-of-4 quorums, and state roots are independently verified.
- No claim of full quantum-resistant mainnet; this is the explicit research and migration path.

## Privacy
- `PrivateCommitment.sol` stores domain-separated commitments only (not full ZK privacy by itself).
- Designed as the on-chain anchor for future zk-proof integration.
- No private data is stored on-chain; only commitments.
- MEVShield and QuantumAccount contracts exist as research starting points.
- All multi-chain pages remain testnet-only; no mainnet asset exposure.

## AI from nodes
- Web Node Lab verified jobs can conceptually contribute compute toward Isolated AI Lab model growth.
- AI GROWTH metric added to node.html.
- Isolated AI Lab remains browser-side / local-only with clear no-value boundaries.

## Safety
- Entire multi-chain registry forces `environment: "testnet"`.
- Mainnet chain IDs are rejected at validation time.
- Swap / LP capabilities remain disabled until a verified testnet DEX route exists.
- Logo updated to new neon Z design.
