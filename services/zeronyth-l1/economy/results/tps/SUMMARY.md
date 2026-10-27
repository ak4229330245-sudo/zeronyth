# Before/after benchmarks (2026-10-27 JST, box TEST chain 9127 / genesis 0x6ff4fbac…, 8 cores shared with the live primary)

All numbers are real measurements on this box; nothing simulated. Live chain was not benchmarked.

## 1. PQ signature verification (ML-DSA-65, full verify every signature) — results/pq-baseline/bench-verify-before-after.txt
| threads | before Node20/noble | after Node24/native OpenSSL |
|---|---|---|
| 1 | 345 /s | 5,287 /s |
| 4 | 1,396 /s | 21,501 /s (~15x) |
"Batched" = worker pool + public-key object cache; no algebraic batch verification exists for ML-DSA, no result cache, no weakening.

## 2. RPC reads through the gateway — rpc-lb-light.json / rpc-lb-heavy.json (bench-rpc-lb.mjs)
| workload | before (1 upstream) | after (4 upstreams, round-robin + lag check) |
|---|---|---|
| light reads (getBlock/getBalance/chainId), 32 conc | 3,662 req/s, p99 22.9 ms | 3,424 req/s, p99 21.6 ms (no gain: gateway-bound) |
| heavy eth_call (1.7M gas), 8 conc | 163 req/s, p99 133 ms | 255 req/s, p99 66 ms (+56%, p99 halved) |
Conclusion: balancing helps node-bound reads (eth_call / estimateGas heavy dapps); light head reads are bound by the
single Node gateway process (and on the live site are already coalesced by ZERONYTH_READ_CACHE_MS=500).

## 3. Tx inclusion (3000 tx, 30 senders) — before: ../bench-relay-workers2.jsonl, after: bench-relay-after.jsonl
| path | before inclusion TPS | after inclusion TPS |
|---|---|---|
| direct, 0% invalid | 1,129 | 1,054 |
| direct, 30% invalid, conc 4 | 1,459 | 1,141 |
| relay (pre-verify), 30% invalid, conc 1 | 271 | 211 |
| relay, 30% invalid, conc 4 | 458 | 563 |
Within run-to-run noise (block timing, shared CPU): this work did not change tx inclusion; the relay path verifies ECDSA,
not ML-DSA, so the native ML-DSA speedup does not apply to it. Direct submission remains ~2x the relay.
