# ZERONYTH L1 v1.8.19 — configurable validator committees and elastic participation

## What now has no fixed node-count constant

- The isolated **native ML-DSA research ledger** accepts a genesis committee of
  **four or more unique validators**, rather than exactly four. The committee
  is constrained by a **1 MiB maximum encoded genesis size** to avoid trivial
  resource-exhaustion attacks, not by a fixed validator-number constant.
- Every signed block certificate and independent ordering certificate needs
  `floor(2 * N / 3) + 1` different authorized ML-DSA validator signatures,
  where `N` is the validator count in that chain's fixed genesis. A four-node
  chain still needs three votes; seven nodes need five; fourteen need ten.
- The independent localhost validator server and private TLS pin configuration
  now derive indices and peer lists from genesis rather than assuming four.
  In the **disposable localhost demo only**, `--validators 4..16` prevents
  accidentally starting hundreds of OS processes on a small workstation.
- The separate signed **DeviceNodeRegistry** and simulated DEV-CREDIT
  **ComputeMarket** no longer have 128-device or 64-provider count caps.
  Registration still requires genuine chain-scoped ML-DSA authorization,
  validated device-role policy and (for rewarded providers) a verified
  validator capacity quorum, bonded DEV-CREDIT and strict job budgets.
- A device can now submit an ML-DSA-signed **leave** message, then sign a
  registration with a new monotonic nonce to rejoin. Old registration and
  previous device-ID leave messages are rejected. Devices can be listed in
  pages of at most 100 without serializing the entire registry response.
- Compute scheduling finds the lowest-occupancy eligible registered provider
  in one pass, with constant additional memory, rather than sorting all
  providers. The MAX_JOBS and per-job CPU, RAM and work bounds remain.

## Security boundary: dynamic participation != dynamic consensus membership

The **number of signed compute/light/relay device profiles can vary over time**.
Registration, heartbeat and leave are currently an **in-memory local research
simulation**, not a publicly accessible P2P network or a durable on-chain
membership ledger. Crash/restart persistence, authenticated peer discovery,
hardware attestations, off-device job execution, economic slashing and real
ZNYT payouts have not been implemented.

**Validator membership remains immutable for the lifetime of a genesis / epoch.**
Adding a new validator to an *already running* chain requires a future
quorum-authorized epoch-change and checkpoint mechanism, with overlapping
quorum safeguards, anti-equivocation state transfer, durable membership
history and partition/restart tests. This release does **not** implement that.
It also does not replace the unchanged **four-validator Besu/EVM/QBFT kit**.

The existing browser WebRTC proof-of-concept retains a six-peer limit per
invitation room and bounded rooms per single signaling instance; that is an
anti-DoS constraint, **not** unlimited public P2P or global node discovery.
Production scale-out would require independent signaling shards, relays and
public admission controls. A real server always has finite CPU/RAM/bandwidth.

## Reproduce the configurable committee proof

```bash
node --test pq-native/elastic-membership.test.mjs
node pq-native/network-demo.mjs 4 --blocks 2 --senders 2 --direct-peer --validators 7
node pq-native/network-demo.mjs 4 --blocks 2 --senders 2 --direct-peer --validators 14
```

The localhost runs verify **all** validators independently execute, check
ML-DSA transfers/proposer and vote signatures, inspect account/state roots,
verify the required quorum certificate and fsync the signed commit. The
corresponding first local samples completed at 7/5 and 14/10 validators,
respectively, with every node reporting identical height, head and balances.
Because these samples contain only eight transactions each, their measured
~50.7 TPS and ~36.5 TPS are **not capacity benchmarks**. Larger validator
sets incur more validation and network overhead: increasing validator count
does **not** by itself move the chain toward sustained 5,000 TPS.

The full regression also confirms >128 signed device registrations, paginated
listing, safe exit/rejoin/nonces, >64 bonded compute providers with conserved
DEV-CREDIT, quorum-sized capacity attestations, tampered signature rejection
and unchanged four-validator compatibility.

No remote hosts, public network, real assets or deployment were touched.
