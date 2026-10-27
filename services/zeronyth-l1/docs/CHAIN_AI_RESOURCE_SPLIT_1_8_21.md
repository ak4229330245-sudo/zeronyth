# ZERONYTH v1.8.21 — Voluntary resource sharing for L1 and generative AI

**Status: local in-memory security/accounting research only.** This is a
reservation policy, NOT operational node pooling, faster public consensus or
running an AI model. No real VPS/GPU is provisioned; no ZNYT or governance
token is minted or transferred.

## Suggested provider-selected allocation

| Purpose | Suggested percent | Future use | v1.8.21 behavior |
| --- | ---: | --- | --- |
| L1 acceleration | 20% | Parallel ML-DSA transaction preverification, mempool filtering, encrypted private relay, RPC/indexing | Signed CPU/RAM capacity reserved only |
| Community generative AI | 20% | Curated dataset processing, permitted model fine-tuning, training/inference tasks | Signed CPU/RAM and theoretical GPU time budget only |
| VPS and AI GPU rentals | 60% | Rent available node capacity to customers paying the governance token | Signed rental offer/escrow simulation from v1.8.20 |

The allocation is **opt-in**, never silently imposed. Each signed percentage
can be 0–80 inclusive and the sum cannot exceed 100. The third percentage is
what remains **nominally** unreserved. A single hardware GPU cannot be divided
into a guaranteed 20%+80% concurrent, isolated VM lease without a validated
GPU scheduler (e.g. mutually exclusive time slices or certified virtualization).
Therefore a node with **one GPU** assigning 20% to community AI **cannot**
simultaneously offer a full exclusive GPU for rent. A node with **two GPUs**
can reserve an abstract 0.4-GPU budget to community AI and still quote one
exclusively rented GPU, *in the simulator only*. Physical time sharing and
partitioning are not implemented and may require a different real schedule.

For a small **2-core server**, a 20% chain share is 400 CPU millicores and
an additional 20% AI share is 400 millicores, leaving a nominal 1,200
millicores for other uses. Fractional CPU shares are theoretical admission
budgets, not operating system CPU cgroups or measured utilization. The existing
hash job executor books whole cores, so a fractional remainder may not fit
another whole-core job even though percentage remains.

## Signed APIs and admission controls

- `ComputeMarket.publishChainShare(signedAllocation)`: ML-DSA-65 signed,
  chain-bound, nonce-checked `CHAIN_SHARE` with `cpuPercent` and expiration.
- `ComputeMarket.publishAiShare(signedAllocation)`: equivalent `AI_SHARE`
  with `aiPercent` and expiration. Both require previously bonded,
  multi-validator capacity-countersigned, currently available native
  server/desktop compute identities in a height-synchronized device registry.
- `chainShare(address)`, `chainAccelerationStatus()`, `aiGrowthStatus()` and
  `nodeResourceAllocation(address)` report reservations and explicitly show
  that zero external workers/model-training jobs are active.
- Providers may update either split after expiry or before it using a new
  signed market nonce. Existing customers' resource reservations and jobs
  have priority: updates exceeding available CPU, RAM or GPU are rejected
  **before** replacing the prior allocation. The chain and AI shares may not
  claim more than 100% combined and are independently time-limited.
- `publishRentalOffer`, `reserveRental` and `assignJob` check both shares
  against a provider's capacity; blocked resources cannot be double-booked.
  Signed rental cash flows, validator GOV-LAB reward reserve and DEV-CREDIT
  legacy hash jobs remain separate and conserved as in v1.8.20.

The percentage budget is not an audited proof of spare hardware or energy.
The signed heartbeat and validator capacity certificates attest *claims* and
can be dishonest. No reward is minted for merely pledging resources.

## Verification

From repository root, on Node.js 24+:

```bash
node pq-native/resource-rental-demo.mjs
node --test pq-native/resource-rental.test.mjs pq-native/compute-market.test.mjs
```

The demo onboards a CPU VPS provider and a two-GPU provider, records each
with a voluntary **20% L1 + 20% community AI + 60% unreserved** split,
books one simulated VPS and GPU rental, settles a signed usage slot, awards
mock GOV-LAB validator signatures from a prefunded reserve, and audits both
research units. It reports **0 real L1 workers, 0 real model training runs**.

## Real-world integration needed for speed or model improvement

1. **L1 speed:** build opt-in remote P2P accelerator transport, sender/node
   authentication, task assignment, independent verification, dataset-size
   bounds, replay isolation, trustless results and secure performance
   measurement; integrate verified hints only into the admission path.
   All validators must still verify signed transactions and state roots and
   reach the existing quorum. Adding more voting validators can increase
   consensus overhead rather than increase TPS.
2. **AI progress:** choose a legally usable model/dataset, define quality
   metrics, reproducible training/fine-tuning jobs, secure private data
   isolation, verified GPU use, checkpoint validation, reproducible inference,
   cost budgets and energy constraints. Inaccurate or malicious training
   contributions must not receive rewards.
3. **Operator safety:** capacity leases, hardware/energy attestation, user
   consent, CPU/memory/GPU isolation, preemption, cooling, no hidden battery
   mining, quotas and fair reward proofs before real node-sharing launch.
4. **Token economics:** design governance voting, accountable reward epochs,
   fixed vs inflationary supply, independent accounting for L1 work, AI work
   and customer-paid rentals. Research GOV-LAB does not confer voting rights
   or count as an actual transferable token.

**A node commitment by itself neither accelerates the L1 nor trains an AI.**
This release implements the resource-budget/anti-overbooking foundation and
retains the existing independent native research consensus and ECDSA Besu devnet.
