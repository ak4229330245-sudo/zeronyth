#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_PORTS=1
if [ "${1:-}" = "--skip-ports" ]; then CHECK_PORTS=0; fi

fail() { echo "ERROR: $*" >&2; exit 1; }
for cmd in docker python3 curl; do
  command -v "$cmd" >/dev/null 2>&1 || fail "$cmd is required."
done
docker info >/dev/null 2>&1 || fail "Docker is installed but the Docker daemon is not reachable. Start Docker Desktop/Engine."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (docker compose)."

if [ "$CHECK_PORTS" -eq 1 ]; then
  python3 - 8545 8080 <<'PY'
import socket, sys
for raw in sys.argv[1:]:
    port=int(raw)
    s=socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(('127.0.0.1', port))
    except OSError as exc:
        raise SystemExit(f"ERROR: localhost port {port} is already in use: {exc}")
    finally:
        s.close()
PY
fi

[ -f "$ROOT/docker-compose.yml" ] || fail "docker-compose.yml is missing."
echo "Preflight: OK"
