#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
HEX_RE = re.compile(r"^0x[0-9a-fA-F]+$")


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: patch-genesis.py GENESIS ADDRESS BALANCE", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    address = sys.argv[2].strip()
    balance = sys.argv[3].strip()
    data = json.loads(path.read_text(encoding="utf-8"))

    if not address:
        print("No FUNDED_ADDRESS set; optional user prefund skipped")
        return 0

    if not ADDRESS_RE.fullmatch(address):
        raise SystemExit("address must be a 0x-prefixed 20-byte EVM address")
    if not HEX_RE.fullmatch(balance):
        raise SystemExit("balance must be positive hexadecimal wei, e.g. 0x3635c9adc5dea00000")
    amount = int(balance, 16)
    if amount <= 0:
        raise SystemExit("balance must be greater than zero")

    alloc = data.setdefault("alloc", {})
    alloc[address[2:].lower()] = {"balance": hex(amount)}
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"Prefunded {address} with {amount} wei")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
