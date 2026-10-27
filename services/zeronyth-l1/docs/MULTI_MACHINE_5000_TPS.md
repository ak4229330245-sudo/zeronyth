# Multi-Machine 5,000 TPS Verification Procedure

## Goal
Validate sustained throughput on the ML-DSA research path across multiple machines
without sacrificing quantum resistance or privacy.

## Requirements
- Node.js 24+ on each machine (ML-DSA support)
- 4+ independent machines or VMs
- Low-latency private network
- Full ML-DSA verification on every transaction

## Steps
1. Deploy validator replicas on each machine using pq-native consensus.
2. Start with single-pass quorum fast path enabled.
3. Drive load for 10+ minutes.
4. Record:
   - Sustained TPS
   - p50 / p95 / p99 finality
   - CPU, memory, I/O
   - Recovery after partition / restart
5. Confirm no signature verification was skipped.

## Notes
- This procedure is the gate listed in PERFORMANCE_1_8_10.md.
- Do not claim 5,000 TPS until these conditions are met.
- 10,000 TPS remains a longer-term target.
