#!/bin/bash
# Rebuild the WHOLE ZERONYTH network (all 4 validators, chain 9127) on this VPS if the box is lost.
# DANGER: running validators 1-3 here while the box still runs them = two copies of the same validator
# keys sealing -> forks/equivocation. Only run when the box chain is confirmed gone/stopped.
#   ./restore-on-vps.sh                # use current VPS data (node4 has the full chain; node1-3 sync from it)
#   ./restore-on-vps.sh <backup.tar.gz> # first restore node data from a backup in ~/zeronyth-backups
set -eu
Z=/home/solbot/zeronyth; L=$Z/services/zeronyth-l1
read -r -p "Box chain is STOPPED/LOST and will not come back with validators 1-3? type YES: " a; [ "$a" = YES ] || exit 1
/usr/bin/pm2 stop zeronyth-testnet >/dev/null || true
if [ $# -ge 1 ]; then
  mv "$L/node-data" "$L/node-data.before-restore-$(date +%Y%m%d-%H%M)"
  tar xzf "$1" -C "$L" node-data config
  tar xzf "$1" -C "$Z" generated-artifacts/pq-finality || true
fi
chmod 600 "$L"/node-data/node*/key "$L"/node-data/node*/pq-mldsa65.seed
rm -f "$L"/node-data/node*/static-nodes-replit.json     # regenerated for the all-local port layout
cp "$Z/ecosystem.zeronyth.config.cjs" "$Z/ecosystem.zeronyth.config.cjs.split"
cp "$Z/ecosystem.zeronyth.config.cjs.split.orig" "$Z/ecosystem.zeronyth.config.cjs"   # original 4-validator config
/usr/bin/pm2 delete zeronyth-testnet >/dev/null || true
/usr/bin/pm2 start "$Z/ecosystem.zeronyth.config.cjs" --only zeronyth-testnet
/usr/bin/pm2 save
echo "Started all 4 validators locally. Check: curl -s 127.0.0.1:8545 -H content-type:application/json -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_blockNumber\",\"params\":[]}'"
echo "Explorer: http://YOUR_TAILSCALE_IP:22673/  (faucet/signal/pq run locally again on 8797/8798/8799)"
