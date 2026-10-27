#!/usr/bin/env python3
"""Offline, owner-only snapshot of this complete local testnet. Never prints keys."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tarfile
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parents[1]
EXCLUDED = {"node_modules", ".git", "__pycache__"}


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_offline():
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            command = (proc / "cmdline").read_bytes()
        except (OSError, ProcessLookupError):
            continue
        if b"--data-path=" + str(ROOT / "node-data").encode() in command:
            raise SystemExit("REFUSED: stop the zeronyth workflow before taking an offline snapshot.")
    for i in range(1, 5):
        for name in ("key", "key.pub"):
            if not (ROOT / f"node-data/node{i}" / name).is_file():
                raise SystemExit("REFUSED: the four-validator state is incomplete.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, help="Public pre-stop RPC evidence JSON, no secrets")
    args = parser.parse_args()
    os.umask(0o077)
    ensure_offline()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    destination = WORKSPACE / "generated-artifacts" / "private-backups" / stamp
    destination.mkdir(parents=True, mode=0o700)
    destination.parent.chmod(0o700)
    archive = destination / "zeronyth-offline.tar.gz"
    files = sorted(p for p in ROOT.rglob("*")
                   if p.is_file() and not set(p.relative_to(ROOT).parts) & EXCLUDED)
    if any(p.is_symlink() for p in files):
        raise SystemExit("REFUSED: unexpected symlink in snapshot source.")
    hashes = {str(p.relative_to(ROOT)): digest(p) for p in files}
    with tarfile.open(archive, "w:gz") as tar:
        for source in files:
            tar.add(source, arcname="zeronyth-l1/" + str(source.relative_to(ROOT)), recursive=False)
    # Verify every archived file against its stopped-source hash without extracting
    # untrusted paths or displaying private contents.
    with tarfile.open(archive, "r:gz") as tar:
        actual = {}
        for member in tar.getmembers():
            if not member.isfile() or not member.name.startswith("zeronyth-l1/"):
                raise RuntimeError("Unexpected archive member")
            stream = tar.extractfile(member)
            h = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                h.update(chunk)
            actual[member.name.removeprefix("zeronyth-l1/")] = h.hexdigest()
    if actual != hashes:
        raise RuntimeError("Archive verification failed; do not use this snapshot")
    ensure_offline()
    if any(digest(ROOT / name) != value for name, value in hashes.items()):
        raise RuntimeError("Source changed during snapshot; do not use this snapshot")
    manifest = {
        "format": "ZERONYTH_OFFLINE_BACKUP_V1", "createdUtc": stamp,
        "chainId": 9127, "validators": 4, "consistentOfflineSnapshot": True,
        "containsPrivateKeys": True, "encrypted": False,
        "archive": archive.name, "archiveSha256": digest(archive),
        "fileCount": len(hashes), "filesSha256": hashes,
        "restorePolicy": "Restore offline into an EMPTY directory only; never overwrite live state.",
        "preStopRpcEvidence": json.loads(args.evidence.read_text()) if args.evidence else None,
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    archive.chmod(0o600)
    (destination / "manifest.json").chmod(0o600)
    print(json.dumps({"backupDirectory": str(destination.relative_to(WORKSPACE)),
                      "archiveBytes": archive.stat().st_size, "verifiedFiles": len(hashes),
                      "sha256": manifest["archiveSha256"],
                      "encrypted": False, "containsPrivateKeys": True}, indent=2))


if __name__ == "__main__":
    main()
