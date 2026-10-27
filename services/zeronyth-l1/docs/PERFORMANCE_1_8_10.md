# ZERONYTH v1.8.10 — conservative ML-DSA key-path optimization

## Security boundary and actual code change

The experimental native ML-DSA-65 module is **separate from the Besu/EVM
chain**, which still uses ECDSA. All signed transactions, proposed headers,
and 3-of-4 votes still undergo cryptographic validation. Every validator
independently checks state, the serial-path consensus state root remains
authoritative, and certified blocks are durably journaled with `fsync`.

The changes target avoidable work rather than authorization checks:

1. Validate a canonical ML-DSA public key once, and retain its public
   `KeyObject` plus the exact domain-separated address derivation in the same
   bounded (1,024-entry) cache. Previously, every `addressOf()` call
   re-exported and re-hashed the ~2 KB SPKI despite a validated cached key.
   All new/unrecognized keys are checked for canonical encoding and ML-DSA
   type before address derivation. This caches **identity**, not signatures.
2. For the same in-process validated private `KeyObject`, a weak map saves
   only its PUBLIC SPKI encoding, avoiding repeated `createPublicKey()` and
   DER/base64 exports in the signing hot path. Weak keys do not prevent key
   garbage collection; private material is never copied into this cache.
3. When caching a freshly verified, fully signed transaction, reuse its
   already computed domain-separated fingerprint. The fingerprint still
   includes every canonical signed field, signature and chain identifier.
   Signatures still require successful verification before caching. Every
   subsequent execution checks the current nonce, balance and state.

## Local measurements on this development environment (2026-10-25)

The microbenchmark used 30,000 calls to the same valid `addressOf` and
4,000 separate client signatures with one ML-DSA private `KeyObject`:

| Test | Before | After | Scope |
| --- | ---: | ---: | --- |
| 30,000 cached-key address derivations | 865 ms | 1 ms | Same-process microbenchmark; not TPS |
| 4,000 transaction signatures | 4,236 ms | 4,061 ms | One client / one signing key; not validator TPS |

The script from v1.8.9 is still available:

```bash
python3 scripts/benchmark-pq-phases.py --transactions 384 --blocks 3 --senders 16 --trials 2
```

Measured 4 separate **localhost** ML-DSA validator processes, each test
submitting three 384-transaction blocks across 16 sender accounts. Every
run includes four independent preverification batches, block staging,
3-of-4 signed votes and durable commits. Results must converge on the same
balances and signed head hash:

| Metric | v1.8.9 earlier sample | v1.8.10 sample |
| --- | ---: | ---: |
| Two-run sequential median inclusive local TPS | 562.0 | 599.05 |
| Two-run parallel + full serial cross-check median local TPS | 597.6 | 656.1 |

These v1.8.10 values are from the final packaged code (including both public
key caches). An **earlier intermediate** two-run sample, before the signer
public-key optimization, measured 609.0 sequential and 586.7 parallel TPS:
the mode ordering reversed again. The two runs in each set are much too few
to establish a sustainable median or attribute the difference solely to code.

An additional **three-run** sequential-only comparison of workers per
validator after the key optimization yielded:

| Signature verification workers per validator | Trial TPS | Median |
| --- | --- | ---: |
| 1 | 696.5, 665.3, 773.3 | **696.5** |
| 2 (unchanged default) | 755.0, 760.8, 820.2 | **760.8** |

These are **different small sample sets, not a controlled A/B benchmark**.
Variation was substantial and later runs sometimes tended to be faster. Do not infer
that the code changes alone caused all of the measured difference, or that
761 TPS is guaranteed. The current two-worker default is retained, and
speculative parallel execution is **not enabled by default** because earlier
runs produced the opposite ordering.

## Gates still missing for 5,000 TPS

- Independent machines/operators, actual secure validator P2P transport,
  network latency, multiple geographic sites and sustained 10+ minute load.
- p50/p95/p99 finality, memory, CPU, I/O and recovery under invalid-traffic,
  partition and restart conditions, as well as an external security review.
- Benchmarking the existing ECDSA-based Besu/EVM chain **separately** from
  this native PQ research code; none of these numbers describe Besu TPS.

The source is unaudited research. **No 5,000/10,000 TPS claim, no mainnet
launch, no private keys distributed, no real funds.**
