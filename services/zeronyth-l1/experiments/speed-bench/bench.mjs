// ZERONYTH speed bench on an ISOLATED throwaway QBFT chain (own genesis/keys/data in $ZB, own ports). Never touches
// the main chain, its data, or the VPS. One config at a time: start 4 Besu validators -> idle block timing ->
// workloads (transfer / erc20 / swap) -> PQ finality lag -> stop + wipe data. Aborts if MemAvailable < 1.2 GB.
// usage: node bench.mjs <configName> [...]   (configs in configs.mjs)   results -> results/<name>.json
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CONFIGS } from './configs.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const { Wallet, ContractFactory, Interface, keccak256, JsonRpcProvider, parseEther } = createRequire(path.join(here, '../../economy/package.json'))('ethers');
const build = JSON.parse(readFileSync(path.join(here, 'build.json'), 'utf8'));
const ZB = process.env.ZB || '/tmp/zbench';
const RUNTIME = '/workspace/zeronyth/generated-artifacts/runtime';
const BESU = `${RUNTIME}/besu-26.9.0/bin/besu`, JAVA_HOME = `${RUNTIME}/jdk-25.0.5+8-jre`;
const RPC_PORT = 9945, P2P = 33300, PROXY4 = 33314, GW_PORT = 9950, PQ_PORT = 9951;
const GAS_PRICE = 1_000_000_000n; // main chain --min-gas-price
const MAIN_JVM = '-Xms64m -Xmx512m -XX:MaxMetaspaceSize=192m -XX:ReservedCodeCacheSize=64m -XX:MaxDirectMemorySize=64m -XX:+UseSerialGC -Xss512k -XX:ActiveProcessorCount=2';
const MIN_AVAIL_MB = 1200;
const memAvailMB = () => Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024;
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
class Abort extends Error {}

function procStat(pid) { try { const s = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  return { cpu: Number(s[11]) + Number(s[12]), rssMB: Number(s[21]) * 4096 / 1048576 }; } catch { return null; } }

async function rpcAt(url, method, params = []) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000) });
  const j = await r.json(); if (j.error) throw new Error(`${method}: ${j.error.message}`); return j.result;
}
const RPC = `http://127.0.0.1:${RPC_PORT}/`; const rpc = (m, p) => rpcAt(RPC, m, p);

async function startChain(cfg, funder) {
  const run = path.join(ZB, 'run'); rmSync(run, { recursive: true, force: true }); mkdirSync(run, { recursive: true });
  const g = JSON.parse(readFileSync(path.join(ZB, 'net/genesis.json'), 'utf8'));
  g.gasLimit = '0x' + BigInt(cfg.gasLimit ?? 30_000_000).toString(16);
  g.config.qbft = { blockperiodseconds: cfg.periodS ?? 1, epochlength: 30000, requesttimeoutseconds: cfg.requestTimeoutS ?? 2,
    ...(cfg.periodMs ? { xblockperiodmilliseconds: cfg.periodMs } : {}) };
  g.alloc = { [funder.address.slice(2).toLowerCase()]: { balance: '0x' + (10n ** 30n).toString(16) } };
  writeFileSync(path.join(run, 'genesis.json'), JSON.stringify(g, null, 1));
  const keys = readdirSync(path.join(ZB, 'net/keys')).sort();
  const pubs = keys.map((k) => readFileSync(path.join(ZB, 'net/keys', k, 'key.pub'), 'utf8').trim().replace(/^0x/, '').replace(/^04(?=[0-9a-f]{128}$)/, ''));
  const delay = cfg.wanDelayMs || 0;
  const procs = [];
  const spawnLogged = (name, cmd, args, env) => { const fd = openSync(path.join(run, `${name}.log`), 'a');
    const p = spawn(cmd, args, { env, stdio: ['ignore', fd, fd] }); p.name = name; procs.push(p); return p; };
  if (delay) spawnLogged('proxy4', process.execPath, [path.join(here, 'delay-proxy.mjs'), String(PROXY4), String(P2P + 4), String(delay)], process.env);
  for (let i = 1; i <= 4; i++) {
    const d = path.join(run, `node${i}`); mkdirSync(d);
    for (const f of ['key', 'key.pub']) writeFileSync(path.join(d, f), readFileSync(path.join(ZB, 'net/keys', keys[i - 1], f)), { mode: 0o600 });
    // Like main: box validators dial each other; validator 4 ("VPS") is dialled by 1-3 (through the delay proxy) and dials nobody.
    const peers = i === 4 ? [] : [1, 2, 3, 4].filter((j) => j !== i).map((j) => `enode://${pubs[j - 1]}@127.0.0.1:${j === 4 && delay ? PROXY4 : P2P + j}`);
    writeFileSync(path.join(d, 'static-nodes.json'), JSON.stringify(peers));
    const storage = cfg.storage || 'FOREST';
    const args = ['--profile=ENTERPRISE', `--genesis-file=${path.join(run, 'genesis.json')}`, `--data-path=${d}`, `--node-private-key-file=${path.join(d, 'key')}`,
      '--network-id=9127', '--sync-mode=FULL', `--data-storage-format=${storage}`, '--p2p-host=127.0.0.1', '--p2p-interface=127.0.0.1', `--p2p-port=${P2P + i}`,
      '--discovery-enabled=false', '--nat-method=NONE', `--static-nodes-file=${path.join(d, 'static-nodes.json')}`, `--min-gas-price=${GAS_PRICE}`,
      ...(storage === 'BONSAI' ? [`--bonsai-parallel-tx-processing-enabled=${cfg.parallel ? 'true' : 'false'}`] : []),
      ...(cfg.targetGasLimit ? [`--target-gas-limit=${cfg.targetGasLimit}`] : []),
      ...(cfg.nodeFlags || [])];
    if (i === 1) args.push('--rpc-http-enabled=true', '--rpc-http-host=127.0.0.1', `--rpc-http-port=${RPC_PORT}`, `--rpc-http-api=${cfg.rpcApis || 'ETH,NET,WEB3,QBFT'}`,
      '--host-allowlist=localhost,127.0.0.1', ...(cfg.rpcFlags || []));
    spawnLogged(`node${i}`, 'nice', ['-n', '10', BESU, ...args], { PATH: process.env.PATH, HOME: process.env.HOME, JAVA_HOME, JAVA_OPTS: process.env.BENCH_XMX ? (cfg.jvm || MAIN_JVM).replace(/-Xmx\d+m/, `-Xmx${process.env.BENCH_XMX}`) : (cfg.jvm || MAIN_JVM) });
  }
  const stop = async () => {
    for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM');
    const t = Date.now(); while (procs.some((p) => p.exitCode === null && p.signalCode === null) && Date.now() - t < 15000) await sleep(200);
    for (const p of procs) if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
  };
  // readiness: height advancing with 3 peers
  for (let k = 0; k < 120; k++) { await sleep(1000);
    if (memAvailMB() < MIN_AVAIL_MB) { await stop(); throw new Abort(`MemAvailable ${memAvailMB() | 0} MB < ${MIN_AVAIL_MB}`); }
    try { const h = parseInt(await rpc('eth_blockNumber'), 16), pc = parseInt(await rpc('net_peerCount'), 16); if (h >= 3 && pc >= 3) return { procs, stop, run }; } catch {}
  }
  await stop(); throw new Error('chain did not start');
}

// Watches the head with a 25 ms poll: first-seen time, tx count, gas used per block.
function headWatcher() {
  const blocks = new Map(); let stop = false, next = null;
  (async () => { while (!stop) { try { const top = parseInt(await rpc('eth_blockNumber'), 16); if (next === null) next = top;
    for (; next <= top; next++) { const t = performance.now(); const b = await rpc('eth_getBlockByNumber', ['0x' + next.toString(16), false]);
      blocks.set(next, { t, txs: b.transactions, gas: parseInt(b.gasUsed, 16), gasLimit: parseInt(b.gasLimit, 16), ts: parseInt(b.timestamp, 16), miner: b.miner }); } } catch {}
    await sleep(25); } })();
  return { blocks, end: () => { stop = true; } };
}
const pct = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
function intervals(blocks, from, to) { const ks = [...blocks.keys()].filter((k) => k >= from && k <= to).sort((a, b) => a - b);
  const iv = []; for (let i = 1; i < ks.length; i++) if (ks[i] === ks[i - 1] + 1) iv.push(blocks.get(ks[i]).t - blocks.get(ks[i - 1]).t);
  return { n: iv.length, avgMs: iv.length ? Math.round(iv.reduce((a, b) => a + b, 0) / iv.length) : null, p95Ms: Math.round(pct(iv, 0.95) ?? 0), maxMs: Math.round(Math.max(0, ...iv)) }; }

function sampler(pids) { const t0 = performance.now(); const c0 = pids.map((p) => procStat(p)?.cpu ?? 0); let peakRss = 0, minAvail = Infinity, aborted = null;
  const iv = setInterval(() => { const rss = pids.reduce((a, p) => a + (procStat(p)?.rssMB ?? 0), 0); peakRss = Math.max(peakRss, rss);
    const m = memAvailMB(); minAvail = Math.min(minAvail, m); if (m < MIN_AVAIL_MB) aborted = `MemAvailable ${m | 0} MB`; }, 500);
  return { get aborted() { return aborted; }, end: () => { clearInterval(iv); const dt = (performance.now() - t0) / 1000; const c1 = pids.map((p) => procStat(p)?.cpu ?? 0);
    return { cpuPct: Math.round(c1.reduce((a, c, i) => a + c - c0[i], 0) / 100 / dt * 100), peakRssMB: Math.round(peakRss), minMemAvailMB: Math.round(minAvail) }; } };
}

// Closed-loop sender: keeps at most `window` submitted-but-unmined txs outstanding (default Besu layered pool silently
// drops beyond ~4k pending; see results/base_burst*.json), so sustained throughput is measured, not pool overflow.
async function sendBatches(url, raws, batch, conc, inflight = () => 0, window = Infinity) {
  let sent = 0;
  const chunks = []; for (let i = 0; i < raws.length; i += batch) chunks.push(raws.slice(i, i + batch));
  const sentAt = new Map(); let rejected = 0, errors = [];
  async function lane() { for (let c; (c = chunks.shift()); ) { while (sent - inflight() > window) await sleep(20); sent += c.length; const ts = performance.now();
    const body = c.map((r, k) => ({ jsonrpc: '2.0', id: k, method: 'eth_sendRawTransaction', params: [r] }));
    try { const res = await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
      if (!Array.isArray(res)) { rejected += c.length; errors.push(JSON.stringify(res).slice(0, 120)); continue; }
      for (const r of res) if (r.error) { rejected++; if (errors.length < 3) errors.push(r.error.message); } } catch (e) { rejected += c.length; errors.push(e.message); }
    c.forEach((r) => sentAt.set(keccak256(r), ts)); } }
  await Promise.all(Array.from({ length: conc }, lane));
  return { sentAt, rejected, errors };
}

async function workload(kind, ctx, cfg, n, url, batch, conc) {
  const { senders, nonces, token, pool, watcher } = ctx;
  const iT = new Interface(build.BenchToken.abi), iP = new Interface(build.BenchPool.abi);
  const raws = [], hashes = new Set();
  for (let i = 0; i < n; i++) { const w = senders[i % senders.length]; const nonce = Number(nonces.get(w.address));
    let tx;
    if (kind === 'transfer') tx = { to: senders[(i + 1) % senders.length].address, value: 1n, gasLimit: 21000n };
    else if (kind === 'erc20') tx = { to: token, data: iT.encodeFunctionData('transfer', [Wallet.createRandom().address, 1n]), gasLimit: 80000n }; // fresh recipient = new storage slot (worst-ish case)
    else tx = { to: pool, data: iP.encodeFunctionData('swap', [10n ** 15n, i % 2 === 0]), gasLimit: 120000n };
    const raw = await w.signTransaction({ type: 0, gasPrice: GAS_PRICE, chainId: 9127n, nonce, ...tx });
    nonces.set(w.address, Number(nonce) + 1); raws.push(raw); hashes.add(keccak256(raw)); }
  const head0 = parseInt(await rpc('eth_blockNumber'), 16);
  const s = sampler(ctx.pids); const pq0 = await fetch(`http://127.0.0.1:${PQ_PORT}/reset`).then((r) => r.json()).catch(() => null);
  const t0 = performance.now();
  const seen = new Set(); let scanned = head0;
  const minedNow = () => { for (let k = scanned + 1; watcher.blocks.has(k); k++) { for (const h of watcher.blocks.get(k).txs) if (hashes.has(h)) seen.add(h); scanned = k; } return seen.size; };
  const { sentAt, rejected, errors } = await sendBatches(url, raws, batch, conc, minedNow, cfg.window ?? 3000);
  const submitMs = performance.now() - t0;
  const mined = new Map(); const deadline = Date.now() + 60_000; let lastBlock = head0;
  while (mined.size < hashes.size - rejected && Date.now() < deadline) {
    for (const [k, b] of watcher.blocks) if (k > head0) { for (const h of b.txs) if (hashes.has(h) && !mined.has(h)) { mined.set(h, b.t); lastBlock = Math.max(lastBlock, k); } }
    if (s.aborted) throw new Abort(s.aborted);
    await sleep(100);
  }
  let diag;
  if (mined.size < hashes.size - rejected) { const missing = [...hashes].filter((h) => !mined.has(h)); const m0 = missing[0];
    const tx = await rpc('eth_getTransactionByHash', [m0]).catch((e) => String(e)); const rc = await rpc('eth_getTransactionReceipt', [m0]).catch((e) => String(e));
    const lat = tx && tx.from ? [await rpc('eth_getTransactionCount', [tx.from, 'latest']), await rpc('eth_getTransactionCount', [tx.from, 'pending'])] : null;
    diag = { missing: missing.length, sampleTx: tx && tx.nonce, blockNumber: tx && tx.blockNumber, receipt: rc && rc.blockNumber, latestPending: lat };
    log('DIAG', JSON.stringify(diag)); }
  await sleep(1500); // let PQ follower catch up on the tail
  const res = s.end(); const pq = await fetch(`http://127.0.0.1:${PQ_PORT}/`).then((r) => r.json()).catch(() => null);
  const firstBlock = [...watcher.blocks.keys()].filter((k) => k > head0 && watcher.blocks.get(k).txs.some((h) => hashes.has(h))).sort((a, b) => a - b)[0];
  const blk = [...watcher.blocks.entries()].filter(([k]) => k >= firstBlock && k <= lastBlock);
  const tEnd = Math.max(...mined.values()) - t0;
  const span = (watcher.blocks.get(lastBlock).t - (watcher.blocks.get(firstBlock - 1)?.t ?? t0)) / 1000;
  const lat = [...mined].map(([h, t]) => t - sentAt.get(h));
  return { kind, n, url: url === RPC ? 'direct' : 'gateway', batch, conc, rejected, errors: errors.slice(0, 3), mined: mined.size, diag,
    submitTxPerSec: Math.round(n / (submitMs / 1000)), endToEndTps: Math.round(mined.size / (tEnd / 1000)), blockTps: Math.round(mined.size / span),
    finalityMs: { p50: Math.round(pct(lat, 0.5)), p95: Math.round(pct(lat, 0.95)), max: Math.round(Math.max(...lat)) },
    blocks: blk.length, maxTxPerBlock: Math.max(...blk.map(([, b]) => b.txs.length)), avgGasPerBlock: Math.round(blk.reduce((a, [, b]) => a + b.gas, 0) / blk.length),
    gasLimit: blk[0]?.[1].gasLimit, gasPerTx: Math.round(blk.reduce((a, [, b]) => a + b.gas, 0) / Math.max(1, mined.size)),
    intervalUnderLoad: intervals(watcher.blocks, firstBlock - 1, lastBlock), resources: res, pq };
}

async function runConfig(name) {
  const cfg = CONFIGS[name]; if (!cfg) throw new Error(`unknown config ${name}`);
  if (memAvailMB() < MIN_AVAIL_MB + Number(process.env.BENCH_START_HEADROOM_MB || 1500)) throw new Abort(`not enough RAM to start (avail ${memAvailMB() | 0} MB)`);
  const funder = Wallet.createRandom(); log(`== ${name}`, JSON.stringify(cfg));
  const chain = await startChain(cfg, funder); const out = { name, cfg, benchXmx: process.env.BENCH_XMX || null, startedAt: new Date().toISOString() };
  let gw, pqp;
  try {
    const provider = new JsonRpcProvider(RPC, 9127, { staticNetwork: true, polling: true, pollingInterval: 100 });
    const f = funder.connect(provider);
    pqp = spawn(process.execPath, [path.join(here, 'pq-follow.mjs')], { env: { PATH: process.env.PATH, RPC_URL: RPC, PORT: String(PQ_PORT), KEYDIR: path.join(ZB, 'net/keys'), NODE_OPTIONS: '--max-old-space-size=96' }, stdio: 'ignore' });
    gw = spawn(process.execPath, [path.join(here, 'run-gateway.mjs')], { cwd: path.join(here, '../..'), env: { PATH: process.env.PATH, GW_PORT: String(GW_PORT), ZERONYTH_RPC_PORT: String(RPC_PORT), ZERONYTH_RPC_TX_PER_MIN: '1000000', ZERONYTH_RPC_RPS: '1000000', ZERONYTH_READ_CACHE_MS: '500' }, stdio: 'ignore' });
    const watcher = headWatcher();
    const besuPids = chain.procs.filter((p) => p.name.startsWith('node')).map((p) => p.pid);
    // nice -> besu java is the child of `nice` via exec, same pid.
    const pids = [...besuPids, pqp.pid];
    // idle timing (also lets gasLimit ramp if targetGasLimit is used)
    await sleep((cfg.idleS ?? 20) * 1000);
    const h = parseInt(await rpc('eth_blockNumber'), 16);
    out.idle = intervals(watcher.blocks, h - 200, h);
    out.idleProposers = {}; for (const [k, b] of watcher.blocks) if (k > h - 200 && watcher.blocks.has(k - 1)) { (out.idleProposers[b.miner] ??= []).push(Math.round(b.t - watcher.blocks.get(k - 1).t)); }
    for (const m in out.idleProposers) { const a = out.idleProposers[m]; out.idleProposers[m] = { n: a.length, avgMs: Math.round(a.reduce((x, y) => x + y, 0) / a.length), maxMs: Math.max(...a) }; }
    out.pqIdle = await fetch(`http://127.0.0.1:${PQ_PORT}/`).then((r) => r.json()).catch(() => null);
    log('idle', JSON.stringify(out.idle), 'pq', JSON.stringify(out.pqIdle));
    // setup: senders, token, pool
    const S = cfg.senders ?? 40; const senders = Array.from({ length: S }, () => Wallet.createRandom());
    let fn = await provider.getTransactionCount(funder.address);
    const fund = await Promise.all(senders.map((w) => f.sendTransaction({ to: w.address, value: parseEther('1000'), gasPrice: GAS_PRICE, gasLimit: 21000n, nonce: fn++ })));
    const tokF = new ContractFactory(build.BenchToken.abi, build.BenchToken.bytecode, f), poolF = new ContractFactory(build.BenchPool.abi, build.BenchPool.bytecode, f);
    const tok = await tokF.deploy({ gasPrice: GAS_PRICE, nonce: fn++ }), pool = await poolF.deploy({ gasPrice: GAS_PRICE, nonce: fn++ });
    await Promise.all(fund.map((t) => t.wait())); await tok.waitForDeployment(); await pool.waitForDeployment();
    const addrs = senders.map((w) => w.address);
    await (await tok.mint(addrs, 10n ** 24n, { gasPrice: GAS_PRICE, nonce: fn++ })).wait(); await (await pool.seed(addrs, 10n ** 22n, { gasPrice: GAS_PRICE, nonce: fn++ })).wait();
    const nonces = new Map(addrs.map((a) => [a, 0n]));
    const ctx = { senders, nonces, token: await tok.getAddress(), pool: await pool.getAddress(), watcher, pids };
    out.runs = [];
    for (const w of cfg.workloads || [['transfer', 6000], ['erc20', 4000], ['swap', 3000]]) {
      const [kind, n, via = 'direct', batch = 100, conc = 4] = w;
      const r = await workload(kind, ctx, cfg, n, via === 'gateway' ? `http://127.0.0.1:${GW_PORT}/rpc` : RPC, batch, conc);
      r.gwCpu = via === 'gateway' ? 'incl. in submit' : undefined;
      log(kind, via, `blockTps=${r.blockTps} e2e=${r.endToEndTps} fin p50/p95=${r.finalityMs.p50}/${r.finalityMs.p95} int=${r.intervalUnderLoad.avgMs} gas/blk=${r.avgGasPerBlock} cpu=${r.resources.cpuPct}% rss=${r.resources.peakRssMB} rej=${r.rejected} pq=${JSON.stringify(r.pq)}`);
      out.runs.push(r); await sleep(3000);
    }
    watcher.end();
    out.diskMB = Math.round(Number((await import('node:child_process')).execSync(`du -sm ${chain.run}/node1/database 2>/dev/null || du -sm ${chain.run}/node1`).toString().split('\t')[0]));
    out.height = parseInt(await rpc('eth_blockNumber'), 16);
  } catch (e) { out.error = String(e.message || e); log('ERROR', e.stack); if (e instanceof Abort) out.aborted = true; }
  finally { gw?.kill(); pqp?.kill(); await chain.stop(); rmSync(chain.run, { recursive: true, force: true }); }
  mkdirSync(path.join(here, 'results'), { recursive: true });
  writeFileSync(path.join(here, 'results', `${name}.json`), JSON.stringify(out, null, 1));
  if (out.aborted) throw new Abort(out.error);
}
for (const n of process.argv.slice(2)) { try { await runConfig(n); } catch (e) { log('STOP', e.message); if (e instanceof Abort) process.exit(2); } }
process.exit(0);
