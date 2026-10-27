#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${SOLC_IMAGE:-ethereum/solc:0.8.24}"
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required." >&2; exit 1; }

contracts=(QuantumAccount.sol MEVShield.sol PrivateCommitment.sol)
for contract in "${contracts[@]}"; do
  [ -f "$ROOT/contracts/$contract" ] || { echo "ERROR: missing contract: $contract" >&2; exit 1; }
  echo "Compiling $contract with $IMAGE..."
  docker run --rm \
    -v "$ROOT/contracts:/src:ro" \
    "$IMAGE" \
    --optimize --optimize-runs 200 --bin --abi "/src/$contract" >/dev/null
done

echo "Solidity compilation: PASS (${#contracts[@]} contracts, solc 0.8.24)"
