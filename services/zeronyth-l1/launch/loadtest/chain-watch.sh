#!/bin/bash
# Samples live-chain height (primary RPC 9545) every 5 s to prove the load test does not slow block production.
while true; do h=$(curl -s -m 2 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' http://127.0.0.1:${1:-9545} | sed -E 's/.*"(0x[0-9a-f]+)".*/\1/'); echo "$(date +%T) $((h)) load=$(cut -d' ' -f1 /proc/loadavg)"; sleep 5; done
