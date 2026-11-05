#!/usr/bin/env bash
# Start the two local E2E chains (912701 harness + fake Base Sepolia 84532).
set -u
QW="$HOME/workspace/qwallet-v2"
export JAVA_HOME="$HOME/workspace/besu-2611-recon/work/jdk-25"
BESU="$HOME/workspace/besu-2611-recon/src/build/install/besu/bin/besu"
export BESU_FALCON1024_KEY_FILE="$QW/evidence/phase4/chain/falcon1024.key"

start() { # name genesis datadir rpcport p2pport logfile
  if curl -s -m 2 -X POST "http://127.0.0.1:$4" -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q result; then
    echo "$1 already up on $4"
    return 0
  fi
  nohup "$BESU" --genesis-file="$2" --data-path="$3" \
    --rpc-http-enabled --rpc-http-host=0.0.0.0 --rpc-http-port="$4" \
    --rpc-http-cors-origins="*" --rpc-http-api=ETH,NET,QBFT,ADMIN,TXPOOL,WEB3 \
    --p2p-port="$5" --min-gas-price=0 > "$6" 2>&1 &
  echo "$1 started pid $! (log $6)"
}

start chain912701 "$QW/evidence/phase4/chain/genesis.json" "$QW/evidence/phase4/chain/data" 18545 41445 "$QW/evidence/phase4/besu.log"
start chain84532 "$QW/evidence/multichain/chain84532/genesis.json" "$QW/evidence/multichain/chain84532/data" 18546 41446 "$QW/evidence/multichain/besu84532.log"

for port in 18545 18546; do
  for i in $(seq 1 30); do
    out="$(curl -s -m 2 -X POST "http://127.0.0.1:$port" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' || true)"
    case "$out" in *result*) echo "port $port -> $out"; break;; esac
    sleep 2
  done
done
