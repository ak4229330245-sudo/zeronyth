#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT" <<'PY'
from pathlib import Path
import json
import sys

root = Path(sys.argv[1])
q = json.loads((root / 'config/qbftConfigFile.json').read_text(encoding='utf-8'))
gen = q['genesis']
cfg = gen['config']

assert cfg['chainId'] == 9127
assert cfg['berlinBlock'] == 0
assert cfg['londonBlock'] == 0
assert cfg['shanghaiTime'] == 0
assert cfg['zeroBaseFee'] is True
assert cfg['qbft']['blockperiodseconds'] >= 1
assert cfg['qbft']['requesttimeoutseconds'] > cfg['qbft']['blockperiodseconds']
assert q['blockchain']['nodes']['count'] == 4
assert gen['difficulty'] == '0x1'
assert gen['mixHash'].lower() == '0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365'
gas_limit = int(gen['gasLimit'], 16)
assert 21_000 <= gas_limit <= 100_000_000, gas_limit

if (root / 'config/genesis.json').exists():
    g = json.loads((root / 'config/genesis.json').read_text(encoding='utf-8'))
    cid = g['config'].get('chainId', g['config'].get('chainid'))
    assert cid == 9127, cid
    assert 'extraData' in g and isinstance(g['extraData'], str) and g['extraData'].startswith('0x')
    assert g['config'].get('shanghaiTime') == 0
    assert g['config'].get('zeroBaseFee') is True

if (root / 'config/static-nodes.json').exists():
    all_nodes = json.loads((root / 'config/static-nodes.json').read_text(encoding='utf-8'))
    assert len(all_nodes) == 4
    assert len(set(all_nodes)) == 4
    assert all(x.startswith('enode://') and ':30303' in x for x in all_nodes)
    for i in range(1, 5):
        p = root / 'node-data' / f'node{i}' / 'static-nodes.json'
        peers = json.loads(p.read_text(encoding='utf-8'))
        assert len(peers) == 3
        assert all_nodes[i-1] not in peers

print('Configuration validation: OK')
PY
