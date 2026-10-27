# ZERONYTH L1 v1.8.16 — direct validator peer communication laboratory

## Scope

This is a **four-process loopback-only** ML-DSA-65 validator research feature,
not a public distributed blockchain deployment. The existing private Besu
network, ECDSA/EVM runtime, wallet, explorer, mobile/WebRTC P2P demonstration,
asynchronous PQ ordering lab and signed node reward simulation remain intact.

Unlike the original `network-demo.mjs` coordinator, the new optional
`--direct-peer` route submits signed transactions to the elected proposer.
That proposer directly contacts the other three validator processes:

1. The elected ML-DSA proposer verifies and constructs one block.
2. Each distinct validator gets the **full signed block**, independently checks
   its proposer seal, transactions, nonce, balances, canonical state root,
   and records its own anti-double-sign ML-DSA vote to an fsync-backed journal.
3. The proposer authenticates peer vote identities against the four fixed
   genesis validators and checks all received ML-DSA vote signatures.
4. A 3-of-4 certificate is distributed directly to all four peers. Each peer
   independently verifies the certificate, persists the signed block and
   certificate with `fsync`, then advances the canonical ledger.
5. The round only returns success when all four peer commit receipts match.
   Later blocks rotate proposers according to the existing genesis order.

To avoid accidental public exposure, peer endpoints bind to **127.0.0.1 only**;
the required `ZERONYTH_PQ_LOCAL_PEER_PORTS` setting is exactly four unique local
ports, mapped in genesis validator order. The demo configures it on disposable
child processes. The routes are disabled in ordinary validator operation.

## Run

Requires Node.js 24+ with ML-DSA-65 support:

```bash
node pq-native/network-demo.mjs 512 --blocks 3 --senders 32 --direct-peer --preverify
node pq-native/network-demo.mjs 4 --blocks 2 --senders 4 --direct-peer --preverify --restart-after-first
node --test pq-native/direct-peer.test.mjs
```

Run the existing coordinator with the *same* workload as a reference:

```bash
node pq-native/network-demo.mjs 512 --blocks 3 --senders 32 --compact --preverify
```

**`--parallel-exec` remains optional**, but on small/contended machines it may
be slower because each of four separate validators starts worker threads and
must still compare their execution against a strict serial state oracle.
Never infer more validators/workers or more block pipelines imply greater TPS.

## Measured one-machine short samples

Single runs on a machine reporting nine logical CPUs, 1,536 transfers split
across three blocks, each with 32 sender accounts, independent ML-DSA mempool
preverification on **all four** validators and durable block journals:

| Configuration | Admission + consensus + fsync TPS | Including sequential client signing TPS |
| --- | ---: | ---: |
| Original coordinator, serial account execution | 597.6 | 373.4 |
| Direct peer communication, serial account execution | 609.8 | 380.3 |
| Direct peer communication, parallel plus mandatory serial cross-check | 451.7 | 309.6 |

These are **single-run noisy local measurements**, not a statistically
defensible speedup claim, not a sustained-load benchmark, and not an
independent-host deployment. `includingClientSigningTps` measures full
local demo wall time. Admission + consensus TPS excludes client signing but
includes validator signature preverification and all journal durability.
The earlier approximately 6,197 TPS applies to a **separate execution-only**
lab where network voting and client signing were excluded; do not equate it
with this multi-validator result.

## Security and liveness limits

- Fixed four-validator genesis. There is **no public peer discovery**, operator
  diversity, remote transport security, validator reconfiguration or audit.
- All four peers must respond successfully to this research round. A 3-of-4
  cryptographic certificate is necessary for safety, **not** proof of
  fault-tolerant liveness; failure of one peer can stop progress.
- There is no safe view change, timeout recovery consensus, automatic network
  catch-up, fork-choice under partitions, DoS protection or production RPC
  authentication. A partial peer commit failure is not silently retried.
- Local ports are loopback only. **Do not expose them to the internet** or
  send real funds; malicious local clients could invoke laboratory routes.
- Mobile/browser P2P workers are not full validator nodes. EVM/Besu still uses
  ECDSA and has not been converted to native ML-DSA.
- 5,000 publicly distributed, consensus-inclusive TPS **has not been
  achieved or verified**. The two-core VPS needs its own performance tests.
