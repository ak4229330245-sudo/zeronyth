import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("backup_readiness",
    Path(__file__).resolve().parents[1] / "scripts/backup-readiness.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupReadinessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.folder = self.base / "backup"
        self.folder.mkdir(mode=0o700)
        self.private = self.base / "restores"
        self.private.mkdir(mode=0o700)
        self.files = {f"node-data/node{i}/{key}": b"DUMMY-TEST-ONLY"
                      for i in range(1, 5) for key in ("key", "key.pub")}
        self.make_archive()

    def tearDown(self):
        self.temp.cleanup()

    def make_archive(self, extra=None):
        archive = self.folder / "backup.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            for name, value in self.files.items():
                member = tarfile.TarInfo("zeronyth-l1/" + name)
                member.size = len(value)
                bundle.addfile(member, io.BytesIO(value))
            if extra:
                bundle.addfile(extra, io.BytesIO(b"x") if extra.isfile() else None)
        archive.chmod(0o600)
        manifest = {"format": "ZERONYTH_OFFLINE_BACKUP_V1", "archive": archive.name,
                    "archiveSha256": backup.sha_file(archive), "fileCount": len(self.files),
                    "filesSha256": {name: hashlib.sha256(value).hexdigest() for name, value in self.files.items()},
                    "chainId": 9127, "validators": 4, "encrypted": False}
        path = self.folder / "manifest.json"
        path.write_text(json.dumps(manifest))
        path.chmod(0o600)

    def test_byte_recovery_is_new_private_and_does_not_start_nodes(self):
        before = {p.name: backup.sha_file(p) for p in self.folder.iterdir()}
        result = backup.restore_bytes(self.folder, self.private)
        self.assertEqual(result["extractedFiles"], 8)
        self.assertFalse(result["databaseBootTested"])
        self.assertEqual(result["nodeProcessesStarted"], 0)
        self.assertEqual(before, {p.name: backup.sha_file(p) for p in self.folder.iterdir()})
        for path in self.private.rglob("*"):
            self.assertFalse(path.stat().st_mode & 0o077)
        backup.restore_bytes(self.folder, self.private)
        self.assertEqual(len(list(self.private.iterdir())), 2)

    def test_corrupt_archive_rejected(self):
        with (self.folder / "backup.tar.gz").open("ab") as stream:
            stream.write(b"corrupt")
        with self.assertRaises(ValueError):
            backup.inspect(self.folder)

    def test_symlink_member_rejected(self):
        member = tarfile.TarInfo("zeronyth-l1/link")
        member.type, member.linkname = tarfile.SYMTYPE, "/etc/passwd"
        self.make_archive(member)
        with self.assertRaises(ValueError):
            backup.inspect(self.folder)

    def test_traversal_member_rejected(self):
        member = tarfile.TarInfo("zeronyth-l1/../escape")
        member.size = 1
        self.make_archive(member)
        with self.assertRaises(ValueError):
            backup.restore_bytes(self.folder, self.private)
        self.assertEqual(list(self.private.iterdir()), [])

    def test_open_permissions_rejected_without_chmod(self):
        manifest = self.folder / "manifest.json"
        manifest.chmod(0o644)
        with self.assertRaises(ValueError):
            backup.inspect(self.folder)
        self.assertEqual(manifest.stat().st_mode & 0o777, 0o644)

    def test_manifest_path_injection_rejected(self):
        path = self.folder / "manifest.json"
        manifest = json.loads(path.read_text())
        manifest["archive"] = "../outside"
        path.write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            backup.inspect(self.folder)


if __name__ == "__main__":
    unittest.main()
