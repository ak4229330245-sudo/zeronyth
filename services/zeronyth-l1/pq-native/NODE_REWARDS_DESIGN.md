# ZERONYTH v1.8.4: Node Provider / Reward Laboratory

**Status: LOCAL, VOLATILE, RESEARCH ONLY. No ZNYT token mint or payout.**

This module explores a network where independent operators lease compute to the
ZERONYTH ecosystem and receive compensation. It does **not** currently
run jobs on remote nodes, confirm real hardware, accept public providers, or
create actual chain transactions. `DEV_CREDIT_NON_TRANSFERABLE_SIMULATION`
is the explicit unit of its self-contained in-memory accounting, initialized
only from `genesis.allocations`. No token bridges, hot wallets or secrets are
needed to demonstrate its protocol shape. Do not use with real funds.

v1.8.5 adds [MULTIDEVICE_NODES.md](MULTIDEVICE_NODES.md) and optional
`ComputeMarket(genesis,{deviceRegistry})` eligibility checks. Existing v1.8.4
research behavior remains compatible when no device registry is supplied.

## Implemented boundaries

1. **Provider identity:** a distinct ML-DSA-65 signed registration containing
   chain ID, replay-resistant nonce, resource claim (CPU/RAM/GPU), and stake.
2. **Attestation quorum:** three **unique** existing 4 validator identities
   sign the exact registration digest, identical claimed capacities, and a
   bounded expiry. Self-report alone cannot pass registration. These signatures
   are **not** proof of physical hardware or third-party trustworthiness.
3. **Bond:** initial provider balance is debited into locked stake; registration
   cannot mint credits. The research lab has no withdrawal/unbond pathway.
4. **Consumer jobs:** separately signed, bounded SHA-256 iterative hash jobs
   debit prefunded consumer DEV-CREDIT into escrow. No shell commands, arbitrary
   code execution, AI model loading, or Internet access.
5. **Scheduling:** at most one job per declared CPU core; deterministic ordering
   picks the least busy eligible provider, with bounded queue/storage. Work is
   simulated locally; `assignJob` never contacts a provider.
6. **Verified payout:** only a valid ML-DSA result signed by the selected provider
   passes to recomputation of the expected hash output. Once correct, 95% of
   escrow is sent to their research balance and 5% to simulated treasury;
   fractions under 20 units round down. Replay cannot pay twice.
7. **Failure:** validly signed, incorrect output causes bounded stake penalty
   sent to treasury, and refunds the consumer's entire escrow. Cryptographically
   invalid signatures never cause slashing. Timeouts refund the consumer; the
   height advance is manual and **not a chain-derived clock**.
8. **Conservation:** `audit()` ensures `spendable + collateral + escrow + treasury`
   always equals the original allocations. No inflation, negative balances or
   currency issuance.
9. **Ten-block admission:** `BlockAdmissionPipeline` admits at most 10 independent
   candidate transaction batches for bounded asynchronous ML-DSA verification
   in at most two worker lanes. It retains exact, canonical signed bytes and
   refuses to finalize different bytes. **Finalization is strictly in order,
   still requires a complete actual three-of-four ML-DSA certificate, and
   never authorizes a signature verification bypass.**

## Run

Requires Node.js 24+ with native `ml-dsa-65`:

```bash
node --test pq-native/compute-market.test.mjs pq-native/block-pipeline.test.mjs
node pq-native/compute-market-demo.mjs
node --test pq-native/*.test.mjs pq-native/test.mjs
```

## What is REQUIRED before opening a public service

- Source attestations from *independent* operators backed by benchmark proofs,
  remote attestation/TEE hardware where practical, challenged work samples and
  authenticated service endpoints. Three local keys on one device give no
  real independence. Test Sybil attacks; stake alone cannot solve them.
- Implement persistent, authenticated distributed job state, consensus height,
  quorum-signed receipts, dispute windows, challenge-based fraud proofs,
  validator-conflict prevention, slashing appeals and failure recovery.
- Specify enforceable provider contracts, payment funding, real economic
  security and a supply-controlled native asset **only after** audit and
  explicitly authorized testnet tokenomics. Never use simulated ledger balances
  as redeemable payment promises.
- Isolate workloads by VM/microVM sandbox, authenticated and rate-limited
  network, cgroups, memory/disk/time limits, no default privileged execution,
  secrets isolation, network egress policy, abuse response and billing caps.
  A Linux VPS requires real CPU, RAM, disk, electricity and connectivity from
  consenting operators; a blockchain alone supplies none of these resources.
- Tie any future pipelined block implementation to finality proofs and parent
  dependencies. Do not simultaneously finalize 10 conflicting state transitions.
- Benchmark real 4+ independent hosts, inclusive latency/TPS and failure modes.
  **5,000 TPS remains an unachieved target.**

Prior v1.6 Besu/EVM and wallet modules are not modified by this isolated lab.
