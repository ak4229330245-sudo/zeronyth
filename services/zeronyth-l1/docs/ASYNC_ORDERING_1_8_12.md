# ZERONYTH L1 v1.8.12 — asynchronous ordering + delta-state *local research lab*

## Status and scope

This is a **separate, explicitly opt-in ML-DSA-65 native ledger experiment**.
The existing Besu/EVM/QBFT chain, faucet, wallet, Web Node, browser P2P and
distributed-validator deployment kit remain unchanged. **Besu transactions
still use ECDSA.** The new code does not create a publicly deployed L1,
replace EVM state storage, or establish production-grade BFT consensus.

## Two deliberately separate durable lanes

1. **Ordering lane:** one of four configured local ML-DSA-65 validators proposes
   a canonical batch bound to `chainId`, height, prior order hash and proposer.
   Three distinct authorized validators independently sign the exact order
   hash. The proposal/vote journals prevent a validator from intentionally
   signing a conflicting hash for the same slot after restart. A certified
   ordering record is **verified and fsync-written** before advancing the
   ordering height. Ordering does *not* change balances or nonces and does
   *not* constitute successful transaction execution.
2. **Execution lane:** `executeNext()` consumes the next already certified
   order, verifies the actual ML-DSA transaction signatures and runs the
   existing canonical sequential account/nonce/balance checks. A separate
   append-only state WAL writes only the changed accounts, including every
   changed balance and nonce. The WAL is checksummed, height-linked, anchored
   to the corresponding certified order hash and fsynced **before** publishing
   the new execution state. Both lane heights are individually observable.
3. **Recovery:** reopening first validates every signed ordering certificate,
   then validates every delta record, and finally **re-executes every committed
   signed order from genesis**, comparing *each* execution root against the
   WAL's stored root. This last step is necessary: the WAL's checksum alone
   is not a cryptographic guarantee against local tampering.

Both journals require local owner-only files and exclusive `.lock` files;
partial records, invalid signatures, corrupt chains, conflicting account
updates, wrong parent order hashes and invalid execution all fail closed.
Only the last four in-memory snapshots are retained; the full append-only
WAL is still required for restart. Journals have bounded record/file sizes,
and order/execution mutations are mutually excluded in this laboratory.

## Run without a server or actual funds

Requires **Node.js 24+** with native `ml-dsa-65` support:

```bash
node pq-native/async-order-demo.mjs
node --test pq-native/async-ordering.test.mjs
```

The demo uses ephemeral local keys and a disposable temporary directory. It
certifies five ordered blocks while executing zero; executes three; closes and
reopens both journals; replays and executes the final two. Its final recipient
balance is exactly five test units. It does **not** launch or join a P2P
validator network, serve public RPC, spend ZNYT, or touch a real wallet.

## Security and performance limitations

- **Ordering is not execution validity.** Three signatures authenticate an
  ordering decision, not account balances. A malformed or economically invalid
  but syntactically canonical transaction can become certified and later halt
  execution at that height. The lab refuses to silently skip it; a real
  protocol would need independently verified admission, proposer penalties,
  deterministic invalid-tx handling and explicit liveness/reconfiguration.
- **No view-change or production BFT liveness.** Validator membership is a
  fixed four; there is no timeout-driven leader rotation, fork choice,
  rollback of speculative forks, reconfiguration, network partition recovery
  or independent-host consensus safety proof.
- **Not MonadDb.** The WAL appends changed-account records, but every new
  root is still computed over the whole in-memory account `Map`. Recovery
  intentionally replays all executed orders from genesis. There is no
  indexed on-disk state trie, bounded-history pruning, optimized SSD access,
  parallel DB execution, EVM storage conflict tracking or fast state-sync.
- **No measured 5,000 TPS.** Ordering height may outrun execution height,
  but *ordering throughput is not executed TPS*. No comparative or sustained
  performance benchmark is asserted for this release. Full ML-DSA checks,
  fsync and serial-state semantics are not skipped to make a speed claim.
- **Trust boundary:** OS-level file permissions, locks and fsync are not a
  substitute for secure key custody, an external audit, a quorum distributed
  over independent hosts, or protection against a hostile machine administrator.

Next milestones for a real network: non-haltable deterministic transaction
admission and BFT view-change; protocol-level execution attestations; on-disk
indexed state and bounded recovery snapshots; independent-machine crash and
Byzantine testing; and then measured end-to-end sustained TPS under load.
