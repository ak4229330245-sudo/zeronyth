#!/usr/bin/env bash
# fund.sh <address> <znyAmount>
#
# Sends <znyAmount> ZNYT from the genesis-funded ECDSA e2e account
# (0xf86ef05acfaa18d67d58823b4b7166127ed55f93, key file:
# ~/workspace/besu-2611-recon/e2e/ecdsa-account.txt) to an arbitrary address
# on the local Phase 4 test chain (chainId 912701, RPC http://127.0.0.1:18545).
# Signs with PortE2ETool sign-ecdsa, submits via eth_sendRawTransaction,
# and prints the transaction hash on stdout.
set -euo pipefail

TO="${1:?usage: fund.sh <address> <znyAmount>}"
AMOUNT="${2:?usage: fund.sh <address> <znyAmount>}"

RPC="http://127.0.0.1:18545"
CHAIN_ID=912701
GAS_PRICE=1000000000
GAS_LIMIT=21000
E2E="$HOME/workspace/besu-2611-recon/e2e"
KEYFILE="$E2E/ecdsa-account.txt"
P4="$HOME/workspace/qwallet-v2/evidence/phase4"
FROM="$(cat "$P4/ecdsa-address.txt")"
export JAVA_HOME="$HOME/workspace/besu-2611-recon/work/jdk-25"

# ZNYT (decimal, may be fractional) -> wei (integer string)
WEI="$(python3 -c "
from decimal import Decimal, getcontext
getcontext().prec = 60
print(int(Decimal('$AMOUNT') * Decimal(10)**18))
")"

NONCE_HEX="$(curl -s -X POST "$RPC" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionCount\",\"params\":[\"$FROM\",\"pending\"]}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['result'])")"
NONCE="$(python3 -c "print(int('$NONCE_HEX',16))")"

OUT="$(cd "$E2E" && "$JAVA_HOME/bin/java" -cp "tool-classes:../src/build/install/besu/lib/*" \
  PortE2ETool sign-ecdsa "$KEYFILE" "$NONCE" "$GAS_PRICE" "$GAS_LIMIT" "$TO" "$WEI" "$CHAIN_ID" 2>/dev/null)"
RAW="$(echo "$OUT" | grep '^raw=' | cut -d= -f2)"
HASH="$(echo "$OUT" | grep '^hash=' | cut -d= -f2)"

SUBMITTED="$(curl -s -X POST "$RPC" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_sendRawTransaction\",\"params\":[\"$RAW\"]}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('result') or d.get('error'))")"

if [ "$SUBMITTED" != "$HASH" ]; then
  echo "ERROR: node returned $SUBMITTED, expected $HASH" >&2
  exit 1
fi
echo "$HASH"
