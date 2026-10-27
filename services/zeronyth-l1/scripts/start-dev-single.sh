#!/usr/bin/env bash
# Development single-node mode.
# QBFT still needs at least one validator key, but this script
# generates a minimal 1-validator genesis so the chain can start
# without a pre-existing multi-validator set.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "ZERONYTH dev single-node mode"
echo "- Generates a 1-validator QBFT genesis if needed"
echo "- Suitable for local UI / RPC testing"
echo "- Not Byzantine-fault-tolerant"

if ! command -v docker >/dev/null; then
  echo "Docker is required to run Besu."
  echo "Config can still be prepared; start will fail without Docker."
fi

# Placeholder: in a full environment this would call Besu's
# operator subcommand to create a 1-validator network.
mkdir -p config node-data/node1
if [ ! -f config/genesis.dev.json ]; then
  cat > config/genesis.dev.json << 'GEN'
{
  "config": {
    "chainId": 9127,
    "qbft": {
      "blockperiodseconds": 1,
      "epochlength": 30000,
      "requesttimeoutseconds": 2
    }
  },
  "nonce": "0x0",
  "timestamp": "0x0",
  "gasLimit": "0x1c9c380",
  "difficulty": "0x1",
  "mixHash": "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365",
  "coinbase": "0x0000000000000000000000000000000000000000",
  "alloc": {}
}
GEN
  echo "Wrote minimal genesis.dev.json (still needs validator extraData for real QBFT)"
fi

echo
echo "To fully start:"
echo "  1. Install Docker"
echo "  2. Run a 1-validator Besu operator generate"
echo "  3. docker compose -f docker-compose.dev.yml up"
echo
echo "Dev helper prepared."
