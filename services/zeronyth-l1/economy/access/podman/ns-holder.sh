#!/bin/bash
# Long-lived holder for ONE unprivileged user+mount namespace, so all podman calls (run/exec/rm) share it.
# Writes its PID to /workspace/podman/holder.pid. No sudo, no system changes.
exec unshare -Urm --propagation private /bin/bash -c 'mount --bind /workspace/podman/sysrun /run && mount --bind /workspace/podman/varcache /var/cache && echo $$ > /workspace/podman/holder.pid && exec sleep infinity'
