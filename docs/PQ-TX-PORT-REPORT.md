<!-- Published copy of the project engineering record. Internal workspace paths were rewritten to this repository's layout (besu-912701/ = reconstructed production source tree, docs/ = deliverables). -->

# ZERONYTH PQ Native Transactions — Port Report

**Date:** 2026-11-05 · **Phase:** Port of PQ native transactions onto the reconstructed
production base + verification · **Status: COMPLETE (sandbox scope)**

Base tree: `besu-912701/` (upstream Besu 26.9.0 + Falcon-1024 QBFT
consensus patch only). The ported tree builds end-to-end and the distribution still stamps
exactly **`besu/v26.11-develop-c9aa666`** — the production version string.

Nothing on the VPS or chains 912701/9127 was touched. All live testing used loopback-only
single-validator Falcon-1024 QBFT nodes on test chain **912772**.

---

## 1. What was ported

Both PQ native transaction types are now implemented on the production base, coexisting
with ECDSA (no scheme was removed or demoted):

| Type | Scheme | Source |
|---|---|---|
| 0x7F | ML-DSA-65 (FIPS 204) | Reference implementation `besu-mldsa-tx` (post-fix state) |
| 0x7E | Falcon-1024 | 案C tree `besu-falcon` (transaction subset only) |

All 案C consensus-swap material was **excluded** as ordered: `MlDsaConsensus*`,
`MlDsa65Consensus*`, `PqConsensus`, the `PqOnlyTransactions` ECDSA-rejecting gate, the
`mldsa65consensus` genesis config (JsonQbftConfigOptions/QbftConfigOptions), the
`QbftBesuControllerBuilder` changes, and every `consensus/common`, `consensus/qbft`,
`consensus/qbft-core` diff. Falcon-1024 QBFT consensus and the off-chain ML-DSA finality
attester are untouched. `MainnetTransactionValidator` received **only** the reference
phase's signature-exception-mapping fix — not 案C's PQ-only gate.

### Defects found in the source material during the port (and fixed)

1. **`FalconTransactionDecoder` (from 案C) had the same critical defect the reference
   phase found in the ML-DSA decoder**: it never stripped the 0x7E type byte and hashed
   only the RLP list bytes, so every wire decode would have failed or mismatched.
   Rewritten to mirror the fixed ML-DSA decoder (`input.slice(1)`, transaction hash over
   the full opaque bytes, sizes = `input.size()`).
2. **`Falcon1024TransactionCrypto.getPublicKeyBytes` called
   `FalconPublicKeyParameters.getEncoded()`, which does not exist in BouncyCastle 1.84**
   (the class exposes only `getH()`). The 案C Falcon side had therefore never compiled
   against the production crypto stack. Fixed: the canonical 1793-byte form is now
   constructed as `0x0a ‖ h`, identical to the noble/Falcon reference encoding used by
   the ZERONYTH JS tooling (and pinned by tests: length 1793, first byte 0x0a).
3. **`Transaction.getPublicKey()`** (案C version) recovered an ECDSA key from the dummy
   signature for PQ types. Extended the reference phase's ML-DSA fix to both schemes:
   PQ transactions return their embedded scheme public key.

## 2. File-by-file change list vs the recon base

New files:

- `crypto/algorithms/.../crypto/MlDsa65TransactionCrypto.java` (+ test) — from reference tree, unchanged.
- `crypto/algorithms/.../crypto/Falcon1024TransactionCrypto.java` (+ test) — from 案C, with the `getEncoded()` fix above and a new `MAX_SIGNATURE_LENGTH = 2048` constant (mirrors the production `Falcon1024ConsensusEnvelope` bound).
- `ethereum/core/.../core/encoding/MlDsaTransaction{Encoder,Decoder}.java` — from reference tree; decoder additionally gained exact-size enforcement (§4).
- `ethereum/core/.../core/encoding/FalconTransaction{Encoder,Decoder}.java` — encoder from 案C; decoder rewritten (defect 1 + size enforcement).
- `ethereum/core/.../mainnet/PqTxGate.java` — NEW: the activation gate (§3).
- `evm/.../gascalculator/PqIntrinsicGas.java` — NEW: the gas schedule (§5).
- Tests (new): `MlDsaTransactionTest` (from reference), `FalconTransactionTest`,
  `PqTransactionProtectionTest`, `mainnet/PqTxGateTest`, `gascalculator/PqIntrinsicGasTest`.

Modified files:

- `datatypes/.../TransactionType.java` — adds `FALCON1024(0x7E)`, `MLDSA65(0x7F)`; lookup array sized 128; both excluded from the base-fee market.
- `ethereum/core/.../core/Transaction.java` — PQ fields, signable messages
  (`DOMAIN ‖ rlp([nonce, gasPrice, gasLimit, to, value, data, chainId])`, signature over
  its keccak256), scheme-bound `computeSender` (verify-then-derive
  `keccak256(pubkey)[12..]`), `signAndBuildMlDsa`/`signAndBuildFalcon`, `getPublicKey` fix.
- `ethereum/core/.../core/encoding/Transaction{Encoder,Decoder}.java` — register both types for POOLED_TRANSACTION and BLOCK_BODY contexts.
- `ethereum/core/.../mainnet/MainnetProtocolSpecs.java` — both types added to the accepted-type sets of the berlin/london/shanghai/cancun/prague/osaka definitions.
- `ethereum/core/.../mainnet/MainnetTransactionValidator.java` — only the catch widening (`IllegalArgumentException | IllegalStateException` → `INVALID_SIGNATURE`).
- `ethereum/core/.../mainnet/MainnetTransactionProcessor.java` — activation-gate check at execution entry (§3).
- `ethereum/core/.../mainnet/ProtocolScheduleBuilder.java` — publishes the genesis gate value when the schedule is created (§3).
- `ethereum/core/.../transaction/TransactionInvalidReason.java` — new constant `PQ_TRANSACTION_NOT_YET_ACTIVE`.
- `ethereum/core/.../test-support/.../BlockDataGenerator.java` — `case MLDSA65, FALCON1024 -> null;` in the exhaustive switch.
- `ethereum/eth/.../transactions/TransactionPool.java` — activation-gate check in `validateTransaction` (§3).
- `ethereum/eth/.../transactions/PendingTransaction.java` — PQ types use frontier memory-size accounting.
- `ethereum/api/.../JsonRpcErrorConverter.java` + `internal/response/RpcErrorType.java` — explicit RPC mapping for the new reason: **-32000 "Post-quantum transaction type is not active yet (see pqTxActivationBlock)"**.
- `ethereum/api/.../results/TransactionBaseResult.java` — PQ types included in the typed-transaction result branch.
- `config/.../GenesisConfigOptions.java` — new `getPqTxActivationBlockNumber()`.
- `config/.../JsonGenesisConfigOptions.java` — reads genesis key `pqTxActivationBlock`; included in `asMap()`.
- `config/.../StubGenesisConfigOptions.java` — field, getter, fluent setter, `asMap()`.
- `evm/.../gascalculator/FrontierGasCalculator.java`, `AmsterdamGasCalculator.java` — add `PqIntrinsicGas.surcharge(...)` (zero for non-PQ types; the Frontier implementation is inherited by Berlin→Osaka).
- Tests (modified): `MainnetTransactionValidatorTest` (+4 PQ tests, §6),
  `layered/BaseTransactionPoolTest` and `layered/LayersTest` (exhaustive-switch fixture
  cases for the new enum constants; the ECDSA fixtures never generate PQ types).

## 3. Activation gate design

Genesis config key **`pqTxActivationBlock`** (number). Absent = PQ transactions are
**never** active — this is the production 912701 shape, so the ported binary is a drop-in
replacement for the current chain configuration until an activation block is chosen.

- `PqTxGate` (new, `ethereum/core` mainnet package) holds the configured value
  (process-wide; a Besu process serves one chain). `ProtocolScheduleBuilder.createProtocolSchedule()`
  configures it from `GenesisConfigOptions` — the single funnel used by every consensus
  (mainnet, QBFT via `BaseBftProtocolScheduleBuilder`, IBFT, clique, merge), so the
  production QBFT path is covered.
- Enforcement points (all three required paths):
  1. **TxPool admission** — `TransactionPool.validateTransaction`, gated at
     `chainHead + 1` (the next block to be built).
  2. **`eth_sendRawTransaction`** — submits through the same pool funnel
     (`EthSendRawTransaction` → `addTransactionViaApi` → `validateTransaction`), so it is
     gated identically; verified live (error -32000 with the gate message).
  3. **Block-import validation** — `MainnetTransactionProcessor.processTransaction`
     rejects PQ transactions in blocks numbered below activation; the same processor
     backs block creation, so an out-of-gate PQ transaction can neither be imported nor
     produced. (The transaction validator itself is deliberately ungated — the gate is a
     chain-configuration concern, and the validator is also used for historical contexts.)
- ECDSA and all other types are never consulted by the gate; unit tests pin this and the
  exact boundary (rejected at activation−1, accepted at activation).

## 4. DoS hygiene for large PQ payloads

- **Decoder-level size enforcement** (before any pool/processing work):
  ML-DSA public key exactly 1952 B, signature exactly 3309 B (FIPS 204 fixed sizes).
  Falcon public key exactly 1793 B — the raw 1792-byte `h` form is rejected on the wire
  so every account has exactly one wire representation — and signature 1–2048 B
  (BouncyCastle-produced Falcon-1024 signatures measured at 1261–1280 B over 400 samples;
  the cap matches the production consensus envelope bound, so no valid signature can be
  rejected while memory stays bounded).
- **Pool bounds (pre-existing, now load-bearing for PQ)**: `sizeForBlockInclusion` ≤
  `txPoolMaxTxBytes` (default 128 KiB) with `EXCEEDS_MAX_TX_BYTES`; per-transaction
  memory accounting via `PendingTransaction`.
- **Admission cost**: sender recovery (one PQ verification) happens during pool
  validation, as for ECDSA; the intrinsic-gas surcharge (§5) prices that verification
  for included transactions. Duplicate submissions are rejected as already-known
  without re-verification.

## 5. Per-scheme intrinsic gas schedule

Implemented in `PqIntrinsicGas` and applied inside `transactionIntrinsicGasCost`
(Frontier + Amsterdam calculators; Berlin–Osaka inherit Frontier's). Two components on
canonical envelope sizes, documented in the class javadoc:

| Component | Falcon-1024 (0x7E) | ML-DSA-65 (0x7F) |
|---|---|---|
| Bytes (pubkey + sig) × 16 gas/B (EIP-2028 non-zero rate) | (1793 + 1462) × 16 = **52,080** | (1952 + 3309) × 16 = **84,176** |
| Verification | **30,000** | **42,000** |
| **Total surcharge** | **82,080** | **126,176** |
| Plain-transfer intrinsic total | **103,080** | **147,176** |

Verification pricing rationale: ecrecover (native secp256k1, ~70 µs class) costs
3000 gas. Measured BouncyCastle 1.84 verify times on the build VM (JDK 25, Besu-style
57-byte domain-separated inputs): Falcon-1024 ≈ 0.71 ms, ML-DSA-65 ≈ 0.98 ms —
≈10× and ≈14× the ecrecover yardstick — hence 30,000 / 42,000. The Falcon byte envelope
uses a 1462 B signature bound although the measured maximum compressed signature is
1280 B; the margin is deliberate. **ECDSA gas is unchanged** (proven in unit tests and
live: gasUsed exactly 21000 before and after activation).

## 6. PQ-account protection (scheme-bound senders)

Sender derivation is per-type with no cross-scheme fallback: a 0x7E transaction derives
its sender only by Falcon-verifying against its embedded Falcon key, a 0x7F only by
ML-DSA-verifying against its embedded ML-DSA key, and ECDSA recovery is never attempted
for PQ types. Proven by `PqTransactionProtectionTest` (10 tests):

- Type-byte spoofing both directions (valid Falcon wire relabeled 0x7F and vice versa)
  is rejected at decode by the exact-size enforcement.
- Cross-scheme transplants (ML-DSA key+signature inside a Falcon transaction and vice
  versa) fail sender derivation.
- A PQ-typed transaction carrying only an ECDSA signature derives **no** sender
  (fails closed in sender recovery).
- An ECDSA account address differs from both PQ addresses — holding ECDSA keys gives
  no control over PQ accounts.
- Decoder size caps reject undersized/oversized keys and signatures for both schemes.

Live E2E additionally shows spoofed raw transactions rejected at the RPC layer
(-32602 Invalid params, decode failure) for both schemes.

## 7. Verification — exact commands and REAL results

Builds used the reference-phase tooling pattern (local dependency mirror, JDK 25,
`--no-daemon`): runner `besu-912701/work/run-gradle-port.sh`.
Unit tests ran through the JUnit Platform Console Launcher 1.14.4 (single JVM) because
Gradle test workers are blocked by the sandbox's loopback interception — same as the
reference phase.

Compile (all BUILD SUCCESSFUL):
`run-gradle-port.sh :config:compileJava :crypto:algorithms:compileJava :datatypes:compileJava :ethereum:core:compileJava :evm:compileJava :ethereum:eth:compileJava :ethereum:api:compileJava :ethereum:core:compileTestJava :crypto:algorithms:compileTestJava :config:compileTestJava :datatypes:compileTestJava :consensus:common:compileTestJava :ethereum:eth:compileTestJava :installDist`
(The evm *test* compile via Gradle needs `net.jqwik:jqwik:1.9.3`, absent from the
offline mirror; `PqIntrinsicGasTest` was instead compiled with `javac` against the core
test classpath and run with the same console launcher — results below are real.
`ethereum:api` test compile is likewise blocked by missing vertx test artifacts in the
mirror; API main code compiles and its behavior is covered by the live E2E.)

Unit results (JUnit console, `--details summary`):

| Suite | Result |
|---|---|
| `MlDsa65TransactionCryptoTest` + `Falcon1024TransactionCryptoTest` (crypto) | **2/2 pass** |
| `MlDsaTransactionTest` (roundtrip/sender/tamper/chainId) | **6/6 pass** |
| `FalconTransactionTest` (same coverage, 0x7E) | **6/6 pass** |
| `PqTransactionProtectionTest` (§6) | **10/10 pass** |
| `PqTxGateTest` (absent/exact-block/ECDSA-ungated) | **3/3 pass** |
| `MainnetTransactionValidatorTest` (35 pre-existing + 4 new PQ: ML-DSA & Falcon valid-accepted, tampered → INVALID_SIGNATURE) | **39/39 pass** |
| `PqIntrinsicGasTest` (schedule constants; Frontier/Berlin…Osaka/Amsterdam; ECDSA unchanged) | **5/5 pass** |
| Config: `GenesisConfigOptionsTest`, `JsonGenesisConfigOptionsTest`, `GenesisConfigTest` | **114/114 pass** |
| Pool regression: `BlobV1TransactionPoolTest`, `LayeredTransactionPoolBaseFeeTest`, `LayeredTransactionPoolGasPriceTest` | **181/181 pass** (6 skipped by design) |
| Regression: `TransactionIntegrationTest`, `TransactionSizeAndHashTest`, `TransactionBuilderTest`, `TransactionReceiptTest`, `ethereum.core.encoding` package | 105 pass, 6 aborted (upstream `Assumptions` gates), **0 failed** |

Benchmark (standalone, BC 1.84): Falcon sign avg 3,976 µs, sig lengths 1261–1280 B
(max 1280 over 400); Falcon verify avg 706 µs; ML-DSA verify avg 977 µs; ML-DSA
pubkey 1952 B, signature 3309 B (exact).

## 8. Live E2E — chain 912772 (ported binary, single-validator Falcon-1024 QBFT)

Harness: `docs/evidence/` — `run_e2e_port.py`, `tool/PortE2ETool.java`,
dual-scheme wallet `wallet/pq-wallet.mjs`. Genesis: `pqTxActivationBlock: 15`,
3 s blocks; ML-DSA, Falcon and ECDSA accounts funded in alloc.
**Result: 45/45 assertions PASS** (full log in `e2e/evidence.json`).

- **Before activation** (head 1 and 3): ML-DSA and Falcon wallet transfers rejected —
  RPC **-32000 "Post-quantum transaction type is not active yet (see
  pqTxActivationBlock)"**; no PQ nonce consumed. ECDSA transfer succeeded in block 5
  with **gasUsed exactly 21000**.
- **After activation** (block 15): Falcon transfer via the dual-scheme wallet succeeded
  (sender debited value + 103080 × 1 gwei exactly; recipient credited; nonce 0→1).
  ML-DSA wallet transfer succeeded (value + 147176 × 1 gwei exactly). ECDSA transfer
  still succeeded with gasUsed 21000 (unchanged).
- **Harness transfers**: Falcon gasUsed 0x192a8 = 103,080; ML-DSA 0x23ee8 = 147,176;
  `eth_getTransactionByHash` shows types 0x7e/0x7f with the correct PQ senders.
- **Replay** (both schemes): -32001 "Nonce too low", no double execution.
  **Tampered signature** (both): -32002 "Invalid signature", no state change.
  **Type-byte spoof** (both): -32602 "Invalid params" (decoder rejection).
- **Contracts**: creation via a Falcon transaction (contract
  `0x36b81cc91931ee9417decc84a5775900b6523bd6`, code verified), `store(42)` via an
  ML-DSA transaction, `eth_call retrieve()` = 42.
- Final head 35; nonces ML-DSA 3, Falcon 3, ECDSA 2.

**Wallet Falcon side**: no sign-capable JavaScript Falcon exists in these trees (the
falcon-net JS is noble-based and verify-only, as is the production finality tooling).
The dual-scheme wallet therefore signs ML-DSA in pure JS (noble, as in the reference
phase) and delegates Falcon keygen/signing to a Java bridge (`PortE2ETool`, BouncyCastle
from the built distribution — the same crypto the node verifies with), while the wallet
itself performs the full user flow (chainId/nonce/balance reads, submission, receipt
waiting) for both schemes. The ML-DSA wallet address matches the Java tool's address
for the same key (noble ↔ BC interop re-proven on the ported tree).

**Production-shape compatibility run** (`run_e2e_nogate.py`, `evidence-nogate.json`):
genesis *without* `pqTxActivationBlock` — **5/5 PASS**: at head 10 both PQ transfers
still rejected ("not active"), ECDSA transfer succeeded with gasUsed 21000. The ported
binary therefore behaves exactly like production on the current production genesis
until an activation block is deliberately configured.

## 9. Remaining limitations

- **Multi-node / peering tests are impossible in this sandbox** (Java↔Java TCP between
  nodes is intercepted; even production↔production pairs report 0 peers). All live
  verification is single-validator loopback. Before any production rollout, re-run on a
  network where nodes can peer: (a) 4-validator QBFT with the ported binary, (b)
  mixed-binary interop (production binary + ported binary) across the activation block,
  (c) block sync of a fresh ported node through pre/post-activation history.
- The activation gate value is process-global state set at protocol-schedule creation.
  That matches Besu's one-chain-per-process model; embedders running several schedules
  in one JVM (tests) must treat the last-created schedule as authoritative.
- `eth_call`/`eth_estimateGas` for PQ transactions also pass through the gated
  processor, so PQ simulations are rejected before activation — consistent, but worth
  knowing for wallet UX.
- Gradle test workers and two modules' test compiles (`evm` jqwik, `api` vertx) are
  blocked by offline-mirror gaps in this sandbox, worked around as described in §7;
  in a networked CI all suites should be run via Gradle directly.
- Spotless formatting could not run in the sandbox (provisioner blocked); new/changed
  files were formatted manually to the project's google-java-format style.
- **Production deployment has NOT been performed and is not authorized by this report.**
  Rollout still requires: an owner-chosen activation block, the all-validator upgrade
  procedure, rollback conditions (binary downgrade is safe pre-activation because the
  gate defaults to never-active; post-activation rollback requires chain-state review),
  and the owner's final approval.
