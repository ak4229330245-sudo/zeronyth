# ZERONYTH production node source (chain 912701)

This tree is the source of the Besu build that runs chain **912701** in
production, including the ZERONYTH post-quantum extensions:

- **Falcon-1024 QBFT consensus** (the original production patch set)
- **Native post-quantum transactions**: Falcon-1024 (type `0x7E`) and
  ML-DSA-65 (type `0x7F`), gated by the genesis option
  `pqTxActivationBlock` (activated on 912701 at block 157,773)

## Provenance

The production binary's original build tree was never published. This tree
was reconstructed and verified to be equivalent: it is upstream
**Hyperledger Besu 26.9.0** plus the ZERONYTH patch set, built with JDK 25,
and it reproduces the production version string exactly
(`besu/v26.11-develop-c9aa666`). Its Falcon cryptography classes are
instruction-identical to the production binary's. Full evidence:
[`../docs/BINARY-PROVENANCE.md`](../docs/BINARY-PROVENANCE.md) and
[`../docs/SOURCE-RECONSTRUCTION-REPORT.md`](../docs/SOURCE-RECONSTRUCTION-REPORT.md);
the PQ transaction port is documented in
[`../docs/PQ-TX-PORT-REPORT.md`](../docs/PQ-TX-PORT-REPORT.md).

## Build

Requires JDK 25 and Gradle 9.3.1:

```sh
./gradlew installDist   # or the project's Gradle wrapper equivalent
# → build/install/besu/bin/besu
```

Upstream Besu documentation applies to everything not modified by the
ZERONYTH patches. The upstream parts remain under their original Apache-2.0
license (see `LICENSE` in this tree if present, and the upstream Besu
repository).
