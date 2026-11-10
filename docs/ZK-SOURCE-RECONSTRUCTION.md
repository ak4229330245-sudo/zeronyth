# ZK source reconstruction (besu-zk, chain 912701)

Date: 2026-11-10 (JST). Production was read-only throughout; no validator, chain data, genesis or key was changed.

## Why
Since 2026-11-06 08:55 JST all production 912701 nodes (4 validators + public node) run the **besu-zk** build
(`besu-912701-zk-candidate.tar.gz`, SHA-256 `c275a90b516a3aa5ada692b4c20b87bdf3873224db06ddd7e62b374739e091c9`).
It adds native ZK-STARK transactions (type `0x7D`), the STARKVERIFY precompile (`0x7d1`) and the genesis options
`zkPrecompileActivationBlock` / `zkTxActivationBlock` / `zkPoolAddress`. The binary was built outside the project
workspace and its source was never found (VPS, build box, GitHub repositories, attachments). The source in
`besu-912701/` was therefore **reconstructed from the production bytecode**.

## What was published
On top of the PQ source tree (`besu-912701/` at 131e815):
1. `.gitignore` fix: the runtime-data rule `**/data/` (and `**/logs/`, `**/state/`) had silently dropped
   **39 upstream Besu 26.9.0 source files** (packages named `data`, `logs`, `state`). They are now tracked.
   With them, the public tree rebuilds the PQ production build byte-identically (all 3,627 classes).
2. Commit "restore 39 upstream Besu 26.9.0 source files".
3. Commit "ZERONYTH zk-STARK: native ZK tx type 0x7D, STARKVERIFY precompile 0x7d1" (36 files, +2510/−24):
   config (zk genesis options), datatypes (`TransactionType.ZKSTARK(0x7D)`, `Address.STARK_VERIFY`),
   core (0x7D decoder/encoder, signing preimage, `ZkStarkGate` activation checks, protocol specs),
   eth (tx-pool gate), api (ZK error codes), evm (STARKVERIFY precompile = Java port of the Winterfell verifier:
   f128, Rescue MerkleAir, SHA3-256, 28 queries, blowup 8, grinding 16, FRI folding 8; `ZkIntrinsicGas`).

Method: decompile (Vineflower 1.11.1) → apply to the public tree → compare normalized `javap -c -p -constants`
(constant-pool indices and line tables ignored) → hand-fix control-flow shape until every class matches.

## Verification
- **Clean build** (JDK 25.0.5+8, Gradle 9.3.1 wrapper, `--no-build-cache --rerun-tasks`,
  `-Pversion=26.11-develop-c9aa666`) vs production `besu/lib`: 51 besu-* jars, 3,651 classes —
  3,596 byte-identical, 55 instruction-identical (constant-pool order / signature placement only), **0 differing**.
  203 third-party jars, `bin/` and jar layout identical. Only the manifest `Commit-Hash` differs.
- **Transaction decoding**: all 22 PQ/ZK transactions on chain (0x7F ×14, 0x7E ×6, 0x7D ×2 at blocks 242419, 242436)
  decode → re-encode byte-identically with matching hash and sender: **22/22**. Receipts match node2: 22/22.
- **Full sync from an empty DB** with the rebuilt binary to block 592,989: no import errors; blockhash and stateRoot
  equal production node2 at 0, 1, 157773, 165318, 185130, 241813, 241814, 242414, 242419, 242436, 300000, 400000,
  450443, 450783, 500000 and head. Examples:

  | block | hash | stateRoot |
  |---|---|---|
  | 165318 | `0xc287712bfe048a4075ecc2837a3fa1370741f5f03c8018a2730e66fa1b98061c` | `0x611ea6d37b866484c187d7218ed8bc20fd5f1916badd60fa5b0fb4b20f817504` |
  | 242419 | `0xdc42ad89555f7f4f6faf7b09dd74c4fd57db28c390620e76aef9e6c9bdf87964` | `0x55bc7749a30461deba4163b61e665761778c681168e3a51b6d647279719b4f49` |
  | 592989 | `0xbb864fc461f649ee602c6b38fc54248363bcd62b60dec719e560a869ea9c90d7` | `0xcb7d3136c8b59f451430961c55c0ea8b616eefa567cf362173d7623d246c1f0c` |
- **STARKVERIFY probe**: valid input → `…01`; 1-byte-tampered proof or root → `…00`.
- Independently, the production jars themselves (node kit falcon-912701-v0.2.0) synced from an empty DB to the
  head with identical hashes/stateRoots.

## Limits (stated honestly)
- This is a reconstruction, not the author's original source: comments, local variable names and formatting come
  from decompilation; original unit tests and commit history were not recovered. No new unit tests for the
  `precompile/stark` package yet.
- The commit `c9aa666…` named in the production manifests is still not available anywhere.
- Unaudited, experimental test-net software.
