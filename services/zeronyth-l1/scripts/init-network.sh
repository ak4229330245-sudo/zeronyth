#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/networkFiles"
NODES="$ROOT/node-data"
BESU_IMAGE="${BESU_IMAGE:-hyperledger/besu:26.9.0}"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 is required." >&2; exit 1; }
}
need docker
need python3

docker compose version >/dev/null 2>&1 || { echo "ERROR: Docker Compose v2 is required (docker compose)." >&2; exit 1; }

# Preserve existing chain identity and state. A complete network is already
# initialized; validate it and return without rotating keys or deleting data.
complete=1
[ -s "$ROOT/config/genesis.json" ] || complete=0
[ -s "$ROOT/config/static-nodes.json" ] || complete=0
[ -s "$ROOT/config/validators.json" ] || complete=0
for i in 1 2 3 4; do
  [ -s "$ROOT/node-data/node$i/key" ] || complete=0
  [ -s "$ROOT/node-data/node$i/key.pub" ] || complete=0
  [ -s "$ROOT/node-data/node$i/static-nodes.json" ] || complete=0
done
if [ "$complete" -eq 1 ]; then
  echo "Existing ZERONYTH network detected; preserving validator keys and chain data."
  "$ROOT/scripts/validate-config.sh"
  exit 0
fi

# If *any* generated network state exists but is incomplete, fail closed. Do not
# silently wipe it; the operator must back it up and explicitly run reset-network.sh.
if [ -e "$ROOT/config/genesis.json" ] || [ -e "$ROOT/config/static-nodes.json" ] ||    [ -e "$ROOT/config/validators.json" ] || [ -d "$ROOT/networkFiles" ] ||    find "$NODES" -mindepth 1 -maxdepth 1 -type d -name 'node[1-4]' -print -quit | grep -q .; then
  echo "ERROR: partial ZERONYTH network state detected. Nothing was deleted." >&2
  echo "Back up node-data and config first. To intentionally discard this local chain, run ./scripts/reset-network.sh, then ./scripts/init-network.sh." >&2
  exit 1
fi

# Never initialize identities while this Compose project is running.
if [ -n "$(docker ps --filter label=com.docker.compose.project=zeronyth-l1 -q 2>/dev/null)" ]; then
  echo "ERROR: ZERONYTH containers are running and no complete network state was found. Stop them before initializing." >&2
  exit 1
fi

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

FAUCET_ADDRESS="${FAUCET_ADDRESS:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
FAUCET_BALANCE_WEI="${FAUCET_BALANCE_WEI:-0x52b7d2dcc80cd2e4000000}"

# No generated network artifacts exist at this point. Never delete state here.
mkdir -p "$NODES"

echo "[1/5] Generating QBFT genesis + validator keys with $BESU_IMAGE..."

CID=$(docker create --entrypoint /opt/besu/bin/besu \
  -v "$ROOT/config:/config:ro" \
  "$BESU_IMAGE" \
  operator generate-blockchain-config \
  --config-file=/config/qbftConfigFile.json \
  --to=/tmp/qsgen-$$ \
  --private-key-file-name=key)

docker start -a "$CID"

rm -rf "$OUT"
mkdir -p "$OUT"
docker cp "$CID:/tmp/qsgen-$$/." "$OUT/"
docker rm "$CID" >/dev/null

[ -f "$OUT/genesis.json" ] || { echo "ERROR: Besu did not generate genesis.json" >&2; exit 1; }
cp "$OUT/genesis.json" "$ROOT/config/genesis.json"

KEYLIST="$OUT/keydirs.txt"
find "$OUT/keys" -mindepth 1 -maxdepth 1 -type d | sort > "$KEYLIST"
KEYCOUNT="$(wc -l < "$KEYLIST" | tr -d ' ')"
[ "$KEYCOUNT" = "4" ] || { echo "ERROR: expected exactly 4 validator key directories, found $KEYCOUNT" >&2; exit 1; }

i=1
while IFS= read -r src; do
  mkdir -p "$NODES/node$i"
  cp "$src/key" "$NODES/node$i/key"
  cp "$src/key.pub" "$NODES/node$i/key.pub"
  chmod 600 "$NODES/node$i/key"
  chmod 644 "$NODES/node$i/key.pub"
  i=$((i + 1))
done < "$KEYLIST"
rm -f "$KEYLIST"

echo "[2/5] Applying devnet prefunds..."
python3 "$ROOT/scripts/patch-genesis.py" "$ROOT/config/genesis.json" "${FUNDED_ADDRESS:-}" "${FUNDED_BALANCE_WEI:-0xd3c21bcecceda1000000}"
python3 "$ROOT/scripts/patch-genesis.py" "$ROOT/config/genesis.json" "$FAUCET_ADDRESS" "$FAUCET_BALANCE_WEI"

echo "[3/5] Building static peer lists and validator metadata..."
python3 "$ROOT/scripts/make-static-nodes.py"

echo "[4/5] Verifying generated files..."
for i in 1 2 3 4; do
  [ -s "$NODES/node$i/key" ] || { echo "ERROR: node$i key missing" >&2; exit 1; }
  [ -s "$NODES/node$i/key.pub" ] || { echo "ERROR: node$i public key missing" >&2; exit 1; }
  [ -s "$NODES/node$i/static-nodes.json" ] || { echo "ERROR: node$i static peer list missing" >&2; exit 1; }
done

echo "[5/5] Validating generated configuration..."
"$ROOT/scripts/validate-config.sh"

echo
echo "Network initialized."
echo "Next: docker compose up -d --build"
echo "Then: ./scripts/smoke-test.sh"
