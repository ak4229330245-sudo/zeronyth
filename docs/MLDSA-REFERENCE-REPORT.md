<!-- Published copy of the project engineering record. Internal workspace paths were rewritten to this repository's layout (besu-912701/ = reconstructed production source tree, docs/ = deliverables). -->

# ML-DSA-65 Native Transactions — Completion & Verification Report

**Scope**: Complete and prove ML-DSA-65 native transactions (transaction type
`0x7F`) end-to-end in the modified Hyperledger Besu 26.9.0 tree at
`besu-mldsa-tx/besu-26.9.0-falcon`.
**Status: COMPLETE.** All unit tests pass and a live E2E on a local
Falcon-1024 QBFT chain (chainId **912770**, loopback only) passes every
assertion, including wallet-driven transfer, harness-driven transfer,
replay/tamper/wrong-chain rejection, and smart-contract creation + call.

> **Reference implementation only — NOT for production deployment.**
> This 26.9.0 build is the reference implementation. Production runs a
> 26.11-develop base (commit c9aa666) whose source is being reconstructed
> separately; the changes below are written so they can be ported
> mechanically (see the file-by-file change list in §7). No VPS was
> contacted, chain IDs 912701/9127 were never used, nothing was deployed.

> **Signature-scheme framing (owner spec, 2026-11-04 21:19).** ECDSA is
> **not** abolished: ECDSA (Ethereum/EVM wallet compatibility), Falcon-1024
> native tx (0x7E, later port phase) and ML-DSA-65 native tx (0x7F, this
> work) coexist. The binding design rule is that **sender derivation is
> scheme-bound**: each transaction type derives its sender only from its
> own scheme's key, with no cross-scheme fallback, so a PQ account can
> never be operated via an ECDSA signature. This implementation satisfies
> the rule for 0x7F: the sender is derived exclusively from the embedded
> ML-DSA-65 public key, and only after the ML-DSA-65 signature over
> `keccak256("ZERONYTH/ML-DSA-65/TX/V1" || rlp([nonce, gasPrice, gasLimit,
> to, value, data, chainId]))` verifies. Moving funds from ECDSA accounts
> to PQ accounts is a voluntary opt-in, not a forced migration.

---

## 1. Audit findings — defects in the partial implementation (all fixed)

The partial implementation already present in the tarball was audited layer
by layer (crypto, encoding, pool admission validation, block import,
execution, RPC read/write). Three defects broke or bypassed the ML-DSA
path; all are fixed minimally, in the existing code style.

### Defect 1 (CRITICAL) — `MlDsaTransactionDecoder` could not decode any wire transaction
`ethereum/core/.../encoding/MlDsaTransactionDecoder.java`

The pristine decoder called `RLP.input(input)` on the **full** opaque bytes
without slicing off the `0x7F` type byte (every other typed decoder does
`input.slice(1)`), so decoding any raw ML-DSA transaction — via
`eth_sendRawTransaction`, block bodies, or p2p — threw `RLPException`.
It also computed the transaction hash over the RLP-list bytes only instead
of the full opaque bytes, and recorded wrong sizes.
**Fix**: decoder rewritten mirroring `EIP1559TransactionDecoder`:
`RLP.input(input.slice(1))`, `.rawRlp(txRlp.raw())`, sizes set to
`input.size()`, `hash = Hash.hash(input)`.

### Defect 2 — Invalid ML-DSA signatures escaped pool validation as an internal error
`ethereum/core/.../mainnet/MainnetTransactionValidator.java`

`validateTransactionSignature` caught only `IllegalArgumentException`
(the ECDSA recovery failure mode). ML-DSA sender recovery throws
`IllegalStateException` when the signature does not verify, so a tampered
ML-DSA transaction surfaced as an internal JSON-RPC error instead of a
clean rejection.
**Fix**: the catch clause is widened to
`IllegalArgumentException | IllegalStateException`, both mapped to
`TransactionInvalidReason.INVALID_SIGNATURE` (JSON-RPC `-32002
"Invalid signature"` — proven live in §4(f)). No other logic changed;
the wrong-chainId check still runs first, so a wrong-chain ML-DSA tx is
rejected as `WRONG_CHAIN_ID` before signature recovery (§4(g)).

### Defect 3 — `Transaction.getPublicKey()` returned a bogus ECDSA key for ML-DSA txs
`ethereum/core/.../core/Transaction.java`

`getPublicKey()` ran ECDSA recovery over the dummy `SECPSignature(1,1,0)`
that `Builder.build()` installs for ML-DSA transactions, so RPC paths
that read the public key (e.g. `TransactionPendingResult`) returned a
meaningless key.
**Fix**: for `TransactionType.MLDSA65`, `getPublicKey()` returns the
embedded ML-DSA-65 public key hex
(`mlDsaPublicKey.map(Bytes::toString)`); all other types unchanged.

### Defect 4 (test-support only) — non-exhaustive switch over `TransactionType`
`ethereum/core/.../test-support/.../BlockDataGenerator.java`

Adding the `MLDSA65` enum constant made an existing `switch` over
`TransactionType` in the core test-support sources non-exhaustive, so
`:ethereum:core:compileTestJava` failed under JDK 25.
**Fix**: one line, `case MLDSA65 -> null;` (consistent with the existing
`case DELEGATE_CODE -> null;`). Test-support only; not part of the
runtime port surface beyond keeping test compilation green.

### Verified OK — no change needed
- `Transaction.computeSender` for MLDSA65: verifies the ML-DSA signature
  and derives the sender solely from the embedded public key
  (scheme-bound, see framing note above); `signAndBuildMlDsa` signs
  exactly the message that verification recomputes.
- Encoder/decoder registration in `TransactionEncoder`/`TransactionDecoder`;
  `Transaction.copy()` carries the ML-DSA fields.
- `MainnetProtocolSpecs`: MLDSA65 is in the accepted-type sets for
  Berlin/London/Shanghai+ (6 sites).
- Pool admission: default max transaction size (128 KiB) comfortably
  exceeds a full ML-DSA tx (~5.3 KB; pubkey 1952 B, signature 3309 B).
- RPC results: `TransactionBaseResult` reports `type = 0x7f` and
  `from = getSender()`; receipts and `eth_getTransactionByHash` behave
  correctly (proven live in §4).
- Execution: `MainnetTransactionProcessor` paths (upfront gas/balance,
  nonce, transfer, contract creation) are type-generic and work for
  0x7F (proven live in §4 and §5).

### Usage note (not a source defect)
`Transaction.Builder` leaves `payload` null unless `.payload(...)` is
called; the ML-DSA encoder calls `getPayload()`, so ML-DSA transactions
must be built with an explicit payload (`Bytes.EMPTY` for a plain
transfer). This matches pristine builder behaviour for other types; the
test code and the E2E harness were fixed to always set a payload rather
than changing production semantics.

---

## 2. Unit tests — exact commands and real results

Gradle's own test workers cannot run in this sandbox (the runtime's TCP
interception corrupts Java↔Java loopback sockets, which Gradle worker
daemons and test executors rely on). Tests were therefore compiled with
Gradle (in-process compilation) and executed with the **JUnit Platform
Console Launcher in a single JVM** against the exact Gradle-resolved
test runtime classpath:

```
# compile (Gradle 9.3.1, JDK 25, local file repository)
gradle :ethereum:core:compileTestJava :ethereum:core:musePrintTestClasspath
gradle :crypto:algorithms:compileTestJava

# run (JUnit Platform Console Launcher 1.14.4, single JVM, JDK 25)
java -jar junit-platform-console-standalone.jar \
  --class-path "$(cat ethereum/core/build/muse-test-classpath.txt)" \
  --select-class org.hyperledger.besu.ethereum.core.MlDsaTransactionTest \
  --select-class org.hyperledger.besu.ethereum.mainnet.MainnetTransactionValidatorTest
```

Results (observed 2026-11-04):

| Test class | Tests | Result |
|---|---|---|
| `org.hyperledger.besu.crypto.MlDsa65TransactionCryptoTest` (pre-existing) | 1 | **1 passed, 0 failed** |
| `org.hyperledger.besu.ethereum.core.MlDsaTransactionTest` (new) | 6 | **6 passed, 0 failed** |
| `org.hyperledger.besu.ethereum.mainnet.MainnetTransactionValidatorTest` (incl. 2 new ML-DSA tests) | 37 | **37 passed, 0 failed** |
| Combined core run | 43 | **43 passed, 0 failed** |

New test coverage:
- `MlDsaTransactionTest` (6): `signAndBuildMlDsa` happy path (incl.
  signature 3309 B / pubkey 1952 B sizes and `getPublicKey()` returning
  the ML-DSA key); encode→decode roundtrip in both `POOLED_TRANSACTION`
  and `BLOCK_BODY` contexts preserving every field, the hash, the sizes,
  and re-encode equality; sender recovery equals
  `addressFromPublicKey`; tampered signature rejected in sender recovery
  (`IllegalStateException: Invalid ML-DSA-65 signature`); tampered wire
  byte rejected identically; a signature replayed under a different
  chainId rejected identically.
- `MainnetTransactionValidatorTest` (+2):
  `shouldAcceptMlDsa65TransactionWithValidSignature`;
  `shouldRejectMlDsa65TransactionWithTamperedSignature` → asserts
  `INVALID_SIGNATURE` (regression test for Defect 2).

Distribution build: `gradle installDist` → **BUILD SUCCESSFUL**;
`build/install/besu/bin/besu --version` prints
`besu/v00.0-develop-xxxxxxxx/linux-x86_64/openjdk-java-25`, and the
distribution jars contain both the Falcon-1024 and ML-DSA-65 classes.

---

## 3. Test chain configuration (E2E)

- **Chain ID 912770** (new test chain; production IDs never used),
  loopback only: p2p `127.0.0.1:41401`, HTTP RPC `127.0.0.1:19601`,
  discovery disabled, `--min-gas-price=0`, APIs ETH, NET, QBFT, ADMIN,
  TXPOOL, WEB3.
- **Consensus: Falcon-1024 QBFT** (the production-mirroring path worked;
  no fallback was needed). Genesis `qbft.falcon1024: true`,
  blockperiod 1 s, epochlength 30000, requesttimeout 2 s;
  berlin/london at 0, shanghaiTime 0, zeroBaseFee. Single validator:
  Falcon address `0xcc476859ce37f2fd277a09cd1820c17ed1a8500f`
  (key generated with the distribution's `Falcon1024KeyFile` CLI;
  `qbft_getValidatorsByBlockNumber` confirmed it as the sole validator).
- Genesis extraData uses this tree's QBFT layout, verified by
  RLP-decoding the production template
  (`zeronyth/falcon-net/genesis-falcon-912701.json`, used as template
  only): `[vanity(32×0x00), [validators], vote(empty list), round(0),
  seals(empty list)]` →
  `0xf83aa0…00d594cc476859ce37f2fd277a09cd1820c17ed1a8500fc080c0`.
- ML-DSA sender account `0x210deb87b8d6b28c15c0f11a3044e85f0093a8cf`
  funded in genesis alloc with `0x33b2e3c9fd0803ce8000000` wei
  (1,000,000,000,000,000,000,000,000,000 wei). Recipient:
  `0x6559bb45e6b3ed0f3b9dc934225a3c6269882913` (fresh ML-DSA account,
  0 balance). Gas price 1 gwei throughout; plain-transfer gasUsed 21000.
- Orchestrator: `e2e/run_e2e.py`; full request/response log and all
  verdicts in `e2e/evidence.json` (**23 assertions, all PASS**).

---

## 4. Live E2E evidence

### Wallet transfer (standalone wallet tool, nonce 0) — §6
```
from: 0x210deb87b8d6b28c15c0f11a3044e85f0093a8cf
to: 0x6559bb45e6b3ed0f3b9dc934225a3c6269882913
amount: 500000000000000000 wei
nonce: 0, chainId: 912770
tx hash: 0x89e19ccbcd39f9cd2887a4ee2cffd02a7ee7108eec926054e618f27f535bc1e9
included in block: 4
receipt status: 0x1
gas used: 21000
sender balance: 1000000000000000000000000000 -> 999999999499979000000000000 wei
recipient balance: 0 -> 500000000000000000 wei
```

### Harness transfer (Java `E2ETool` against the dist jars, nonce 1)
- Submitted via `eth_sendRawTransaction`; returned hash
  `0xc8860ccb4bc031dba31e68054fb3182b97395baa28749acda4e2095dc74c9012`.
- **(a)** Receipt: block `0xa` (10), **status `0x1`**, gasUsed `0x5208` (21000).
- **(b)** Recipient balance increased by exactly 1,000,000,000,000,000,000 wei (1 ETH).
- **(c)** Sender balance decreased by exactly 1,000,021,000,000,000,000 wei
  (value + 21000 × 1 gwei).
- **(d)** Sender nonce 1 → 2 (`eth_getTransactionCount`).
- `eth_getTransactionByHash`: **`type = 0x7f`**,
  `from = 0x210deb87b8d6b28c15c0f11a3044e85f0093a8cf` (the ML-DSA sender).

### Negative tests
- **(e) Replay**: resubmitting the identical raw transaction →
  `{"code": -32001, "message": "Nonce too low"}`; sender nonce stays 2
  (no double execution).
- **(f) Tampered signature**: raw tx with the last byte flipped →
  `{"code": -32002, "message": "Invalid signature"}` (rejected at pool
  admission; this is Defect 2's fix working end-to-end); no state change.
- **(g) Wrong chainId**: transaction signed for chainId 912771 →
  `{"code": -32000, "message": "Wrong chainId"}`.

---

## 5. Smart-contract execution via ML-DSA transactions

A minimal hand-assembled storage contract (51-byte runtime;
`store(uint256)` selector `0x6057361d`, `retrieve()` selector
`0x2e64cec1`) was deployed and exercised entirely with type-0x7F
transactions from the ML-DSA sender:

- **Creation**: tx
  `0x47a9837ec1716b0e7f7ad6cecaae81efd1b17308a77e94cd89de1035c76f6b93`,
  block `0x18` (24), receipt **status `0x1`**, gasUsed `0xfa7a` (64122),
  `contractAddress = 0xcea02138d24261d5be21d3fa08ba144c63ee92d9`;
  `eth_getCode` returns exactly the 51-byte runtime.
- **Call**: `store(42)` tx
  `0x1f877c935ec2636d5050268557e0e4962df9b0959021b0b5dfb8496a937843be`,
  block `0x1c` (28), receipt **status `0x1`**, gasUsed `0xa954` (43348).
- **Readback**: `eth_call` `retrieve()` →
  `0x000000000000000000000000000000000000000000000000000000000000002a` (42).

No processor/encoder changes were needed for the contract path.

---

## 6. Wallet integration

Standalone wallet: `e2e/wallet/mldsa-wallet.mjs` (Node, independent of
Besu and of the test harness; `create | address | balance | transfer`
commands; vendored noble ML-DSA-65 + keccak bundle
`e2e/wallet/vendor-noble.mjs`). It generates an ML-DSA-65 keypair,
saves/loads a JSON key file (`{"seed": …}` or the expanded
`{"secretKey","publicKey"}` form interoperable with the Bouncy Castle
key encoding used by Besu), derives the address with the same
`keccak256(pubkey)[12..]` rule, builds and signs transfers with the
identical signable-message construction, submits via
`eth_sendRawTransaction`, and checks balances before/after.

Evidence: the wallet's derived address for the E2E sender key equals
the Java harness address
(`0x210deb87b8d6b28c15c0f11a3044e85f0093a8cf`), and the §4 wallet
transfer (0.5 ETH, nonce 0) was executed through the wallet CLI, with
its full output recorded in `e2e/evidence.json`
(`walletTransferOutput`). Cross-implementation agreement (noble ↔
Bouncy Castle) is thereby proven for key handling, signing, and
verification. (MetaMask cannot sign ML-DSA; this tool stands in for
wallet integration, as specified.)

---

## 7. File-by-file change list vs the pristine tarball

Generated by extracting
`user/files/E36B16CC-D325-4FA5-8A49-C4A0197D51CB-besu-26.9.0-falcon-mldsa65-final.tar.gz`
fresh and running `diff -rq` against the working tree (build outputs
excluded). **Exactly 6 source/test files differ, plus 1 new test file:**

Modified (semantic fixes — port these):
1. `ethereum/core/src/main/java/org/hyperledger/besu/ethereum/core/encoding/MlDsaTransactionDecoder.java`
   — rewritten decode (Defect 1): slice the 0x7F type byte, rawRlp,
   correct hash (over full opaque bytes) and sizes. 39 diff lines;
   file is 55 lines.
2. `ethereum/core/src/main/java/org/hyperledger/besu/ethereum/mainnet/MainnetTransactionValidator.java`
   — catch clause widened to `IllegalArgumentException |
   IllegalStateException` → `INVALID_SIGNATURE`, with explanatory
   comment (Defect 2). 4 diff lines.
3. `ethereum/core/src/main/java/org/hyperledger/besu/ethereum/core/Transaction.java`
   — `getPublicKey()` ML-DSA branch returning the embedded ML-DSA
   public key (Defect 3). 6 added lines.
4. `ethereum/core/src/test-support/java/org/hyperledger/besu/ethereum/core/BlockDataGenerator.java`
   — `case MLDSA65 -> null;` added to a `TransactionType` switch
   (Defect 4, test-support compile fix). 1 added line.

Created (tests):
5. `ethereum/core/src/test/java/org/hyperledger/besu/ethereum/core/MlDsaTransactionTest.java`
   — new, 185 lines, 6 tests (§2).

Modified (tests):
6. `ethereum/core/src/test/java/org/hyperledger/besu/ethereum/mainnet/MainnetTransactionValidatorTest.java`
   — 2 new ML-DSA validator tests + helpers + constant
   `ML_DSA_CHAIN_ID = 912770`. 79 diff lines.

Build-environment only (do **not** port as a feature change):
7. `gradle/gradle-daemon-jvm.properties` — `toolchainVersion` 21 → 25.
   The tarball's 21 pin is a packaging artifact: upstream Besu 26.9.0
   pins 25, the production binary was built with JDK 25, and the
   sources use post-21 language features (unnamed variables, flexible
   constructor bodies) that JDK 21 cannot compile. (Pristine copy kept
   at `besu-mldsa-tx/build-env/gradle-daemon-jvm.properties.pristine-21`.)

Everything else in the tree is byte-identical to the pristine tarball.

---

## 8. Transaction-type 0x7F collision check

`0x7F` is assigned **only** to `TransactionType.MLDSA65(0x7F)`. All
other transaction types: FRONTIER (legacy), ACCESS_LIST `0x01`,
EIP1559 `0x02`, BLOB `0x03`, DELEGATE_CODE `0x04`. Every other `0x7f`
occurrence in the tree is an unrelated namespace (RLP single-byte
string-prefix bound, the EVM PUSH32 opcode byte, discv4
`PacketType.MAX_VALUE`, benchmark bit masks). The
`transactionTypeByEthSerializedType` lookup array is sized 128, so
0x7F is the maximum valid typed-transaction byte under EIP-2718.
**No collision.**

## 9. Activation gating — note for the production port

This 26.9.0 reference build accepts type-0x7F transactions **globally,
from genesis**, wherever the protocol spec includes MLDSA65 in its
accepted-type set. The production port must instead **gate 0x7F behind
a configured activation block**, with before/after-activation
compatibility tests in that phase. Gating was intentionally **not**
implemented in this tree (per instructions).

## 10. Remaining limitations

- Reference build only; the production port onto the reconstructed
  26.11-develop base (including the Falcon-1024 0x7E transaction type
  and the dual-scheme wallet) is a separate, later phase, as is the
  activation-block gating in §9.
- E2E used a single-validator Falcon QBFT chain; multi-validator
  block propagation of 0x7F transactions over p2p was not exercised
  (the wire encode/decode path it depends on is covered by the
  BLOCK_BODY roundtrip unit test).
- `spotlessApply` could not be run in this sandbox: spotless 7.0.3's
  provisioner fails (`InvalidUserDataException: Cannot add a
  configuration with name 'spotless…'`) when resolving its formatter
  from the local file repository. Touched files were formatted to
  match the surrounding google-java-format style and Besu import
  order manually; a `spotlessCheck` pass on a networked machine is
  recommended before the port lands.
- Gradle test workers cannot run in this sandbox (loopback socket
  interception); unit tests were executed via the JUnit Platform
  Console Launcher on the Gradle-resolved classpath (§2). The same
  test classes should be re-run under `./gradlew test` in a normal
  environment as a final check.
- Dependencies for the offline build were mirrored into a local file
  repository (`besu-mldsa-tx/tools/local-repo`, checksums
  verified against the project's `gradle/verification-metadata.xml`);
  this is sandbox tooling, not part of the deliverable source changes.
