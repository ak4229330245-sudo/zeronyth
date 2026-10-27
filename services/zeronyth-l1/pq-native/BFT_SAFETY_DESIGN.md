# ZERONYTH research path: high-throughput BFT safety gate

Status: **production BFT design only; NOT activated** in v1.8.17. The isolated
research lab now offers opt-in fixed-peer mutual TLS over private IPs, but
has no public validator networking or safe Byzantine view-change.

## What is actually running

- Four statically known ML-DSA-65 validators, deterministic leader per block.
- Every accepted proposal checks all signed transactions, parent hash, nonce,
  sender balances, block state root and native ML-DSA proposer signature.
- A block only commits after three different cryptographically valid ML-DSA
  validator votes for its exact block hash.
- A validator journals its own vote slot before it signs. A full block and its
  certificate are also fsync-persisted before an in-memory commit.
- These controls are NOT a complete networked BFT protocol: v1.8.17 adds
  authenticated private-IP direct peers for the isolated lab only, but lacks
  distributed gossip, safe round-change proofs, fork choice and recovery under
  partitions. An incomplete transport does not establish BFT liveness.

## Mandatory checks before introducing fast leader view-change

1. Define PREPARE/PRECOMMIT/COMMIT or a carefully specified chained HotStuff
   safety protocol and its quorum-certificate format. Merely incrementing
   `round` on a timeout is **unsafe** and must not be implemented as a shortcut.
2. Persist per-height locks, highest safe QC, validator votes and signed
   timeouts atomically. Recover all this data before a restarted validator
   accepts new proposals. Reject a different block when a valid lock exists.
3. Prove the quorum-intersection safety condition for N=4, f=1, Q=3 under
   adversarial message order, equivocation and crashes. Verify double-vote
   and conflicting-finalization tests through network fault injection.
4. Authenticated validator transport needs replay protection, peer rate
   limits, message size limits, cert pinning and strict genesis/network ID.
   Never treat the unauthenticated localhost HTTP control API as P2P.
5. Put validator-set changes, chain upgrades and key rotation behind an
   independently signed governance policy. No admin bypass or fallback ECDSA.
6. Third-party cryptographic/protocol audit and multi-operator testnet
   before any public funds or production throughput claim.

## Performance target and truthfulness

For 5,000 TPS at a 300ms block interval, a typical target block must carry
about 1,500 transactions. At 1,536 tx/block and 16MiB canonical TX data,
transaction admission, independent ML-DSA verification, deterministic state
execution, P2P delivery and certificate collection must all fit the latency
budget in a physically distributed, adversarial test environment.

Measure p50/p95/p99 time-to-finality, signatures/s/core, network bytes,
disk fsync latency, peak memory, load shedding and sustained multi-minute
throughput. The current localhost experiments remain below 5,000 TPS; their
resource limits do not establish throughput on independent validator hardware.

**Do not deploy a view-change implementation before these safety gates pass.**
