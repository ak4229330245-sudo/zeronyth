#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "${1:-}" != "--confirm" ]; then
  if [ ! -t 0 ]; then
    echo "ERROR: reset deletes local validator keys and chain history. Re-run interactively or pass --confirm after backing up data." >&2
    exit 1
  fi
  echo "WARNING: this deletes local validator identities and chain history. Back up node-data/ and config/ first."
  read -r -p "Type RESET to continue: " answer
  [ "$answer" = "RESET" ] || { echo "Reset cancelled."; exit 1; }
fi
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose down --remove-orphans || true
fi
rm -rf networkFiles node-data/node1 node-data/node2 node-data/node3 node-data/node4
rm -f config/genesis.json config/static-nodes.json config/validators.json
mkdir -p node-data
touch node-data/.gitkeep
echo "Reset complete. Run ./scripts/init-network.sh to regenerate validator identities."
