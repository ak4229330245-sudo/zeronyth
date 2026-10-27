#!/usr/bin/env bash
# Start/stop LOCAL Anvil stand-ins (127.0.0.1 only, low priority). They stand in for the real testnets until gas exists.
#   script/standins.sh start [home]   # "home" also starts a local ZERONYTH stand-in (chain 31337000, port 18450)
#   script/standins.sh stop
set -euo pipefail
cd "$(dirname "$0")/.."
ANVIL="${ANVIL:-$HOME/.foundry/bin/anvil}"
mkdir -p logs state
if [[ "${1:-}" == stop ]]; then
  for f in state/anvil-*.pid; do [[ -f $f ]] && kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; done; exit 0
fi
start() { # port chainId label
  nohup nice -n 15 "$ANVIL" --host 127.0.0.1 --port "$1" --chain-id "$2" --block-time 1 --silent >"logs/anvil-$1.log" 2>&1 &
  echo $! > "state/anvil-$1.pid"; echo "anvil $3 chain $2 on 127.0.0.1:$1 pid $!"
}
[[ "${2:-}" == home ]] && start 18450 31337000 "LOCAL STAND-IN ZERONYTH"
start 18451 31337001 "LOCAL STAND-IN Base Sepolia"
start 18452 31337002 "LOCAL STAND-IN Ethereum Sepolia"
start 18453 31337003 "LOCAL STAND-IN Arbitrum Sepolia"
start 18454 31337004 "LOCAL STAND-IN BNB Testnet"
start 18455 31337005 "LOCAL STAND-IN Robinhood Testnet"
