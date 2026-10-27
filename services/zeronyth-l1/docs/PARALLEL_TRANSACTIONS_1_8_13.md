# ZERONYTH L1 v1.8.13 — conflict-aware parallel transaction research

## What changes, and what does not

The **separate ML-DSA-65 native asynchronous ordering laboratory** now
supports bounded, opt-in-by-lab **parallel execution of transfers in a single
certified order**. It does **not** upgrade the existing Besu/EVM/QBFT
validators, change the live chain's ECDSA authentication, parallel-finalize
blocks or connect a public peer-to-peer network. All v1.8.12 features remain.

`AsynchronousOrderingLab.open(genesis, {orderLogPath,stateWalPath,
parallelWorkers:2,minParallelTransactions:32})` enables two bounded Node.js
worker threads by default for batches with at least 32 transfers. Specify
`parallelWorkers:0` to disable this path in the lab, or set 1–8. Valid
`minParallelTransactions` values are 2–1,536. Workers are constructed lazily
to avoid startup cost when orders contain only a few transactions, and closed
with the lab. Existing non-lab code and its defaults are untouched.

### Execution policy and security invariants

1. The proposer and three of four authorized ML-DSA validators must have
   already signed the **exact same ordering payload**. No ordering journal
   entry is executed out of order.
2. Every transaction signature, chain ID, signer, nonce and amount passes
   the existing checks. Transactions are grouped by all addresses they touch
   (sender **and** recipient). Groups touching the same address are merged
   and retain their original order. Only account-disjoint groups can run in
   parallel. The worker count and memory/time budget are bounded.
3. The existing deterministic **sequential interpreter independently computes
   the resulting state root for the whole ordered batch**. If a worker result
   differs, crashes, times out or cannot supply all groups, this height fails
   closed. No balance, executed height or state WAL can advance on a mismatch.
   When one conflict group encompasses the batch, the code falls back to
   sequential execution, preserving nonces and balances.
4. The trusted canonical sequential state is fsynced into the existing
   append-only changed-account WAL **before** advancing the public execution
   height. Restart replays the original ML-DSA-signed orders and independently
   cross-checks all previously committed state roots.

The `executeNext()` result includes an `executionMode` field:

- `serial` — fewer than the threshold or workers disabled;
- `serial-conflict-fallback` — enough transactions, but no independent groups;
- `parallel-serial-crosschecked` — parallel worker jobs were dispatched and
  their root matched the canonical sequential root.

The default workers were chosen for a **local research configuration**, not
as a tuned production policy for a two-core VPS or mobile browser. They do
not run in the website, iPhone/iPad background, or distributed browser P2P.

## Run and inspect

Requires Node.js 24+ with `ml-dsa-65`:

```bash
node --test pq-native/async-ordering.test.mjs
node pq-native/parallel-transaction-demo.mjs
```

The tests cover 64 independent ML-DSA-signed transfers, shared-account
conflicts, an intentionally fraudulent worker root, durable restart recovery,
invalid worker settings and all earlier asynchronous ordering attacks.
The demo runs 64 transfers through *both* serial and two-worker modes on
separate disposable ledgers, and requires identical final state roots. It
reports time spent in `executeNext()`, including state fsync but **excluding**
the 3-of-4 ordering protocol, network, client signing and initialization.

**Speed must be measured; parallel execution is not automatically faster.**
One local 64-transfer run took roughly **21.5 ms sequential** versus **69.1
ms parallel with full serial cross-check**. Worker startup, IPC and duplicate
execution dominated this small sample; the parallel path was *slower*. This
single-run timing is *not* a reproducible sustained benchmark, global P2P
throughput, deployed-chain TPS, or evidence of reaching 5,000 TPS.

To eventually achieve faster executed transactions securely, profile large
real workloads, move signature pre-verification off the critical path,
implement audited deterministic conflict/version validation for generalized
contract storage, optimize durable state persistence, then test multi-host BFT
under faults. Removing the serial safety cross-check prematurely would
trade away the invariant this phase exists to protect.
