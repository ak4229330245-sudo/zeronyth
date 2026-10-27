# ZERONYTH v1.8.15 — CPU-aware execution research and measured phase costs

## What changed

This release is a **separate local ML-DSA-65 execution laboratory**, not an
upgrade of the Besu/EVM/QBFT consensus network. Every v1.8.14 feature remains
available, including strict ML-DSA 3-of-4 signed ordering, asynchronous
execution, bounded signature prefetch, canonical serial-state cross-check and
durable delta WAL recovery.

1. **Bounded CPU-aware defaults:** both native research worker pools choose
   `min(4, max(1, os.availableParallelism()))` workers if not explicitly
   configured. A machine reporting 2 logical CPUs uses 2 signature and 2
   execution workers in separate stages; one reporting 9 CPUs uses 4 + 4.
   Users can still select an exact **0–8** for each pool. This is an initial
   scheduling heuristic, not an automatic latency or memory guarantee.
2. **Cheaper deterministic replay detection:** the canonical account engine
   checks the already-verified `(sender address, nonce)` pair to reject
   duplicates in one ordered batch. It no longer computes a redundant extra
   JSON/SHA-256 transaction ID solely for that detection. This cannot admit
   a replay: a sender's on-ledger nonce must increment after every accepted
   transfer, so two transfers with the same sender and nonce can never be
   legal in the same ordered block. Full ML-DSA cryptographic validation,
   exact signed-byte cache keys and state-root verification are unchanged.
3. **Execution phase timings:** `executeNext()` returns `elapsedMs` for
   `verifyAndExecute` and `stateCommit` (WAL fsync). This measures exactly
   what the local execution lane spent, not validator voting or network time.
4. **Configurable benchmark:** `node pq-native/signature-pipeline-demo.mjs 4`
   runs the same previously certified three-block/1,536-transfer workload
   with four signature workers and four account-disjoint execution workers,
   compares it with the canonical serial baseline and no-prefetch workers,
   and aborts unless every state root matches. Try `2` or `8` to measure
   hardware-specific worker scheduling differences.

## Measurements (one local machine reporting 9 logical CPUs)

Each row below is an independently generated three-block research experiment,
**not** a production network. Worker startup, sender signing, 3-of-4 order
certificate construction and P2P transport are **excluded** from the timer.
The WAL `fsync` is included. These are *short executed-transfer/sec* samples.

| Repetition | Serial tx/s | Warmed 4-worker signature prefetch + parallel tx/s |
| --- | ---: | ---: |
| 1 | 3,253.9 | 6,030.0 |
| 2 | 3,381.2 | 6,196.8 |
| 3 | 3,390.3 | 6,889.2 |
| **Median** | **3,381.2** | **6,196.8** |

The median per-trial ratio was **~1.85×**, and each sample completed with the
same exact root as serial execution. For contrast, a separate *single* eight-
worker run produced about **5,538 local executed tx/s**; more workers were
not automatically faster. Neither sample is a defensible long-term sustained
TPS claim. On a **two-core VPS**, the auto-default is 2 workers per pool and
the 9-CPU results do *not* apply. The 5,000 TPS target for a publicly deployed
and fault-tested L1 is still **not** achieved or verified.

The phase profile showed roughly **5–30 milliseconds of durable state writes**
across three sample blocks, with the vast majority spent in signature
verification and deterministic execution. Optimizing WAL write size alone
would therefore not produce Monad-style throughput.

## Security remains a strict gate

- An ML-DSA order certificate only authenticates ordering, never the future
  balance state. Transaction signatures are verified by trusted workers;
  sender, nonce and amount are checked against canonical signed bytes.
- Independent account-disjoint workers can execute concurrently, but all
  state changes are compared to the full sequential interpreter. Errors,
  collisions, invalid signatures and stale state fail closed before commit.
- Next-block signature prefetch cannot advance nonces, balances or executed
  height. It remains bounded to **one** certified future block and is
  revalidated at recovery from signed order logs. On restart the full ledger
  independently replays every executed order to check every root.
- Browser/mobile nodes, distributed reward jobs, prior Security Lab features
  and real Besu/EVM transaction verification are not changed.

## What is missing for a real 5,000+ TPS L1

Independent-host P2P throughput and Byzantine fault testing, production
BFT view-change and liveness, executable invalid-order handling, audited
execution certificates, generalized EVM contract read/write-set tracking,
real on-disk indexed state, cold-start/low-memory measurement and sustained
load testing. Do not use this isolated laboratory as a public validator or
claim quantum-safe Besu/EVM transactions.
