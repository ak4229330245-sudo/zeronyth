# v1.8.20 — VPS, AI GPU rentals and GOV-LAB validator incentive design

**Scope:** Offline, in-memory simulation on the isolated Node.js 24+ native
ML-DSA-65 research stack. No permissionless L1 network, VM or GPU scheduler,
real governance token, production metering, production tenant, settlement chain,
money transfer, coin mint, or externally rentable host exists here.

## Community economic loop (research simulation)

1. A node operator registers an ML-DSA-65 identity as a native server/desktop
   compute device, publishes a signed fresh power/network heartbeat and bonds
   **DEV-CREDIT** stake. A separate capacity claim receives multiple genesis
   validator signatures; the claim is **not measured or trusted hardware**.
2. The operator signs a priced `vps` or `ai-gpu` resource offer, including CPU,
   RAM, claimed disk/GPU/VRAM and an expiry. Every signed quote is limited to
   available attested claimed capacity, and only eight active offers per
   provider are accepted at once (without a global number-of-provider cap).
3. A separate customer signs a reservation. The quoted amount is debited from
   that customer's **GOV-LAB**, a distinct explicitly initialized research
   balance, and is recorded as escrow. CPU, RAM and GPU cannot be double-booked
   across simultaneous reservations and bounded legacy hash jobs.
4. Each block-height slot used must be agreed by **both** the provider and
   customer with independently valid, chain-bound, ML-DSA-signed meter reports.
   Only their *matching assertions* can release payment: 95% to the provider,
   5% to the simulated treasury. Unused prepaid GOV-LAB is refunded. These
   counters **do not independently prove CPU/GPU work really happened**.
5. The customer can cancel before the first simulated slot. If no jointly
   signed settlement is achieved by one slot after the deadline, the entire
   pending escrow is refunded without provider compensation. This conservative
   failed-agreement behavior must be redesigned around independently measured
   usage and dispute arbitration before any real-world rental product.
6. Genesis validators may sign the same **research block identifier** for a
   simulated height. A `floor(2N/3)+1` independent signature quorum can be paid
   **GOV-LAB** from a pre-funded and decreasing validator reward reserve. A
   validator is paid once per height and only when it actually signed that
   test certificate. Such a signature collection is **not independent evidence
   of a finalized L1 block**; a production implementation must verify a
   consensus-committed block or other enforceable work proof.

### Separate accounting domains

| Unit | Purpose | What it is **not** |
| --- | --- | --- |
| `DEV_CREDIT_NON_TRANSFERABLE_SIMULATION` | Existing experimental bonded compute jobs, slash/refund, SHA-256 reward flow | Real ZNYT or governance token |
| `GOV_LAB_NOT_REAL_TOKEN` | Experimental VPS and AI GPU reservation, consumption, provider payments and validator-round payouts | A transferable token or deployable governance contract |

Both units are independently conserved. The explicit GOV-LAB initial balance
allocations plus validator reward reserve are a *fixed test budget*, not a
tokenomics decision or hidden minting privilege. No real wallets or contracts
are changed. The ticker, governance rights, supply, emissions schedule and
reward allocation policy **have not been chosen**.

## Reproduce and inspect

From repository root:

```bash
node pq-native/resource-rental-demo.mjs
node --test pq-native/resource-rental.test.mjs pq-native/compute-market.test.mjs
```

The demo onboards **two disposable signed providers** (one VPS, one GPU),
publishes both offers, reserves two simulated slots of each, settles one slot
with the two parties' signed approvals, refunds the other prepaid slots,
awards three validator signers from a pre-funded reserve and audits separate
DEV/GOV supply conservation. It does **not** start VMs or transmit inference
requests. Its signatures/identities are newly generated and disposable.

## What is deliberately not implemented

- No operating hypervisor, Firecracker/KVM/container orchestrator or live VPS
  address/SSH login; no open HTTP/S or SSH/VNC endpoints.
- No GPU allocation, drivers, model download, hosted LLM, inference serving,
  resource partitioning, confidential data handling or GPU billing meter.
- No independently verified capacity, challenge proofs, trusted usage oracle,
  slashing for overstatement, network isolation, anti-spam/abuse response,
  image scanning, customer KYC or privacy/security review.
- No real governance token contract, on-chain issuance/transfer, real buyer
  funding, staking/rewards, price discovery, treasury management, fee withdrawal
  or governance voting.
- No live validator additions, epoch-safe dynamic validator membership,
  independent public P2P or deployed secure multi-host settlement.

## Required architecture before real-world service

1. A safe resource attestation mechanism (independent CPU/GPU/disk probes and
   validator attestations that cover fresh measured capacity, reservations,
   demand peaks and revocation), with challenge/dispute resolution.
2. A hardened VPS orchestration plane: tenant isolation, images and storage,
   ephemeral credentials, networking/firewall/NAT, backups, monitoring and
   per-tenant data deletion; clear host/operator consent and quotas.
3. A hardened GPU/AI serving plane: measured GPU memory/compute, model licensing,
   inference APIs, sandboxing, tenant secrets, abuse prevention and
   reproducible metering independent of unilateral operator claims.
4. Real tokenomics reviewed with the user: the governance token ticker,
   fixed or inflationary supply, validator/node revenue share, reward epochs,
   capped issuance, governance power, vote delegation, slashing and emergency
   controls. Legal, tax and financial reviews are needed before token launch.
5. An audited smart-contract/native-token ledger with multi-sig treasury,
   verifiable L1 finality proofs, real escrow, payment disputes, rate-limits,
   recovery and publicly inspectable issuance, before public deployment.

**Nothing in this release starts a real rental marketplace, mints a governance
token, spends actual money, or switches the existing Besu/EVM chain to PQ.**
