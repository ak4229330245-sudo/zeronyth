#!/usr/bin/env bash
# VPS side, run as solbot by the box tunnel wrapper right before it reconnects.
# Kills ONLY sshd sessions of this user that host the marker process `zeronyth-tunnel-hold`
# (started by the box tunnel as its remote command), i.e. a stale previous tunnel still
# holding the forwarded ports. Never touches other sessions/processes. No root needed.
set -u
LOG=$HOME/zeronyth-ops/logs/tunnel-clean.log; mkdir -p "${LOG%/*}"
ts(){ date '+%F %T %Z'; }
me=$(id -u); killed=0
for hold in $(pgrep -u "$me" -f '^zeronyth-tunnel-hold' || true); do
  ppid=$(ps -o ppid= -p "$hold" | tr -d ' '); [ -n "$ppid" ] || continue
  pcomm=$(ps -o comm= -p "$ppid"); puid=$(ps -o uid= -p "$ppid" | tr -d ' ')
  if [ "$puid" = "$me" ] && [[ "$pcomm" == sshd* ]]; then
    echo "$(ts) killing stale tunnel session sshd pid=$ppid (hold pid=$hold, age=$(ps -o etime= -p "$ppid" | tr -d ' '))" >> "$LOG"
    kill -TERM "$ppid" "$hold" 2>/dev/null; killed=$((killed+1))
  fi
done
if [ $killed -gt 0 ]; then
  for i in $(seq 1 20); do ss -ltnH | grep -q '127.0.0.1:22781 ' || break; sleep 0.5; done
  pgrep -u "$me" -f '^zeronyth-tunnel-hold' >/dev/null && { pkill -KILL -u "$me" -f '^zeronyth-tunnel-hold'; echo "$(ts) SIGKILL leftover hold" >> "$LOG"; }
fi
# Legacy (pre-marker) tunnel sessions cannot be identified safely: just report a held port.
if ss -ltnH | grep -q '127.0.0.1:22781 '; then echo "$(ts) port 22781 still held after clean (killed=$killed)" >> "$LOG"; echo held; exit 3; fi
echo "clean killed=$killed"; exit 0
