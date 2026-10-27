#!/usr/bin/env python3
"""Read-only, on-host QBFT quorum and block-progression health check."""

import argparse
import json
import time
from urllib.request import Request, urlopen


def rpc(method: str, params=None, url="http://127.0.0.1:8545"):
    body = json.dumps({"jsonrpc":"2.0", "id":1, "method":method,
                       "params":params if params is not None else []}).encode()
    request = Request(url, data=body, headers={"Content-Type":"application/json"}, method="POST")
    with urlopen(request, timeout=5) as response:
        answer = json.load(response)
    if not isinstance(answer, dict) or answer.get("error") or "result" not in answer:
        raise RuntimeError(f"RPC method {method} refused or returned malformed data")
    return answer["result"]


def check(seconds=7, request=rpc, sleeper=time.sleep):
    if not isinstance(seconds, int) or not 3 <= seconds <= 60:
        raise ValueError("check duration must be 3..60 seconds")
    if int(request("eth_chainId"), 16) != 9127:
        raise RuntimeError("Wrong ZERONYTH chain ID")
    validators = request("qbft_getValidatorsByBlockNumber", ["latest"])
    if not isinstance(validators, list) or len(set(validators)) != 4:
        raise RuntimeError("Expected four distinct QBFT genesis validators")
    peers = int(request("net_peerCount"), 16)
    if peers < 2:
        raise RuntimeError("Fewer than two connected peers: 3-of-4 quorum cannot be confirmed")
    before = int(request("eth_blockNumber"), 16)
    sleeper(seconds)
    after = int(request("eth_blockNumber"), 16)
    if after <= before:
        raise RuntimeError("No block progression during health sample; quorum may be unavailable")
    return {"chainId":9127, "validatorCount":len(validators), "connectedPeers":peers,
            "fromBlock":before, "toBlock":after, "sampleSeconds":seconds}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate one host's private-network QBFT liveness")
    parser.add_argument("--seconds", type=int, default=7, help="block progression observation window (3..60)")
    args = parser.parse_args()
    try:
        status = check(args.seconds)
    except (RuntimeError, ValueError, OSError, TimeoutError) as exc:
        parser.exit(1, f"NOT HEALTHY: {exc}\n")
    print(json.dumps(status, indent=2))
    print("QBFT liveness sample PASS. This is not a production availability or byzantine fault audit.")
