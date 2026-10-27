#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE_DATA = ROOT / "node-data"
CONFIG = ROOT / "config"


def load_public_key(path: Path) -> str:
    value = path.read_text(encoding="utf-8").strip()
    if value.startswith("0x"):
        value = value[2:]
    # Besu/enode expects the raw 64-byte uncompressed key (X || Y).
    # Accept tools that include the standard 0x04 uncompressed-point prefix.
    if len(value) == 130 and value.startswith("04"):
        value = value[2:]
    if len(value) != 128 or any(c not in "0123456789abcdefABCDEF" for c in value):
        raise SystemExit(f"invalid secp256k1 public key in {path}")
    return value.lower()


def main() -> None:
    enodes: list[str] = []
    validators: list[dict[str, str | int]] = []

    for i in range(1, 5):
        pub = load_public_key(NODE_DATA / f"node{i}" / "key.pub")
        enode = f"enode://{pub}@172.28.0.{10+i}:30303"
        enodes.append(enode)
        validators.append({"node": i, "name": f"node{i}", "enode": enode})

    CONFIG.mkdir(parents=True, exist_ok=True)
    (CONFIG / "static-nodes.json").write_text(json.dumps(enodes, indent=2) + "\n", encoding="utf-8")
    (CONFIG / "validators.json").write_text(json.dumps(validators, indent=2) + "\n", encoding="utf-8")

    # Each node gets the other three peers only. Self-peering is unnecessary.
    for i in range(1, 5):
        peers = [enode for j, enode in enumerate(enodes, start=1) if j != i]
        (NODE_DATA / f"node{i}" / "static-nodes.json").write_text(
            json.dumps(peers, indent=2) + "\n", encoding="utf-8"
        )

    print("\n".join(enodes))


if __name__ == "__main__":
    main()
