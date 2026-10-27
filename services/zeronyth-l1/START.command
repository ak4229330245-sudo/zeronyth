#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./scripts/start.sh
printf '\nPress Enter to close this window...'
read -r _ || true
