#!/bin/bash
# Run podman as "root" inside an unprivileged single-UID user namespace (no newuidmap/setuid helpers on this box).
# /run is replaced (only inside this private mount namespace) by /workspace/podman/sysrun. No sudo, no system changes.
. /workspace/podman/env.sh
P=/workspace/podman/podman-linux-amd64/usr/local/bin/podman
exec unshare -Urm --propagation private /bin/bash -c 'mount --bind /workspace/podman/sysrun /run && mount --bind /workspace/podman/varcache /var/cache && exec "$0" --storage-opt overlay.ignore_chown_errors=true --cgroup-manager=cgroupfs --tmpdir /run/libpod --root /workspace/podman/storage --runroot /run/containers "$@"' "$P" "$@"
