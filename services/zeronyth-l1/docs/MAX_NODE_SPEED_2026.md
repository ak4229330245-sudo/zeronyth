# Maximizing ZERONYTH Chain Speed via Nodes (Quantum-Resistant + Privacy Preserved)

## Goal
Push local / research-path TPS as high as possible using node contributions,
without removing ML-DSA verification or privacy commitments.

## Applied changes
- Default research worker pools raised to `min(8, availableParallelism())`.
- Signature prefetch remains enabled by default.
- Conflict-aware parallel execution of account-disjoint transfers remains active.
- Quorum fast path (single-pass admission) available.
- All ML-DSA signature checks, 3-of-4 quorum, and serial state-root cross-check preserved.
- Privacy: PrivateCommitment remains the on-chain anchor; no plaintext on chain.

## How to run a high-speed local benchmark
```bash
cd services/zeronyth-l1
node pq-native/benchmark.mjs --transactions 256 --blocks 5
node pq-native/private-peer-demo.mjs 512 3 --single-pass
```

## Realistic expectation
- Single machine: hundreds to low thousands of TPS possible with the research path.
- 5000 TPS sustained still requires multi-machine + network validation (gates listed in PERFORMANCE_1_8_10.md).
- Node contributions (browser or hosted) feed the research pools and AI growth allocation.

## Safety
- No mainnet assets.
- Testnet / local only.
- Quantum resistance (ML-DSA) and privacy commitments are not disabled.
