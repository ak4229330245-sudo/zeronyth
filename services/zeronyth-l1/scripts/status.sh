#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
RPC="${RPC_URL:-http://127.0.0.1:8545}"
call() {
  curl --fail --silent --show-error --max-time 5 \
    -H 'Content-Type: application/json' --data "$1" "$RPC"
  echo
}
echo "RPC: $RPC"
echo "chainId:"; call '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
echo "networkId:"; call '{"jsonrpc":"2.0","method":"net_version","params":[],"id":2}'
echo "blockNumber:"; call '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":3}'
echo "peerCount:"; call '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":4}'
echo "validators:"; call '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":5}'
