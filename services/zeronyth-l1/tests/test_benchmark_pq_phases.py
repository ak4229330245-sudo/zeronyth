import importlib.util
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("phase_compare",ROOT/"scripts/benchmark-pq-phases.py")
bench=importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


def sample(parallel=False,tps=500):
    return {
        "status":"FOUR SEPARATE LOCAL PROCESSES VERIFIED ML-DSA QUORUM",
        "validators":4,"mlDsaVotes":3,"independentSenderAccounts":16,
        "transactionCount":100,"blocks":3,"totalTransactions":300,
        "parallelAccountExecution":parallel,"independentPreverification":True,
        "compactBlockReferences":True,"sustained5000TpsVerified":False,
        "inclusiveLocalTps":tps,"includingClientSigningTps":tps*0.65,
        "independentPreverificationMs":100,"proposalPhaseMs":160,
        "stagingPhaseMs":140,"votingPhaseMs":15,"commitPhaseMs":65,
    }


class BenchmarkRunnerTests(unittest.TestCase):
    def test_bounds_prevent_accidental_unbounded_load(self):
        for inputs in [(0,3,16,2),(1537,1,16,2),(100,9,16,2),
                       (400,8,65,2),(400,8,16,6),(1536,3,16,2)]:
            with self.subTest(inputs=inputs),self.assertRaises(ValueError):
                bench.size_limits(*inputs)
        bench.size_limits(100,3,16,2)

    def test_missing_consensus_proof_or_fake_throughput_is_rejected(self):
        valid=sample()
        bench.validate_sample(valid,100,3,16,False)
        for key,value in [("mlDsaVotes",2),("validators",3),
                          ("sustained5000TpsVerified",True),("totalTransactions",301),
                          ("independentPreverification",False),("commitPhaseMs",float('nan'))]:
            broken={**valid,key:value}
            with self.subTest(key=key),self.assertRaises(ValueError):
                bench.validate_sample(broken,100,3,16,False)

    def test_report_shows_mediane_and_never_claims_real_remote_tps(self):
        counter={True:0,False:0}
        def runner(tx_per_block,blocks,senders,parallel):
            counter[parallel]+=1
            return sample(parallel,tps=(440 if parallel else 510)+counter[parallel])
        r=bench.report(100,3,16,2,runner=runner)
        self.assertEqual(counter,{True:2,False:2})
        self.assertEqual(r["measurements"]["sequential"]["medianInclusiveLocalTps"],511.5)
        self.assertEqual(r["recommendedModeForThisWorkload"],"sequential")
        self.assertIsNone(r["realDistributedTps"])
        self.assertIsNone(r["realBesuEvmTps"])
        self.assertFalse(r["sustained5000TpsVerified"])


if __name__ == "__main__":
    unittest.main()
