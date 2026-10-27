/** Restore into isolated storage, open one restored DB read-only via RPC, then stop. */
import { spawn, spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const root = fileURLToPath(new URL('../../', import.meta.url));
const workspace = path.resolve(root, '../..');
const backup = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Pass private backup directory');
const target = path.join(workspace, 'generated-artifacts/private-restores', `check-${Date.now()}`);
const outDir = path.join(workspace, 'generated-artifacts/crypto-migration');
const manifest = JSON.parse(await readFile(path.join(backup, 'manifest.json')));
const restored = spawnSync('python3', [path.join(root, 'scripts/restore-replit.py'), backup, target],
  { encoding: 'utf8' });
if (restored.status !== 0) throw Error(restored.stderr || restored.stdout);
await mkdir(outDir, { recursive: true });
const runtime = path.join(workspace, 'generated-artifacts/runtime');
const log = openSync(path.join(outDir, 'restored-node.log'), 'a', 0o600);
const child = spawn(path.join(runtime, 'besu-26.9.0/bin/besu'), [
  '--profile=ENTERPRISE', `--genesis-file=${target}/config/genesis.json`,
  `--data-path=${target}/node-data/node1`, `--node-private-key-file=${target}/node-data/node1/key`,
  '--network-id=9127', '--sync-mode=FULL', '--data-storage-format=FOREST',
  '--p2p-enabled=false', '--discovery-enabled=false', '--min-gas-price=0',
  '--rpc-http-enabled=true', '--rpc-http-host=127.0.0.1', '--rpc-http-port=18545',
  '--rpc-http-api=ETH,NET,QBFT', '--host-allowlist=localhost,127.0.0.1',
], { cwd: target, env: { ...process.env,
  JAVA_HOME: path.join(runtime, 'jdk-25.0.5+8-jre'),
  JAVA_OPTS: '-Xms128m -Xmx384m -XX:ActiveProcessorCount=2',
}, stdio: ['ignore', log, log] });
closeSync(log);
let spawnError;
child.on('error', e => { spawnError = e; });
async function stop() {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)), delay(10_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await new Promise(r => child.once('exit', r));
  }
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => void stop().then(() => process.exit(1)));
async function rpc(port, method, params = []) {
  const result = await (await fetch(`http://127.0.0.1:${port}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(2500),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })).json();
  if (result.error) throw Error(JSON.stringify(result.error));
  return result.result;
}
try {
  let height;
  for (let i = 0; i < 75; i++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw Error('Restored node exited; inspect restored-node.log');
    try { height = await rpc(18545, 'eth_blockNumber'); break; } catch { await delay(1000); }
  }
  if (!height) throw Error('Restored node RPC did not become ready');
  const before = manifest.preStopRpcEvidence;
  const restoredBlock = await rpc(18545, 'eth_getBlockByNumber', [before.block.number, false]);
  assert.equal(await rpc(18545, 'eth_chainId'), before.chainId);
  assert.equal(restoredBlock.hash, before.block.hash);
  assert.equal(restoredBlock.stateRoot, before.block.stateRoot);
  assert.ok(BigInt(height) >= BigInt(before.block.number));
  assert.deepEqual((await rpc(18545, 'qbft_getValidatorsByBlockNumber', ['latest'])).sort(),
    [...before.validators].sort());
  const liveBlock = await rpc(8545, 'eth_getBlockByNumber', [before.block.number, false]);
  assert.equal(liveBlock.hash, before.block.hash);
  const liveHeight = await rpc(8545, 'eth_blockNumber');
  assert.ok(BigInt(liveHeight) > BigInt(before.block.number));
  assert.equal(await rpc(8545, 'net_peerCount'), '0x3');
  const report = { archiveSha256Verified: true, restoredFileCount: manifest.fileCount,
    everyRestoredFileHashVerified: true,
    restoredNodes: 4, databaseReadCheckNodes: 1, restoredNodeP2PEnabled: false,
    restoredNodeChainId: before.chainId, historicalBlock: before.block.number,
    historicalHashPreserved: true, stateRootPreserved: true,
    validatorSetPreserved: true, restoredHead: height,
    liveHeadAfterRestart: liveHeight, livePeers: 3,
    liveChainContinuedWithoutReset: true,
    scope: 'All four nodes hash-restored; one restored database opened without P2P. Not a full four-node disaster-recovery drill.' };
  await writeFile(path.join(outDir, 'backup-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await stop();
}
