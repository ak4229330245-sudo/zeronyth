#!/usr/bin/env bash
# Box -> VPS static mirror for the zeronyth-edge fallback. Syncs on any dashboard change (checked every 30 s,
# so every deploy is picked up) and at least every 5 min. Public web root only; backup/swap files excluded.
set -u
SRC=/workspace/zeronyth-primary/services/zeronyth-l1/dashboard/
DST="${ZERONYTH_VPS_SSH:-deploy@YOUR_VPS_IP}:zeronyth-edge/site/"
SSH='ssh -i /home/box/.ssh/<your_vps_key> -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=10'
STAMP=/tmp/zeronyth-edge-sync.stamp
last=0
while :; do
  now=$(date +%s)
  if [ ! -e "$STAMP" ] || [ $((now - last)) -ge 300 ] || [ -n "$(find "$SRC" -newer "$STAMP" -print -quit 2>/dev/null)" ]; then
    touch "$STAMP.new"
    if rsync -a --delete --delete-excluded --exclude='*.orig' --exclude='*.bak' --exclude='*.swp' --exclude='*.tmp' --exclude='*~' \
         --exclude='*.precache.orig' -e "$SSH" --rsync-path='mkdir -p ~/zeronyth-edge/site && rsync' "$SRC" "$DST"; then
      mv -f "$STAMP.new" "$STAMP"; last=$now; echo "$(date '+%F %T') JST synced"
    else echo "$(date '+%F %T') JST sync failed (retry in 30 s)"; fi
  fi
  sleep 30
done
