import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync, existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createGateway } from './replit-gateway.mjs';
import { ensureStaticPeerFiles } from './static-nodes-replit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = path.resolve(root, '../..');
const runtime = path.join(workspace, 'generated-artifacts/runtime');
const logDir = path.join(workspace, 'generated-artifacts/zeronyth-logs');
const besu = path.join(runtime, 'besu-26.9.0/bin/besu');
const javaHome = process.env.ZERONYTH_JAVA_HOME || path.join(runtime, 'jdk-25.0.5+8-jre');
const port = Number(process.env.PORT);
// Port layout (defaults = original). A second chain on the same machine sets these to avoid collisions.
const RPC_PORT = Number(process.env.ZERONYTH_RPC_PORT || 8545);
const P2P_BASE = Number(process.env.ZERONYTH_P2P_BASE || 30302);     // node i listens on P2P_BASE + i
const ADMIN_BASE = Number(process.env.ZERONYTH_ADMIN_BASE || 8644);  // node i (2..4) admin RPC on ADMIN_BASE + i
process.env.ZERONYTH_RPC_PORT = String(RPC_PORT);                    // read by the gateway
// Which of the 4 validators run on THIS machine (split deployment, e.g. box "1,2,3" + VPS "4").
// The public RPC goes on the lowest-numbered local validator. NEVER run the same validator on two machines.
const LOCAL_NODES = (process.env.ZERONYTH_NODES || '1,2,3,4').split(',').map(Number).filter((n) => n >= 1 && n <= 4);
const MIN_PEERS = Number(process.env.ZERONYTH_MIN_PEERS || 3);
const REQUIRE_LIVE = process.env.ZERONYTH_REQUIRE_LIVE !== '0';
// Legacy (sequenced) tx pool under --profile=ENTERPRISE: default 4096 entries silently drops bursts beyond that.
// Same values on every validator (approved 2026-10-27). Gas limit is NOT changed here.
const TXPOOL_MAX = /^\d{3,6}$/.test(process.env.ZERONYTH_TXPOOL_MAX_SIZE || '') ? process.env.ZERONYTH_TXPOOL_MAX_SIZE : '20000';
const TXPOOL_ACCOUNT_PCT = /^0?\.\d{1,4}$|^1$/.test(process.env.ZERONYTH_TXPOOL_ACCOUNT_PCT || '') ? process.env.ZERONYTH_TXPOOL_ACCOUNT_PCT : '0.05';
const children = [];
let server, stopping = false;
const log = (message) => process.stdout.write(`[ZERONYTH] ${message}\n`);
const javaEnv = {
  ...process.env, JAVA_HOME: javaHome,
  JAVA_OPTS: process.env.ZERONYTH_JAVA_OPTS || '-Xms128m -Xmx512m -XX:ActiveProcessorCount=2',
};

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  server?.close();
  for (const child of children) child.kill('SIGTERM');
  // Besu needs time to release its durable database locks.
  await Promise.race([
    Promise.all(children.map((child) => child.exitCode !== null ? Promise.resolve()
      : new Promise((resolve) => child.once('exit', resolve)))),
    delay(12_000),
  ]);
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  process.exit(code);
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void shutdown(0));

function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env: javaEnv, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (exit ${result.status})`);
}
function start(name, command, args, env, { required = true } = {}) {
  const output = openSync(path.join(logDir, `${name}.log`), 'a', 0o600);
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', output, output] });
  closeSync(output);
  children.push(child);
  child.once('error', (error) => {
    log(`${name}: ${error.message}`);
    if (required) void shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      log(`${name} stopped (${code ?? signal}); inspect generated-artifacts/zeronyth-logs/${name}.log`);
      if (required) void shutdown(1);
    }
  });
}

async function initializeNetwork(config) {
  const genesis = path.join(root, 'config/genesis.json');
  const complete = existsSync(genesis) && [1, 2, 3, 4].every((i) =>
    existsSync(path.join(root, `node-data/node${i}/key`)) &&
    existsSync(path.join(root, `node-data/node${i}/key.pub`)));
  if (!complete) {
    if (existsSync(genesis) || existsSync(path.join(root, 'networkFiles')) ||
        [1, 2, 3, 4].some((i) => existsSync(path.join(root, `node-data/node${i}`)))) {
      throw new Error('Partial network state found. Nothing was deleted; restore a complete backup before starting.');
    }
    log('Initializing a fresh local development chain.');
    const output = path.join(root, 'networkFiles');
    runSync(besu, ['operator', 'generate-blockchain-config',
      `--config-file=${path.join(root, 'config/qbftConfigFile.json')}`,
      `--to=${output}`, '--private-key-file-name=key']);
    await cp(path.join(output, 'genesis.json'), genesis);
    const keys = (await readdir(path.join(output, 'keys'))).sort();
    if (keys.length !== 4) throw new Error('Expected exactly four generated validators');
    for (const [index, keyDir] of keys.entries()) {
      const destination = path.join(root, `node-data/node${index + 1}`);
      await mkdir(destination, { recursive: true });
      for (const key of ['key', 'key.pub']) await cp(path.join(output, 'keys', keyDir, key), path.join(destination, key));
      await chmod(path.join(destination, 'key'), 0o600);
    }
    runSync('python3', ['scripts/patch-genesis.py', genesis, config.FUNDED_ADDRESS || '',
      config.FUNDED_BALANCE_WEI || '0xd3c21bcecceda1000000']);
    runSync('python3', ['scripts/patch-genesis.py', genesis, config.FAUCET_ADDRESS,
      config.FAUCET_BALANCE_WEI || '0x52b7d2dcc80cd2e4000000']);
    runSync('python3', ['scripts/make-static-nodes.py']);
  } else log('Preserving existing validator identities and chain data.');
  const peers = [];
  for (let i = 1; i <= 4; i++) {
    let key = (await readFile(path.join(root, `node-data/node${i}/key.pub`), 'utf8')).trim().replace(/^0x/, '');
    if (key.length === 130 && key.startsWith('04')) key = key.slice(2);
    if (!/^[a-fA-F0-9]{128}$/.test(key)) throw new Error(`Invalid public key for node${i}`);
    peers.push(`enode://${key}@127.0.0.1:${P2P_BASE + i}`);
  }
  await ensureStaticPeerFiles(root, peers);
}
async function rpc(method) {
  const response = await fetch(`http://127.0.0.1:${RPC_PORT}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params: [], id: 1 }),
    signal: AbortSignal.timeout(2500),
  });
  const payload = await response.json();
  if (payload.error) throw new Error('Local RPC error');
  return payload.result;
}

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A workflow-provided PORT is required');
  if (!existsSync(besu) || !existsSync(path.join(javaHome, 'bin/java'))) {
    throw new Error('Native Besu 26.9.0 and Java 25 runtime are missing. See services/zeronyth-l1/REPLIT.md.');
  }
  await mkdir(logDir, { recursive: true });
  if (!existsSync(path.join(root, '.env'))) await cp(path.join(root, '.env.example'), path.join(root, '.env'));
  const config = parseEnv(await readFile(path.join(root, '.env'), 'utf8'));
  await initializeNetwork(config);
  if (!LOCAL_NODES.length) throw new Error('ZERONYTH_NODES selects no validators');
  for (const i of LOCAL_NODES) {
    const data = path.join(root, `node-data/node${i}`);
    const args = [
      '--profile=ENTERPRISE', `--genesis-file=${process.env.ZERONYTH_GENESIS_FILE ? path.resolve(root, process.env.ZERONYTH_GENESIS_FILE) : path.join(root, 'config/genesis.json')}`,
      `--data-path=${data}`, `--node-private-key-file=${path.join(data, 'key')}`,
      '--network-id=9127', '--sync-mode=FULL', '--data-storage-format=FOREST',
      '--p2p-host=127.0.0.1', '--p2p-interface=127.0.0.1', `--p2p-port=${P2P_BASE + i}`,
      '--discovery-enabled=false', '--nat-method=NONE',
      `--tx-pool-max-size=${TXPOOL_MAX}`, `--tx-pool-limit-by-account-percentage=${TXPOOL_ACCOUNT_PCT}`,
      `--static-nodes-file=${path.join(data, 'static-nodes-replit.json')}`, `--min-gas-price=${/^\d{1,24}$/.test(process.env.ZERONYTH_MIN_GAS_PRICE || '') ? process.env.ZERONYTH_MIN_GAS_PRICE : '0'}`,
    ];
    if (i === LOCAL_NODES[0]) args.push('--rpc-http-enabled=true', '--rpc-http-host=127.0.0.1',
      `--rpc-http-port=${RPC_PORT}`, `--rpc-http-api=ETH,NET,WEB3,QBFT${process.env.ZERONYTH_NODE1_ADMIN === '1' ? ',ADMIN' : ''}`, '--host-allowlist=localhost,127.0.0.1');
    // Optional, loopback-only admin RPC on validators 2-4 (QBFT voting needs a majority of validators).
    // Off by default; enable with ZERONYTH_ADMIN_RPC=1 (used by scripts/validator-vote.mjs).
    if (i !== LOCAL_NODES[0] && process.env.ZERONYTH_ADMIN_RPC === '1') args.push('--rpc-http-enabled=true',
      '--rpc-http-host=127.0.0.1', `--rpc-http-port=${ADMIN_BASE + i}`, `--rpc-http-api=ETH,NET,QBFT${i === 2 ? ',DEBUG,TRACE' : ''}`,
      '--host-allowlist=localhost,127.0.0.1');
    start(`node${i}`, besu, args, javaEnv);
  }
  log(`Waiting for validators ${LOCAL_NODES.join(',')} to connect and produce blocks…`);
  let first, height, peers, ready = false;
  for (let attempt = 0; attempt < 90 && !stopping; attempt++) {
    try {
      height = parseInt(await rpc('eth_blockNumber'), 16);
      peers = parseInt(await rpc('net_peerCount'), 16);
      first ??= height;
      if (height > first && peers >= MIN_PEERS && await rpc('eth_chainId') === '0x23a7') {
        ready = true; break;
      }
    } catch { /* Java is still starting; readiness is bounded below. */ }
    await delay(1000);
  }
  if (!ready && REQUIRE_LIVE) throw new Error('Validators did not establish a live quorum within 90 seconds. Inspect the native node logs.');
  if (!ready) log('No live quorum yet (remote validators unreachable?); continuing — Besu keeps retrying static peers.');
  if (process.env.ZERONYTH_FAUCET !== '0') start('faucet', process.execPath, ['--env-file=.env', 'faucet/server.mjs'], {
    ...process.env, PORT: process.env.ZERONYTH_FAUCET_PORT || '8787', LISTEN_HOST: '127.0.0.1', RPC_URL: `http://127.0.0.1:${RPC_PORT}`,
    // Public faucet policy: 10 ZNYT, one claim per address AND per client IP every 24 h, persisted across restarts.
    // Set here (process env beats --env-file), so .env is untouched; override with ZERONYTH_FAUCET_* if needed.
    FAUCET_DRIP_ZNYT: process.env.ZERONYTH_FAUCET_DRIP_ZNYT || '10',
    FAUCET_COOLDOWN_MS: process.env.ZERONYTH_FAUCET_COOLDOWN_MS || '86400000',
    FAUCET_IP_COOLDOWN_MS: process.env.ZERONYTH_FAUCET_IP_COOLDOWN_MS || process.env.ZERONYTH_FAUCET_COOLDOWN_MS || '86400000',
    // Global budget: at most 500 claims (5,000 ZNYT) per day in total, reset 09:00 JST (00:00 UTC).
    FAUCET_GLOBAL_DAILY: process.env.ZERONYTH_FAUCET_GLOBAL_DAILY || '500',
    FAUCET_STATE_FILE: process.env.ZERONYTH_FAUCET_STATE_FILE || `${root}.faucet-state/claims.json`,
  });
  if (process.env.ZERONYTH_SIGNAL !== '0') start('p2p-signal', process.execPath, ['p2p-signal/server.mjs'], {
    ...process.env, PORT: process.env.ZERONYTH_SIGNAL_PORT || '8788', LISTEN_HOST: '127.0.0.1',
  });
  // Post-quantum (ML-DSA-65) finality attestations over every ECDSA-sealed block. Optional:
  // a failure never stops the validators. Disable with ZERONYTH_PQ_FINALITY=0.
  if (process.env.ZERONYTH_PQ_FINALITY !== '0') start('pq-finality', process.execPath, ['scripts/pq-finality.mjs'], {
    PATH: process.env.PATH, HOME: process.env.HOME, PORT: process.env.ZERONYTH_PQ_PORT || '8799', LISTEN_HOST: '127.0.0.1',
    RPC_URL: `http://127.0.0.1:${RPC_PORT}/`, NODE_OPTIONS: '--max-old-space-size=96',
  }, { required: false });
  // Isolated, worthless swap sandbox. Its failure must never stop the preserved
  // Chain 9127 validators; it owns only its Chain 29129 files and ports.
  const swapLabEnv = Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'NIX_LD_LIBRARY_PATH', 'NIX_LD', 'LD_LIBRARY_PATH']
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]]),
  );
  if (process.env.ZERONYTH_SWAPLAB !== '0') start('swap-lab', process.execPath, ['experiments/swap-lab/server.mjs'], {
    ...swapLabEnv, JAVA_HOME: javaHome, ZERONYTH_JAVA_HOME: javaHome,
    JAVA_OPTS: '-Xms32m -Xmx192m -XX:ActiveProcessorCount=1',
  }, { required: false });
  server = createGateway(path.join(root, 'dashboard'));
  server.on('error', (error) => { log(error.message); void shutdown(1); });
  server.listen(port, process.env.ZERONYTH_LISTEN_HOST || '0.0.0.0', () => {
    log(`Local testnet ready: chainId=9127, height=${height}, peers=${peers}, validators=4.`);
    log(`Original explorer is serving on the workflow port ${port}. No public chain has been deployed.`);
  });
} catch (error) {
  log(`Startup failed: ${error.message}`);
  await shutdown(1);
}
