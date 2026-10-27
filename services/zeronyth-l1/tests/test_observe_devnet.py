import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("observe_devnet",
    Path(__file__).resolve().parents[1] / "scripts/observe-devnet.py")
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)
inventory = {101: ("127.0.0.1", 8545), 102: None, 103: None, 104: None}


def fake_rpc(advance=True):
    heights = iter(["0x10", "0x11" if advance else "0x10"])
    def call(endpoint, method, params=None):
        return {"eth_blockNumber": lambda: next(heights), "eth_chainId": lambda: "0x23a7",
                "net_peerCount": lambda: "0x3",
                "qbft_getValidatorsByBlockNumber": lambda: ["test"] * 4}[method]()
    return call


class ObserveDevnetTests(unittest.TestCase):
    def test_does_not_require_or_enable_rpc_on_other_validators(self):
        with patch.object(monitor, "validator_inventory", return_value=inventory), \
             patch.object(monitor, "rpc", side_effect=fake_rpc()), patch.object(monitor.time, "sleep"):
            result = monitor.observe()
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["validatorProcesses"], 4)
        self.assertEqual(result["observedRpcEndpoints"], 1)
        self.assertFalse(result["allValidatorsExposedRpc"])
        self.assertTrue(result["readOnly"])

    def test_nonadvancing_chain_is_not_healthy(self):
        with patch.object(monitor, "validator_inventory", return_value=inventory), \
             patch.object(monitor, "rpc", side_effect=fake_rpc(False)), patch.object(monitor.time, "sleep"):
            self.assertEqual(monitor.observe()["status"], "FAIL")

    def test_changed_pid_is_not_silently_accepted(self):
        changed = {**inventory, 105: None}
        del changed[104]
        with patch.object(monitor, "validator_inventory", side_effect=[inventory, changed]), \
             patch.object(monitor, "rpc", side_effect=fake_rpc()), patch.object(monitor.time, "sleep"):
            self.assertEqual(monitor.observe()["status"], "FAIL")

    def test_no_existing_rpc_fails_without_starting_one(self):
        with patch.object(monitor, "validator_inventory", return_value={k: None for k in inventory}):
            with self.assertRaises(ValueError):
                monitor.observe()


if __name__ == "__main__":
    unittest.main()
