# ZERONYTH primary on the box (migrated 2026-10-27 12:54 JST)

Chain 9127 (0x23a7), QBFT, same genesis/history as the VPS (last VPS-only block 4314 = 0x10da; box continued from it).
Validators: node1 0x64ed…5201, node2 0x8B2f…8Cc4, node3 0xcBDf…F9c0 on the BOX; node4 0xf556…bfc7 on the VPS.
Quorum = 3 of 4, so the chain keeps running on the box alone if the VPS/tunnel is down.

## Box (pm2, user box) — `export PATH=$HOME/.local/bin:$PATH`
| app | what | ports (127.0.0.1 only) |
|---|---|---|
| zeronyth-primary | launcher: Besu node1-3 (heap 512m each, nice 10), faucet, signaling, pq-finality, gateway | gateway 22780, RPC 9545, P2P 31303-31305, faucet 9797, signal 9798, pq 9799 |
| zeronyth-primary-api | api-server | 5100 (/api/healthz) |
| zeronyth-p2p-tunnel | ssh -N to VPS (ServerAlive 10s x3, ExitOnForwardFailure, pm2 restart 5s) | -L 31306->VPS node4; -R VPS 31303-31305 -> box nodes; -R VPS 8797/8798/8799/8801 -> box faucet/signal/pq/econ |
| zeronyth-cloudflared | (not started) cloudflare/setup.sh starts it | -> 22780 |
Box test chains keep 8545/8646-8648/30303-30306/22673/8801 — no overlap.

Stop/start: `pm2 stop zeronyth-primary` / `pm2 start ecosystem.box-primary.config.cjs` ; status `pm2 ls`, health `scripts/health.sh`.
After a box reboot: `pm2 resurrect` (no init system on the box to do it automatically).

## VPS (pm2 solbot, saved; pm2-solbot.service resurrects on reboot)
zeronyth-testnet = validator 4 only (heap 384m), explorer still at http://YOUR_TAILSCALE_IP:22673/ (node4 local RPC 8545;
faucet/signal/pq/econ reached through the tunnel). zeronyth-api on 127.0.0.1:5000.
Daily backup 04:30 JST (crontab): ~/zeronyth-backups/backup.sh -> zeronyth-YYYYMMDD-HHMM.tar.gz (0600, keep 7).
Restore everything on the VPS if the box is lost: ~/zeronyth-backups/restore-on-vps.sh [backup.tar.gz]
NEVER run validators 1-3 in two places at once.
Public bootnode later (needs sudo): ~/zeronyth-backups/ufw-bootnode.sh (prepared, not applied).

## Cloudflare (after the domain exists)
1. `~/.local/bin/cloudflared tunnel login`  (domain owner; opens a Cloudflare auth URL)
2. `/workspace/zeronyth-primary/cloudflare/setup.sh <domain>`  (create tunnel, write config, DNS route, start under pm2)
Alternative (no login on the box): Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create (cloudflared),
public hostname <domain> → http://127.0.0.1:22780, then run the shown `cloudflared tunnel run --token …` on the box.
