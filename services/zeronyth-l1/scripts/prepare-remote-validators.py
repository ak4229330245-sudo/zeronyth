#!/usr/bin/env python3
"""Opt-in 4-host QBFT validator split. NEVER upload generated private directories."""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import stat
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "network-hosts"

COMPOSE = """# Private VPN-connected Besu QBFT validator; one distinct operator/host.
name: zeronyth-remote-validator
services:
  validator:
    image: hyperledger/besu:26.9.0
    restart: unless-stopped
    init: true
    stop_grace_period: 45s
    security_opt:
      - no-new-privileges:true
    command:
      - --profile=ENTERPRISE
      - --genesis-file=/config/genesis.json
      - --data-path=/data
      - --node-private-key-file=/data/key
      - --network-id=9127
      - --sync-mode=FULL
      - --sync-min-peers=1
      - --p2p-host=${ZERONYTH_P2P_HOST:?Set private VPN IPv4 host}
      - --p2p-interface=0.0.0.0
      - --p2p-port=30303
      - --nat-method=NONE
      - --discovery-enabled=false
      - --static-nodes-file=/data/static-nodes.json
      - --rpc-http-enabled=true
      - --rpc-http-host=0.0.0.0
      - --rpc-http-port=8545
      - --rpc-http-api=ETH,NET,WEB3,QBFT
      - --host-allowlist=127.0.0.1,localhost
      - --min-gas-price=0
    ports:
      - '${ZERONYTH_P2P_BIND_IP:?Set VPN bind IPv4}:30303:30303/tcp'
      - '127.0.0.1:8545:8545/tcp'
    volumes:
      - ./genesis.json:/config/genesis.json:ro
      - ./data:/data
"""


def ipv4_hosts(hosts: list[str]) -> list[str]:
    if len(hosts) != 4:
        raise ValueError("Exactly four private VPN IPv4 addresses are required")
    result = []
    for text in hosts:
        if text != text.strip():
            raise ValueError("Whitespace in host address")
        try:
            address = ipaddress.IPv4Address(text)
        except ipaddress.AddressValueError as exc:
            raise ValueError("Valid IPv4 literals required, not hostnames or public URLs") from exc
        if (not address.is_private or address.is_loopback or address.is_link_local
                or address.is_multicast or address.is_unspecified or address.is_reserved
                or not any(address in ipaddress.ip_network(net) for net in
                           ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))):
            raise ValueError("Only routable private RFC1918 VPN addresses are permitted")
        result.append(str(address))
    if len(set(result)) != 4:
        raise ValueError("Each validator must advertise a distinct VPN IPv4")
    return result


def read_regular(path: Path) -> bytes:
    if path.is_symlink() or not path.is_file() or not stat.S_ISREG(path.stat().st_mode):
        raise ValueError(f"Missing or untrusted validator source: {path}")
    return path.read_bytes()


def public_key(path: Path) -> str:
    value = read_regular(path).decode("ascii").strip().removeprefix("0x")
    if value.startswith("04") and len(value) == 130:
        value = value[2:]
    if not re.fullmatch(r"[0-9a-fA-F]{128}", value):
        raise ValueError(f"Invalid Besu public enode key: {path}")
    return value.lower()


def private_key(path: Path) -> bytes:
    content = read_regular(path)
    clean = content.decode("ascii").strip()
    if not re.fullmatch(r"(?:0x)?[0-9a-fA-F]{64}", clean):
        raise ValueError(f"Invalid Besu private key file: {path}")
    return content


def prepare(source: Path, output: Path, hosts: list[str]) -> dict:
    """Only create a brand-new directory; deliberately never rotate/overwrite keys."""
    ips = ipv4_hosts(hosts)
    source = source.resolve()
    output = output.absolute()
    if output == source or output in source.parents or output.is_symlink():
        raise ValueError("Refusing a dangerous output target")
    if output.exists():
        raise FileExistsError(f"Output already exists; no validator material overwritten: {output}")

    genesis = read_regular(source / "config" / "genesis.json")
    try:
        chain = json.loads(genesis)
    except json.JSONDecodeError as exc:
        raise ValueError("Invalid source genesis JSON") from exc
    if chain.get("config", {}).get("chainId") != 9127 or not re.fullmatch(
            r"0x[0-9a-fA-F]+", str(chain.get("extraData", ""))):
        raise ValueError("Genesis chain ID or genesis QBFT validators are invalid")

    private_keys = []
    public_keys = []
    for i in range(1, 5):
        data_dir = source / "node-data" / f"node{i}"
        private_keys.append(private_key(data_dir / "key"))
        public_keys.append(public_key(data_dir / "key.pub"))
    if len(set(public_keys)) != 4 or len(set(private_keys)) != 4:
        raise ValueError("Validator identities must be distinct")

    enodes = [f"enode://{pub}@{ip}:30303" for pub, ip in zip(public_keys, ips)]
    manifest = {"network":"zeronyth-private-qbft", "chainId":9127,
        "genesisSha256":hashlib.sha256(genesis).hexdigest(),
        "mode":"four-independent-private-vpn-operators", "validators":[
        {"id":f"node{i}", "vpnHost":ips[i-1], "enode":enodes[i-1]}
        for i in range(1, 5)]}

    previous_umask = os.umask(0o077)
    try:
        output.mkdir(mode=0o700, parents=True, exist_ok=False)
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        for i in range(1, 5):
            hostdir = output / f"node{i}"
            hostdir.mkdir(mode=0o700)
            data = hostdir / "data"
            data.mkdir(mode=0o700)
            (hostdir / "genesis.json").write_bytes(genesis)
            (data / "key").write_bytes(private_keys[i-1])
            (data / "static-nodes.json").write_text(json.dumps([
                url for j, url in enumerate(enodes) if j != i-1], indent=2) + "\n", encoding="utf-8")
            (hostdir / ".env").write_text(
                f"ZERONYTH_P2P_HOST={ips[i-1]}\nZERONYTH_P2P_BIND_IP={ips[i-1]}\n",
                encoding="utf-8")
            (hostdir / "compose.yaml").write_text(COMPOSE, encoding="utf-8")
            (hostdir / "README.txt").write_text(
                "CONFIDENTIAL: data/key is ONE validator private key.\n"
                "Transfer this node directory only to its intended independent operator\n"
                "over an encrypted authenticated channel. Never commit/upload/reuse keys.\n"
                "Host must own its stated VPN address. Firewall TCP 30303 to the other\n"
                "three validator VPN hosts; do not expose JSON-RPC to the Internet.\n"
                "On its assigned VPN host: docker compose -f compose.yaml up -d\n"
                "Persistent data stays under ./data. Never run scripts/start.sh here.\n",
                encoding="utf-8")
        return manifest
    finally:
        os.umask(previous_umask)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare four confidential independent QBFT validator directories")
    parser.add_argument("--hosts", required=True, nargs=4, metavar="VPN_IPV4",
                        help="four unique private reachable VPN addresses in node1..node4 order")
    parser.add_argument("--out", type=Path, default=OUTPUT,
                        help="private output path (must not exist; default network-hosts/)")
    args = parser.parse_args()
    try:
        prepared = prepare(ROOT, args.out, args.hosts)
    except (ValueError, FileExistsError, OSError, UnicodeError) as exc:
        parser.error(str(exc))
    print(f"Prepared {len(prepared['validators'])} separate, confidential validator host directories.")
    print("KEEP network-hosts PRIVATE. No servers contacted or deployed.")
