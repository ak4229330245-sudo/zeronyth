# ZERONYTH v1.8.18 — security-preserving validator quorum fast path

## Outcome

The isolated ML-DSA native four-validator research network has a safer and
faster **optional single-pass admission** workload path. The original extra
independent `/preverify` request on every node remains available for explicit
mempool-admission research; it is not a prerequisite for valid consensus.

When single-pass is selected, each block is still cryptographically verified
by **all four independent validator processes**: the proposer fully verifies
each transaction while creating the block, and the other three validators
verify *all* its signed bytes, nonce transitions, account balances, proposal
seal and canonical state root before issuing their fsync-journaled ML-DSA
votes. Everyone checks a genuine three-of-four signed quorum certificate and
fsyncs the whole committed block before acknowledging success.

The elected proposer now also memoizes its already verified and executed
candidate in the canonical `Ledger` implementation. The existing proposal
stage still enforces a valid ML-DSA proposer seal and exact transaction-list
hash and must match the **same height, parent hash and state root** before it
can reuse this candidate. Mutated signed bytes, forged roots and stale parent
states cannot inherit it. Commit invalidates the candidate and normal
transaction replay/nonce checks remain in force.

No existing Besu/EVM/QBFT, wallet security, WebRTC browser node, mobile
participation, P2P/TLS setup, ML-DSA ordering journal or node reward feature
was removed or made less strict. This still is **not** a safe production BFT
network, real EVM-native ML-DSA or a quantum-secure TLS protocol.

## Repeatable benchmark

Requires Node.js 24+, OpenSSL and the existing `pq-native/` demonstration:

```bash
node pq-native/private-peer-demo.mjs 512 3
node pq-native/private-peer-demo.mjs 512 3 --single-pass
node pq-native/quorum-benchmark.mjs 512 3 3
```

Each repetition uses freshly generated disposable ML-DSA identities, a
private CA and four independently running mutually authenticated TLS
validator processes on **one computer**. It includes full four-validator
crypto/account verification, signed 3-of-4 votes, private peer delivery and
durable block fsync, but **excludes sequential demo-client signing** from the
first TPS value. A second metric in the per-run output includes signing.

The exact three separately created 1,536-transfer samples were:

| Run | Four-node standalone preverify + consensus + fsync TPS | Single-pass fully independently verified quorum TPS |
| --- | ---: | ---: |
| 1 | 565.2 | 721.2 |
| 2 | 696.5 | 755.5 |
| 3 | 642.8 | 795.2 |
| **Median** | **642.8** | **755.5** |

Median ratio **~1.18×**. These are short-loopback experiments on one machine,
**not a statistically generalizable or sustained throughput guarantee**. A
separate one-off 512x3 sample after proposer candidate reuse measured ~786.8
tx/s, with approximately 628 ms proposer, 837 ms remote checks/voting and
415 ms four-node durability over three blocks. This phase profile is evidence
of where further research is needed, not proof of 5,000 TPS.

The 1,536-tx *block-size* test (`node pq-native/network-demo.mjs 1536 --blocks
3 --senders 64 --direct-peer`) produced only ~594.3 tx/s in one no-preverify
sample: maximum block size and more worker threads are not inherently faster.

## Explicit rejection tests

The following are expected **to fail** without changing a canonical ledger:

```bash
node pq-native/private-peer-demo.mjs 4 2 --single-pass --bad-transaction
node pq-native/private-peer-demo.mjs 4 2 --bad-peer-pin
```

The first test substitutes a canonical-length but forged ML-DSA transaction
signature. The second swaps two trusted-CA-signed peer certificate pins. The
full regression suite also checks malicious proposer seals, forged state
roots, duplicate sender nonces, invalid quorum votes, replay, network
identity mismatch and restart verification.

## Remaining bottlenecks and blockers

- Validation is CPU-intensive and performed independently on every validator.
  Cutting necessary ML-DSA verification to make a benchmark look faster would
  be a consensus security regression; no such shortcut was introduced.
- Real four-VPS latency and bandwidth, especially on a two-core machine,
  remain unknown. No independent-host measurement was performed.
- The current research network requires **all four acknowledgements** and
  lacks a safe Byzantine round-change/liveness mechanism, dynamic membership
  and public chain data replication/recovery.
- A prior approximately 6,197 tx/s result refers to an *execution-only* lane
  without network voting and client signing. **The desired sustained,
  distributed 5,000 TPS has not been reached or verified.**
