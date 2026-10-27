#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${EXPLORER_URL:-http://127.0.0.1:8080}"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
TEST_ADDRESS="${E2E_TEST_ADDRESS:-0x1111111111111111111111111111111111111111}"

json_result() {
  python3 -c 'import json,sys; d=json.load(sys.stdin); assert "error" not in d, d.get("error"); print(d["result"])'
}

rpc() {
  curl --fail --silent --show-error --max-time 8 \
    -H 'Content-Type: application/json' \
    --data "$1" "$RPC_URL"
}

proxy_rpc() {
  curl --fail --silent --show-error --max-time 8 \
    -H 'Content-Type: application/json' \
    --data "$1" "$BASE_URL/rpc"
}

for i in $(seq 1 60); do
  if curl --fail --silent --max-time 3 "$BASE_URL/" >/dev/null 2>&1; then break; fi
  if [ "$i" -eq 60 ]; then echo "ERROR: explorer did not become ready" >&2; exit 1; fi
  sleep 1
done

HEADERS="$(mktemp)"
trap 'rm -f "$HEADERS"' EXIT
curl --fail --silent --show-error --max-time 5 -D "$HEADERS" -o /dev/null "$BASE_URL/"
grep -qi '^content-security-policy:' "$HEADERS" || { echo "ERROR: explorer CSP header missing" >&2; exit 1; }
grep -qi '^x-frame-options: DENY' "$HEADERS" || { echo "ERROR: explorer X-Frame-Options missing" >&2; exit 1; }

CHAIN_DIRECT="$(rpc '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' | json_result)"
CHAIN_PROXY="$(proxy_rpc '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":2}' | json_result)"
[ "$CHAIN_DIRECT" = "0x23a7" ] || { echo "ERROR: direct chain ID mismatch: $CHAIN_DIRECT" >&2; exit 1; }
[ "$CHAIN_PROXY" = "$CHAIN_DIRECT" ] || { echo "ERROR: proxied RPC mismatch: $CHAIN_PROXY" >&2; exit 1; }

HEALTH="$(curl --fail --silent --show-error --max-time 8 "$BASE_URL/api/faucet/health")"
printf '%s' "$HEALTH" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True; assert d.get("chainId")=="9127"; assert float(d.get("balanceZNYT",0))>0'

BEFORE_HEX="$(rpc "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$TEST_ADDRESS\",\"latest\"],\"id\":3}" | json_result)"
CLAIM="$(curl --fail --silent --show-error --max-time 15 \
  -H 'Content-Type: application/json' \
  --data "{\"address\":\"$TEST_ADDRESS\"}" \
  "$BASE_URL/api/faucet/claim")"
TX_HASH="$(printf '%s' "$CLAIM" | python3 -c 'import json,sys,re; d=json.load(sys.stdin); assert d.get("ok") is True; h=d.get("txHash",""); assert re.fullmatch(r"0x[0-9a-fA-F]{64}",h); print(h)')"

MINED=0
for _ in $(seq 1 30); do
  RECEIPT="$(rpc "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$TX_HASH\"],\"id\":4}" | json_result)"
  if [ "$RECEIPT" != "None" ] && [ "$RECEIPT" != "null" ]; then
    printf '%s' "$RECEIPT" | python3 -c 'import ast,sys; r=ast.literal_eval(sys.stdin.read()); assert r.get("status")=="0x1", r; assert r.get("transactionHash")' || exit 1
    MINED=1
    break
  fi
  sleep 1
done
[ "$MINED" -eq 1 ] || { echo "ERROR: faucet transaction was not mined: $TX_HASH" >&2; exit 1; }

AFTER_HEX="$(rpc "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$TEST_ADDRESS\",\"latest\"],\"id\":5}" | json_result)"
python3 - "$BEFORE_HEX" "$AFTER_HEX" <<'PY'
import sys
before, after = (int(x, 16) for x in sys.argv[1:])
expected = 100 * 10**18
assert after - before == expected, (before, after, after-before)
PY

HTTP_CODE="$(curl --silent --output /tmp/qsl1-cooldown.json --write-out '%{http_code}' --max-time 8 \
  -H 'Content-Type: application/json' \
  --data "{\"address\":\"$TEST_ADDRESS\"}" \
  "$BASE_URL/api/faucet/claim")"
[ "$HTTP_CODE" = "429" ] || { echo "ERROR: expected faucet cooldown 429, got $HTTP_CODE" >&2; cat /tmp/qsl1-cooldown.json >&2 || true; exit 1; }
rm -f /tmp/qsl1-cooldown.json


UNSUPPORTED_CODE="$(curl --silent --output /tmp/qsl1-content-type.json --write-out '%{http_code}' --max-time 8 \
  -H 'Content-Type: text/plain' \
  --data '{"address":"0x2222222222222222222222222222222222222222"}' \
  "$BASE_URL/api/faucet/claim")"
[ "$UNSUPPORTED_CODE" = "415" ] || { echo "ERROR: expected faucet content-type rejection 415, got $UNSUPPORTED_CODE" >&2; cat /tmp/qsl1-content-type.json >&2 || true; exit 1; }
rm -f /tmp/qsl1-content-type.json

RUNNING="$(docker compose -f "$ROOT/docker-compose.yml" ps --services --filter status=running | wc -l | tr -d ' ')"
[ "$RUNNING" -eq 6 ] || { echo "ERROR: expected 6 running services, got $RUNNING" >&2; docker compose -f "$ROOT/docker-compose.yml" ps >&2; exit 1; }

echo "Full E2E: PASS (explorer, RPC proxy, faucet health, 100 ZNYT transfer, cooldown, content-type guard, 6 services running)"
