// Box-only rehearsal of the PUBLIC genesis on isolated ports (never touches the live chain, its ports, or its keys).
// Starts 4 fresh validators (throwaway keys) + faucet + gateway, runs checks, then stops everything.
// Ports: p2p 33301-33304, RPC 11545 (loopback), faucet 11787, gateway 11780. Data: /workspace/zeronyth-public-rehearsal
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, openSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const l1 = path.resolve(here, '../..');
const { ethers } = createRequire(path.join(l1, 'economy/package.json'))('ethers');
const DATA = '/workspace/zeronyth-public-rehearsal'; const RPC = 'http://127.0.0.1:11545';
const KEEP = process.argv.includes('--keep');
const results = []; const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
function stopAll() { for (const p of procs) try { p.kill('SIGTERM'); } catch {} }
process.on('exit', stopAll);

rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true });
let r = spawnSync(process.execPath, [path.join(here, 'build-public-genesis.mjs'), '--test', '--launch-time', 'now'], { encoding: 'utf8' });
if (r.status) { console.error(r.stderr); process.exit(1); }
const g = JSON.parse(readFileSync(path.join(here, 'out-test/genesis.json'), 'utf8'));
const m = JSON.parse(readFileSync(path.join(here, 'out-test/manifest.json'), 'utf8'));
const keys = JSON.parse(readFileSync(path.join(here, 'out-test/test-keys.json'), 'utf8'));
ok('genesis has no Hardhat account', !Object.keys(g.alloc).some((a) => a.toLowerCase() === '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'));
ok('genesis alloc sums to 100,000,000 ZNYT', Object.values(g.alloc).reduce((s, a) => s + BigInt(a.balance), 0n) === ethers.parseEther('100000000'));

const runtime = path.resolve(l1, '../../generated-artifacts/runtime');
const besu = path.join(runtime, 'besu-26.9.0/bin/besu'); const JAVA_HOME = path.join(runtime, readdirSync(runtime).find((d) => d.startsWith('jdk-')));
const enodes = [1, 2, 3, 4].map((i) => `enode://${new ethers.SigningKey(keys[`validator${i}`]).publicKey.slice(4)}@127.0.0.1:${33300 + i}`);
for (const i of [1, 2, 3, 4]) {
  const d = path.join(DATA, `node${i}`); mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'key'), keys[`validator${i}`].slice(2), { mode: 0o600 });
  writeFileSync(path.join(d, 'static-nodes.json'), JSON.stringify(enodes.filter((_, j) => j !== i - 1)));
  const args = ['--profile=ENTERPRISE', `--genesis-file=${path.join(here, 'out-test/genesis.json')}`, `--data-path=${d}`,
    `--node-private-key-file=${path.join(d, 'key')}`, `--network-id=${m.chainId}`, '--sync-mode=FULL', '--data-storage-format=FOREST',
    '--p2p-host=127.0.0.1', '--p2p-interface=127.0.0.1', `--p2p-port=${33300 + i}`, '--discovery-enabled=false', '--nat-method=NONE',
    `--static-nodes-file=${path.join(d, 'static-nodes.json')}`, '--min-gas-price=1000000000', '--metrics-enabled=false'];
  if (i === 1) args.push('--rpc-http-enabled=true', '--rpc-http-host=127.0.0.1', '--rpc-http-port=11545', '--rpc-http-api=ETH,NET,WEB3,QBFT,DEBUG', '--host-allowlist=localhost,127.0.0.1');
  const log = openSync(path.join(DATA, `node${i}.log`), 'a');
  procs.push(spawn('/usr/bin/nice', ['-n', '15', besu, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, JAVA_HOME, JAVA_OPTS: '-Xms64m -Xmx320m -XX:+UseSerialGC -XX:ActiveProcessorCount=1' }, stdio: ['ignore', log, log] }));
}
const provider = new ethers.JsonRpcProvider(RPC, m.chainId, { staticNetwork: true });
let h = 0; for (let t = 0; t < 120; t++) { try { h = await provider.getBlockNumber(); if (h >= 3) break; } catch {} await sleep(1000); }
ok('4 fresh validators produce blocks', h >= 3, `height=${h}`);
const vals = await provider.send('qbft_getValidatorsByBlockNumber', ['latest']).catch(() => []);
ok('validator set = genesis validators', JSON.stringify(vals.map((v) => v.toLowerCase()).sort()) === JSON.stringify(m.validators.map((v) => v.toLowerCase()).sort()), `${vals.length} validators`);
ok('chainId', (await provider.send('eth_chainId', [])) === '0x' + m.chainId.toString(16), m.chainId);
const bal = async (a) => ethers.formatEther(await provider.getBalance(a));
for (const [k, want] of [['developer', '2000000.0'], ['grants', '20000000.0'], ['treasury', '14999000.0'], ['liquidity', '10000000.0'], ['earlyParticipants', '9900000.0'], ['faucet', '100000.0'], ['opsDeployer', '1000.0']])
  ok(`balance ${k}`, (await bal(m.addresses[k])) === want, await bal(m.addresses[k]));
const P = JSON.parse(readFileSync(path.join(l1, 'economy/build/EmissionPool.json'), 'utf8')).abi;
const D = JSON.parse(readFileSync(path.join(l1, 'economy/build/DevVesting.json'), 'utf8')).abi;
const pool = new ethers.Contract(m.emissionPool, P, provider); const vest = new ethers.Contract(m.devVesting, D, provider);
ok('EmissionPool holds 30M, immutables patched', (await bal(m.emissionPool)) === '30000000.0' && (await pool.beneficiary()) === m.economyExpected && (await pool.starter()) === m.addresses.opsDeployer && Number(await pool.annualBps()) === 1500 && Number(await pool.yearSeconds()) === 31536000);
ok('DevVesting holds 13M, 1y cliff + 3y linear to developer', (await bal(m.devVesting)) === '13000000.0' && (await vest.beneficiary()) === m.addresses.developer && Number(await vest.start()) === m.launchTs && Number(await vest.cliff()) === 31536000 && Number(await vest.linear()) === 94608000);
ok('DevVesting nothing releasable before cliff', (await vest.releasable()) === 0n && (await vest.vestedAt(m.launchTs + 31536000 + 47304000)) === ethers.parseEther('6500000'), 'half vested at cliff+1.5y = 6.5M');
// stranger cannot start the pool
const stranger = new ethers.Wallet(keys.grants, provider);
let refused = false; try { await (await pool.connect(stranger).start({ gasPrice: 1_000_000_000n, gasLimit: 200_000n })).wait(); } catch { refused = true; }
ok('only opsDeployer can start the pool', refused);
r = spawnSync(process.execPath, [path.join(here, 'launch-deploy.mjs'), '--test'], { encoding: 'utf8', env: { ...process.env, RPC_URL: RPC } });
console.log(r.stdout.trim()); if (r.status) console.error(r.stderr);
ok('launch-deploy: economy at expected CREATE address, pool started', r.status === 0 && Number(await pool.startTime()) > 0);
ok('daily emission ≈ 12,328.77 ZNYT', Math.abs(Number(ethers.formatEther(await pool.dailyEmission())) - 12328.767) < 0.01, ethers.formatEther(await pool.dailyEmission()));
// zero-fee chain? fees go to the block proposer; total supply must stay 100M
const total = (await Promise.all([...Object.keys(g.alloc), ...m.validators, m.economyExpected].map((a) => provider.getBalance(a)))).reduce((s, b) => s + b, 0n);
ok('supply conserved (100M) after launch txs', total === ethers.parseEther('100000000'), ethers.formatEther(total));

// faucet + gateway with abuse protection
const fState = path.join(DATA, 'faucet-state.json');
const fenv = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '11787', LISTEN_HOST: '127.0.0.1', RPC_URL: RPC, FAUCET_PRIVATE_KEY: keys.faucet, FAUCET_ADDRESS: m.addresses.faucet,
  FAUCET_DRIP_ZNYT: '1', FAUCET_COOLDOWN_MS: '1000', FAUCET_GAS_PRICE_WEI: '1000000000', CHAIN_ID: String(m.chainId),
  FAUCET_ADDR_DAILY: '1', FAUCET_IP_DAILY: '3', FAUCET_GLOBAL_DAILY: '5', FAUCET_SKIP_IF_FUNDED: '1', FAUCET_STATE_FILE: fState };
procs.push(spawn(process.execPath, [path.join(l1, 'faucet/server.mjs')], { env: fenv, stdio: ['ignore', openSync(path.join(DATA, 'faucet.log'), 'a'), openSync(path.join(DATA, 'faucet.log'), 'a')] }));
const gwJs = path.join(DATA, 'gw.mjs');
writeFileSync(gwJs, `import { createGateway } from ${JSON.stringify(path.join(l1, 'scripts/replit-gateway.mjs'))};\ncreateGateway(${JSON.stringify(path.join(l1, 'dashboard'))}).listen(11780, '127.0.0.1');\n`);
procs.push(spawn(process.execPath, [gwJs], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ZERONYTH_TRUST_CF: '1', ZERONYTH_RPC_PORT: '11545', ZERONYTH_FAUCET_PORT: '11787', ZERONYTH_RPC_RPS: '30' }, stdio: ['ignore', openSync(path.join(DATA, 'gw.log'), 'a'), openSync(path.join(DATA, 'gw.log'), 'a')] }));
for (let t = 0; t < 30; t++) { try { if ((await fetch('http://127.0.0.1:11787/health')).ok) break; } catch {} await sleep(500); }
const claim = async (addr, ip) => { const res = await fetch('http://127.0.0.1:11780/api/faucet/claim', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ address: addr }) }); return [res.status, (await res.json()).error || 'ok']; };
const fresh = () => ethers.Wallet.createRandom().address;
const a1 = fresh(); const seq = [];
seq.push(['first claim', await claim(a1, '203.0.113.1'), 200]);
await sleep(1500);
seq.push(['same address again (addr daily=1)', await claim(a1, '203.0.113.2'), 429]);
seq.push(['ip#1 claim 2', await claim(fresh(), '203.0.113.1'), 200]); await sleep(1100);
seq.push(['ip#1 claim 3', await claim(fresh(), '203.0.113.1'), 200]); await sleep(1100);
seq.push(['ip#1 claim 4 (ip daily=3)', await claim(fresh(), '203.0.113.1'), 429]);
seq.push(['funded address refused', await claim(m.addresses.grants, '203.0.113.9'), 409]);
seq.push(['ip#3 claim (4th success)', await claim(fresh(), '203.0.113.3'), 200]); await sleep(1100);
seq.push(['ip#4 claim (5th success)', await claim(fresh(), '203.0.113.4'), 200]); await sleep(1100);
seq.push(['ip#5 claim (global daily=5)', await claim(fresh(), '203.0.113.5'), 429]);
for (const [n, [st, e], want] of seq) ok(`faucet: ${n}`, st === want, `${st} ${e}`);
const writes = await fetch('http://127.0.0.1:11780/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendTransaction', params: [{}] }) });
ok('public /rpc refuses writes', writes.status === 403);
const st = JSON.parse(readFileSync(fState, 'utf8')); ok('faucet daily counters persisted', st.total === 5, JSON.stringify({ day: st.day, total: st.total }));
const fails = results.filter((x) => !x.pass).length;
writeFileSync(path.join(here, 'rehearsal-result.txt'), `ZERONYTH public genesis rehearsal ${new Date().toISOString()} (box, isolated ports, throwaway keys)\n` + results.map((x) => `${x.pass ? 'PASS' : 'FAIL'} ${x.name} ${x.detail}`).join('\n') + `\n${results.length - fails}/${results.length} PASS\n`);
console.log(`${results.length - fails}/${results.length} PASS`);
if (!KEEP) { stopAll(); await sleep(3000); }
process.exit(fails ? 1 : 0);
