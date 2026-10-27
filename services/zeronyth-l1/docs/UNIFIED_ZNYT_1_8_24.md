# v1.8.24 — Unified simulated ZNYT economy (research only)

## User intent and naming

**ZNYT is the sole proposed network utility/governance token**, rather than
independently created gas, governance, validator, and cloud-rental tokens.
The same ZNYT balance should eventually pay for L1 transaction gas, VPS and
AI-GPU rental, and potentially AI service usage. Node operators/validators
may receive ZNYT rewards and qualifying node providers have an AI-usage
benefit. ZNYT holders may eventually govern network rules via **separately
implemented, audited** voting procedures; this release includes no voting.

## What now runs locally

`ComputeMarket(genesis, {deviceRegistry, znyt:{...}})` explicitly enables a
**single in-memory `ZNYT_LAB_NOT_REAL_TOKEN` ledger** instead of the earlier
separate GOV-LAB and GAS-LAB research ledgers. The new mode preserves the
previous DEV-CREDIT compute-job accounting as an unrelated test fixture;
the DEV-CREDIT is **not** a second public chain token.

| Action | One simulated ZNYT balance / shared accounting |
|---|---|
| VPS / AI-GPU booking | Deduct from renter into reservation escrow; accept independently signed provider and renter usage; refund unused slots; pay provider, retain a 5% booking fee (integer-rounded). |
| Hypothetical gas charge | Payer signs operation, max gas, max price, nonce and expiry. A validator signature quorum agrees on a *claimed* usage amount. Debit renter; burn 20% default; put 80% into a network gas-fee pool. Configurable 0–100% burn. |
| Validator reward | Require quorum signatures bound to a unique simulated height and block ID. Pay the existing configured per-signer reward from the collected gas-fee pool, then any explicitly prefunded reserve. Never mint unexpectedly. |
| Bonded node AI entitlement | Signed request with mock quota of 20 per 10 heights; does not debit ZNYT. **No real AI inference.** |
| Audit | Verify all spendable balances + rental escrow + reward reserve + rental treasury + network gas-fee pool + accumulated burn exactly match the initially provisioned simulated ZNYT supply. |

### Example of a *single* initial 1,000 ZNYT-LAB balance

1. Reserve 2 VPS slots at 20 each: 40 in escrow, 960 spendable.
2. Mutual settlement for 1 slot: renter gets 20 back, provider earns 19,
   rental treasury gets 1; renter has 980.
3. Sign and hypothetically meter 10 gas units × 10: charge 100 from **same**
   renter balance. Renter has 880; 20 burned; gas-fee pool receives 80.
4. Three validators earn 2 each from that gas-fee pool; 74 stays pooled.
   Total non-burned simulated supply is 980; exact ledger conservation holds.

All authorization signatures here use ML-DSA-65 for local research identities.
Replay, nonce, expiry, chain-ID, capacity, duplicated validator, bounded price,
contradictory meter, escrow and conservation tests are included.

### Quick validation

```bash
node --test pq-native/unified-znyt.test.mjs
node pq-native/unified-znyt-demo.mjs
```

## Not yet implemented / not safe to represent as live

- **No actual ZNYT was issued, transferred or burned.** These are ephemeral
  research numbers, not public token balances, deposits, withdrawals or
  tradable governance-token rewards.
- Native block execution does **not** charge actual gas; reported usage is
  a validator-signed *hypothetical* meter and lacks independent accounting
  against real execution. The separate Besu/EVM devnet remains classically
  signed and has `zeroBaseFee: true`.
- No governance proposal/vote/timelock machinery, policy execution, real
  consensus reward distribution or chain-state integration exists.
- No remote physical VPS creation, GPU compute, real generative-AI inference,
  bandwidth measurement, secure renter isolation, metered billing or
  provider payout exists. Rental certificates attest *claims*, not
  externally verified capacity. Resource shares of 20% L1 / 20% future AI /
  60% available rental are reservations, not actual execution.
- Legacy `governance:{...}` GOV-LAB and standalone `GasBurnLab` remain only
  for repeatability of prior demos. They are *not* separate ZNYT token types;
  use the `znyt:{...}` constructor for the new unified test scenario.

## Before public launch

Implement and audit native on-chain ZNYT balances/staking, consensus and
execution-derived fee measurement, validator incentives, anti-collusion
metering, provider penalties, actual cloud isolation/scheduling, open
governance, token distribution and inflation/burn policy. Test economics
under low/high real transaction volume: burning more gas than rewards may
not sustain validators; pre-funded reserves alone cannot fund perpetual
operations. A token used for pricing volatile resources also needs pricing,
quoting and user-protection rules. Treat this as a **design and accounting
prototype only** until those milestones are complete.
