#!/usr/bin/env bash
set -euo pipefail
RPC="${RPC_URL:-http://127.0.0.1:8545}"
ATTEMPTS="${RPC_WAIT_ATTEMPTS:-60}"
SLEEP_SECONDS="${RPC_WAIT_SLEEP_SECONDS:-2}"

for ((i=1; i<=ATTEMPTS; i++)); do
  if response="$(curl --silent --show-error --max-time 2 \
      -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
      "$RPC" 2>/dev/null)"; then
    if printf '%s' "$response" | python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("result")=="0x23a7" else 1)' 2>/dev/null; then
      echo "RPC ready: $RPC"
      exit 0
    fi
  fi
  sleep "$SLEEP_SECONDS"
done

echo "ERROR: RPC did not become ready: $RPC" >&2
exit 1
