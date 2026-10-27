#!/usr/bin/env bash
# One-shot cutover: box validators 2,3 -> VPS. Stop on box FIRST, then start on VPS. Logs every step.
set -euo pipefail
export PATH=$HOME/.local/bin:$PATH PM2_HOME=/home/box/.pm2
K="${ZERONYTH_VPS_SSH_KEY:-$HOME/.ssh/id_ed25519}"; H="${ZERONYTH_VPS_SSH:-deploy@YOUR_VPS_IP}"; V(){ ssh -i "$K" -o BatchMode=yes "$H" "$@"; }
P=/workspace/zeronyth-primary; ND=$P/services/zeronyth-l1/node-data
t(){ echo "$(date '+%T.%3N') $*"; }
CLEAN=(env -i PATH=$PATH HOME=$HOME PM2_HOME=$PM2_HOME)
t "watchdog stop (VPS)"; V 'PM2_HOME=$HOME/.pm2 pm2 stop zeronyth-v4-watchdog >/dev/null'
t "STOP box zeronyth-primary (V1-V3 down)"; pm2 stop zeronyth-primary >/dev/null
for i in $(seq 1 30); do pgrep -f "zeronyth-primary/services/zeronyth-l1/node-data/node[23]" >/dev/null || break; sleep 1; done
if pgrep -f "zeronyth-primary/services/zeronyth-l1/node-data/node[23]" >/dev/null; then t "ABORT: box V2/V3 java still alive"; exit 1; fi
t "box V2/V3 confirmed stopped"
t "final delta rsync"
for n in 2 3; do rsync -a --delete -e "ssh -i $K -o BatchMode=yes" $ND/node$n/database $ND/node$n/caches $ND/node$n/DATABASE_METADATA.json $ND/node$n/VERSION_METADATA.json $H:zeronyth-stage/node$n/; done
t "VPS: stop testnet, swap in DBs, new config"
V 'set -e; export PM2_HOME=$HOME/.pm2; pm2 stop zeronyth-testnet >/dev/null; B=$(ls -d ~/zeronyth-backups/pre-vps-quorum-* | tail -1); ND=~/zeronyth/services/zeronyth-l1/node-data
  for n in 2 3; do mv $ND/node$n/database $B/node$n-database-stale; rm -rf $ND/node$n/caches; mv ~/zeronyth-stage/node$n/database ~/zeronyth-stage/node$n/caches $ND/node$n/; cp ~/zeronyth-stage/node$n/*METADATA.json $ND/node$n/; done
  cd ~/zeronyth; cp ecosystem.zeronyth.config.cjs.v234.new ecosystem.zeronyth.config.cjs'
t "box tunnel -> new layout (-L 31304-31306, -R 31303)"
cp /tmp/box-eco.new.cjs $P/ecosystem.box-primary.config.cjs; pm2 delete zeronyth-p2p-tunnel >/dev/null; (cd $P && "${CLEAN[@]}" pm2 start ecosystem.box-primary.config.cjs --only zeronyth-p2p-tunnel >/dev/null)
t "VPS: start testnet with V2,V3,V4"
V 'set -e; export PM2_HOME=$HOME/.pm2; cd ~/zeronyth; pm2 delete zeronyth-testnet >/dev/null; env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=$HOME PM2_HOME=$PM2_HOME pm2 start ecosystem.zeronyth.config.cjs --only zeronyth-testnet >/dev/null'
t "box: start primary with V1 only"
pm2 delete zeronyth-primary >/dev/null; (cd $P && "${CLEAN[@]}" pm2 start ecosystem.box-primary.config.cjs --only zeronyth-primary >/dev/null)
t "done issuing; waiting for blocks"
