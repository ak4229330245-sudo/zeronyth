"""Safety and quorum checks for opt-in independent validator host exports."""

import importlib.util
import json
import stat
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


split = load("remote_split", "prepare-remote-validators.py")
health = load("remote_health", "check-remote-consensus.py")
HOSTS = ["10.17.0.11", "10.17.0.12", "10.17.0.13", "10.17.0.14"]


class RemoteValidatorTests(unittest.TestCase):
    def test_exact_private_nonduplicate_host_ips_required(self):
        self.assertEqual(split.ipv4_hosts(HOSTS), HOSTS)
        for bad in [
            HOSTS[:3], [HOSTS[0]]*4, ["8.8.8.8", *HOSTS[1:]],
            ["127.0.0.1", *HOSTS[1:]], ["169.254.0.1", *HOSTS[1:]],
            ["0.0.0.0", *HOSTS[1:]], ["localhost", *HOSTS[1:]],
            ["10.17.0.11 ", *HOSTS[1:]],
        ]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                split.ipv4_hosts(bad)

    def fixture(self, root):
        (root / "config").mkdir()
        (root / "node-data").mkdir()
        (root / "config/genesis.json").write_text(json.dumps({
            "config":{"chainId":9127}, "extraData":"0xdeadbeef"}), encoding="utf-8")
        for i in range(1, 5):
            d=root / "node-data" / f"node{i}"
            d.mkdir()
            (d / "key").write_text(f"{i:02x}"*32, encoding="ascii")
            (d / "key.pub").write_text(f"{i+16:02x}"*64, encoding="ascii")

    def test_split_protects_secret_files_and_yields_independent_enodes(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)
            src=base / "source";src.mkdir()
            self.fixture(src)
            out=base / "new-operator-bundles"
            manifest=split.prepare(src, out, HOSTS)
            self.assertEqual(len(manifest["validators"]),4)
            self.assertEqual(len({e["enode"] for e in manifest["validators"]}),4)
            self.assertEqual(stat.S_IMODE(out.stat().st_mode),0o700)
            for i in range(1,5):
                self.assertNotIn(f"{i:02x}"*32,json.dumps(manifest))
            for i in range(1, 5):
                bundle=out / f"node{i}"
                key=bundle / "data/key"
                self.assertEqual(stat.S_IMODE(key.stat().st_mode),0o600)
                self.assertEqual(key.read_text(),f"{i:02x}"*32)
                self.assertEqual((bundle / "genesis.json").read_bytes(),
                                 (src / "config/genesis.json").read_bytes())
                peers=json.loads((bundle / "data/static-nodes.json").read_text())
                self.assertEqual(len(peers),3)
                self.assertNotIn(manifest["validators"][i-1]["enode"],peers)
                self.assertTrue(all(peer in [e["enode"] for e in manifest["validators"]]
                                    for peer in peers))
                docker=(bundle / "compose.yaml").read_text()
                self.assertIn("127.0.0.1:8545:8545",docker)
                self.assertIn("--discovery-enabled=false",docker)
                self.assertIn("--p2p-host=${ZERONYTH_P2P_HOST:",docker)
                self.assertNotIn("0.0.0.0:8545:8545",docker)
            with self.assertRaises(FileExistsError):
                split.prepare(src,out,HOSTS)

    def test_invalid_sources_do_not_create_partial_secret_bundles(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)
            src=base / "source";src.mkdir()
            self.fixture(src)
            (src / "node-data/node2/key").write_text("notakey")
            out=base / "must-not-create"
            with self.assertRaises(ValueError):
                split.prepare(src,out,HOSTS)
            self.assertFalse(out.exists())
            with self.assertRaises(ValueError):
                split.prepare(src,base,HOSTS)

    def test_public_manifest_and_private_outputs_excluded_from_release(self):
        build=(ROOT / "scripts/build-release.py").read_text()
        verify=(ROOT / "scripts/verify-release.py").read_text()
        gitignore=(ROOT / ".gitignore").read_text()
        self.assertIn('"network-hosts"',build)
        self.assertIn('"network-hosts"',verify)
        self.assertIn('network-hosts/',gitignore)

    def test_quorum_health_requires_four_validators_and_progress_with_two_peers(self):
        def make_request(peers="0x2",heads=("0x2", "0x4"),validators=4):
            height=iter(heads)
            def stub(method, params=None):
                if method=="eth_chainId":return "0x23a7"
                if method=="net_peerCount":return peers
                if method=="qbft_getValidatorsByBlockNumber":
                    return [f"0x{i:040x}" for i in range(validators)]
                if method=="eth_blockNumber":return next(height)
                raise AssertionError(method)
            return stub
        result=health.check(3,request=make_request(),sleeper=lambda seconds:None)
        self.assertEqual(result["toBlock"],4)
        self.assertEqual(result["connectedPeers"],2)
        for stub in [make_request(peers="0x1"),
                     make_request(heads=("0x4", "0x4")),
                     make_request(validators=3)]:
            with self.assertRaises(RuntimeError):
                health.check(3,request=stub,sleeper=lambda seconds:None)


if __name__ == "__main__":
    unittest.main()
