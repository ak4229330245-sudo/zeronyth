#!/usr/bin/env bash
set -euo pipefail
RPC="${RPC_URL:-http://127.0.0.1:8545}"

json() {
  curl --fail --silent --show-error --max-time 5 \
    -H 'Content-Type: application/json' \
    --data "$1" "$RPC"
}

result() {
  python3 -c 'import json,sys; d=json.load(sys.stdin); assert "error" not in d, d.get("error"); print(d["result"])'
}

CID="$(json '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' | result)"
[ "$CID" = "0x23a7" ] || { echo "Unexpected chainId: $CID" >&2; exit 1; }

NET_VERSION="$(json '{"jsonrpc":"2.0","method":"net_version","params":[],"id":2}' | result)"
[ "$NET_VERSION" = "9127" ] || { echo "Unexpected networkId: $NET_VERSION" >&2; exit 1; }

B1="$(json '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":3}' | result)"
B1="$((16#${B1#0x}))"
sleep 3
B2="$(json '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":4}' | result)"
B2="$((16#${B2#0x}))"
[ "$B2" -gt "$B1" ] || { echo "Block height did not advance ($B1 -> $B2)" >&2; exit 1; }

VALS="$(json '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":5}' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "error" not in d, d.get("error"); print(len(d["result"]))')"
[ "$VALS" -eq 4 ] || { echo "Expected 4 validators, got $VALS" >&2; exit 1; }

PEERS_HEX="$(json '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":6}' | result)"
PEERS="$((16#${PEERS_HEX#0x}))"
[ "$PEERS" -ge 3 ] || { echo "Expected at least 3 peers on node1, got $PEERS" >&2; exit 1; }

echo "Smoke test: PASS (chainId=$CID, networkId=$NET_VERSION, blocks=$B1->$B2, validators=$VALS, peers=$PEERS)"
