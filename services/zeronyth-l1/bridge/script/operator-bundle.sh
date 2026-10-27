#!/usr/bin/env bash
# Build the lean "run a relayer" kit for an outside operator (no keys, no secrets, no state).
#   bash script/operator-bundle.sh [out.tar.gz]
# Unpack on the operator machine, then follow OPERATORS.md.
set -euo pipefail
cd "$(dirname "$0")/../.."   # services/zeronyth-l1
OUT="${1:-$PWD/bridge/zeronyth-relayer-kit.tar.gz}"
tar czf "$OUT" \
  --exclude='bridge/lib/*.orig' \
  bridge/relayer.mjs bridge/lib bridge/abi bridge/deployments/main.json \
  bridge/package.json bridge/package-lock.json \
  bridge/script/operator-keygen.mjs bridge/pm2.operator.config.cjs bridge/OPERATORS.md \
  dashboard/assets/vendor-noble.mjs dashboard/assets/ecosystem-registry.mjs
# Refuse to ship anything that looks like a key file.
if tar tzf "$OUT" | grep -Eq '\.secrets|keys\.json|\.env'; then echo "refusing: secret-looking path in kit" >&2; rm -f "$OUT"; exit 1; fi
echo "$OUT"
