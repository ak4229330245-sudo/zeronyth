#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
python3 "$ROOT/scripts/build-release.py" "$OUT"
