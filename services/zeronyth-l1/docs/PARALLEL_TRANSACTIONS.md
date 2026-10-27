# Parallel Transaction Processing

## Mechanism
- Transactions that do not touch the same accounts are grouped.
- Groups are executed in parallel across worker threads (up to 12).
- After parallel execution, a serial state-root cross-check is performed.
- Signature verification (ML-DSA) also runs in a parallel pool.
- No cryptographic shortcuts. Quantum resistance and privacy preserved.

## Configuration
- Default workers: min(12, availableParallelism())
- Explicit override possible for benchmarks
- Bound raised from 8 to 12 to match strengthened pools

## Safety
- Only account-disjoint transfers run in parallel
- Fail-closed on any mismatch
- Testnet / research path only
