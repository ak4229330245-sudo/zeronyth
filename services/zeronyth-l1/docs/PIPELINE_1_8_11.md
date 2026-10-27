# ZERONYTH v1.8.11 — safe pipelined execution *research* phase

## What this version actually executes

The **native ML-DSA-65 local research ledger**, not the Besu/EVM chain, now
offers a deliberately **opt-in** forecast mode on its existing bounded
ten-candidate admission pipeline:

1. Queue 1–10 canonical, signed block candidates, subject to a global
   32 MiB queue limit and existing per-block limits. Two bounded CPU admission
   lanes independently verify all signatures before accepting a candidate.
2. `previewStates()` copies the entire current canonical ledger into a private
   disposable in-memory fork and walks candidates **in order**. For each block,
   at most two bounded workers perform *optional* account-disjoint speculative
   execution; the result is checked against a separate trusted serial pass.
   Any invalid signature, nonce, balance, state-root or pool result fails the
   preview. Predictions show height and state root, *not a signed block*.
3. Return the forecast only if the authoritative head, state root and queue
   revision remain unchanged. No consensus signature is created and no chain
   state, finalized height, durable journal or token balances are mutated.
4. `commitNext()` still requires the matching exact signed candidate plus
   an independently checked canonical proposal and **3 of 4 valid ML-DSA
   validator votes**. It commits just one block. Future predictions are
   recomputed on demand from the latest authoritative state.

These are *ten ordered in-memory projections*, not ten simultaneous block
finalizations. Parallelism occurs in candidate **signature admission** and
independent **transactions within a candidate**, while canonical commitment
and prediction across dependent heights remain ordered.

## Try the laboratory safely

Requires Node.js 24+ with `ml-dsa-65` support:

```bash
node pq-native/pipeline-demo.mjs
node --test pq-native/block-pipeline.test.mjs
```

The demonstration creates disposable local keys for exactly four validators,
queues ten signed transfers, compares ten forecast roots with ten later
certified roots, validates 3-of-4 votes and returns JSON. It does not call an
external network, spend crypto, require a permanent VPS or start a public
validator.

From code, a caller must opt in explicitly:

```js
const pipeline = new BlockAdmissionPipeline(ledger, {lanes: 2, speculativeWorkers: 2});
pipeline.admit(signedTransactionsForHeightOne);
const forecast = await pipeline.previewStates(); // finalized: false, quorumVotes: 0
// The normal, independently certified canonical commit path remains required.
await pipeline.close();
```

## What still prevents Monad-level throughput

- **Actual asynchronous consensus/execution is not implemented.** Deferring
  state-root validation affects protocol safety, proposer validity, resource
  limits, invalid-transaction handling, rollback, cross-block dependencies,
  recovery and finality. This requires a reviewed BFT redesign, not a switch
  to ignore an existing validator check.
- **General optimistic concurrency control** for dynamic EVM contracts
  needs precise storage read/write-set tracking, state-version validation,
  deterministic retry, resource caps and canonical sequential equivalence.
  This lab knows explicit sender and destination addresses only, and uses
  disjoint-account components with a full serial cross-check.
- **MonadDb-like fast state storage is not integrated.** The research ledger
  uses an in-memory JavaScript `Map` and an fsync-protected append journal;
  the separate EVM chain uses Besu. A real storage engine needs measured
  on-disk data structures, read-ahead/prefetch, transactional snapshots,
  crash consistency, bounded caches and adversarial failure tests before
  it can replace either state implementation.
- **No global P2P validator load test:** the prior ~599–656 TPS is from four
  local processes in v1.8.10. It was not retested as a v1.8.11 network TPS
  improvement, and no 5,000/10,000 TPS assertion is made.

To reach higher speeds safely, the next *separate* milestones are CPU/SSD
profiling under representative state sizes; a tested conflict/retry EVM
execution engine; revised consensus/state-root proofs; then independent
hosts on an actual P2P network with sustained-load and adversarial tests.
The regular network remains unchanged and existing artifacts are preserved.
