"""Owner-only backup audit and isolated BYTE recovery; never launches validators."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tarfile
import tempfile

MAX_FILES = 10_000
MAX_BYTES = 512 * 1024 * 1024


def sha_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def private_real(path, directory=False):
    path = Path(path)
    if path.is_symlink() or (not path.is_dir() if directory else not path.is_file()):
        raise ValueError("Non-regular private input")
    if any(parent.is_symlink() for parent in path.absolute().parents):
        raise ValueError("Symlink ancestor rejected")
    if path.stat().st_uid != os.getuid() or stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError("Owner-only input required; permissions were not changed")


def inspect(backup):
    backup = Path(backup)
    private_real(backup.parent, True)
    private_real(backup, True)
    private_real(backup / "manifest.json")
    if (backup / "manifest.json").stat().st_size > 4 * 1024 * 1024:
        raise ValueError("Manifest limit")
    manifest = json.loads((backup / "manifest.json").read_text())
    if manifest.get("format") != "ZERONYTH_OFFLINE_BACKUP_V1":
        raise ValueError("Unsupported format")
    name = manifest.get("archive")
    if not isinstance(name, str) or PurePosixPath(name).name != name or name in (".", ".."):
        raise ValueError("Unsafe archive name")
    archive = backup / name
    private_real(archive)
    expected = manifest.get("filesSha256")
    if not isinstance(expected, dict) or not 1 <= len(expected) <= MAX_FILES:
        raise ValueError("Manifest count limit")
    for name, digest in expected.items():
        path = PurePosixPath(name)
        if (not name or path.is_absolute() or ".." in path.parts or str(path) != name
                or "\\" in name or not isinstance(digest, str) or len(digest) != 64
                or any(c not in "0123456789abcdef" for c in digest)):
            raise ValueError("Unsafe manifest entry")
    before = sha_file(archive)
    if before != manifest.get("archiveSha256"):
        raise ValueError("Archive hash mismatch")
    seen, total = set(), 0
    with tarfile.open(archive, "r:gz") as bundle:
        for item in bundle:
            name = item.name.removeprefix("zeronyth-l1/")
            if (not item.name.startswith("zeronyth-l1/") or not item.isfile()
                    or name not in expected or name in seen):
                raise ValueError("Unsafe, duplicate or unexpected member")
            total += item.size
            if total > MAX_BYTES or item.size < 0:
                raise ValueError("Extraction size limit")
            digest = hashlib.sha256()
            with bundle.extractfile(item) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            if digest.hexdigest() != expected[name]:
                raise ValueError("Member hash mismatch")
            seen.add(name)
    required = {f"node-data/node{i}/{key}" for i in range(1, 5) for key in ("key", "key.pub")}
    if (seen != set(expected) or len(seen) != manifest.get("fileCount")
            or not required <= seen or manifest.get("chainId") != 9127
            or manifest.get("validators") != 4):
        raise ValueError("Incomplete inventory or network mismatch")
    summary = {"status": "PASS", "verifiedFiles": len(seen), "expandedBytes": total,
               "archiveBytes": archive.stat().st_size, "archiveSha256": before,
               "manifestSha256": sha_file(backup / "manifest.json"),
               "ownerOnly": True, "encrypted": bool(manifest.get("encrypted")),
               "sourceModified": False, "extractedFiles": 0,
               "databaseBootTested": False,
               "limit": "Byte consistency only; not snapshot authenticity or database recovery proof"}
    return summary, manifest, archive


def restore_bytes(backup, private_root):
    summary, manifest, archive = inspect(backup)
    private_root = Path(private_root)
    private_real(private_root, True)
    # New random directory only. No overwrite, extractall(), symlinks or node launch.
    destination = Path(tempfile.mkdtemp(prefix="byte-drill-", dir=private_root))
    os.chmod(destination, 0o700)
    restored, expanded = 0, 0
    with tarfile.open(archive, "r:gz") as bundle:
        for item in bundle:
            name = item.name.removeprefix("zeronyth-l1/")
            if not item.name.startswith("zeronyth-l1/") or not item.isfile() or name not in manifest["filesSha256"]:
                raise ValueError("Archive changed during drill")
            target = destination / name
            parent = destination
            for component in PurePosixPath(name).parts[:-1]:
                parent = parent / component
                parent.mkdir(mode=0o700, exist_ok=True)
                private_real(parent, True)
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            digest = hashlib.sha256()
            with os.fdopen(fd, "wb") as output, bundle.extractfile(item) as source:
                remaining = item.size
                expanded += remaining
                if remaining < 0 or expanded > MAX_BYTES:
                    raise ValueError("Archive changed during drill")
                while remaining:
                    chunk = source.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("Truncated member")
                    output.write(chunk)
                    digest.update(chunk)
                    remaining -= len(chunk)
                output.flush()
                os.fsync(output.fileno())
            if digest.hexdigest() != manifest["filesSha256"][name]:
                raise ValueError("Restored hash mismatch")
            restored += 1
    if (restored != summary["verifiedFiles"] or sha_file(archive) != summary["archiveSha256"]
            or sha_file(Path(backup) / "manifest.json") != summary["manifestSha256"]):
        raise ValueError("Source changed; no recovery receipt issued")
    receipt = {**summary, "extractedFiles": restored, "byteRecoveryVerified": True,
               "nodeProcessesStarted": 0, "externalBackupPerformed": False}
    with (destination / "BYTE-RECOVERY-RECEIPT.json").open("x") as stream:
        os.chmod(stream.name, 0o600)
        json.dump(receipt, stream, indent=2)
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["audit", "restore-bytes"])
    parser.add_argument("backup", type=Path)
    parser.add_argument("--confirm-isolated", action="store_true")
    args = parser.parse_args()
    try:
        if args.operation == "audit":
            result = inspect(args.backup)[0]
        else:
            if not args.confirm_isolated:
                raise ValueError("Explicit isolated drill confirmation required")
            project = Path(__file__).resolve().parents[3]
            result = restore_bytes(args.backup, project / "generated-artifacts/private-restores")
        print(json.dumps(result, indent=2))
    except Exception as error:
        # Do not echo archive filenames, raw parser data or private material.
        raise SystemExit(f"FAIL: {type(error).__name__}; original backup and live chain untouched")
