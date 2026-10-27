#!/bin/bash
# Run podman inside the holder namespace (see ns-holder.sh); falls back with an error if the holder is not running.
. /workspace/podman/env.sh
P=/workspace/podman/podman-linux-amd64/usr/local/bin/podman
H=$(cat /workspace/podman/holder.pid 2>/dev/null) || { echo "Error: podman namespace holder not running" >&2; exit 125; }
kill -0 "$H" 2>/dev/null || { echo "Error: podman namespace holder not running" >&2; exit 125; }
exec nsenter -t "$H" --user --mount --preserve-credentials -- "$P" --storage-opt overlay.ignore_chown_errors=true --cgroup-manager=cgroupfs --tmpdir /run/libpod --root /workspace/podman/storage --runroot /run/containers "$@"
