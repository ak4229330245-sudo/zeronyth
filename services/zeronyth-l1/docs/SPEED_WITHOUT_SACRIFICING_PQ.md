# Speed Improvements Without Sacrificing Quantum Resistance

## Changes applied
- Parallel execution pool max workers: 12 → 16
- ML-DSA signature verification pool max workers: 12 → 16
- Default research workers: min(16, availableParallelism())
- Signature prefetch remains enabled
- Account-disjoint parallel transaction execution remains active
- Serial state-root cross-check after parallel execution remains

## Quantum resistance preserved
- Every transaction still undergoes full ML-DSA-65 verification
- No signature shortcuts or skipped checks
- 3-of-4 quorum and independent validator verification unchanged
- Privacy commitments unchanged

## Expected effect
- Higher core-count machines can use more parallel workers
- Throughput improves on the research path without reducing security
- 10,000 TPS remains a long-term goal requiring multi-machine validation
