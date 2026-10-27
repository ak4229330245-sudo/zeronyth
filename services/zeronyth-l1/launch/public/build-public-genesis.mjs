// Builds a PUBLIC ZERONYTH genesis from public-genesis.config.json (approved tokenomics, total exactly 100,000,000 ZNYT).
// - EmissionPool (30M) and DevVesting (13M) are PREDEPLOYED in genesis: runtime code with immutables patched in,
//   so the funds are locked from block 0 (no admin withdrawal exists in either contract).
// - EmissionPool.beneficiary = CREATE address of opsDeployer at nonce 0 (the ZnytEconomy deployment), starter = opsDeployer.
// - No Hardhat/Anvil dev account anywhere. Refuses to build while any 0xREPLACE_ placeholder remains (unless --test).
// Usage: node build-public-genesis.mjs [--config file] [--out dir] [--test]
//   --test: fills placeholders with throwaway addresses from test-keys.json (generated, 0600) for a box rehearsal only.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const l1 = path.resolve(here, '../..');
const req = createRequire(path.join(l1, 'economy/package.json'));
const solc = req('solc'); const { ethers } = req('ethers');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TEST = process.argv.includes('--test');
const cfg = JSON.parse(readFileSync(arg('--config', path.join(here, 'public-genesis.config.json')), 'utf8'));
const outDir = arg('--out', path.join(here, TEST ? 'out-test' : 'out')); mkdirSync(outDir, { recursive: true });

// ---------- addresses ----------
let A = { ...cfg.addresses }, V = [...cfg.validators];
if (TEST) {
  const kf = path.join(outDir, 'test-keys.json'); // throwaway rehearsal keys (0600). Never used for a real launch.
  const keys = existsSync(kf) ? JSON.parse(readFileSync(kf, 'utf8')) : {};
  const w = (n) => (keys[n] ??= ethers.Wallet.createRandom().privateKey);
  for (const k of Object.keys(A)) A[k] = new ethers.Wallet(w(k)).address;
  V = (cfg.validators).map((_, i) => new ethers.Wallet(w(`validator${i + 1}`)).address);
  writeFileSync(kf, JSON.stringify(keys), { mode: 0o600 }); chmodSync(kf, 0o600);
}
const bad = [...Object.entries(A), ...V.map((v, i) => [`validator${i + 1}`, v])].filter(([, v]) => !ethers.isAddress(String(v).split(' ')[0]));
if (bad.length) { console.error('Replace these placeholders first:\n  ' + bad.map(([k, v]) => `${k}: ${v}`).join('\n  ')); process.exit(2); }
const HARDHAT0 = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
if ([...Object.values(A), ...V].some((a) => a.toLowerCase() === HARDHAT0)) { console.error('Public Hardhat dev account is not allowed'); process.exit(2); }
if (new Set([...Object.values(A), ...V].map((a) => a.toLowerCase())).size !== Object.keys(A).length + V.length) { console.error('Addresses must be distinct'); process.exit(2); }

// ---------- amounts ----------
const Z = (s) => ethers.parseEther(String(s)); const al = cfg.allocationZnyt;
const total = Object.values(al).reduce((s, v) => s + Z(v), 0n);
if (total !== Z(cfg.totalSupplyZnyt)) { console.error(`Allocation sums to ${ethers.formatEther(total)}, expected ${cfg.totalSupplyZnyt}`); process.exit(2); }
const lt = arg('--launch-time', cfg.launchTime); if (lt === 'now') cfg.launchTime = new Date().toISOString(); else cfg.launchTime = lt;
const launchTs = Math.floor(new Date(cfg.launchTime).getTime() / 1000);

// ---------- compile runtime code with immutable references ----------
const src = (f) => ({ content: readFileSync(path.join(l1, 'economy/contracts', f), 'utf8') });
const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'EmissionPool.sol': src('EmissionPool.sol'), 'DevVesting.sol': src('DevVesting.sol') },
  settings: { evmVersion: 'shanghai', viaIR: true, optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'storageLayout'] } } } })));
if ((out.errors || []).some((e) => e.severity === 'error')) { console.error(out.errors); process.exit(1); }
function runtime(file, name, values) {
  const c = out.contracts[file][name]; let code = c.evm.deployedBytecode.object;
  const refs = c.evm.deployedBytecode.immutableReferences;
  // map AST id -> variable name via the ABI-public getters: resolve by scanning the source AST is heavy; use name order from storage-free immutables
  const ids = Object.keys(refs);
  if (ids.length !== Object.keys(values).length) throw new Error(`${name}: expected ${Object.keys(values).length} immutables, got ${ids.length}`);
  return { c, code, refs };
}
// Resolve immutable AST ids -> names through the compiler AST.
const ast = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'EmissionPool.sol': src('EmissionPool.sol'), 'DevVesting.sol': src('DevVesting.sol') },
  settings: { evmVersion: 'shanghai', viaIR: true, optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '': ['ast'] } } } }))).sources;
const idName = {};
(function walk(n) { if (!n || typeof n !== 'object') return; if (n.nodeType === 'VariableDeclaration' && n.mutability === 'immutable') idName[n.id] = n.name; for (const v of Object.values(n)) if (typeof v === 'object') walk(v); })(ast);
function patched(file, name, values) {
  const { c, refs } = runtime(file, name, values); let code = c.evm.deployedBytecode.object;
  for (const [id, locs] of Object.entries(refs)) {
    const n = idName[id]; if (!(n in values)) throw new Error(`${name}: no value for immutable ${n}`);
    const word = ethers.zeroPadValue(ethers.toBeHex(values[n]), 32).slice(2);
    for (const { start, length } of locs) { if (length !== 32) throw new Error('unexpected immutable length'); code = code.slice(0, start * 2) + word + code.slice((start + length) * 2); }
  }
  if (/__\$/.test(code)) throw new Error('unlinked library');
  return '0x' + code;
}
const economyAddr = ethers.getCreateAddress({ from: A.opsDeployer, nonce: 0 });
const POOL = '0x000000000000000000000000000000000000E001', VEST = '0x000000000000000000000000000000000000E002';
const poolCode = patched('EmissionPool.sol', 'EmissionPool', { annualBps: cfg.emission.annualBps, yearSeconds: cfg.emission.yearSeconds, beneficiary: economyAddr, starter: A.opsDeployer });
const vestCode = patched('DevVesting.sol', 'DevVesting', { beneficiary: A.developer, start: launchTs, cliff: cfg.vesting.cliffSeconds, linear: cfg.vesting.linearSeconds });

// ---------- QBFT extraData via the Besu CLI ----------
const runtimeDir = path.resolve(l1, '../../generated-artifacts/runtime');
const besu = path.join(runtimeDir, 'besu-26.9.0/bin/besu'); const javaHome = readdirSync(runtimeDir).find((d) => d.startsWith('jdk-'));
const vf = path.join(outDir, 'validators.json'); writeFileSync(vf, JSON.stringify(V, null, 1));
const r = spawnSync(besu, ['rlp', 'encode', `--from=${vf}`, '--type=QBFT_EXTRA_DATA'], { env: { ...process.env, JAVA_HOME: path.join(runtimeDir, javaHome), JAVA_OPTS: '-Xmx128m' }, encoding: 'utf8' });
const extraData = (r.stdout || '').trim().split('\n').pop();
if (!/^0x[0-9a-f]+$/.test(extraData)) { console.error('besu rlp encode failed', r.stderr); process.exit(1); }

// ---------- genesis ----------
const hex = (v) => '0x' + v.toString(16);
const alloc = {
  [POOL]: { balance: hex(Z(al.rewardPool_EmissionPool)), code: poolCode, comment: 'EmissionPool: 15%/yr of remaining, no withdrawal' },
  [VEST]: { balance: hex(Z(al.developer_DevVesting)), code: vestCode, comment: 'DevVesting: 1y cliff + 3y linear to developer' },
  [A.developer]: { balance: hex(Z(al.developer_unlocked)) },
  [A.grants]: { balance: hex(Z(al.grants)) },
  [A.treasury]: { balance: hex(Z(al.treasury)) },
  [A.opsDeployer]: { balance: hex(Z(al.opsDeployer_from_treasury)) },
  [A.liquidity]: { balance: hex(Z(al.liquidity)) },
  [A.earlyParticipants]: { balance: hex(Z(al.earlyParticipants)) },
  [A.faucet]: { balance: hex(Z(al.faucet_from_early)) },
};
const genesis = {
  config: { chainId: cfg.chainId, berlinBlock: 0, londonBlock: 0, shanghaiTime: 0, zeroBaseFee: true,
    qbft: { blockperiodseconds: cfg.blockPeriodSeconds, epochlength: 30000, requesttimeoutseconds: 4 } },
  nonce: '0x0', timestamp: hex(BigInt(launchTs)), gasLimit: cfg.gasLimit, difficulty: '0x1',
  mixHash: '0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365',
  coinbase: '0x0000000000000000000000000000000000000000', alloc, extraData,
};
writeFileSync(path.join(outDir, 'genesis.json'), JSON.stringify(genesis, null, 2) + '\n');
const manifest = { chainId: cfg.chainId, launchTime: cfg.launchTime, launchTs, test: TEST, emissionPool: POOL, devVesting: VEST,
  economyExpected: economyAddr, addresses: A, validators: V, totalSupplyWei: total.toString(),
  genesisHash: null, allocation: Object.fromEntries(Object.entries(al).map(([k, v]) => [k, v])) };
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`genesis written: ${path.join(outDir, 'genesis.json')}  total=${ethers.formatEther(total)} ZNYT  economy(expected)=${economyAddr}${TEST ? '  [TEST addresses]' : ''}`);
