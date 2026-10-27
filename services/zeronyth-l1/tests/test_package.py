import hashlib
import json
import re
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OFFICIAL_QBFT_MIXHASH = "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365"


class PackageTests(unittest.TestCase):
    def test_release_verifier_rejects_experimental_validator_secrets(self):
        with tempfile.TemporaryDirectory() as folder:
            for filename in (
                "validator.pem", "validator.votes.jsonl", "validator.votes.jsonl.lock",
                "validator.blocks.jsonl", "validator.blocks.jsonl.lock", "validator.key",
            ):
                archive = Path(folder) / "invalid.zip"
                with zipfile.ZipFile(archive, "w") as zf:
                    zf.writestr(f"zeronyth-l1-starter-kit-test/pq-native/{filename}", "dummy")
                result = subprocess.run(
                    ["python3", str(ROOT / "scripts/verify-release.py"), str(archive)],
                    capture_output=True, text=True, check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("PQ validator key or vote journal", result.stderr + result.stdout)

    def test_versions_are_consistent(self):
        version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
        product = json.loads((ROOT / "product.json").read_text(encoding="utf-8"))
        faucet = json.loads((ROOT / "faucet/package.json").read_text(encoding="utf-8"))
        lock = json.loads((ROOT / "faucet/package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(version, "1.8.32-safetyfix-znyt")
        self.assertEqual(product["version"], version)
        self.assertEqual(faucet["version"], version)
        self.assertEqual(lock["version"], version)
        self.assertEqual(lock["packages"][""]["version"], version)

    def test_qbft_source_config_is_valid_for_this_kit(self):
        q = json.loads((ROOT / "config/qbftConfigFile.json").read_text(encoding="utf-8"))
        genesis = q["genesis"]
        config = genesis["config"]
        self.assertEqual(config["chainId"], 9127)
        self.assertEqual(config["berlinBlock"], 0)
        self.assertEqual(config["londonBlock"], 0)
        self.assertEqual(config["shanghaiTime"], 0)
        self.assertIs(config["zeroBaseFee"], True)
        self.assertEqual(config["qbft"]["blockperiodseconds"], 1)
        self.assertGreater(config["qbft"]["requesttimeoutseconds"], config["qbft"]["blockperiodseconds"])
        self.assertEqual(q["blockchain"]["nodes"]["count"], 4)
        self.assertEqual(genesis["difficulty"], "0x1")
        self.assertEqual(genesis["mixHash"].lower(), OFFICIAL_QBFT_MIXHASH)
        self.assertEqual(int(genesis["gasLimit"], 16), 30_000_000)

    def test_compose_is_pinned_local_and_non_conflicting(self):
        text = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("hyperledger/besu:26.9.0", text)
        self.assertIn("nginx:1.30.5-alpine", text)
        self.assertNotIn("hyperledger/besu:latest", text)
        self.assertNotIn("container_name:", text)
        self.assertIn("no-new-privileges:true", text)
        dockerfile = (ROOT / "faucet/Dockerfile").read_text(encoding="utf-8")
        self.assertIn("node:22.23.3-alpine", dockerfile)
        self.assertIn("npm ci --omit=dev", dockerfile)
        self.assertIn("package-lock.json", dockerfile)
        self.assertIn('127.0.0.1:8545:8545', text)
        self.assertIn('127.0.0.1:8080:80', text)
        self.assertNotIn('127.0.0.1:8546:8545', text)
        self.assertNotIn('127.0.0.1:8547:8545', text)
        self.assertNotIn('127.0.0.1:8548:8545', text)
        self.assertNotRegex(
            text,
            re.compile(r'ports:\s*\n\s*-\s*["\']?30303:30303', re.M),
        )
        self.assertNotRegex(text, re.compile(r"ports:\s*\n\s*- [\"']?127\.0\.0\.1:8787", re.M))
        self.assertIn("FAUCET_PRIVATE_KEY: ${FAUCET_PRIVATE_KEY:?", text)
        self.assertIn("FAUCET_ADDRESS: ${FAUCET_ADDRESS:?", text)
        self.assertIn("condition: service_started", text)
        self.assertNotIn("./dashboard:/usr/share/nginx/html:ro", text)
        self.assertIn("./dashboard/index.html:/usr/share/nginx/html/index.html:ro", text)

    def test_faucet_dependency_lock_is_exact(self):
        package = json.loads((ROOT / "faucet/package.json").read_text(encoding="utf-8"))
        lock = json.loads((ROOT / "faucet/package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(package["dependencies"]["ethers"], "6.17.0")
        self.assertEqual(lock["packages"]["node_modules/ethers"]["version"], "6.17.0")
        self.assertTrue(lock["packages"]["node_modules/ethers"]["integrity"].startswith("sha512-"))

    def test_no_generated_validator_keys_are_packaged(self):
        with tempfile.TemporaryDirectory() as folder:
            subprocess.run(
                ["python3", str(ROOT / "scripts/build-release.py"), folder],
                check=True, capture_output=True, text=True,
            )
            archive = Path(folder) / f"zeronyth-l1-starter-kit-v{(ROOT / 'VERSION').read_text().strip()}.zip"
            with zipfile.ZipFile(archive) as package:
                names = set(package.namelist())
            self.assertFalse(any("/node-data/node" in name for name in names))
            self.assertFalse(any(name.endswith("/config/genesis.json") for name in names))
            self.assertFalse(any(name.endswith("/config/static-nodes.json") for name in names))
            self.assertFalse(any(name.endswith("/config/validators.json") for name in names))
            self.assertFalse(any(name.endswith("/.env") for name in names))

    def test_launchers_and_reinit_guards(self):
        init_sh = (ROOT / "scripts/init-network.sh").read_text(encoding="utf-8")
        start_sh = (ROOT / "scripts/start.sh").read_text(encoding="utf-8")
        start_bat = (ROOT / "START.bat").read_text(encoding="utf-8")
        self.assertNotIn("mapfile", init_sh)
        self.assertIn("Docker Compose v2", init_sh)
        self.assertIn("com.docker.compose.project=zeronyth-l1", init_sh)
        self.assertNotIn("docker compose down --remove-orphans", start_sh)
        self.assertIn("./scripts/doctor.sh", start_sh)
        self.assertIn("preserving validator keys and chain data", init_sh)
        self.assertIn("partial ZERONYTH network state detected", init_sh)
        self.assertNotIn('rm -rf "$OUT" "$NODES/node1"', init_sh)
        reset_sh = (ROOT / "scripts/reset-network.sh").read_text(encoding="utf-8")
        self.assertIn('"${1:-}" != "--confirm"', reset_sh)
        self.assertIn('Type RESET to continue', reset_sh)
        self.assertIn("Git\\bin\\bash.exe", start_bat)
        self.assertIn("wsl", start_bat.lower())
        self.assertTrue((ROOT / "scripts/wait-for-rpc.sh").exists())
        self.assertTrue((ROOT / "scripts/doctor.sh").exists())

    def test_dashboard_avoids_inline_script_and_unsafe_error_html(self):
        html = (ROOT / "dashboard/index.html").read_text(encoding="utf-8")
        js = (ROOT / "dashboard/assets/app.js").read_text(encoding="utf-8")
        nginx = (ROOT / "dashboard/nginx.conf").read_text(encoding="utf-8")
        self.assertNotRegex(html, re.compile(r"\son\w+=", re.I))
        self.assertIn('src="assets/app.js"', html)
        self.assertIn('src="assets/security-ui.mjs"', html)
        self.assertIn('src="assets/guarded-send-ui.mjs"', html)
        self.assertIn('id="guardSend"', html)
        self.assertIn('id="guardConfirm"', html)
        self.assertNotIn("innerHTML", js)
        self.assertIn("Content-Security-Policy", nginx)
        self.assertIn("Permissions-Policy", nginx)
        self.assertIn("limit_req zone=qsl1_faucet", nginx)
        self.assertIn("location = /api/faucet/claim", nginx)
        self.assertIn("location = /api/faucet/health", nginx)

    def test_faucet_hardening(self):
        server = (ROOT / "faucet/server.mjs").read_text(encoding="utf-8")
        self.assertIn("NonceManager", server)
        self.assertIn("MAX_BODY_BYTES", server)
        self.assertIn("MAX_QUEUE", server)
        self.assertIn("assertExpectedChain", server)
        self.assertIn("gasPrice: 0n", server)
        self.assertIn("signer.reset()", server)
        self.assertIn("txQueue", server)
        self.assertIn("enqueueTransaction", server)
        self.assertIn("Content-Type must be application/json", server)
        self.assertIn("FAUCET_PRIVATE_KEY does not match FAUCET_ADDRESS", server)
        self.assertIn("retry-after", server)
        self.assertIn("SIGTERM", server)
        self.assertNotIn("access-control-allow-origin", server.lower())
        self.assertNotIn("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", server)

    def test_contract_guards_and_domain_separation(self):
        q = (ROOT / "contracts/QuantumAccount.sol").read_text(encoding="utf-8")
        m = (ROOT / "contracts/MEVShield.sol").read_text(encoding="utf-8")
        p = (ROOT / "contracts/PrivateCommitment.sol").read_text(encoding="utf-8")
        for source in (q, m, p):
            self.assertIn("pragma solidity 0.8.24;", source)
        self.assertRegex(q, re.compile(r"PQC verification.*externalized", re.I))
        self.assertIn("ownerEpoch", q)
        self.assertIn("recoveryConfigEpoch", q)
        self.assertIn("r.ownerEpoch != ownerEpoch", q)
        self.assertIn("r.recoveryConfigEpoch != recoveryConfigEpoch", q)
        self.assertIn("OwnerCannotBeGuardian", q)
        self.assertIn("if (g == _owner) revert OwnerCannotBeGuardian();", q)
        self.assertIn("if (guardian[newOwner]) revert OwnerCannotBeGuardian();", q)
        self.assertIn("bytes32 proposedPQCKeyHash", q)
        self.assertIn("pqcPublicKeyHash = r.proposedPQCKeyHash", q)
        self.assertRegex(q, re.compile(r"recoveryDelay = newDelay;\s*recoveryConfigEpoch\+\+;"))
        self.assertIn("block.chainid, address(this), sender", m)
        self.assertIn("block.chainid, address(this), publisher", p)
        self.assertIn("not a full encrypted mempool", m)

    def test_release_hygiene_and_deterministic_builder(self):
        gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        builder = (ROOT / "scripts/build-release.py").read_text(encoding="utf-8")
        verify = (ROOT / "scripts/verify-release.py").read_text(encoding="utf-8")
        self.assertIn("config/validators.json", gitignore)
        self.assertIn("FIXED_TIME", builder)
        self.assertIn("refusing to package symlink", builder)
        self.assertIn("symlink not allowed in release", verify)
        self.assertIn("top-level directory/version mismatch", verify)
        self.assertIn("required executable bit missing", verify)
        self.assertIn("dist/", gitignore)
        self.assertIn("ci-artifacts/", gitignore)

    def test_release_builder_is_reproducible(self):
        with tempfile.TemporaryDirectory() as td1, tempfile.TemporaryDirectory() as td2:
            subprocess.run(["python3", str(ROOT / "scripts/build-release.py"), td1], check=True, capture_output=True, text=True)
            subprocess.run(["python3", str(ROOT / "scripts/build-release.py"), td2], check=True, capture_output=True, text=True)
            name = f"zeronyth-l1-starter-kit-v{(ROOT / 'VERSION').read_text().strip()}.zip"
            a = hashlib.sha256((Path(td1) / name).read_bytes()).hexdigest()
            b = hashlib.sha256((Path(td2) / name).read_bytes()).hexdigest()
            self.assertEqual(a, b)

    def test_license_is_not_left_as_placeholder(self):
        license_text = (ROOT / "LICENSE").read_text(encoding="utf-8")
        self.assertIn("MIT License", license_text)
        self.assertNotIn("replace this template", license_text.lower())
        self.assertTrue((ROOT / "THIRD_PARTY_NOTICES.md").exists())

    def test_ci_e2e_is_included_and_hardened(self):
        workflow = (ROOT / ".github/workflows/e2e.yml").read_text(encoding="utf-8")
        e2e = (ROOT / "scripts/e2e-test.sh").read_text(encoding="utf-8")
        compile_sh = (ROOT / "scripts/compile-contracts.sh").read_text(encoding="utf-8")
        verify = (ROOT / "scripts/verify-release.py").read_text(encoding="utf-8")
        self.assertIn("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", workflow)
        self.assertIn("actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97", workflow)
        self.assertIn("actions/upload-artifact@v7.0.2", workflow)
        self.assertIn("runs-on: ubuntu-24.04", workflow)
        self.assertIn('python-version: "3.13.16"', workflow)
        self.assertIn("permissions:\n  contents: read", workflow)
        self.assertIn("timeout-minutes: 20", workflow)
        self.assertIn("Rebuild package and verify reproducibility", workflow)
        self.assertIn("docker compose down -v --remove-orphans", workflow)
        self.assertIn("ethereum/solc:0.8.24", compile_sh)
        self.assertIn("eth_getTransactionReceipt", e2e)
        self.assertIn('r.get("status")=="0x1"', e2e)
        self.assertIn("after - before == expected", e2e)
        self.assertIn('"429"', e2e)
        self.assertIn('"415"', e2e)
        self.assertIn("forbidden generated file in release", verify)
        self.assertTrue((ROOT / "docs/CI.md").exists())

    def test_known_pqc_hash_uses_sha256(self):
        import importlib.util
        path = ROOT / "pqc/ml_dsa_adapter.py"
        spec = importlib.util.spec_from_file_location("ml_dsa_adapter", path)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        expected = "0x" + hashlib.sha256(b"abc").hexdigest()
        self.assertEqual(module.public_key_hash(b"abc"), expected)


if __name__ == "__main__":
    unittest.main()
