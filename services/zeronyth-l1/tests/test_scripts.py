import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ScriptTests(unittest.TestCase):
    def test_patch_genesis_valid_address(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "genesis.json"
            path.write_text(json.dumps({"alloc": {}}), encoding="utf-8")
            subprocess.run(
                [
                    "python3", str(ROOT / "scripts/patch-genesis.py"), str(path),
                    "0x1111111111111111111111111111111111111111", "0xde0b6b3a7640000",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(
                data["alloc"]["1111111111111111111111111111111111111111"]["balance"],
                "0xde0b6b3a7640000",
            )

    def test_patch_genesis_rejects_bad_address(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "genesis.json"
            path.write_text(json.dumps({"alloc": {}}), encoding="utf-8")
            proc = subprocess.run(
                ["python3", str(ROOT / "scripts/patch-genesis.py"), str(path), "0x1234", "0x1"],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(proc.returncode, 0)

    def test_patch_genesis_empty_address_is_noop(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "genesis.json"
            original = {"alloc": {"abc": {"balance": "0x1"}}}
            path.write_text(json.dumps(original), encoding="utf-8")
            subprocess.run(
                ["python3", str(ROOT / "scripts/patch-genesis.py"), str(path), "", "0x1"],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), original)


if __name__ == "__main__":
    unittest.main()
