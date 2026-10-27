#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ -f .env ] || cp .env.example .env
./scripts/doctor.sh --skip-ports
# Keep existing containers and validator data in place on routine restarts.
# init-network.sh is idempotent and refuses to erase partial state.
./scripts/init-network.sh
# Only check for host-port conflicts when this Compose project is not already
# running; otherwise its own published ports would be mistaken for conflicts.
if [ -z "$(docker compose ps --status running -q 2>/dev/null)" ]; then
  ./scripts/doctor.sh
fi

docker compose up -d --build
./scripts/wait-for-rpc.sh
./scripts/smoke-test.sh

echo
echo "ZERONYTH L1 is running:"
echo "  Explorer / Faucet UI: http://127.0.0.1:8080"
echo "  JSON-RPC:             http://127.0.0.1:8545"
