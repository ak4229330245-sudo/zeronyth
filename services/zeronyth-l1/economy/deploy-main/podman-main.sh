#!/bin/bash
# Podman for the MAIN-chain access service (zeronyth-access-main): same unprivileged namespace holder as the box test
# service (/workspace/podman, pm2 zeronyth-podman-ns) but a SEPARATE storage root/runroot, so the two services' reapers
# never see (or stop) each other's containers. No sudo, no system changes.
. /workspace/podman/env.sh
P=/workspace/podman/podman-linux-amd64/usr/local/bin/podman
H=$(cat /workspace/podman/holder.pid 2>/dev/null) || { echo "Error: podman namespace holder not running" >&2; exit 125; }
kill -0 "$H" 2>/dev/null || { echo "Error: podman namespace holder not running" >&2; exit 125; }
exec nsenter -t "$H" --user --mount --preserve-credentials -- "$P" --storage-opt overlay.ignore_chown_errors=true --cgroup-manager=cgroupfs --tmpdir /run/libpod-main --root /workspace/podman-main/storage --runroot /run/containers-main "$@"
