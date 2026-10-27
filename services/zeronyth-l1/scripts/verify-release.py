#!/usr/bin/env python3
from __future__ import annotations
import hashlib
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

if len(sys.argv) != 2:
    raise SystemExit("usage: verify-release.py <release.zip>")
path = Path(sys.argv[1])
if not path.is_file():
    raise SystemExit(f"release not found: {path}")

forbidden_exact = {".env", "config/genesis.json", "config/static-nodes.json", "config/validators.json"}
forbidden_parts = {"networkFiles", "network-hosts", "__pycache__", ".git", "dist", "ci-artifacts", "node_modules"}
required_suffixes = {
    ".github/workflows/e2e.yml",
    "scripts/e2e-test.sh",
    "scripts/compile-contracts.sh",
    "scripts/build-release.py",
    "scripts/doctor.sh",
    "faucet/package-lock.json",
    "README.md",
    "LICENSE",
    "SECURITY.md",
    "VERSION",
    "pq-native/verification-worker.mjs",
    "pq-native/verification-pool.mjs",
    "pq-native/staged-block.mjs",
    "pq-native/block-journal.mjs",
    "pq-native/durable-ledger.mjs",
    "pq-native/execution-worker.mjs",
    "pq-native/execution-pool.mjs",
    "pq-native/BFT_SAFETY_DESIGN.md",
}
required_executables = {
    "START.command",
    "scripts/start.sh",
    "scripts/init-network.sh",
    "scripts/doctor.sh",
    "scripts/package-release.sh",
    "scripts/e2e-test.sh",
}

with zipfile.ZipFile(path) as zf:
    infos = [i for i in zf.infolist() if not i.is_dir()]
    if not infos:
        raise SystemExit("release zip is empty")
    roots = {PurePosixPath(i.filename).parts[0] for i in infos}
    if len(roots) != 1:
        raise SystemExit(f"expected one top-level directory, got: {sorted(roots)}")
    root = next(iter(roots))
    rels: list[str] = []
    info_by_rel: dict[str, zipfile.ZipInfo] = {}

    for info in infos:
        p = PurePosixPath(info.filename)
        if p.is_absolute() or ".." in p.parts:
            raise SystemExit(f"unsafe archive path: {p}")
        rel = PurePosixPath(*p.parts[1:])
        rels.append(str(rel))
        info_by_rel[str(rel)] = info
        mode = (info.external_attr >> 16) & 0xFFFF
        if stat.S_ISLNK(mode):
            raise SystemExit(f"symlink not allowed in release: {rel}")
        if str(rel) in forbidden_exact:
            raise SystemExit(f"forbidden generated file in release: {rel}")
        if any(part in forbidden_parts for part in rel.parts):
            raise SystemExit(f"forbidden path in release: {rel}")
        if rel.parts[0] == "pq-native" and (
            any(part in {"local-data", "private-keys"} for part in rel.parts)
            or rel.name.endswith((".votes.jsonl", ".votes.jsonl.lock", ".blocks.jsonl", ".blocks.jsonl.lock"))
            or rel.suffix.lower() in {".pem", ".key", ".secret"}
        ):
            raise SystemExit(f"PQ validator key or vote journal in release: {rel}")
        if len(rel.parts) >= 3 and rel.parts[0] == "node-data" and rel.parts[-1] in {"key", "key.pub", "static-nodes.json"}:
            raise SystemExit(f"validator material in release: {rel}")

    missing = sorted(s for s in required_suffixes if s.lstrip("/") not in rels)
    if missing:
        raise SystemExit(f"required release files missing: {missing}")

    version = zf.read(f"{root}/VERSION").decode("utf-8").strip()
    expected_root = f"zeronyth-l1-starter-kit-v{version}"
    if root != expected_root:
        raise SystemExit(f"top-level directory/version mismatch: {root} != {expected_root}")

    for rel in required_executables:
        info = info_by_rel.get(rel)
        if info is None:
            raise SystemExit(f"required executable missing: {rel}")
        mode = (info.external_attr >> 16) & 0xFFFF
        if mode & 0o111 == 0:
            raise SystemExit(f"required executable bit missing: {rel}")

sha = hashlib.sha256(path.read_bytes()).hexdigest()
print(f"Release verification: PASS ({len(infos)} files, sha256={sha})")
