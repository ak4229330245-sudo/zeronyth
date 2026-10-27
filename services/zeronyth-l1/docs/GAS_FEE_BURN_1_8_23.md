# ZERONYTH v1.8.23 — Partial gas-fee burn research design

**Important status:** The release is an independent **GAS-LAB research
accounting demonstration**, NOT a change to actual ZERONYTH network
fees or tokens. The existing Besu/EVM private devnet has London enabled but
explicit `zeroBaseFee: true` (see `config/qbftConfigFile.json`), and the
separate native ML-DSA ledger has no gas-priced transfer field or gas meter.
Therefore neither production nor existing development transactions burn any
token under this new model.

## Suggested fee flow

| Paid simulated gas fee | Burned | Held in network reward pool |
| ---: | ---: | ---: |
| 100 GAS-LAB units | 20 | 80 |
| 1,000 GAS-LAB units | 200 | 800 |

`burnBasisPoints = 2000` (20%) is a prototype **default**, not a binding
mainnet economic decision. The constructor accepts `0..10000` basis points,
with `burned = floor(fee * burnBps / 10000)`, `pooled = fee - burned`.
The amount is destroyed in the simulation accounting by reducing circulating
units, **not** transferred to a misleading burn wallet. Integer units below
the representable burn share round down to zero, without negative balances.

### Signed research procedure

1. Create a distinct GAS-LAB allocation budget. This budget does not mint or
   reference ZNYT, the separate GOV-LAB research token, or original DEV-CREDIT.
2. The payer ML-DSA-signs the chain ID, operation ID, nonce, authorized gas
   limit, authorized maximum unit price and an expiration height.
3. A `floor(2N/3)+1` distinct genesis validator quorum signs the same
   authorization identifier, simulated gas usage, price and height.
4. Only after all authentication, price/usage bounds and balance checks pass,
   the research ledger atomically debits the payer, records the cumulative
   burn, credits the network reward pool and advances the payer nonce.
5. `audit()` verifies that spendable + network fee pool + burned equals the
   explicit initial GAS-LAB supply. The circulating test supply decreases by
   exactly the cumulative simulated burns.

**The signed meter is a validator assertion, not evidence of actually
executed EVM/native gas.** Real metering must be deterministic for every
validator from real transaction execution, rather than accepted merely
because signers agreed on a gas number.

## Reproduce

```bash
node pq-native/gas-burn-demo.mjs
node --test pq-native/gas-burn-lab.test.mjs
```

The demo reports a simulated 100-unit charge, 20 units destroyed and an
80-unit pool, plus a conserved 1,000-unit initial budget. No actual network
fee, signing key, wallet asset or token balance is changed outside the demo.

## Mainnet architecture decisions still needed

1. Which actual asset pays for network gas: native ZNYT, a future governance
   token, or a separate designated unit? This has **not** been chosen.
2. What percentage burns and what exact share goes to proposer/validators,
   independent compute contributors, treasury and other recipients? The
   simulated unallocated 80% pool is **not paid to anybody** yet.
3. Whether the target chain will use fixed-per-operation charges, a real gas
   meter, EIP-1559 style base fee, or a bespoke mechanism. Ethereum EIP-1559
   burns **the entire protocol base-fee portion**, while priority fees are
   retained by block producers. Burning a flat 20% of total gas is a
   different, custom protocol choice.
4. Live Besu configuration currently requires its zero-fee assumptions for
   private development. Changing genesis/reconfiguring fee policies on an
   existing chain would be a consensus migration requiring deliberate upgrade
   planning, regression tests and operator coordination; none were applied.
5. The ML-DSA research ledger would require new signed fee fields in native
   transaction authorization, deterministic gas accounting in *all* serial
   and parallel execution paths, state-root/total-supply commitments,
   replay/recovery tests across durable journals, validators' independently
   computed receipts and an epoch-activated protocol upgrade. Those steps
   cannot be replaced by this standalone fee simulation.

**The prior v1.8.22 node-provider AI entitlement, governance simulation,
VPS/GPU rental, resource-split research, Besu/EVM and native ML-DSA quorum
remain unchanged. No automatic token deflation or price rise is guaranteed.**
