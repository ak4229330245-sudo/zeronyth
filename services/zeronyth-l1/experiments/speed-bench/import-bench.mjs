// Single-validator QBFT chain pinned to 2 CPUs with validator-4 (VPS) JVM options, 60M gas, full blocks.
// Parses Besu "Produced #N | tx | gas in Xs | Timing(... txsSelection, blockImported)" to get per-block
// execution + import cost for full 60M blocks. Isolated: /tmp/zimp, port 9965, p2p 33399, wiped on exit.
// usage: node import-bench.mjs [cpuList=6,7]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, openSync } from 'node:fs';
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
const here = path.dirname(fileURLToPath(import.meta.url));
const { Wallet, ContractFactory, Interface, JsonRpcProvider, parseEther } = createRequire(path.join(here, '../../economy/package.json'))('ethers');
const build = JSON.parse(readFileSync(path.join(here, 'build.json'), 'utf8'));
const RT = '/workspace/zeronyth/generated-artifacts/runtime', Z = '/tmp/zimp', RUN = `${Z}/run`, PORT = 9965, GP = 1_000_000_000n;
const VPS_JVM = '-Xms64m -Xmx384m -XX:MaxMetaspaceSize=160m -XX:ReservedCodeCacheSize=64m -XX:MaxDirectMemorySize=64m -XX:+UseSerialGC -Xss512k -XX:ActiveProcessorCount=2';
const cpus = process.argv[2] || '6,7';
const mem = () => Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024;
const rpc = async (m, p = []) => { const j = await (await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json(); if (j.error) throw new Error(j.error.message); return j.result; };
rmSync(RUN, { recursive: true, force: true }); mkdirSync(RUN, { recursive: true });
const funder = Wallet.createRandom(); const g = JSON.parse(readFileSync(`${Z}/out/genesis.json`, 'utf8'));
g.alloc = { [funder.address.slice(2).toLowerCase()]: { balance: '0x' + (10n ** 30n).toString(16) } }; writeFileSync(`${RUN}/genesis.json`, JSON.stringify(g));
const keydir = path.join(Z, 'out/keys', (await import('node:fs')).readdirSync(`${Z}/out/keys`)[0]);
const logf = `${RUN}/node.log`; const fd = openSync(logf, 'a');
const p = spawn('taskset', ['-c', cpus, 'nice', '-n', '10', `${RT}/besu-26.9.0/bin/besu`, '--profile=ENTERPRISE', `--genesis-file=${RUN}/genesis.json`, `--data-path=${RUN}/d`, `--node-private-key-file=${keydir}/key`,
  '--data-storage-format=FOREST', '--p2p-port=33399', '--discovery-enabled=false', '--min-gas-price=1000000000', '--rpc-http-enabled', '--rpc-http-host=127.0.0.1', `--rpc-http-port=${PORT}`, '--rpc-http-api=ETH,NET,WEB3',
  '--host-allowlist=localhost,127.0.0.1', '--target-gas-limit=60000000', '--tx-pool-max-size=20000', '--tx-pool-limit-by-account-percentage=0.05'],
  { env: { PATH: process.env.PATH, HOME: process.env.HOME, JAVA_HOME: `${RT}/jdk-25.0.5+8-jre`, JAVA_OPTS: VPS_JVM }, stdio: ['ignore', fd, fd] });
let peakRss = 0; const rssIv = setInterval(() => { try { peakRss = Math.max(peakRss, Number(readFileSync(`/proc/${p.pid}/stat`, 'utf8').split(') ')[1].split(' ')[21]) * 4096 / 1048576); } catch {} if (mem() < 1200) { console.log('ABORT RAM'); p.kill('SIGKILL'); process.exit(2); } }, 500);
try {
  for (let k = 0; k < 90; k++) { await sleep(1000); try { if (parseInt(await rpc('eth_blockNumber'), 16) >= 2) break; } catch {} }
  const prov = new JsonRpcProvider(`http://127.0.0.1:${PORT}/`, 9127, { staticNetwork: true, pollingInterval: 100 }); const f = funder.connect(prov);
  const S = Array.from({ length: 60 }, () => Wallet.createRandom()); let n = 0;
  const fund = await Promise.all(S.map((w) => f.sendTransaction({ to: w.address, value: parseEther('1000'), gasPrice: GP, gasLimit: 21000n, nonce: n++ })));
  const tok = await new ContractFactory(build.BenchToken.abi, build.BenchToken.bytecode, f).deploy({ gasPrice: GP, nonce: n++ });
  const pool = await new ContractFactory(build.BenchPool.abi, build.BenchPool.bytecode, f).deploy({ gasPrice: GP, nonce: n++ });
  await Promise.all(fund.map((t) => t.wait())); await tok.waitForDeployment(); await pool.waitForDeployment();
  const addrs = S.map((w) => w.address);
  await (await tok.mint(addrs, 10n ** 24n, { gasPrice: GP, nonce: n++ })).wait(); await (await pool.seed(addrs, 10n ** 22n, { gasPrice: GP, nonce: n++ })).wait();
  const gl = parseInt((await rpc('eth_getBlockByNumber', ['latest', false])).gasLimit, 16); console.log('gasLimit (genesis 60M)', gl);
  const iT = new Interface(build.BenchToken.abi), iP = new Interface(build.BenchPool.abi); const nonces = addrs.map(() => 0);
  async function phase(kind, total) {
    const raws = []; for (let i = 0; i < total; i++) { const k = i % S.length; const tx = kind === 'transfer' ? { to: addrs[(k + 1) % S.length], value: 1n, gasLimit: 21000n }
      : kind === 'erc20' ? { to: await tok.getAddress(), data: iT.encodeFunctionData('transfer', [Wallet.createRandom().address, 1n]), gasLimit: 80000n }
      : { to: await pool.getAddress(), data: iP.encodeFunctionData('swap', [10n ** 15n, i % 2 === 0]), gasLimit: 120000n };
      raws.push(await S[k].signTransaction({ type: 0, gasPrice: GP, chainId: 9127n, nonce: nonces[k]++, ...tx })); }
    const h0 = parseInt(await rpc('eth_blockNumber'), 16);
    for (let i = 0; i < raws.length; i += 200) await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(raws.slice(i, i + 200).map((r, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_sendRawTransaction', params: [r] }))) });
    const last = addrs[(total - 1) % S.length];
    for (let k = 0; k < 120; k++) { await sleep(1000); if (Number(await rpc('eth_getTransactionCount', [last, 'latest'])) >= nonces[(total - 1) % S.length]) break; }
    return [h0, parseInt(await rpc('eth_blockNumber'), 16)];
  }
  const ranges = { transfer: await phase('transfer', 12000), erc20: await phase('erc20', 4500), swap: await phase('swap', 3500) };
  await sleep(1500);
  const lines = readFileSync(logf, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => l.includes('Produced #'));
  const out = { cpus, jvm: VPS_JVM, peakRssMB: Math.round(peakRss), phases: {} };
  for (const [kind, [a, b]] of Object.entries(ranges)) {
    const rows = lines.map((l) => { const m = /Produced #([\d,]+).*?\|\s+(\d+) tx \|.*?\| ([\d,]+) \(([\d.]+)%\) gas in ([\d.]+)s.*?txsSelection=(\d+)ms.*?blockImported=(\d+)ms/.exec(l); return m && { n: Number(m[1].replace(/,/g, '')), tx: +m[2], gas: Number(m[3].replace(/,/g, '')), pct: +m[4], total: +m[5] * 1000, sel: +m[6], imp: +m[7] }; })
      .filter((r) => r && r.n > a && r.n <= b && r.gas > 0.9 * 60_000_000 * 0.9);
    const avg = (k) => rows.length ? Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length) : null; const mx = (k) => rows.length ? Math.max(...rows.map((r) => r[k])) : null;
    out.phases[kind] = { fullBlocks: rows.length, avgTx: avg('tx'), avgGas: avg('gas'), execMs: { avg: avg('sel'), max: mx('sel') }, importMs: { avg: avg('imp'), max: mx('imp') }, producedTotalMs: { avg: avg('total'), max: mx('total') } };
  }
  console.log(JSON.stringify(out, null, 1)); mkdirSync(path.join(here, 'results'), { recursive: true }); writeFileSync(path.join(here, 'results', `import60m_cpu${cpus.replace(/,/g, '-')}.json`), JSON.stringify(out, null, 1));
} finally { clearInterval(rssIv); p.kill('SIGTERM'); await sleep(4000); try { p.kill('SIGKILL'); } catch {} rmSync(RUN, { recursive: true, force: true }); }
