# ZERONYTH L1 v1.8.14 — bounded ML-DSA signature worker pipeline

## Scope

This is an **opt-in, one-process research addition** to the independent
`pq-native` asynchronous ordering/execution laboratory. It does not modify
Besu/EVM/QBFT, wallet security, distributed browser P2P, external node
rewards or existing network configurations. No blockchain has been publicly
deployed and **no real-world 5,000 TPS throughput is established**.

## Changes since v1.8.13

1. **Full parallel ML-DSA-65 verification:** for batches at or above the
   configured threshold, a bounded 1–8 signature-worker pool independently
   verifies the canonical *complete signed transaction bytes*. Returned
   signer, nonce and value are compared to the original signed fields before
   a positive cache entry is admitted. Invalid signatures, changed signed
   bytes, chain mismatch and worker timeouts fail closed. No signature is
   assumed valid merely because a quorum signed the **order**.
2. **Overlap transaction execution with the mandatory safety check:** the
   account-disjoint execution worker pool and the canonical, fully ordered
   sequential interpreter work during the same window. Their computed state
   roots **must match**. The sequential root still controls the fsync-backed
   changed-account WAL commit, so speculative corruption cannot change
   balances or executed height.
3. **Opt-in warmup for active validators:**
   `await lab.prepareExecution()` waits for all configured CPU worker threads
   to be online before measuring or operating a long-lived execution lane.
   A cold start still costs CPU/time; it is excluded only from explicitly
   labeled steady-state microbenchmarks.
4. **Bounded next-order signature prefetch:** after verification of the
   current signed order, the signature-worker pool may cryptographically
   validate **one** later certified order while the current height executes
   and fsyncs. It does not execute the later transactions, change state,
   sign consensus votes or grant finality. Prefetch errors are captured and
   cause rejection when that height is eventually executed. Recovery always
   revalidates all persisted signed orders.

## Exact configuration

```js
const lab = await AsynchronousOrderingLab.open(genesis, {
  orderLogPath, stateWalPath,
  parallelWorkers: 2,         // 0 disables parallel state execution; max 8
  signatureWorkers: 2,        // 0 disables parallel signature verification; max 8
  minParallelTransactions: 32,// 2..1536, small orders use canonical serial path
  prefetchSignatures: true,   // set false for a controlled comparison
});
await lab.prepareExecution();
// After accepting ML-DSA 3-of-4 certified ordering records:
// await lab.executeNext();  // one certified height in canonical order
await lab.close();
```

The worker pools are **lazy** unless `prepareExecution()` is explicitly
called. At most one future order is prefetched at a time, and a batch contains
at most 1,536 signed transfers. Verified signed transaction cache entries are
bounded and fingerprinted with the entire canonical signed bytes; execution
still enforces every nonce, balance and replay rule. Shared-account transfers
run in a single ordered component, not concurrently. On any mismatch, worker
failure or durable-WAL error, the authoritative execution height cannot move.

## Repeatable research demos

Requires Node.js 24+ native `ml-dsa-65`:

```bash
node --test pq-native/async-ordering.test.mjs
node pq-native/parallel-transaction-demo.mjs 8
node pq-native/signature-pipeline-demo.mjs
```

The signature pipeline demonstration certifies **three orders, each with 512
signed transfers**, before its execution timer starts. It compares the
canonical serial interpreter, warmed signature/state workers without
prefetch, and the same warmed workers with one next-order prefetch. All
three must yield exactly the same state root, 64 recipients with the right
balances and 64 senders with the right final nonces. The code rejects a
missing prefetch or mismatched root rather than inventing benchmark data.

### Observed local measurements

Three independent repeated runs of the full 1,536-transfer demonstration,
on this execution environment (execution + state WAL fsync only, **not**
client signing, ordering consensus or actual network transport):

| Trial | Serial executed tx/s | Warmed workers + prefetch executed tx/s |
| --- | ---: | ---: |
| 1 | 3,103.6 | 4,970.9 |
| 2 | 3,411.0 | 4,882.4 |
| 3 | 3,473.0 | 4,410.0 |
| **Median** | **3,411.0** | **4,882.4** |

For these three samples, the median of individual per-trial ratios was
**about 1.43×**, and all three warmed pipeline samples exceeded serial.
This is a **short, single-machine laboratory execution measurement**, not a
certified sustained throughput benchmark. Worker warmup occurs before the
measurement; first-batch latency and P2P/BFT overhead may erase the gain.
The historical 5,000 TPS goal is not verified or achieved on a real L1.

## Outstanding security and speed work

- Trusted worker code must be shipped and audited as part of the validator;
  positive signatures are cryptographically checked by workers, while an
  independent main-thread interpreter rechecks deterministic balances/nonces
  and the state root. A fully hostile OS/worker environment is not in scope.
- No production leader view-change, slashing, fork rollback, generalized EVM
  read/write conflict tracking, durable indexed state database or distributed
  validator fault simulation. Certified invalid transactions may halt the
  deferred execution lane rather than being skipped.
- Profile on a dedicated two-core VPS, under memory pressure, mixed EVM-like
  workloads, larger account sets, power loss, network partitions and sustained
  traffic. Implement reviewed protocol-level execution proofs before enabling
  any deferred-execution finality in a public network.
