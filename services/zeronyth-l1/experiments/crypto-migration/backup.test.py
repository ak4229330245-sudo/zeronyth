"""Non-destructive restore safety regression tests with synthetic data only."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

RESTORE = Path(__file__).resolve().parents[2] / "scripts/restore-replit.py"


class RestoreSafety(unittest.TestCase):
    def fixture(self, tmp, member_name="zeronyth-l1/example.txt", wrong_file_hash=False):
        backup = Path(tmp) / "backup"
        backup.mkdir()
        archive = backup / "snapshot.tar.gz"
        data = b"synthetic restore test, no private keys\n"
        with tarfile.open(archive, "w:gz") as tar:
            info = tarfile.TarInfo(member_name)
            info.size = len(data)
            info.mode = 0o755
            tar.addfile(info, io.BytesIO(data))
        manifest = {"format": "ZERONYTH_OFFLINE_BACKUP_V1", "archive": archive.name,
                    "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                    "filesSha256": {"example.txt": "0" * 64 if wrong_file_hash else
                                    hashlib.sha256(data).hexdigest()}}
        (backup / "manifest.json").write_text(json.dumps(manifest))
        return backup

    def run_restore(self, backup, target):
        return subprocess.run(["python3", str(RESTORE), str(backup), str(target)],
                              capture_output=True, text=True)

    def test_valid_archive_and_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            backup = self.fixture(tmp)
            target = Path(tmp) / "restored"
            result = self.run_restore(backup, target)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((target / "example.txt").stat().st_mode & 0o777, 0o700)
            self.assertEqual(target.stat().st_mode & 0o777, 0o700)

    def test_existing_state_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            backup = self.fixture(tmp)
            target = Path(tmp) / "existing"
            target.mkdir()
            (target / "marker").write_text("preserve me")
            result = self.run_restore(backup, target)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("nothing overwritten", result.stderr)
            self.assertEqual((target / "marker").read_text(), "preserve me")

    def test_archive_corruption_is_rejected_before_restoring(self):
        with tempfile.TemporaryDirectory() as tmp:
            backup = self.fixture(tmp)
            with (backup / "snapshot.tar.gz").open("ab") as stream:
                stream.write(b"corrupt")
            target = Path(tmp) / "restored"
            self.assertNotEqual(self.run_restore(backup, target).returncode, 0)
            self.assertFalse(target.exists())

    def test_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            backup = self.fixture(tmp, "zeronyth-l1/../../escaped")
            target = Path(tmp) / "restored"
            self.assertNotEqual(self.run_restore(backup, target).returncode, 0)
            self.assertFalse(target.exists())
            self.assertFalse((Path(tmp) / "escaped").exists())

    def test_individual_file_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            backup = self.fixture(tmp, wrong_file_hash=True)
            result = self.run_restore(backup, Path(tmp) / "restored")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("File checksum mismatch", result.stderr)


if __name__ == "__main__":
    unittest.main()
