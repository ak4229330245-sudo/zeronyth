# Gateway / explorer / RPC load test — box, 2026-10-27 13:11–13:24 JST (measured)
Box: 8 vCPU Xeon, 16 GB. Generator ran ON THE SAME BOX (4–6 processes), so numbers are conservative.
Target: isolated copy of the gateway (same code) on 127.0.0.1:11781 → box TEST chain Besu RPC 8545 + PQ 8799.
Every simulated client has its own CF-Connecting-IP (as through Cloudflare) and polls exactly like the real pages:
- light node (light-node-ui.mjs): every 1 s → [eth_blockNumber, net_peerCount] batch + next header + full PQ certificate (~14 KB gz) = 3 req/s
- visitor (app.js explorer): page load (4 files) then every 1 s a 5-call RPC batch, PQ summary every 2 s ≈ 1.5 req/s
Pass = p95 < 1000 ms AND errors < 1 % AND ≥ 95 % of 1 s ticks executed.

| gateway | light nodes (max pass) | first fail | visitors (max pass) | first fail |
|---|---|---|---|---|
| current code (no cache) | **500** (1,467 req/s, p95 103 ms) | 600 (p99 1.6 s, ticks 92 %) | **800** (1,440 req/s) | 1,200 |
| + read micro-cache 500 ms (`ZERONYTH_READ_CACHE_MS=500`) | **6,400** (18,922 req/s, p95 255 ms) | 9,600 (errors 3 %) | **6,400** (11,403 req/s, p95 96 ms) | 9,600 (ticks 90 %) |

Bottleneck without cache: the single gateway Node process at 100 % CPU (Besu ~27 %). With cache Besu sees ~1 call per distinct
request shape per 0.5 s regardless of user count.
Live primary path (127.0.0.1:22780, old code, live node1 RPC): 200 light nodes, 600 req/s, p95 12.5 ms, 0 errors.
Live chain during all tests: ~1 block/s throughout (no slow 5-s sample of 139), all 4 validators 10/40 proposals.

## Bandwidth is the real public limit (not measured on the internet)
Light node ≈ 16 KB/s (≈ 130 kbit/s, mostly the PQ certificate every second). Visitor ≈ 3.6 KB/s.
Upload 100 Mbit/s → ≈ 750 light nodes or ≈ 3,400 visitors. Cloudflare cache of /api/pq/* (1 s) or fetching the
certificate every 10 blocks instead of every block would cut light-node traffic ~10×.

Raw output: run `node loadtest.mjs <url> light|visitor <levels> [sec] [procs]`.

## Deployed 2026-10-27 13:27–13:28 JST
- Box primary (22780) and VPS private gateway (22673) now run the patched gateway with `ZERONYTH_READ_CACHE_MS=500`
  and the 100k-key / 5 s-prune limiter. Backups: `*.precache.orig` (box primary), `*.cache.orig` (VPS).
- After restart: 4/4 proposers (10/10/10/10 of last 40), ~1 block/s, private URL / , /rpc, /api/pq, /node.html = 200 from the VPS.

## Light-node bandwidth: PQ certificate every N blocks (default N=10)
`dashboard/assets/light-node-ui.mjs` now fetches `/api/pq/finality/latest` (~14 KB gz) only when
`verified - lastCert >= PQ_EVERY` (default 10; `?pqEvery=1..100` or `localStorage['znyt-pq-every']`).

| mode | 100 light nodes, 15 s, live 22780 | per node |
|---|---|---|
| every block (old) | 1.60 MB/s | ~16 KB/s |
| every 10 blocks (new default) | 0.41 MB/s | ~4.1 KB/s |

At 100 Mbit/s upload: ~750 → ~3,000 light nodes.

Trade-off: every header is still ECDSA/QBFT-verified each block, and each fetched certificate is still fully
ML-DSA-verified against the registry (no verification is skipped or weakened). The only change is latency: the
"PQ-final" height lags the verified head by up to N blocks (~10 s instead of ~1 s). A PQ certificate for block h,
matched against the locally verified hash chain, finalizes h and all ancestors, so no block goes uncovered.
Use `?pqEvery=1` for the old behaviour.
