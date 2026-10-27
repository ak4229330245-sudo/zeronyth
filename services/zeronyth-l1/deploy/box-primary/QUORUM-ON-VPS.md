# Interim layout: VPS holds QBFT quorum (2026-10-27 20:05 JST)

Box VM pauses when idle, so validators 2 and 3 were moved (same keys, same validator set, no vote) to the VPS.

| validator | miner | runs on | p2p | RPC |
|---|---|---|---|---|
| V1 | 0x64ed95ce | box (pm2 zeronyth-primary, ZERONYTH_NODES=1) | 31303 | box 9545 (public RPC via gateway 22780) |
| V2 | 0x8b2f88ad | VPS (pm2 zeronyth-testnet, ZERONYTH_NODES=2,3,4, -Xmx256m) | 31304 | VPS 8545 |
| V3 | 0xcbdfa7c6 | VPS | 31305 | VPS 8647 |
| V4 | 0xf556a93b | VPS | 31306 | VPS 8648 |

Box paused => chain continues on V2-V4 (3/4). Blocks slow to ~1.6 s avg while V1 is away (its proposer turns time out).
NEVER put 2 or 3 back into the box ZERONYTH_NODES while the VPS runs them.

* Tunnel `p2p-tunnel.sh`: -L 31304-31306 + 18545 (VPS RPC), -R 31303 + services. ServerAlive 5x3, ExitOnForwardFailure,
  pm2 restart_delay 2 s, pre-connect `vps/tunnel-stale-clean.sh` kills only our own stale session (marker `zeronyth-tunnel-hold`).
* Watchdogs `chain-watchdog.py`: VPS `zeronyth-v4-watchdog` (restarts zeronyth-testnet), box `zeronyth-v1-watchdog`
  (restarts zeronyth-primary, no --update-env). Stall 120/180 s with reference ahead, 1 restart / 5 min, backoff to 1 h, grace after VM resume.
* Rollback: `/workspace/zeronyth-backups/pre-vps-quorum-20261027-195552/` (box) and `~/zeronyth-backups/pre-vps-quorum-20261027-195552/`
  (VPS: old config, pm2 dump, stale node2/3 DBs). Reverse of `vps/cutover-v23-to-vps.sh`: stop VPS testnet first, restore NODES "4" there,
  tunnel layout back to -L 31306 / -R 31303-31305, box NODES "1,2,3" (box node2/3 data then sync the missed blocks).

## Standby PQ finality on the VPS (added 20:19 JST)
`zeronyth-pq-finality-vps` (VPS pm2, 127.0.0.1:9799, RPC 8545, node --max-old-space-size=64, ~96 MB RSS)
uses the same ML-DSA-65 seeds and identical code as the box signer (registry setHash 0xa253587c…).
It keeps certifying every block while the box is paused (verified: box frozen 20:20:14–20:21:15 JST,
VPS signer certified 24214→24245 with 4/4 signers, 0 failures). Public /api/pq is still served by the box.

## Always-on public edge (2026-10-27)
cloudflared (VPS) -> `zeronyth-edge` (VPS pm2, `vps/zeronyth-edge.mjs`, 127.0.0.1:22790 main / 22791 scan, ~80 MB RSS)
-> box via the reverse tunnel (22781 gateway, 22815 scan). Health probe every 2 s (1.5 s timeout, 2 misses = down);
a request that gets no response headers in 6 s also flips to fallback. Pass-through keeps every header (CF-Connecting-IP
for the visitor counter; Host: localhost for the gateway).

While the box is paused/unreachable:
- static site from `~/zeronyth-edge/site` (rsync from the box by box pm2 `zeronyth-edge-sync`, `edge-site-sync.sh`:
  on any dashboard change within 30 s, and at least every 5 min), same security headers + CSP as the gateway,
  plus a plain-text maintenance line in the visitor's language (Accept-Language / ?lang).
- `/rpc` -> VPS validators 8545 -> 8647 -> 8648, gateway allow-list, 30 rps/IP, 30 tx/min/IP, dev-key senders blocked.
- `/api/pq/*` -> VPS standby ML-DSA-65 signer 9799.
- every other `/api/*`, `/ai-lab/*`, `/rpc?network=swap-lab` -> 503 JSON maintenance notice (ja/en/zh-CN/ko). Admin routes
  are never served locally.
- scan -> 503 bilingual maintenance page.
Rollback: `cp ~/zeronyth-cloudflared/config.yml.bak-edge-20261027 ~/zeronyth-cloudflared/config.yml && pm2 restart zeronyth-cloudflared`.
