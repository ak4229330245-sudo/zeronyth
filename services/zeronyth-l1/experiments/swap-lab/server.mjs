import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { chmod, copyFile, mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '../..');
const workspace = path.resolve(appRoot, '../..');
const dataRoot = path.join(workspace, 'generated-artifacts/swap-lab');
const stateDir = path.join(dataRoot, 'state');
const generatedRoot = path.join(stateDir, 'networkFiles');
const genesisPath = path.join(stateDir, 'genesis.json');
const dataPath = path.join(stateDir, 'database');
const ownerPath = path.join(stateDir, 'deployer.json');
const deploymentPath = path.join(stateDir, 'deployment.json');
const compiledPath = path.join(stateDir, 'compiled-contracts.json');
const publicPath = path.join(appRoot, 'dashboard/assets/swap-lab-deployment.json');
const logPath = path.join(workspace, 'generated-artifacts/zeronyth-logs/swap-lab.log');
const besuPath = path.join(workspace, 'generated-artifacts/runtime/besu-26.9.0/bin/besu');
const javaHome = process.env.ZERONYTH_JAVA_HOME || path.join(workspace, 'generated-artifacts/runtime/jdk-25.0.5+8-jre');
const CHAIN_ID = 29129;
const RPC_PORT = 8547;
const PORT = 8789;
const rpcUrl = `http://127.0.0.1:${RPC_PORT}/`;
let besu, httpServer, stopping = false, contractArtifact, owner, provider;

const requireFromFaucet = createRequire(path.join(appRoot, 'faucet/package.json'));
const { Wallet, JsonRpcProvider, ContractFactory } = requireFromFaucet('ethers');

function log(message) { process.stdout.write(`[SWAP-LAB] ${message}\n`); }
function privateMode(file) {
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0 || stat.nlink !== 1) {
    throw new Error('Private swap-lab file permission check failed');
  }
}

async function ensurePrivateDirectory(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
  }
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory() ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
      (stat.mode & 0o077) !== 0) {
    throw new Error('Swap-lab data directory must be owner-only and not a symlink');
  }
}

async function compile() {
  const source = await readFile(path.join(scriptDir, 'SwapLab.sol'), 'utf8');
  const sourceSha256 = createHash('sha256').update(source).digest('hex');
  const input = JSON.stringify({
    language: 'Solidity',
    sources: { 'SwapLab.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers'] } },
    },
  });
  const result = spawnSync('solc', ['--standard-json'], {
    input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, SOLC_MAX_THREADS: '1' },
  });
  if (result.error || result.status !== 0) throw new Error('Solidity compiler failed');
  const start = result.stdout.indexOf('{');
  if (start < 0) throw new Error('Solidity compiler returned invalid output');
  const output = JSON.parse(result.stdout.slice(start));
  const errors = (output.errors || []).filter((item) => item.severity === 'error');
  if (errors.length || !output.contracts?.['SwapLab.sol']) {
    throw new Error(`Solidity compile errors (${errors.length}); see isolated swap-lab log`);
  }
  const contracts = Object.fromEntries(
    Object.entries(output.contracts['SwapLab.sol']).map(([name, item]) => [name, {
      abi: item.abi, bytecode: `0x${item.evm.bytecode.object}`, methods: item.evm.methodIdentifiers,
    }]),
  );
  await writeFile(compiledPath, JSON.stringify({ sourceSha256, contracts }), { mode: 0o600, flag: 'wx' }).catch(async (error) => {
    if (error.code !== 'EEXIST') throw error;
    privateMode(compiledPath);
    const existing = JSON.parse(await readFile(compiledPath, 'utf8'));
    if (existing.sourceSha256 !== sourceSha256 ||
        Object.keys(existing.contracts || {}).join(',') !== Object.keys(contracts).join(',')) {
      throw new Error('Existing compiler artifact mismatch');
    }
  });
  privateMode(compiledPath);
  return contracts;
}

async function writeNew(file, data, mode = 0o600) {
  const handle = await open(file, 'wx', mode);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  await chmod(file, mode);
}

async function initialize() {
  if (!existsSync(besuPath) || !existsSync(path.join(javaHome, 'bin/java'))) {
    throw new Error('Isolated Besu/Java runtime unavailable');
  }
  if (existsSync(stateDir) && (lstatSync(stateDir).isSymbolicLink() || !lstatSync(stateDir).isDirectory())) {
    throw new Error('Swap-lab state path is not a private directory');
  }
  if (!existsSync(stateDir)) {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await chmod(stateDir, 0o700);
  }
  if ((lstatSync(stateDir).mode & 0o077) !== 0) throw new Error('Swap-lab state directory must be owner-only');

  const hasChainState = existsSync(genesisPath) || existsSync(ownerPath) ||
    existsSync(path.join(generatedRoot, 'keys')) || existsSync(dataPath);
  const complete = existsSync(genesisPath) && existsSync(ownerPath) &&
    existsSync(path.join(generatedRoot, 'genesis.json')) &&
    existsSync(path.join(generatedRoot, 'keys', '0', 'key')) && existsSync(dataPath);
  if (hasChainState && !complete) {
    throw new Error('Partial isolated swap-lab state found; preserving it without reset');
  }
  if (complete) {
    privateMode(ownerPath);
    owner = new Wallet(JSON.parse(await readFile(ownerPath, 'utf8')).privateKey);
    const genesis = JSON.parse(await readFile(genesisPath, 'utf8'));
    if (genesis.config?.chainId !== CHAIN_ID) throw new Error('Swap-lab genesis Chain ID mismatch');
    if (!existsSync(deploymentPath)) throw new Error('Swap-lab deployment record missing; refusing redeploy');
    privateMode(deploymentPath);
  } else {
    owner = Wallet.createRandom();
    await writeNew(ownerPath, JSON.stringify({ privateKey: owner.privateKey }) + '\n');
    const config = {
      genesis: {
        config: {
          chainId: CHAIN_ID, berlinBlock: 0, londonBlock: 0, shanghaiTime: 0,
          zeroBaseFee: true, qbft: { blockperiodseconds: 1, epochlength: 30000, requesttimeoutseconds: 4 },
        },
        nonce: '0x0', timestamp: '0x0', gasLimit: '0x1c9c380', difficulty: '0x1',
        mixHash: '0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365',
        coinbase: '0x0000000000000000000000000000000000000000',
        alloc: { [owner.address.toLowerCase()]: { balance: `0x${(1000n * 10n ** 18n).toString(16)}` } },
      },
      blockchain: { nodes: { generate: true, count: 1 } },
    };
    const configPath = path.join(stateDir, 'qbft-config.json');
    await writeNew(configPath, JSON.stringify(config, null, 2));
    const result = spawnSync(besuPath, ['operator', 'generate-blockchain-config',
      `--config-file=${configPath}`, `--to=${generatedRoot}`, '--private-key-file-name=key'],
    { encoding: 'utf8', env: { ...process.env, JAVA_HOME: javaHome, JAVA_OPTS: '-Xms32m -Xmx192m -XX:ActiveProcessorCount=1' }, maxBuffer: 2 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error('Isolated QBFT genesis generation failed; state preserved');
    const keysDir = path.join(generatedRoot, 'keys');
    const keyDirs = await readdir(keysDir);
    if (keyDirs.length !== 1 || !existsSync(path.join(keysDir, keyDirs[0], 'key'))) {
      throw new Error('Expected one isolated validator; state preserved');
    }
    await copyFile(path.join(generatedRoot, 'genesis.json'), genesisPath);
    await writeNew(path.join(stateDir, 'validator.key'), await readFile(path.join(keysDir, keyDirs[0], 'key')));
    await mkdir(dataPath, { mode: 0o700 });
    await chmod(path.join(stateDir, 'validator.key'), 0o600);
    await chmod(dataPath, 0o700);
    for (const dir of [generatedRoot, keysDir, path.join(keysDir, keyDirs[0])]) await chmod(dir, 0o700);
    for (const name of await readdir(path.join(keysDir, keyDirs[0]))) {
      const file = path.join(keysDir, keyDirs[0], name);
      if (lstatSync(file).isFile()) await chmod(file, 0o600);
    }
    for (const file of [genesisPath, configPath]) await chmod(file, 0o600);
  }
}

function rpc(method, params = []) {
  return fetch(rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(3000),
  }).then(async (response) => {
    const result = await response.json();
    if (!response.ok || result.error) throw new Error('Local swap-lab RPC failed');
    return result.result;
  });
}

async function waitForChain() {
  for (let i = 0; i < 90 && !stopping; i++) {
    try {
      const chainId = Number(BigInt(await rpc('eth_chainId')));
      if (chainId === CHAIN_ID) {
        await rpc('eth_blockNumber');
        return;
      }
    } catch { /* bounded local startup retry */ }
    await delay(1000);
  }
  throw new Error('Isolated swap-lab RPC did not become ready');
}

async function deploy() {
  const record = JSON.parse(await readFile(deploymentPath, 'utf8'));
  const bytecode = contractArtifact;
  const addresses = record.addresses;
  for (const address of Object.values(addresses)) {
    if (!/^0x[0-9a-f]{40}$/i.test(address) || await rpc('eth_getCode', [address, 'latest']) === '0x') {
      throw new Error('Recorded swap-lab contract code is missing; refusing redeploy');
    }
  }
  if (record.chainId !== CHAIN_ID || !record.methods || !record.fee) throw new Error('Swap-lab deployment record is invalid');
  const publicRecord = {
    chainId: CHAIN_ID,
    chainHex: `0x${CHAIN_ID.toString(16)}`,
    rpcPath: '/rpc?network=swap-lab',
    tokens: [
      { symbol: 'TestA', name: 'ZERONYTH Test Token A', address: addresses.tokenA, decimals: 18, claimable: true },
      { symbol: 'TestB', name: 'ZERONYTH Test Token B', address: addresses.tokenB, decimals: 18, claimable: true },
    ],
    pair: addresses.pair,
    router: addresses.router,
    feeBps: 30,
    methods: record.methods,
    lp: { symbol: 'ZLP', decimals: 18 },
    disclaimer: 'Valueless experimental assets; unaudited. Not Chain 9127. No production or investment use.',
  };
  const serialized = JSON.stringify(publicRecord, null, 2) + '\n';
  if (existsSync(publicPath)) {
    const prior = await readFile(publicPath, 'utf8');
    if (prior !== serialized) throw new Error('Public swap-lab addresses differ from private deployment record; refusing overwrite');
  } else {
    await writeNew(publicPath, serialized, 0o644);
  }
}

async function ensureDeployed(compiled) {
  if (existsSync(deploymentPath)) {
    await deploy();
    return;
  }
  const height = Number(BigInt(await rpc('eth_blockNumber')));
  if (height > 2) throw new Error('Swap-lab chain has blocks but no deployment record; refusing redeploy');
  const signer = owner.connect(new JsonRpcProvider(rpcUrl, CHAIN_ID, { staticNetwork: true }));
  const deployContract = async (name, args = []) => {
    const artifact = compiled[name];
    if (!artifact?.abi || !artifact.bytecode || artifact.bytecode === '0x') throw new Error(`Missing compiled ${name}`);
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
    const instance = await factory.deploy(...args, { gasPrice: 0n });
    await instance.waitForDeployment();
    return instance;
  };
  const tokenA = await deployContract('SwapTestToken', ['ZERONYTH Test Token A', 'TestA']);
  const tokenB = await deployContract('SwapTestToken', ['ZERONYTH Test Token B', 'TestB']);
  const pair = await deployContract('SwapLabPair', [tokenA.target, tokenB.target]);
  const router = await deployContract('SwapLabRouter', [tokenA.target, tokenB.target, pair.target]);
  await (await pair.setRouter(router.target, { gasPrice: 0n })).wait();
  const methods = Object.fromEntries(
    ['SwapTestToken', 'SwapLabPair', 'SwapLabRouter'].map((name) => [name, compiled[name].methods]),
  );
  const record = {
    chainId: CHAIN_ID,
    addresses: { tokenA: tokenA.target, tokenB: tokenB.target, pair: pair.target, router: router.target },
    deployerAddress: owner.address,
    methods,
    fee: { numerator: 3, denominator: 1000 },
  };
  await writeNew(deploymentPath, JSON.stringify(record, null, 2) + '\n');
  provider = signer.provider;
  await deploy();
  await provider.destroy();
}

async function health(_req, res) {
  try {
    const [chainId, blockNumber, peers] = await Promise.all([
      rpc('eth_chainId'), rpc('eth_blockNumber'), rpc('net_peerCount'),
    ]);
    const record = JSON.parse(await readFile(publicPath, 'utf8'));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ready: true, chainId: Number(BigInt(chainId)), blockNumber: Number(BigInt(blockNumber)),
      peers: Number(BigInt(peers)), deployment: record }));
  } catch {
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ready: false, message: 'Swap-lab is initializing or unavailable. No Chain 9127 RPC is used.' }));
  }
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  httpServer?.close();
  if (besu && besu.exitCode === null) besu.kill('SIGTERM');
  if (besu && besu.exitCode === null) {
    await Promise.race([new Promise((resolve) => besu.once('exit', resolve)), delay(10_000)]);
    if (besu.exitCode === null) besu.kill('SIGKILL');
  }
  log('Isolated swap-lab stopped; private state retained.');
  process.exit(code);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

try {
  await mkdir(path.dirname(logPath), { recursive: true });
  const logHandle = await open(logPath, 'a', 0o600);
  await chmod(logPath, 0o600);
  process.stdout.write = (text) => { logHandle.write(text); return true; };
  process.stderr.write = (text) => { logHandle.write(text); return true; };
  await ensurePrivateDirectory(dataRoot);
  await ensurePrivateDirectory(stateDir);
  contractArtifact = await compile();
  await initialize();
  const nodeKeyPath = existsSync(path.join(generatedRoot, 'keys', '0', 'key'))
    ? path.join(generatedRoot, 'keys', '0', 'key') : path.join(stateDir, 'validator.key');
  privateMode(ownerPath);
  const env = { ...process.env, JAVA_HOME: javaHome, JAVA_OPTS: '-Xms32m -Xmx192m -XX:ActiveProcessorCount=1' };
  const args = [
    '--profile=ENTERPRISE', `--genesis-file=${genesisPath}`, `--data-path=${dataPath}`,
    `--node-private-key-file=${nodeKeyPath}`, `--network-id=${CHAIN_ID}`, '--sync-mode=FULL',
    '--data-storage-format=FOREST', '--p2p-host=127.0.0.1', '--p2p-interface=127.0.0.1',
    '--p2p-port=30329', '--discovery-enabled=false', '--nat-method=NONE',
    '--rpc-http-enabled=true', '--rpc-http-host=127.0.0.1', `--rpc-http-port=${RPC_PORT}`,
    '--rpc-http-api=ETH,NET,WEB3,QBFT', '--rpc-http-cors-origins=all',
    '--host-allowlist=localhost,127.0.0.1', '--min-gas-price=0',
  ];
  besu = spawn(besuPath, args, { cwd: appRoot, env, stdio: ['ignore', 'ignore', 'ignore'] });
  besu.on('exit', (code) => { if (!stopping) { log(`Isolated Besu exited (${code ?? 'signal'}); existing chain was not altered by this process.`); void shutdown(1); } });
  await waitForChain();
  await ensureDeployed(contractArtifact);
  httpServer = createServer((req, res) => {
    if (req.method !== 'GET' || new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`).pathname !== '/health') {
      res.writeHead(404); return res.end();
    }
    void health(req, res);
  });
  httpServer.requestTimeout = 3000;
  httpServer.listen(PORT, '127.0.0.1', () => log(`Ready: isolated chain=${CHAIN_ID}, RPC=loopback:${RPC_PORT}, one local validator.`));
  httpServer.on('error', () => { log('Status service failed to bind; isolated DEX unavailable.'); void shutdown(1); });
} catch (error) {
  log(`Isolated swap-lab startup failed: ${error.message}`);
  await shutdown(1);
}
