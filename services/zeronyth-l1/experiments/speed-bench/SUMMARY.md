# ZERONYTH speed bench (isolated box chain), 2026-10-27 JST

Throwaway 4-validator QBFT chain (Besu 26.9.0, chain 9127 clone with fresh keys/genesis, ports 9945/333xx, data in /tmp/zbench/run, wiped after every config).
Main-like node args: `--profile=ENTERPRISE`, FOREST, min-gas-price 1 gwei, SerialGC, ActiveProcessorCount=2, nice 10.
**Main chain, its data and the VPS were never touched.** Validator 4 can sit behind `delay-proxy.mjs` (65 ms one-way = measured box↔VPS RTT ~130 ms).
PQ: `pq-follow.mjs` runs the production per-block finality work unchanged (ECDSA header/seal verify + 4× **ML-DSA-65** sign + full `verifyCertificate`, every block, no sampling/caching/skip; `skips` counter stayed 0 in every run).

New main baseline (after the validator-4 clock fix, 17:5x JST): 1.0 s blocks, 30M gas → ~1,430 transfer TPS theoretical.

Caveats: the box has 8 cores shared by all 4 bench validators, the AI chat, the econ test chain and main. Only ~2.6 GB was free, so most configs ran with `-Xmx256m` (BENCH_XMX). Main uses 512m; base at 512m gave 1,316/633/683 TPS against 1,180/580/590 at 256m. The bench aborts at MemAvailable < 1.2 GB, and several configs hit that limit (marked *partial*). TPS figures are block-inclusion TPS, closed-loop with ≤ `window` txs outstanding. Finality means submit → included (QBFT finality is immediate).

| config | change type | transfer TPS | erc20 TPS | swap TPS | block interval idle / load (ms) | finality p50/p95 transfer (ms) | CPU (4 nodes+PQ) / peak RSS | PQ impact (lag p50/p95, backlog, failures) | risks |
|---|---|---|---|---|---|---|---|---|---|
| base (30M, 1 s), Xmx256 | none | 1,180 | 580 | 590 | 978 / 1,017 | 1,479 / 2,451 | 497% / 1.25–1.49 GB | 142/159 ms, ≤1, 0 | none |
| base, Xmx512 (= main JVM) | none | 1,316 | 633 | 683 | 947 / 912 | 1,551 / 2,206 | 432% / 1.26–1.58 GB | 92/322, ≤1, 0 | none |
| base_wan (val4 +65 ms) | none | 1,173 | 580 | 610 | 990 / 852–985 | 1,556 / 2,186 | 418% | 77/138, ≤1, 0 | WAN alone causes no round changes (old main 3 s gaps were clock skew) |
| rt1_wan (requesttimeout 1 s) | genesis transition (hard fork) | 1,218 | 607 | 692 | 969 / 985 | 1,663 / 2,096 | 459% | 107/226, ≤1, 0 | no gain once clocks are synced; more spurious round changes if VPS hiccups |
| base_burst (6k burst, default pool) | none | 613 (**588 of 6,000 silently dropped**) | | | 956 / 980 | 1,940 / 2,514 | | 67/97, 0 | ENTERPRISE ⇒ SEQUENCED txpool, `--tx-pool-max-size` 4096: bursts are lost |
| txpool_burst (`--tx-pool-max-size=20000 --tx-pool-limit-by-account-percentage=0.05`) | CLI, rolling restart | 1,203 (0 dropped) | | | 985 / 998 | 2,110 / 2,704 | 439% / 1.28 GB | 79/100, ≤1, 0 | +~10 MB heap per 10k pending tx |
| **gas60** (60M + txpool) | `--target-gas-limit` CLI, rolling restart | **1,825–2,173** | (skipped, RAM) | **983** | 961–981 / 920–1,096 | 1,720–2,000 / 2,345–2,819 | 512–552% / 1.46–1.61 GB | 91–115 / 171–286, ≤2, 0 | each block must import in < 1 s on the VPS too; 42M gas/block observed |
| gas100 (100M + txpool) | same | 2,107 | – | 827 | 954 / **1,424–1,815** | 2,215 / 3,200 | 538% / 1.68 GB | 121/240, ≤1, 0 | CPU-bound: blocks stretch to 1.4–1.8 s, swap TPS worse than 60M, worse finality. Not recommended |
| p500 (xblockperiodmilliseconds 500) | genesis transition (hard fork, experimental key) | 1,307 | – | 651 | **512** / 765–921 | 1,473 / 2,045 | 477% / 1.35–1.42 GB | 94/129, ≤1 (idle ≤5), 0 | under load blocks stretch to ~0.8–0.9 s; doubles empty blocks, disk and PQ certs per day |
| p500_wan | same | 1,248 | – | 616 | 546 / 961–975 | 1,654 / 2,365 | 480% | 94/167, ≤1, 0 | as above; WAN makes it ~1 s under load anyway |
| combo (60M + 500 ms + txpool) *partial* | transition + CLI | 1,769 | – | (aborted, RAM) | 520 / 1,131 | 1,950 / 2,809 | 540% / 1.52 GB | 106/196, ≤1, 0 | no better than gas60 alone |
| gateway *partial* (batch 50, conc 4) | – | direct 1,267 / **via gateway 427 (−66%)** | | | 995 / 947–1,003 | gw 829 / 1,360 | gateway Node single thread | 78/185, 0 | prod default `ZERONYTH_RPC_TX_PER_MIN=30` per IP caps a single client to 0.5 tx/s |
| bonsai_par | data-storage change (resync) | aborted at 1.19 GB free before load | | | 951 / – | | Bonsai needs more RAM | – | not viable on this box's RAM; FOREST→BONSAI needs a full resync |
| layered txpool | CLI | not startable: `--profile=ENTERPRISE` forces the sequenced pool | | | | | | | would need dropping/overriding ENTERPRISE |
| jvm1g / cpu4 | CLI | not run (RAM headroom) | | | | | | | 4×1 GB heap is unsafe next to the AI chat and finetune |

PQ summary: PQ cost is per **block** (~40–55 ms for 4× ML-DSA-65 sign, ~15 ms for cert verify, ~7 ms for ECDSA), independent of tx count. At 1 s blocks that is ~7% of one core. Across all configs (including 500 ms, 60M, 100M) we saw 0 failures, 0 skip-aheads, a backlog of ≤2 blocks under load, and a lag p95 ≤ 286 ms. Every option kept full ML-DSA-65 verification of every block.

## Recommendation for main (not applied, needs approval)
1. All 4 validators (3 box + VPS): `--target-gas-limit=60000000`. This is a CLI flag with a rolling restart, one node at a time, and no genesis change or hard fork. The proposer moves gasLimit 1/1024 per block, so 30M→60M takes ~710 blocks (~12 min). Set the same value on every validator, otherwise the gas limit oscillates.
2. All 4 validators: `--tx-pool-max-size=20000 --tx-pool-limit-by-account-percentage=0.05`. CLI only. The default 4096 is smaller than one 60M block of transfers (2,857), and bursts above it are silently dropped.
3. Keep the 1 s period and `requesttimeoutseconds` 2. Don't use 500 ms or 100M: they need a hard fork (500 ms) or the box is CPU-bound (100M), and the measured gain was ~0–10%.
4. High-volume clients (relayers/bots) should submit directly to node RPC, or get a higher `ZERONYTH_RPC_TX_PER_MIN` for trusted IPs. The gateway costs ~66% throughput, and its per-IP limit dominates for single clients.
5. Before step 1, confirm on the VPS that it imports a full 60M block in well under 1 s (CPU/RAM unknown, read-only check).

Expected gain: from ~1,430 theoretical / ~1,200–1,300 measured transfer TPS to ~2,860 theoretical / **~1,800–2,200 measured** (+40–65%). Swap-like workload goes from ~600–680 to ~980 TPS (+45–65%). Block time stays at 1.0 s and PQ finality keeps up with every block.

## 2026-10-27 18:05 JST — VPS (validator 4) pre-apply check: NOT applied

- `import-bench.mjs`: single validator pinned to 2 box cores with node4's exact JVM opts, 60M gas, full blocks
  (`results/import60m_cpu6-7.json`). Box import (blockImported) of a full 60M block: transfer 248 ms avg / 278 max,
  ERC20 261/292, swap 335/392 ms. Peak RSS 435 MB (fits the VPS's ~930 MB available).
- VPS: 2 vCPU Xeon Gold 6342, single-thread hash ~2.6x slower than the box; virtio disk reports rotational.
  node4 already spends p50 142 ms / p95 272 ms in blockImported for EMPTY blocks (box: 7 ms).
- Estimate for a full 60M block on node4: ~0.65–1.0 s execution + 0.14–0.27 s fixed persist = ~0.8–1.3 s,
  i.e. not well under the 1 s period. When V4 proposes (25%) it must build+import, so round changes
  (2 s request timeout) and lost fault tolerance (3 of 4 with V4 lagging) are likely under sustained load.
- Decision: rolling restart with --target-gas-limit=60000000 was NOT applied. Main chain unchanged.

## 2026-10-27 18:11–18:18 JST — tx pool applied to main (gas limit unchanged at 30M)

- All 4 validators: `--tx-pool-max-size=20000 --tx-pool-limit-by-account-percentage=0.05` (start-replit.mjs default,
  overridable by ZERONYTH_TXPOOL_MAX_SIZE / ZERONYTH_TXPOOL_ACCOUNT_PCT). V4 memory check (`txpool-mem-bench.mjs`,
  node4 JVM opts, 20000-tx burst at 30M gas): peak RSS 390 MB, all 20000 landed -> 20000 on V4 too.
- Main-chain drop test (`drop-test.mjs`, 10 throwaway wallets x 600 tiny self-transfers, one burst):
  6000 sent / 6000 accepted / 6000 landed / 0 silently dropped; all landed in 7.7 s (blocks 21324–21334, max 1428 tx/block).
  Faucet drip refunded to the faucet afterwards. Note: 0.05 x 20000 = max 1000 pending per sender.
