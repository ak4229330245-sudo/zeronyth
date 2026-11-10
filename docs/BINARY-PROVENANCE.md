<!-- Published copy of the project engineering record. Internal workspace paths were rewritten to this repository's layout (besu-912701/ = reconstructed production source tree, docs/ = deliverables). -->

# Provenance of the production Besu binary "26.11-develop-c9aa666" (chain 912701)

> **Update 2026-11-10.** Three different builds carry the same version string `26.11-develop-c9aa666`:
> (1) the original Falcon-QBFT build (2026-11-03, = node kit v0.1.x), (2) the PQ build `besu-912701-pq.tar.gz`
> (SHA-256 `2f11c1a6…5fcf`, production 2026-11-05 → 2026-11-06) and (3) the **besu-zk** build
> (`besu-912701-zk-candidate.tar.gz`, SHA-256 `c275a90b516a3aa5ada692b4c20b87bdf3873224db06ddd7e62b374739e091c9`),
> which **runs production since 2026-11-06 08:55 JST**. The besu-zk source was reconstructed from its bytecode and is
> published in `besu-912701/` — see [ZK-SOURCE-RECONSTRUCTION.md](ZK-SOURCE-RECONSTRUCTION.md)
> (0 differing classes; full sync from genesis matches production stateRoots). The text below is the original
> 2026-11-04 investigation of build (1)/(2).

Investigation date: 2026-11-04. All VPS access was read-only (`tar` stream of the install
directory over SSH; nothing on the VPS was modified). Production install copied to
`besu-912701/prod-install/` (bin + lib only — no chain data, no keys).

## TL;DR

- The exact source of the production build does **not** exist in any public place checked:
  the full commit hash `c9aa666b29a33c6f2a7a6752c18ef46dd71e70d4` is **not** in
  `besu-eth/besu` (GitHub: "not our ref"), and no source tree/archive exists on the VPS
  (install only; backups hold only site/points/attester archives).
- The binary was nevertheless identified conclusively:
  **upstream Besu 26.9.0 (tag `ee9c64c8ed031cba5c6bcdb502a79c03c3a467c4`, 2026-09-22)
  + the ZERONYTH custom Falcon-1024 QBFT patch set** (the Falcon subset of the owner's
  tarball), compiled with **JDK 25**, and built from a private git tree whose HEAD was
  `c9aa666b29a33c6f2a7a6752c18ef46dd71e70d4` in November 2026.
- The "26.11" in the version string is **not** the code's release line. Besu's
  `calculateVersion()` (build.gradle) stamps non-semver builds as
  `"${yy.M of the git ref file's mtime}-develop-${HEAD hash[0..7]}"`. The tree was simply
  checked out / built in November 2026 (26.11); the code base is 26.9.0.

## Evidence

### 1. Full commit hash recovered from jar manifests

Every production module jar's `META-INF/MANIFEST.MF` carries:

```
Implementation-Version: 26.11-develop-c9aa666
Commit-Hash: c9aa666b29a33c6f2a7a6752c18ef46dd71e70d4
```

(the `Commit-Hash` attribute is written by each module's build.gradle via
`getGitCommitDetails(40)`). `git cat-file` against a full clone of `besu-eth/besu`:
`fatal: remote error: upload-pack: not our ref c9aa666b29a33c6f2a7a6752c18ef46dd71e70d4`
— the commit is not public; it is the HEAD of the project's private build tree.

### 2. Class inventory of the production jars

51 `besu-*` jars, 3,619 classes total. Custom (non-upstream) classes: exactly 11, all Falcon:

- `crypto`: `Falcon1024ConsensusCrypto`, `Falcon1024ConsensusEnvelope` (+`$VerifiedMessage`),
  `Falcon1024KeyFile` (+`$Info`, `$KeyPair`), `Falcon1024PqTool`, `Falcon1024CommitQuorum`,
  `Falcon1024Signature`
- `consensus/common`: `bft/FalconConsensus`
- `consensus/qbft-core`: `payload/FalconQbftPayloadAuthenticator`

No `MlDsa*` classes anywhere (no ML-DSA transaction support in production).

Upstream classes whose constant pool references Falcon classes (i.e. the modified call
sites) — exactly the tarball patch's footprint:

- `app`: `controller/QbftBesuControllerBuilder`
- `config`: `JsonQbftConfigOptions`, `QbftConfigOptions`
- `consensus/common`: `PoaQueryServiceImpl`, `bft/BftBlockHashing`, `bft/BftBlockInterface`,
  `bft/messagewrappers/BftMessage`, `bft/network/ValidatorPeers`, `bft/payload/SignedData`,
  `validator/ValidatorProvider`
- `consensus/qbft`: `QbftExtraDataCodec`
- `consensus/qbft-core`: `payload/CommitPayload`, `payload/MessageFactory`,
  `statemachine/QbftRound`, `validation/CommitValidator`

(`QbftProposeValidatorVote`/`QbftDiscardValidatorVote` were also modified in the tarball —
strict address-format validation — but do not reference Falcon classes; whether production
contains that change is checked by bytecode comparison in Phase B.)

String constants inside the production Falcon classes are identical to the tarball
sources: domain `ZERONYTH/QBFT/FALCON-1024/V1`, key-file formats `falcon1024-v1` /
`falcon1024-enc-v1` (scrypt + AES/GCM), the same error/log messages, and
`FalconConsensus.PRODUCTION_CHAIN_IDS = {9127}` (verified in bytecode: `ldc2_w 9127l`).

### 3. Upstream base narrowed to 26.9.0

Top-level class-name inventory per module, production jars vs upstream source trees:

| candidate | upstream classes missing from prod jars | notes |
|---|---|---|
| **26.9.0** (tag, 2026-09-22) | **0** | prod-only extras = annotation-processor-generated classes (Dagger/Immutables) + the 8 Falcon classes |
| 26.10.0 (2026-10-15) | 36 | e.g. `ethereum/core/kzg/Cell` (added to main 2026-09-30), `EthGetHeaderByHash` (2026-10-06), `evm/v2/operation/*` (2026-10-08), `MissingCodeFetcher`, `RevertCodeFormatSubCommand` — all absent from production |
| 26.11.0 (2026-10-30) | (worse; superset of the above drift) | — |

Dependency-version fingerprint (189 external artifacts in prod `lib/` vs
`gradle/verification-metadata.xml`): **26.9.0 matches 188/189 exactly, 0 mismatches**
(26.10.0: 1 mismatch; later tags/main diverge rapidly — netty 4.2.19, vertx 5.2.2, etc.,
none of which are in production).

Class-file major version of production classes = **69 → compiled with JDK 25**
(upstream 26.9.0 gradle daemon toolchain is 25; the tarball tree lowered it to 21 for its
own local build — one of the few non-functional tarball diffs).

### 4. The tarball tree is exactly "upstream 26.9.0 + custom patch set"

`diff -rq` of pristine upstream 26.9.0 (`git archive 26.9.0`) vs the owner's tarball
extract: **54 differing/added paths, all project-custom**:

- Falcon QBFT: 8 new files (6 crypto, `FalconConsensus`, `FalconQbftPayloadAuthenticator`)
  + 17 modified main-source files + tests (`FalconQbftConsensusTest`, `Falcon1024*Test`)
- ML-DSA-65 native tx (**not in production**): `MlDsa65TransactionCrypto`,
  `MlDsaTransaction{En,De}coder`, and modifications to `TransactionType`, `Transaction`,
  `Transaction{En,De}coder`, `MainnetProtocolSpecs`, `MainnetTransactionValidator`,
  `PendingTransaction`, `TransactionBaseResult`
- QBFT validator-vote RPC hardening: `Qbft{Propose,Discard}ValidatorVote` (+ tests)
- Build tweaks: `+ implementation project(':crypto:algorithms')` in
  `app`, `consensus/common`, `consensus/qbft-core` build.gradle (Falcon wiring);
  acceptance-tests modules dropped from `settings.gradle`/`platform/build.gradle`
  (build slimming); daemon toolchain 25→21
- `zeronyth/` docs + `falcon-net/` tooling, `docs/zeronyth/`

No other differences: the tarball's upstream content is byte-identical to the 26.9.0 tag.
Hence the production tree = the same branch lineage (26.9.0 + Falcon subset; whether it
also contains the vote-RPC hardening and ML-DSA tx is answered by the jar inventory:
ML-DSA tx — no; vote RPCs — bytecode check in Phase B).

## Conclusion

Matching source for the production binary exists nowhere publicly and not on the VPS;
the binary's provenance is nonetheless pinned to **upstream Besu 26.9.0 + the ZERONYTH
Falcon-1024 QBFT patch (Falcon subset of the owner's tarball)**, built with JDK 25 from
private HEAD `c9aa666b29a33c6f2a7a6752c18ef46dd71e70d4` in Nov 2026. Reconstruction
(Phase B) therefore = upstream 26.9.0 source + that Falcon patch subset, built with
JDK 25 and version-stamped `26.11-develop-c9aa666`, validated by class/bytecode diff
and by mixed-binary Falcon QBFT interop tests.
