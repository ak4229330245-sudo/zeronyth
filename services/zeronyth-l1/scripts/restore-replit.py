#!/usr/bin/env python3
"""Verify and restore a private offline snapshot into an EMPTY directory only."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tarfile


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    manifest = json.loads((args.backup / "manifest.json").read_text())
    if manifest["format"] != "ZERONYTH_OFFLINE_BACKUP_V1":
        raise SystemExit("Unsupported snapshot format")
    archive = args.backup / manifest["archive"]
    if archive.parent.resolve() != args.backup.resolve() or sha(archive) != manifest["archiveSha256"]:
        raise SystemExit("Archive path or checksum mismatch")
    destination = args.destination.resolve()
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        raise SystemExit("REFUSED: destination is not empty; nothing overwritten.")
    # Check all members before writing anything; never extract links or traversal.
    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        expected = manifest["filesSha256"]
        names = []
        for member in members:
            parts = PurePosixPath(member.name).parts
            if (not member.isfile() or not parts or parts[0] != "zeronyth-l1"
                    or ".." in parts or PurePosixPath(member.name).is_absolute()):
                raise SystemExit("Unsafe archive member")
            name = "/".join(parts[1:])
            if name not in expected:
                raise SystemExit("Unlisted archive member")
            names.append(name)
        if len(set(names)) != len(names) or set(names) != set(expected):
            raise SystemExit("Duplicate or missing archive members")
        destination.mkdir(parents=True, mode=0o700, exist_ok=True)
        destination.chmod(0o700)
        for member, name in zip(members, names):
            target = destination / name
            target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
            stream = tar.extractfile(member)
            h = hashlib.sha256()
            with target.open("xb") as output:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    h.update(chunk)
                    output.write(chunk)
            target.chmod(0o700 if member.mode & 0o100 else 0o600)
            if h.hexdigest() != expected[name]:
                raise SystemExit("File checksum mismatch; incomplete restore must not be started")
    print(json.dumps({"restoredFiles": len(names), "allFileHashesVerified": True,
                      "destination": str(destination), "liveStateOverwritten": False}))


if __name__ == "__main__":
    main()
