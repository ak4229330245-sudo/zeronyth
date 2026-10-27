#!/usr/bin/env bash
# Box <-> VPS tunnel (pm2: zeronyth-p2p-tunnel). Fast reconnect:
#  - ServerAlive 5s x3 => a dead link is detected in ~15 s (also right after the box VM resumes)
#  - before connecting, ask the VPS to kill OUR stale previous session (marker zeronyth-tunnel-hold)
#    so the reverse ports are free (the 18:42 incident: "remote port forwarding failed for 8797")
#  - ExitOnForwardFailure + pm2 restart_delay 2 s => retry quickly
# Layout via env: ZT_LOCAL_PORTS (validators on the VPS, -L) / ZT_REMOTE_VALIDATOR_PORTS (validators on the box, -R)
set -u
KEY="${ZERONYTH_VPS_SSH_KEY:-$HOME/.ssh/id_ed25519}"; HOST="${ZERONYTH_VPS_SSH:-deploy@YOUR_VPS_IP}"
O=(-i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
ts(){ date '+%F %T %Z'; }
out=$(timeout 25 ssh "${O[@]}" "$HOST" 'bash ~/zeronyth-ops/tunnel-stale-clean.sh' 2>&1); echo "$(ts) pre-clean: ${out:-unreachable}"
L=(); for p in ${ZT_LOCAL_PORTS:-31306}; do L+=(-L "127.0.0.1:$p:127.0.0.1:$p"); done
# box 127.0.0.1:18545 -> VPS validator RPC 8545 (reference height for the box V1 watchdog)
L+=(-L "127.0.0.1:18545:127.0.0.1:8545")
R=(); for p in ${ZT_REMOTE_VALIDATOR_PORTS:-31303 31304 31305}; do R+=(-R "127.0.0.1:$p:127.0.0.1:$p"); done
echo "$(ts) connecting: -L ${ZT_LOCAL_PORTS:-31306} | -R validators ${ZT_REMOTE_VALIDATOR_PORTS:-31303 31304 31305} + services"
exec ssh "${O[@]}" -T -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -o TCPKeepAlive=yes -o ExitOnForwardFailure=yes \
  "${L[@]}" "${R[@]}" \
  -R 127.0.0.1:8797:127.0.0.1:9797 -R 127.0.0.1:8798:127.0.0.1:9798 -R 127.0.0.1:8799:127.0.0.1:9799 \
  -R 127.0.0.1:8801:127.0.0.1:9801 -R 127.0.0.1:8803:127.0.0.1:9803 \
  -R 127.0.0.1:22781:127.0.0.1:22780 -R 127.0.0.1:22815:127.0.0.1:9815 \
  "$HOST" "bash -c 'exec -a zeronyth-tunnel-hold sleep infinity'"
