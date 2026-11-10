# Production binary (chain 912701)

> **Update 2026-11-10:** since **2026-11-06 08:55 JST** all five production nodes run the **besu-zk** build
> (adds native ZK-STARK transactions `0x7D` and the STARKVERIFY precompile `0x7d1`):
> `besu-912701-zk-candidate.tar.gz`, SHA-256 `c275a90b516a3aa5ada692b4c20b87bdf3873224db06ddd7e62b374739e091c9`,
> version string `besu/v26.11-develop-c9aa666` (unchanged). The easiest way to run it is the node kit
> **falcon-912701-v0.2.0** (https://github.com/ak4229330245-sudo/zeronyth-falcon-node/releases/tag/falcon-912701-v0.2.0),
> whose `besu/lib` is byte-identical to production. Source: [`besu-912701/`](../besu-912701/) incl. the reconstructed
> ZK part ([ZK-SOURCE-RECONSTRUCTION.md](ZK-SOURCE-RECONSTRUCTION.md)).
>
> **The PQ-only archive below (`besu-912701-pq.tar.gz`) is an old version.** It cannot import blocks with ZK
> features (it stops around blocks 241,814–242,419). Use v0.2.0 instead. It is kept for reference only.

## Old: PQ-only build (production 2026-11-05 → 2026-11-06)

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
nodes on 5 November 2026 and ran the network until 6 November 2026 08:55 JST (replaced by besu-zk); PQ transactions
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
