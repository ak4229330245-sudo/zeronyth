#!/bin/bash
# ZERONYTH daily backup on the VPS (solbot crontab, 04:30 JST). Consistent snapshot of validator 4's chain DB:
# node4 is stopped for a few seconds (chain keeps going on the 3 box validators, node4 resyncs on start).
# Contents: node4 full chain DB + validator node keys/ML-DSA seeds for node1-4 (0600) + genesis/config + launcher config.
# No user wallet keys are included (none exist on this host; .env/faucet key is deliberately excluded).
set -u
umask 077
Z=/home/solbot/zeronyth; L=$Z/services/zeronyth-l1; B=/home/solbot/zeronyth-backups; KEEP=7
mkdir -p "$B"; chmod 700 "$B"
TS=$(date +%Y%m%d-%H%M); OUT="$B/zeronyth-$TS.tar.gz"; LOG="$B/backup.log"
exec >>"$LOG" 2>&1
echo "$(date '+%F %T %Z') start"
H=$(curl -s -m 5 127.0.0.1:8545 -H content-type:application/json -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | sed -n 's/.*"result":"\(0x[0-9a-f]*\)".*/\1/p')
/usr/bin/pm2 stop zeronyth-testnet >/dev/null
for i in $(seq 1 30); do pgrep -u solbot -f 'besu-26.9.0' >/dev/null || break; sleep 1; done
tar czf "$OUT.part" -C "$L" --exclude='node-data/node[123]/database' --exclude='node-data/*/caches' \
  node-data config/genesis.json config/qbftConfigFile.json config/validators.json config/pq-validators.json \
  -C "$Z" ecosystem.zeronyth.config.cjs ecosystem.zeronyth.config.cjs.split.orig generated-artifacts/pq-finality
RC=$?
/usr/bin/pm2 start zeronyth-testnet >/dev/null
if [ $RC -eq 0 ]; then mv "$OUT.part" "$OUT"; chmod 600 "$OUT"; echo "$OUT height=$H size=$(du -h "$OUT" | cut -f1)"; echo "$H $TS" > "$B/LATEST"
else rm -f "$OUT.part"; echo "tar failed rc=$RC"; fi
ls -1t "$B"/zeronyth-*.tar.gz 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f
echo "$(date '+%F %T %Z') done; kept $(ls "$B"/zeronyth-*.tar.gz | wc -l)"
