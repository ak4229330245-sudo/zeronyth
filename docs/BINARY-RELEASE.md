# Production binary (chain 912701)

The Besu build that runs chain **912701** in production — including the
Falcon-1024 QBFT consensus patch and native post-quantum transactions
(Falcon-1024 `0x7E` / ML-DSA-65 `0x7F`, `pqTxActivationBlock` gate) — is
distributed from the project site (the archive is ~192 MB, too large for
this git repository):

| | |
|---|---|
| Download | https://zeronyth.dpdns.org/downloads/besu-912701-pq.tar.gz |
| SHA-256 | `2f11c1a6bb23d78646a10747fab7ae2384c5b88cfb52dcef3306ee07424c5fcf` |
| Checksum file | https://zeronyth.dpdns.org/downloads/besu-912701-pq.tar.gz.sha256 |
| Size | 191,868,564 bytes |
| Version string | `besu/v26.11-develop-c9aa666` |
| Source | [`besu-912701/`](../besu-912701/) in this repository (see `besu-912701/ZERONYTH-SOURCE.md`) |
| Provenance | [`BINARY-PROVENANCE.md`](BINARY-PROVENANCE.md) |

This exact archive (matching SHA-256) was rolled out to all five production
nodes on 5 November 2026 and has run the network since; PQ transactions
activated at block 157,773 the same day. Verify the checksum after download:

```sh
sha256sum besu-912701-pq.tar.gz
# expect: 2f11c1a6bb23d78646a10747fab7ae2384c5b88cfb52dcef3306ee07424c5fcf
tar xzf besu-912701-pq.tar.gz
./besu/bin/besu --version   # besu/v26.11-develop-c9aa666 (JDK 25 required)
```

> Experimental, unaudited software. Running a validator requires the
> network operator's coordination; outside nodes should join as
> non-validator full nodes first.
