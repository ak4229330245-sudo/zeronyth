# Parallel Processing Strengthened (Quantum Resistance + Privacy Preserved)

## Changes
- Parallel execution pool upper bound: 8 → 12 workers
- ML-DSA signature verification pool upper bound: 8 → 12 workers
- Default research workers: min(12, availableParallelism())
- Signature prefetch remains enabled by default
- Conflict detection (account-disjoint groups only) unchanged
- Serial state-root cross-check after parallel execution unchanged
- Full ML-DSA verification on every transaction preserved (no shortcuts)
- Privacy: PrivateCommitment.sol remains the only on-chain privacy anchor; no plaintext

## Safety guarantees kept
- Fail-closed pools
- Resource limits on workers
- 3-of-4 quorum and independent validator verification
- No reduction in cryptographic checks
- Testnet / local research only

## Usage
Higher core-count machines will automatically use more workers.
Explicit overrides still possible for controlled benchmarks.
