# ZERONYTH v1.8.9 — Local ML-DSA performance audit

**Status:** Measured four separate localhost ML-DSA validator processes,
**not** four geographically independent Besu/EVM validators or a public P2P
L1. Neither 5,000 nor 10,000 real TPS is established.

## Reproducible measurement

```bash
python3 scripts/benchmark-pq-phases.py --transactions 384 --blocks 3 --senders 16 --trials 2
```

The script creates a fresh four-process **temporary local** signed ML-DSA
quorum for each trial. Each trial uses 384 signed transfers/block, 3 blocks,
16 independent sender accounts, parallel mempool preverification, compact
staging with independent full block checks, 3-of-4 distinct signed votes and
fsync-backed certified block journal before final state. Results must agree
across all four replicas. Trial inputs, CPU load and operating system scheduling
still introduce noise; this is **not a sustained workload test**.

Observed on this development environment (2026-10-25):

| Metric | Sequential account execution | Parallel execution + serial state cross-check |
| --- | ---: | ---: |
| Median inclusive local TPS (2 runs) | **562.0** | **597.6** |
| Individual local TPS range | 484.0–640.0 | 586.2–609.0 |
| Median TPS including client signing | 340.15 | 364.70 |
| Mempool signature preverification (ms) | 646.31 | 646.11 |
| Proposal verification/state execution (ms) | 572.00 | 468.60 |
| Staging independent full checks (ms) | 506.09 | 440.50 |
| Collecting 3 signed votes (ms) | 70.76 | 77.53 |
| Four durable commits (ms) | 295.09 | 295.62 |

The parallel median was **6.33%** faster on this small two-trial run, but a
separate earlier single run in the same task gave **507.5 TPS sequential**
versus **455.8 TPS parallel**. Because results vary materially with run order,
the release **does not silently switch default execution mode**, bypass
independent ML-DSA verification, remove durable fsync, or drop its full serial
cross-checks. More repeated runs on controlled hardware are mandatory before
making an optimization decision.

## Bottleneck interpretation for the measured workload

For sequential mode, median phase costs sum to approximately:

1. Mempool preverification **30.9%**.
2. Proposal creation and full validation **27.4%**.
3. Independent staging verification **24.2%**.
4. Durable commit **14.1%**.
5. Vote collection **3.4%**.

These are **local wall-clock phase shares, not CPU flamegraph attribution**.
They overlap in real implementations and may change with transactions/sender
contention, workload, SSD, validator location and background load.

## Next performance gates

- Run 3–5+ repeat samples with fixed CPUs, recorded hardware, clean thermal
  conditions and varying distinct sender counts before adopting parallel mode.
- Profile ML-DSA signature verification cost separately from canonical
  transaction parsing/encoding, state-root computation and fsync.
- Keep cryptographic verification and complete deterministic serial fallback;
  do **not** cache unverifiable messages, shortcut quorum or skip disk writes.
- Test multiple independent operators through the newly packaged private
  VPN validator topology. Benchmark this **separately** from the isolated
  ML-DSA lab because the current Besu EVM network still uses ECDSA.
- Measure p50/p95/p99 end-to-end time-to-finality, block propagation,
  network RTT, memory/IO and 10+ minute sustained TPS. Record invalid-signature
  storms, partitions, validator restart and unavailability behavior.
- **5,000 TPS and 10,000 TPS are objectives, not demonstrated properties.**

The test runner intentionally caps load to 4,000 transactions/trial, 8 blocks,
64 senders, at most five trials per mode and a 180-second child timeout. It
never connects to a wallet, spends crypto, or touches public chain endpoints.
