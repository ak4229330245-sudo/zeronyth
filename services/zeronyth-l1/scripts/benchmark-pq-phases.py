#!/usr/bin/env python3
"""Reproducible, bounded 4-process localhost ML-DSA phase comparison.

Does not run a public chain, actual P2P validators, funds, or a 5k TPS proof.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PHASES = (
    "independentPreverificationMs", "proposalPhaseMs", "stagingPhaseMs",
    "votingPhaseMs", "commitPhaseMs",
)


def size_limits(tx_per_block: int, blocks: int, senders: int, trials: int):
    if not 1 <= tx_per_block <= 1536 or not 1 <= blocks <= 8:
        raise ValueError("Invalid block count or signed transactions per block")
    if not 1 <= senders <= 64 or not 1 <= trials <= 5:
        raise ValueError("Sender count and trial count must remain bounded")
    if tx_per_block * blocks > 4000:
        raise ValueError("Benchmark runner limits each trial to 4000 transactions")


def validate_sample(sample: dict, tx_per_block: int, blocks: int,
                    senders: int, expected_parallel: bool):
    if (sample.get("status") != "FOUR SEPARATE LOCAL PROCESSES VERIFIED ML-DSA QUORUM"
            or sample.get("validators") != 4 or sample.get("mlDsaVotes") != 3
            or sample.get("independentSenderAccounts") != senders
            or sample.get("transactionCount") != tx_per_block
            or sample.get("blocks") != blocks
            or sample.get("totalTransactions") != tx_per_block * blocks
            or sample.get("parallelAccountExecution") is not expected_parallel
            or sample.get("independentPreverification") is not True
            or sample.get("compactBlockReferences") is not True
            or sample.get("sustained5000TpsVerified") is not False):
        raise ValueError("A benchmark sample failed the strict security/workload invariant checks")
    for key in ["inclusiveLocalTps", "includingClientSigningTps", *PHASES]:
        value = sample.get(key)
        if type(value) not in (float, int) or not math.isfinite(value) or value < 0:
            raise ValueError(f"Benchmark phase missing or invalid: {key}")


def aggregate(samples: list[dict]):
    if not samples:
        raise ValueError("At least one verified benchmark sample is required")
    def median(key):
        return round(statistics.median(s[key] for s in samples), 2)
    phases = {phase:median(phase) for phase in PHASES}
    total = sum(phases.values())
    return {
        "trials":len(samples),
        "medianInclusiveLocalTps":median("inclusiveLocalTps"),
        "medianIncludingClientSigningTps":median("includingClientSigningTps"),
        "phaseMediansMs":phases,
        "phaseSharesPercent":{name:round(100*value/total,1) if total else 0
                              for name,value in phases.items()},
        "worstInclusiveLocalTps":min(s["inclusiveLocalTps"] for s in samples),
        "bestInclusiveLocalTps":max(s["inclusiveLocalTps"] for s in samples),
    }


def run_case(tx_per_block: int, blocks: int, senders: int, parallel: bool):
    command = ["node", str(ROOT / "pq-native/network-demo.mjs"), str(tx_per_block),
               "--blocks", str(blocks), "--senders", str(senders), "--preverify", "--compact"]
    if parallel:
        command.append("--parallel-exec")
    # No shell, no inherited credentials printed, no global chain state touched.
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                            timeout=180, check=True)
    sample = json.loads(result.stdout)
    validate_sample(sample, tx_per_block, blocks, senders, parallel)
    return sample


def report(tx_per_block: int, blocks: int, senders: int, trials: int,
           runner=run_case):
    size_limits(tx_per_block, blocks, senders, trials)
    measurements = {}
    for label, parallel in [("sequential", False), ("parallel-with-serial-crosscheck", True)]:
        samples=[]
        for _ in range(trials):
            sample=runner(tx_per_block, blocks, senders, parallel)
            validate_sample(sample,tx_per_block,blocks,senders,parallel)
            samples.append(sample)
        measurements[label]=aggregate(samples)
    baseline=measurements["sequential"]["medianInclusiveLocalTps"]
    candidate=measurements["parallel-with-serial-crosscheck"]["medianInclusiveLocalTps"]
    return {
        "label":"FOUR-PROCESS LOCAL ML-DSA RESEARCH BENCHMARK",
        "version":"phase-comparison-v1", "transactionsPerBlock":tx_per_block,
        "blocks":blocks, "senders":senders,"trialsPerMode":trials,
        "measurements":measurements,
        "parallelDeltaPercent":round(100*(candidate-baseline)/baseline,2) if baseline else None,
        "recommendedModeForThisWorkload": "parallel-with-serial-crosscheck" if candidate>baseline else "sequential",
        "targetTps":5000,"goal10000TpsVerified":False,"sustained5000TpsVerified":False,
        "realDistributedTps":None,"realBesuEvmTps":None,
        "warnings":[
            "Local processes on one machine; no geographical P2P, Besu, EVM or independently hosted validators.",
            "Includes local preverification and fsync commits but excludes independent P2P/round-change latency.",
            "A faster median here does not automatically authorize switching the consensus engine or weakening state verification.",
        ],
    }


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description="Compare bounded local 4-process ML-DSA TPS and phase timing")
    parser.add_argument("--transactions",type=int,default=384)
    parser.add_argument("--blocks",type=int,default=3)
    parser.add_argument("--senders",type=int,default=16)
    parser.add_argument("--trials",type=int,default=2)
    args=parser.parse_args()
    try:
        result=report(args.transactions,args.blocks,args.senders,args.trials)
    except (ValueError,subprocess.CalledProcessError,subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        parser.exit(1,f"Benchmark aborted without a TPS claim: {exc}\n")
    print(json.dumps(result,indent=2,ensure_ascii=False))
