"""Read-only, local-only liveness observation. No start/stop/reset or repair actions."""
import argparse
import ipaddress
import json
from pathlib import Path
import time
import urllib.request


def validator_inventory():
    found = {}
    for file in Path("/proc").glob("[0-9]*/cmdline"):
        try:
            args = file.read_bytes().split(b"\0")
            if b"java" not in args[0] or b"--network-id=9127" not in args:
                continue
            # Other validators intentionally need not expose HTTP RPC.
            ports = [arg.split(b"=", 1)[1] for arg in args if arg.startswith(b"--rpc-http-port=")]
            hosts = [arg.split(b"=", 1)[1].decode() for arg in args if arg.startswith(b"--rpc-http-host=")]
            endpoint = None
            if ports and hosts:
                port, host = int(ports[0]), hosts[0]
                if not 1 <= port <= 65535 or not ipaddress.ip_address(host).is_loopback:
                    raise ValueError("Unexpected validator RPC endpoint")
                endpoint = (host, port)
            found[int(file.parent.name)] = endpoint
        except (OSError, StopIteration):
            continue
    if len(found) != 4:
        raise ValueError("Expected exactly four local validators")
    return found


def rpc(endpoint, method, params=None):
    host, port = endpoint
    authority = f"[{host}]" if ":" in host else host
    request = urllib.request.Request(f"http://{authority}:{port}",
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=5) as response:
        result = json.load(response)
    if "error" in result or "result" not in result:
        raise ValueError("RPC failed")
    return result["result"]


def observe(interval=5):
    before = validator_inventory()
    endpoints = [endpoint for endpoint in before.values() if endpoint is not None]
    if not endpoints or len(set(endpoints)) != len(endpoints):
        raise ValueError("No unique existing local RPC endpoint")
    heights = {endpoint: int(rpc(endpoint, "eth_blockNumber"), 16) for endpoint in endpoints}
    time.sleep(interval)
    after = validator_inventory()
    rows = []
    for endpoint in endpoints:
        height = int(rpc(endpoint, "eth_blockNumber"), 16)
        chain = int(rpc(endpoint, "eth_chainId"), 16)
        peers = int(rpc(endpoint, "net_peerCount"), 16)
        validators = len(rpc(endpoint, "qbft_getValidatorsByBlockNumber", ["latest"]))
        rows.append({"heightBefore": heights[endpoint], "heightAfter": height, "chainId": chain,
                     "validatorCount": validators,
                     "peers": peers, "advancing": height > heights[endpoint]})
    healthy = before == after and all(r["advancing"] and r["chainId"] == 9127 and
                                     r["peers"] == 3 and r["validatorCount"] == 4 for r in rows)
    return {"status": "PASS" if healthy else "FAIL", "readOnly": True,
            "validatorProcessesUnchanged": before == after,
            "validatorProcesses": len(before), "observedRpcEndpoints": len(endpoints),
            "allValidatorsExposedRpc": len(endpoints) == 4,
            "nodes": rows, "sampleIntervalSeconds": interval,
            "limit": "Only existing RPC endpoints observed; no RPC enabled on other nodes. Not full monitoring or security assurance."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interval", type=int, choices=range(2, 31), default=5)
    args = parser.parse_args()
    try:
        result = observe(args.interval)
        print(json.dumps(result, indent=2))
        raise SystemExit(0 if result["status"] == "PASS" else 1)
    except Exception as error:
        raise SystemExit(f"FAIL: {type(error).__name__}; no automatic repair attempted")
