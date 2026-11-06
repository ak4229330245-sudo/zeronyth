# ZERONYTH Whitepaper

**A Quantum-Resistant EVM Network with Native Post-Quantum Transactions**

Version 1.1 — 6 November 2026 (v1.0: 5 November 2026; v1.1 adds §5A, the zk-STARK privacy pool)
Network: ZERONYTH, Chain ID 912701 (`0xDED3D`)
Website: https://zeronyth.dpdns.org/ · Explorer: https://scan.zeronyth.dpdns.org/

> ZERONYTH is experimental, unaudited software. ZNYT is a test coin with no
> monetary value. Never use real assets on this network.

---

## Abstract

ZERONYTH is a live, public, EVM-compatible blockchain whose signature stack is
post-quantum end to end. Consensus votes are sealed with **Falcon-1024**,
finality checkpoints are certified with **ML-DSA-65** (NIST FIPS 204), and —
since activation block **157,773** on 5 November 2026 — users can hold and
spend from **native post-quantum accounts**: transactions signed with
Falcon-1024 (type `0x7E`) or ML-DSA-65 (type `0x7F`) execute in the same EVM
alongside ordinary ECDSA transactions. Account control is *scheme-bound*: a
post-quantum account can never be operated by an ECDSA signature, so migrating
funds to a PQ account permanently removes them from the quantum-vulnerable
signature scheme. On 6 November 2026 a fourth pillar joined the stack: a
**zk-STARK privacy pool** (PrivatePoolG1) deployed on the production chain,
whose deposits, shielded transfers and withdrawals are verified by STARK
proofs — hash-based, with no trusted setup and no elliptic-curve assumption.
The stack is now four pillars: **ECDSA · Falcon · ML-DSA · zk-STARK**
(§5A). This paper describes the threat model, the design, the exact
transaction formats and gas schedule, the activation governance, and the
verification evidence behind the production deployment, together with an
honest account of the current limitations.

## 1. Introduction: the quantum deadline for ECDSA

Every externally owned account on an ECDSA chain is one cryptographically
relevant quantum computer away from forgery. Shor's algorithm reduces the
elliptic-curve discrete logarithm problem — the entire basis of secp256k1
account security — to polynomial time. An attacker who records today's public
keys (and every used address exposes one) can derive the corresponding private
keys once suitable hardware exists, then drain the accounts. Unlike encrypted
traffic, where the risk is retrospective decryption, account signatures face
*prospective forgery*: the assets remain at risk for as long as they sit in
ECDSA accounts.

Migrating a live chain is slow: new signature schemes need new transaction
formats, new wallets, new address derivation, and a coordinated activation.
ZERONYTH's premise is that this migration should be done *before* it is
urgent, on a network that is quantum-resistant at every layer from day one —
consensus, finality, and user transactions — while refusing to break the EVM
tooling that developers already use.

## 2. Design principles

1. **Post-quantum at every layer.** A chain whose blocks are sealed with
   classical signatures but whose transactions are PQ (or vice versa) still
   has a quantum single point of failure. ZERONYTH applies PQ signatures to
   consensus seals, finality certificates, and user transactions.
2. **Standards-based primitives only.** ML-DSA-65 is NIST FIPS 204.
   Falcon-1024 is the Falcon scheme selected by NIST for standardization
   (FN-DSA, FIPS 206 draft). No home-grown cryptography.
3. **EVM compatibility is non-negotiable.** Contracts, tooling, and standard
   JSON-RPC behave exactly as on any Besu chain. PQ transactions are new
   transaction *types*, not a new execution environment.
4. **Coexistence, not flag days.** ECDSA, Falcon-1024, and ML-DSA-65
   transactions coexist permanently. Users migrate funds to PQ accounts
   voluntarily, at their own pace; nothing is force-migrated.
5. **Scheme-bound accounts.** Each transaction type derives its sender *only*
   from its own scheme's key and signature. There is no cross-scheme fallback
   anywhere in the pipeline (see §7).
6. **Gated, rehearsed activation.** New transaction types ship disabled and
   are enabled at a pre-announced activation block, after a rolling upgrade
   of every block-importing node (see §8).

## 3. Architecture overview

ZERONYTH is built on Hyperledger Besu (26.9.0 lineage) with a focused set of
modifications:

| Layer | Mechanism |
|---|---|
| Execution | Stock Besu EVM; standard JSON-RPC (`eth_*`) |
| Consensus | QBFT, 4 validators, ~1 s blocks |
| Consensus signatures | **Falcon-1024** commit seals (domain `ZERONYTH/QBFT/FALCON-1024/V1`) |
| Finality proofs | **ML-DSA-65** certificates over finalized checkpoints, produced by an attestation service (see §4.2) |
| User transactions | ECDSA (legacy / EIP-2930 / EIP-1559), **Falcon-1024 (`0x7E`)**, **ML-DSA-65 (`0x7F`)** |
| Proof / privacy | **zk-STARK** privacy pool (PrivatePoolG1): STARK-verified shielded transfers as native ZK transactions (**`0x7D`**); STARKVERIFY precompile at `0x7d1` |
| Native coin | ZNYT, 18 decimals |

## 4. Consensus and finality

### 4.1 Falcon-1024 QBFT

Validators seal QBFT proposal/commit payloads with Falcon-1024 instead of
secp256k1. A block is committed when a quorum of validators' Falcon seals is
present; verification of the seal envelope is part of block import, so a node
running the ZERONYTH build rejects classically sealed blocks for this chain.
Falcon was chosen for consensus because of its small signatures (~1.3 KB at
the 1024 parameter set) and fast verification — properties that matter when
every block carries several seals, every second.

### 4.2 ML-DSA-65 finality certificates

An attestation service tracks the chain head and issues ML-DSA-65-signed
certificates over finalized checkpoints, providing a post-quantum proof of
finality that external observers can verify independently of the consensus
layer. This layer is deliberately *additive*: it certifies finality but does
not gate block production, so an attester outage cannot halt the chain (see
§11 for the corresponding limitation).

## 5. Native post-quantum transactions

### 5.1 Wire format

Both PQ types share one envelope shape:

```
tx = typeByte || rlp([ nonce, gasPrice, gasLimit, to, value, data,
                       chainId, publicKey, signature ])
```

| | Falcon-1024 tx | ML-DSA-65 tx |
|---|---|---|
| Type byte | `0x7E` | `0x7F` |
| Public key | 1,793 B (canonical padded form) | 1,952 B |
| Signature | ≤ 2,048 B (≈1.26–1.28 KB in practice) | 3,309 B |
| Signing domain | `ZERONYTH/FALCON-1024/TX/V1` | `ZERONYTH/ML-DSA-65/TX/V1` |

The signature is computed over `keccak256(domain || rlp([nonce, gasPrice,
gasLimit, to, value, data, chainId]))`. Embedding the full public key in every
transaction makes PQ accounts self-certifying: any node can derive and
authenticate the sender from the transaction alone, with no key registry.

### 5.2 Address derivation

`address = keccak256(publicKey)[12..32]` — the low 20 bytes of the Keccak-256
hash of the scheme public key, exactly parallel to Ethereum's derivation from
an uncompressed secp256k1 key. Because the key spaces are disjoint, a Falcon
address, an ML-DSA address, and an ECDSA address controlled by "the same
person" are three different accounts; holding one scheme's keys grants no
power over another scheme's account.

### 5.3 Replay protection

The signed payload binds `nonce` and `chainId`, as with EIP-155. Replayed
transactions fail with a nonce error; transactions signed for another chain
fail chain-ID validation. Both properties are covered by live tests for both
schemes (§9).

### 5.4 Contract execution

PQ transactions are first-class EVM transactions: they can transfer ZNYT,
deploy contracts, and call contracts. Sender authentication happens once at
validation; execution thereafter is the ordinary EVM path. Contract creation
plus a state-changing call plus a read-back were verified end to end for both
schemes before activation.

## 5A. The fourth pillar: zk-STARK privacy pool

Signatures answer "who may spend"; they do not answer "who spent what".
ZERONYTH's proof and privacy layer is a **zk-STARK** system, chosen because
STARKs are hash-based — transparent (no trusted setup) and free of the
elliptic-curve assumptions that a quantum attacker would break in
SNARK-style systems.

**Pool design.** The contract **PrivatePoolG1**
(`0xb69ba292fb84d3ab86aed617ba2a8fb4b38e7862`) holds shielded ZNYT:

- **Deposit** registers a *note* (commitment) for the deposited amount in a
  depth-10 Merkle tree.
- **Shielded transfer** proves, in zero knowledge, ownership of an unspent
  note and correct creation of the recipient's new note, and publishes a
  *nullifier* that prevents the note from being spent twice — without
  revealing which note was spent.
- **Withdrawal** verifies a proof and returns ZNYT to a chosen address.

Transfers and withdrawals execute as **native ZK transactions (type
`0x7D`)**: the transaction carries the STARK proof, and every validator
verifies the same proof deterministically during block import. The client
also embeds a general **STARKVERIFY precompile at `0x7d1`**. A relayer's
ECDSA signature on a `0x7D` transaction authorizes fees only; it cannot
substitute for the proof.

**Verification stack.** Statements are Cairo programs, proven with the
Stone prover and verified on-chain by the StarkEx verifier contracts
(CpuVerifier et al., Apache-2.0). In-statement hashing is **Poseidon
implemented in-program** (an earlier Pedersen-based design was eliminated
in the G1 hardening pass); the proof system's channel is **Keccak-256**.
The remaining cryptographic assumptions are therefore hash-family only —
Poseidon permutation plus Keccak-256 — with no curve assumption anywhere
in the stack.

**Production status.** The verifier stack and pool were deployed to chain
912701 on 6 November 2026, and the rollout's Stage 4 production proof has
completed end to end on the live chain: deposits of 3 + 5 ZNYT,
STARK-verified Merkle root synchronizations, and — after the native ZK
type activated at block 242,414 — the first production shielded transfer
as a native `0x7D` transaction
(tx `0xe0dda0a1cebf8c0401a557682728f0084e41dff76fca2198ac1f574c9cfa0476`,
gas 17,969,723) and a withdrawal of 5 ZNYT back to a plain address
(tx `0x8416dbc1f54f5a732924643363cae4db57d1b444d9758ea147d632811409266e`),
with the pool's final state exact (3 ZNYT remaining shielded) and a
verbatim replay of the transfer rejected.

**v1 limits (stated plainly).** Amounts are **not** hidden in v1 — what is
hidden is which note was spent; amount hiding is pool-v2 work. Proof
generation takes ~5 minutes per action and is currently performed
off-chain by the operator (the prover does not run on the validator host).
Verification is gas-heavy (~18M gas per native ZK transaction), so
practical capacity is ≈1 ZK transaction per block. The pool is
**unaudited**: an external audit has been deferred by the operator's
decision, and the rollout is prototype-grade (see §12).

## 6. Gas schedule and denial-of-service hygiene

PQ signatures are larger and more expensive to verify than `ecrecover`, so
each PQ type pays a fixed intrinsic-gas surcharge with two components: the
canonical envelope bytes priced at the EIP-2028 non-zero-byte rate (16 gas/B),
and a verification component benchmarked against measured BouncyCastle verify
times (≈0.71 ms Falcon-1024, ≈0.98 ms ML-DSA-65, versus the ~70 µs class of
`ecrecover` at 3,000 gas).

| Component | Falcon-1024 (`0x7E`) | ML-DSA-65 (`0x7F`) |
|---|---|---|
| Bytes (pubkey + sig) × 16 | (1793 + 1462) × 16 = 52,080 | (1952 + 3309) × 16 = 84,176 |
| Verification | 30,000 | 42,000 |
| **Total surcharge** | **82,080** | **126,176** |
| Plain-transfer intrinsic total | 103,080 | 147,176 |

ECDSA intrinsic gas is unchanged (21,000 for a plain transfer, before and
after activation — pinned by tests). Denial-of-service is further bounded at
the decoder, *before* any pool or execution work: public keys and signatures
must have exactly their canonical sizes (Falcon signatures are capped at
2,048 B, matching the production consensus envelope bound), and the existing
pool-wide transaction-size cap (128 KiB) applies unchanged. Duplicate
submissions are rejected as already-known without re-verification.

## 7. Account security model: scheme-bound senders

The security property that makes PQ accounts meaningful:

> A `0x7E` transaction derives its sender **only** by Falcon-verifying against
> its embedded Falcon key; a `0x7F` transaction **only** by ML-DSA-verifying
> against its embedded ML-DSA key. ECDSA sender recovery is never attempted
> for PQ types, and a PQ-typed transaction carrying an ECDSA signature derives
> no sender at all — it fails closed.

Consequences:

- Funds moved into a PQ account leave the ECDSA attack surface permanently;
  even a future total break of secp256k1 cannot move them.
- Type-byte spoofing (relabelling a valid transaction of one scheme as the
  other) and cross-scheme key/signature transplants are rejected at decode or
  sender derivation. A dedicated protection test suite (10 tests) pins all of
  these cases, and tampered-signature rejection plus replay rejection were
  additionally demonstrated live for both schemes.

**Dual signatures (requiring both PQ schemes in one transaction) were
evaluated and not adopted** for general use: the overhead is ~8.5 KB of key
and signature data per transaction, key loss of either scheme would freeze
the account, and — decisively — Falcon and ML-DSA are both lattice-based, so
the diversity gained is only partial. Per-scheme single signatures are the
default; genuinely high-value custody can layer multi-signature at the
account/contract level instead of fattening the protocol.

## 8. Activation and upgrade governance

PQ transaction types are controlled by a genesis configuration value,
`pqTxActivationBlock`:

- Absent from the configuration ⇒ the types are **never** active. This is the
  default and matches the network's behavior before the upgrade.
- The gate is enforced at all three points that can introduce a transaction
  into a block: transaction-pool admission, `eth_sendRawTransaction` (which
  funnels through the same pool validation and returns error `-32000` with an
  explicit "not active yet" message before activation), and block-import
  validation in the transaction processor.
- ECDSA transactions are never gated.

The production rollout followed the documented upgrade plan: the new binary
was deployed to every block-importing node (public node first, then the four
validators one at a time, with per-node database backups), hash and state
root equality against the previous binary was verified at a common height,
and only then was the activation block set — **157,773**, roughly 10,000
blocks ahead of the then-current head. Rollback to the previous binary is
safe at any time *before* activation; after activation, nodes must run the
PQ-aware binary to import blocks that contain PQ transactions.

## 9. Verification and production status

The implementation was built by porting the PQ transaction code onto a source
tree reconstructed to match the production binary (upstream Besu 26.9.0 plus
the ZERONYTH Falcon-consensus patch set; the reconstruction reproduces the
production version string exactly, and its Falcon cryptography classes are
instruction-identical to production under `javap` comparison).

Evidence gathered before and during activation:

- **Unit suites**: transaction validator 39/39, configuration 114/114,
  transaction-pool suites 181/181, activation-gate tests 3/3, per-scheme gas
  tests 5/5, scheme-bound protection tests 10/10.
- **Live end-to-end** on throwaway chains: ML-DSA reference chain 23/23
  assertions; ported build 45/45 (including pre-activation rejection of both
  PQ types through every path, post-activation Falcon and ML-DSA transfers,
  replay and tamper rejection for both schemes, and contract execution); a
  production-shaped no-gate configuration run 5/5 confirmed both PQ types
  stay rejected when the activation key is absent.
- **Production activation** (5 Nov 2026): all five nodes crossed block
  157,773 in lockstep with peer counts and finality attestation nominal; the
  pre-activation probe returned the gate error, and post-activation probes
  for *both* schemes passed the gate (failing only on insufficient funds).
- **First production PQ transaction**: an ML-DSA-65 transfer of 0.001 ZNYT,
  tx `0x8120159eb72a8a5462878636e858225661c304a3e87f4cb9687937b2d4a8a3f9`,
  block 165,913, status success, with balance and nonce deltas verified
  on-chain. The Falcon-1024 production proof followed the same day
  (tx `0x5cbfde62eec5a78199a78c40ff4529815e44db97fc0f4d93bd048665a0096676`,
  block 184,874).
- **zk-STARK pool** (6 Nov 2026): the full program — on-chain STARK
  verification of a real proof, pool deposit → shielded transfer →
  withdrawal, the STARKVERIFY precompile, native `0x7D` transactions,
  four-instance identical-import determinism, and a 9-case fault suite —
  was proven end to end on independent test chains before the production
  rollout. On production, the verifier stack and PrivatePoolG1 were
  deployed at the pre-announced address, and the Stage 4 production proof
  completed the full cycle on the live chain (§5A): deposits, STARK-verified
  root syncs, a native `0x7D` shielded transfer and a withdrawal, with the
  final pool state exact and a verbatim replay rejected.

## 10. Wallets and interfaces

- **Standard interfaces.** ECDSA accounts work with unmodified Ethereum
  wallets and tooling over the standard JSON-RPC at
  `https://zeronyth.dpdns.org/rpc`.
- **Quantum Wallet** (web, at `/quantum-wallet/`): an ML-DSA-65 wallet that
  creates PQ accounts, and — through three JSON-RPC extension methods
  (`zny_getCapabilities`, `zny_sendTransaction`, `zny_faucet`) served by the
  site gateway — submits transactions that the gateway transcodes into the
  chain's native `0x7F` format. The wallet's address derivation and signing
  payload are exactly the chain standards of §5, so web-wallet accounts are
  ordinary on-chain PQ accounts.
- **Developer wallets.** A dual-scheme reference wallet (CLI) demonstrates
  Falcon-1024 and ML-DSA-65 account creation and signing; PQ accounts cannot
  be operated by ECDSA-only wallets such as MetaMask, by design (§7).

## 11. Token

ZNYT is the native coin of chain 912701 (18 decimals), used for gas and
transfers. The project's tokenomics design targets a supply of
**100,000,000 ZNYT**; the current network's genesis carries a larger test
allocation (2,000,000,000 ZNYT) for development and faucet distribution
(100 ZNYT per claim, rate-limited). **ZNYT is presently a test coin with no
monetary value**, and nothing in this paper is an offer of securities or
investment advice.

## 12. Limitations and risks (as of v1.0)

Honesty about the current state matters more than polish:

- **Unaudited.** Neither the consensus modifications nor the PQ transaction
  code has had an external security audit. This is the single largest gap
  between ZERONYTH and production-grade deployment for third parties.
- **Validator infrastructure is concentrated.** All validators currently run
  on operator-controlled infrastructure without geographic or organizational
  distribution; QBFT's fault tolerance is therefore not yet realized in
  deployment. Distribution is the top infrastructure priority (§13).
- **Finality certificates are an attestation layer**, produced by a service
  external to consensus (§4.2). They add a verifiable PQ proof of finality
  but are not yet enforced by the protocol for light clients.
- **Load evidence is thin.** Endurance testing under sustained transaction
  load has not been completed; current stability figures describe ~1 s
  block production at very low transaction volume.
- **Algorithm-family concentration.** Both PQ schemes are lattice-based. A
  fundamental break of lattice assumptions would weaken both; hash-based
  signatures (e.g., SPHINCS+) are the natural diversification candidate but
  carry much larger signatures.
- **Size overhead.** PQ transactions carry ~3.3 KB (Falcon) to ~5.3 KB
  (ML-DSA) of key/signature data. Throughput in transactions per second is
  correspondingly lower than an ECDSA-only chain at equal bandwidth.
- **The STARK pool is v1.** Amounts are public (only note linkage is
  hidden), proving takes ~5 minutes per action and runs off-chain under
  the operator, verification costs ~18M gas (≈1 ZK transaction per block
  in practice), and the pool contracts and statements have not been
  externally audited — the audit was explicitly deferred by the operator
  in favour of shipping the production rollout first (§5A).

## 13. Roadmap

1. Distribute validators across independent hosts, providers, and regions.
2. External security audit of the Falcon consensus patch and the PQ
   transaction implementation.
3. Complete endurance/load testing and publish throughput benchmarks.
4. ~~Complete the production proof set for Falcon-1024 transfers~~ — done
   2026-11-05 (first funded production Falcon transfer, block 184,874).
   Next for the pool: v2 with hidden amounts and incremental Merkle roots,
   then the external audit package for the STARK components.
5. Developer documentation, a public PQ transaction specification, and
   reference wallet releases.
6. Research: hash-based signature diversification, and non-EVM execution
   environments for a future chain generation.

## 14. Conclusion

ZERONYTH demonstrates that a chain does not have to choose between the
Ethereum ecosystem and post-quantum security. With Falcon-1024 sealing its
consensus, ML-DSA-65 certifying its finality, both schemes available as
native, scheme-bound user accounts, and zk-STARK proofs giving the chain a
privacy layer whose assumptions are hash-family only — four pillars:
ECDSA, Falcon, ML-DSA, zk-STARK — the migration path that every ECDSA chain
will eventually need has been walked end to end, in production, at small
scale. The remaining work is scale, distribution, and independent
verification — not invention.

## References

1. NIST, *FIPS 204: Module-Lattice-Based Digital Signature Standard*
   (ML-DSA), 2024.
2. Fouque et al., *Falcon: Fast-Fourier Lattice-based Compact Signatures
   over NTRU*, https://falcon-sign.info/ (NIST PQC selection; FN-DSA,
   FIPS 206 draft).
3. NIST, *FIPS 205: Stateless Hash-Based Digital Signature Standard*
   (SLH-DSA / SPHINCS+), 2024.
4. Shor, P.W., "Polynomial-Time Algorithms for Prime Factorization and
   Discrete Logarithms on a Quantum Computer", *SIAM J. Comput.* 26(5),
   1997.
5. Hyperledger Besu documentation, https://besu.hyperledger.org/ — QBFT
   consensus and transaction pool behaviour.
6. EIP-155 (chain-ID replay protection); EIP-2028 (transaction data gas
   cost reduction — source of the 16 gas/non-zero-byte rate used in §6).

---

*ZERONYTH project — https://github.com/ak4229330245-sudo/zeronyth ·
https://zeronyth.dpdns.org/*
