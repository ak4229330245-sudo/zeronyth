#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import os
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
NAME = f"zeronyth-l1-starter-kit-v{VERSION}"
FIXED_TIME = (2020, 1, 1, 0, 0, 0)

EXACT_EXCLUDES = {
    ".env",
    "config/genesis.json",
    "config/static-nodes.json",
    "config/validators.json",
    "compose.log",
    "failed.log",
    "rpc-status.txt",
    "compose-ps.txt",
    "compose-services.txt",
    "release-files.txt",
}
PART_EXCLUDES = {".git", ".cache", ".config", ".local", "dist", "ci-artifacts", "networkFiles", "network-hosts", "__pycache__", "node_modules"}


def excluded(rel: PurePosixPath) -> bool:
    text = str(rel)
    if text in EXACT_EXCLUDES:
        return True
    if any(part in PART_EXCLUDES for part in rel.parts):
        return True
    if rel.parts[0] == "pq-native":
        if any(part in {"local-data", "private-keys"} for part in rel.parts):
            return True
        # Exclude ALL research execution/order/vote journals, including the new
        # async delta WAL; they can contain transaction/account metadata.
        if rel.name.endswith((".jsonl", ".jsonl.lock", ".wal", ".wal.lock")):
            return True
        if rel.suffix.lower() in {".pem", ".key", ".secret"}:
            return True
    if len(rel.parts) >= 2 and rel.parts[0] == "node-data" and rel.parts[1].startswith("node"):
        return True
    return rel.suffix == ".pyc"


def mode_for(path: Path) -> int:
    executable = bool(path.stat().st_mode & stat.S_IXUSR)
    return 0o755 if executable else 0o644


def build(out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{NAME}.zip"
    files: list[tuple[Path, PurePosixPath]] = []

    for path in ROOT.rglob("*"):
        if out_dir == path or out_dir in path.parents:
            continue
        if not path.is_file():
            continue
        rel = PurePosixPath(path.relative_to(ROOT).as_posix())
        if excluded(rel):
            continue
        if path.is_symlink():
            raise SystemExit(f"refusing to package symlink: {rel}")
        files.append((path, rel))

    files.sort(key=lambda item: str(item[1]))
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path, rel in files:
            arcname = f"{NAME}/{rel}"
            info = zipfile.ZipInfo(arcname, FIXED_TIME)
            info.create_system = 3
            info.external_attr = (mode_for(path) & 0xFFFF) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            info.flag_bits |= 0x800
            zf.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    (out_dir / f"{out.name}.sha256").write_text(f"{digest}  {out.name}\n", encoding="utf-8")
    print(out)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a deterministic ZERONYTH release ZIP.")
    parser.add_argument("legacy_out_dir", nargs="?", help=argparse.SUPPRESS)
    parser.add_argument("--source", type=Path, default=ROOT, help="Source tree (must be this kit root).")
    parser.add_argument("--output", type=Path, help="Output ZIP path. Defaults to <source>/dist/<release>.zip")
    parser.add_argument("--out-dir", type=Path, help="Output directory (alternative to --output).")
    args = parser.parse_args()

    source = args.source.resolve()
    if source != ROOT.resolve():
        raise SystemExit(f"--source must be the kit root: {ROOT}")
    if args.output and args.out_dir:
        parser.error("use either --output or --out-dir, not both")

    if args.output:
        requested = args.output.resolve()
        expected_name = f"{NAME}.zip"
        if requested.name != expected_name:
            raise SystemExit(f"--output filename must be {expected_name}")
        out_dir = requested.parent
    elif args.out_dir:
        out_dir = args.out_dir.resolve()
    elif args.legacy_out_dir:
        out_dir = Path(args.legacy_out_dir).resolve()
    else:
        out_dir = ROOT / "dist"

    built = build(out_dir)
    if args.output and built.resolve() != args.output.resolve():
        raise SystemExit("internal output path mismatch")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
