// ZERONYTH 参加アプリ (contributor) — double-click starter target. No command line needed.
// Opens a local status page (http://127.0.0.1:8899) in the browser. Japanese-first UI, English toggle.
// Safe defaults: lends at most 50% of CPU threads at lowest OS priority, pauses on battery, heat or when the PC is busy.
// Resource split default L1 40% / AI 30% / VPS rental 30% (must total 100%).
// Keys (eth + ML-DSA-65 seed) are created locally in data/keys.json and never shown or sent anywhere.
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Wallet, Interface, keccak256, concat, getBytes, formatEther, Transaction } from 'ethers';
import { ml_dsa65 } from '../../dashboard/assets/vendor-noble.mjs';
import { DOMAINS, DEFAULT_SHARES, b64, hashOf, pqKeyHash, pqSign, validShares } from '../lib/proto.mjs';
import { VerifyPool } from '../lib/verify-pool.mjs';
import UI_HTML from './ui.html';

const VERSION = '0.1.0';
const here = path.dirname(fileURLToPath(import.meta.url));
const KIT = process.env.ZERONYTH_KIT_DIR || path.resolve(here, '..');
const DATA = path.join(KIT, 'data'); mkdirSync(DATA, { recursive: true, mode: 0o700 });
const CFG_F = path.join(DATA, 'config.json'), KEY_F = path.join(DATA, 'keys.json'), ST_F = path.join(DATA, 'state.json');
const readJ = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const kitDefaults = readJ(path.join(KIT, 'defaults.json'), {});
const DEFAULTS = { server: 'https://zeronyth.dpdns.org', shares: { ...DEFAULT_SHARES }, cpuPct: 50, pauseOnBattery: true, pauseOnHeat: true, pauseWhenBusy: true, lang: 'ja', openBrowser: true, ...kitDefaults };
let cfg = { ...DEFAULTS, ...readJ(CFG_F, {}) };
if (process.env.ZERONYTH_SERVER) cfg.server = process.env.ZERONYTH_SERVER;
if (!validShares(cfg.shares)) cfg.shares = { ...DEFAULT_SHARES };
const saveCfg = () => writeFileSync(CFG_F, JSON.stringify(cfg, null, 2));
saveCfg();
let keys = readJ(KEY_F, null);
if (!keys) { keys = { eth: '0x' + randomBytes(32).toString('hex'), mldsaSeed: randomBytes(32).toString('hex') }; writeFileSync(KEY_F, JSON.stringify(keys), { mode: 0o600 }); }
const wallet = new Wallet(keys.eth);
const kp = ml_dsa65.keygen(new Uint8Array(Buffer.from(keys.mldsaSeed, 'hex')));
let st = readJ(ST_F, {});
const saveSt = () => writeFileSync(ST_F, JSON.stringify(st));
const logs = [];
const log = (ja, en = ja) => { const line = { t: Date.now(), ja, en }; logs.push(line); if (logs.length > 60) logs.shift(); console.log(new Date().toLocaleTimeString(), cfg.lang === 'en' ? en : ja); };
try { os.setPriority(0, 19); } catch {}   // lowest priority; worker threads created later inherit it (Linux/macOS), Windows = IDLE class

const S = { phase: 'starting', paused: false, pauseReasons: [], manualPause: false, error: null, info: null, l1Verified: 0, l1Jobs: 0, aiJobs: 0, heartbeats: 0, lastHeartbeat: 0, startedAt: Date.now(), gpu: [], econ: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ server API
const base = () => cfg.server.replace(/\/+$/, '');
async function http_(p, opt = {}) {
  const r = await fetch(base() + p, { ...opt, headers: { 'content-type': 'application/json', ...(opt.headers || {}) }, signal: AbortSignal.timeout(opt.timeout || 20000) });
  if (r.status === 204) return null; const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { error: t.slice(0, 120) }; }
  if (r.status >= 400) throw new Error(j.error || `HTTP ${r.status}`); return j;
}
const econ = (p, body, timeout) => http_('/api/econ' + p, body === undefined ? { timeout } : { method: 'POST', body: JSON.stringify(body), timeout });
async function rpcBatch(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 100) {
    const part = calls.slice(i, i + 100).map((c, k) => ({ jsonrpc: '2.0', id: i + k, method: c[0], params: c[1] }));
    const res = await http_('/rpc', { method: 'POST', body: JSON.stringify(part) });
    for (const r of res) out[r.id] = r.result ?? null;
  }
  return out;
}
const rpc1 = async (m, p) => (await rpcBatch([[m, p]]))[0];
const ABI = new Interface(['function registerProvider(bytes32,bytes32,uint16,uint16,uint16)', 'function withdraw()', 'function subscribe(uint8) payable']);
async function sendTx(to, data, gasLimit = 400000n) {
  const [nonce, gp] = await rpcBatch([['eth_getTransactionCount', [wallet.address, 'pending']], ['eth_gasPrice', []]]);
  const gasPrice = BigInt(S.info?.gasPriceWei ?? gp ?? 0) > BigInt(gp ?? 0) ? BigInt(S.info.gasPriceWei) : BigInt(gp ?? 0);
  const raw = await wallet.signTransaction({ type: 0, chainId: 9127, nonce: Number(nonce), to, data, gasLimit, gasPrice, value: 0n });
  const r = await econ('/rpc', { jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [raw] });
  if (r.error) throw new Error(r.error.message);
  for (let i = 0; i < 60; i++) { const rc = await rpc1('eth_getTransactionReceipt', [r.result]); if (rc) { if (rc.status !== '0x1') throw new Error('transaction reverted'); return rc; } await sleep(1000); }
  throw new Error('transaction not mined in 60 s');
}

// ------------------------------------------------------------------ resources + safety
function detectGpu() { return new Promise((res) => execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { timeout: 3000 }, (e, out) => res(e ? [] : String(out).trim().split('\n').filter(Boolean)))); }
const cpus = os.cpus().length;
const lentThreads = () => Math.max(1, Math.floor((cpus * cfg.cpuPct) / 100));
const l1ThreadsFor = () => (cfg.shares.l1Bps > 0 ? Math.max(1, Math.round((lentThreads() * cfg.shares.l1Bps) / 10000)) : 0);
function sh(cmd, args) { return new Promise((res) => execFile(cmd, args, { timeout: 4000, windowsHide: true }, (e, out) => res(e ? '' : String(out)))); }
async function onBattery() {
  if (process.platform === 'linux') {
    try { const ps = '/sys/class/power_supply'; let hasBat = false, ac = false;
      for (const n of readdirSync(ps)) { const t = readFileSync(`${ps}/${n}/type`, 'utf8').trim();
        if (t === 'Mains' || t === 'USB') ac ||= readFileSync(`${ps}/${n}/online`, 'utf8').trim() === '1';
        if (t === 'Battery') { hasBat = true; if (readFileSync(`${ps}/${n}/status`, 'utf8').trim() === 'Discharging') return true; } }
      return hasBat && !ac; } catch { return false; }
  }
  if (process.platform === 'darwin') return /Battery Power/.test(await sh('pmset', ['-g', 'batt']));
  if (process.platform === 'win32') return /\b(1|4|5|11)\b/.test((await sh('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Battery).BatteryStatus'])).trim()); // 1=discharging
  return false;
}
async function tooHot() {
  if (process.platform === 'linux') {
    try { let max = 0; for (const z of readdirSync('/sys/class/thermal').filter((x) => x.startsWith('thermal_zone'))) { const v = Number(readFileSync(`/sys/class/thermal/${z}/temp`, 'utf8')) / 1000; if (v > max && v < 150) max = v; } return max >= 85 ? `${max.toFixed(0)}°C` : false; } catch { return false; }
  }
  if (process.platform === 'darwin') { const m = /CPU_Speed_Limit\s*=\s*(\d+)/.exec(await sh('pmset', ['-g', 'therm'])); return m && Number(m[1]) < 100 ? `throttled ${m[1]}%` : false; }
  return false;   // Windows: no reliable non-admin temperature source; busy/battery checks still apply
}
let lastCpu = os.cpus().map((c) => c.times), lastOwn = process.cpuUsage(), lastT = Date.now(), busyCount = 0;
function othersBusyPct() {
  const now = os.cpus().map((c) => c.times); let idle = 0, total = 0;
  now.forEach((t, i) => { const p = lastCpu[i] || t; const d = (k) => t[k] - p[k]; const tot = d('user') + d('nice') + d('sys') + d('idle') + d('irq'); total += tot; idle += d('idle'); });
  const own = process.cpuUsage(lastOwn); const ownMs = (own.user + own.system) / 1000; lastCpu = now; lastOwn = process.cpuUsage(); lastT = Date.now();
  if (!total) return 0; const busy = total - idle; return Math.max(0, Math.min(100, ((busy - ownMs) / total) * 100));
}
async function safetyTick() {
  const reasons = [];
  if (S.manualPause) reasons.push('manual');
  if (cfg.pauseOnBattery && (await onBattery())) reasons.push('battery');
  const hot = cfg.pauseOnHeat && (await tooHot()); if (hot) reasons.push('heat');
  const busy = othersBusyPct(); busyCount = busy > 85 ? busyCount + 1 : 0;
  if (cfg.pauseWhenBusy && busyCount >= 2) reasons.push('busy');
  const was = S.paused; S.paused = reasons.length > 0; S.pauseReasons = reasons; S.othersCpuPct = Math.round(busy);
  if (S.paused !== was) log(S.paused ? `一時停止しました（${reasons.join(', ')}）` : '再開しました', S.paused ? `Paused (${reasons.join(', ')})` : 'Resumed');
}

// ------------------------------------------------------------------ join (register + declare)
function buildDecl() {
  return { v: 1, chainId: 9127, address: wallet.address, shares: cfg.shares, app: `participant/${VERSION}`,
    resources: { cpus, lentThreads: lentThreads(), l1Threads: l1ThreadsFor(), ramMB: Math.round(os.totalmem() / 2 ** 20), gpu: S.gpu, gpuUsedForVerification: false, os: process.platform, arch: os.arch() } };
}
async function join() {
  S.phase = 'connecting'; S.error = null;
  S.econ = await econ('/status');
  S.info = await econ(`/provider/info?address=${wallet.address}`);
  const decl = st.decl && st.declKey === JSON.stringify([cfg.shares, lentThreads(), S.gpu]) ? st.decl : buildDecl();
  st.decl = decl; st.declKey = JSON.stringify([cfg.shares, lentThreads(), S.gpu]); saveSt();
  const declHash = hashOf(decl);
  if (BigInt(S.info.balanceWei) < 10n ** 16n) {
    S.phase = 'funding'; log('テスト用ZNYT（無価値）を受け取っています…', 'Getting free test ZNYT (no value)…');
    await http_('/api/faucet/claim', { method: 'POST', body: JSON.stringify({ address: wallet.address }) });
    for (let i = 0; i < 30 && BigInt(await rpc1('eth_getBalance', [wallet.address, 'latest'])) === 0n; i++) await sleep(1000);
  }
  if (S.info.declHash !== declHash) {
    S.phase = 'registering'; log('チェーンに参加登録しています…', 'Registering on-chain…');
    await sendTx(S.info.economy, ABI.encodeFunctionData('registerProvider', [pqKeyHash(kp.publicKey), declHash, cfg.shares.l1Bps, cfg.shares.aiBps, cfg.shares.rentalBps]));
  }
  await econ('/provider/declare', { decl, pqPk: b64.enc(kp.publicKey), pqSig: pqSign(DOMAINS.decl, declHash, kp.secretKey), ecdsaSig: await wallet.signMessage(getBytes(declHash)) });
  S.info = await econ(`/provider/info?address=${wallet.address}`);
  S.phase = 'running'; log('参加しました。耐量子署名（ML-DSA-65）で認証済みです。', 'Joined. Authenticated with post-quantum ML-DSA-65 signature.');
}

// ------------------------------------------------------------------ work loops
let pool = null, gen = 0;
async function stateCheck(results) {
  const ok = results.filter((r) => r.ok); if (!ok.length) return results;
  const senders = [...new Set(ok.map((r) => r.from))];
  let res = []; try { res = await rpcBatch(senders.flatMap((a) => [['eth_getTransactionCount', [a, 'latest']], ['eth_getBalance', [a, 'latest']]])); } catch {}
  const m = new Map(senders.map((a, i) => [a, res[2 * i] != null && res[2 * i + 1] != null ? { nonce: BigInt(res[2 * i]), bal: BigInt(res[2 * i + 1]) } : null]));
  const minGas = BigInt(S.info?.gasPriceWei || 0);
  return results.map((r) => { if (!r.ok) return r; const s = m.get(r.from); if (!s) return r;
    if (BigInt(r.nonce) < s.nonce) return { ...r, ok: false, reason: 'nonce-too-low' };
    if (BigInt(r.maxCost) > s.bal) return { ...r, ok: false, reason: 'insufficient-funds' };
    if (BigInt(r.gasPrice) < minGas) return { ...r, ok: false, reason: 'gas-price-below-min' };
    return r; });
}
async function waitActive(g) { while (g === gen && (S.paused || S.phase !== 'running')) await sleep(1000); return g === gen; }
async function l1Loop(g) {
  while (await waitActive(g)) {
    try {
      const job = await econ(`/l1/jobs/next?address=${wallet.address}`, undefined, 25000); if (!job || g !== gen) continue;
      const results = await stateCheck(await pool.parallel('tx', job.items));
      const h = keccak256(concat([job.jobId, hashOf(results)]));
      const r = await econ('/l1/jobs/result', { jobId: job.jobId, address: wallet.address, results, sig: pqSign(DOMAINS.l1, h, kp.secretKey) });
      if (r?.accepted) { S.l1Verified += job.items.length; S.l1Jobs++; }
    } catch (e) { S.error = e.message; await sleep(3000); }
  }
}
async function aiExec(job) {
  if (job.type === 'ai-hash') return { digest: keccak256(new TextEncoder().encode(String(job.payload?.text || ''))) };
  throw new Error('unsupported AI job on this device');
}
async function aiLoop(g) {
  while (cfg.shares.aiBps > 0 && (await waitActive(g))) {
    try {
      const job = await econ(`/ai/jobs/next?address=${wallet.address}`, undefined, 25000); if (!job || g !== gen) continue;
      const output = await aiExec(job);
      await econ('/ai/jobs/result', { jobId: job.jobId, address: wallet.address, output, sig: pqSign(DOMAINS.ai, keccak256(concat([job.jobId, hashOf(output)])), kp.secretKey) });
      S.aiJobs++;
    } catch (e) { S.error = e.message; await sleep(3000); }
  }
}
async function heartbeatLoop(g) {
  while (await waitActive(g)) {
    try { const { nonce } = await econ(`/provider/challenge?address=${wallet.address}`);
      await econ('/provider/heartbeat', { address: wallet.address, nonce, sig: pqSign(DOMAINS.hb, keccak256(concat([wallet.address, nonce])), kp.secretKey) });
      S.heartbeats++; S.lastHeartbeat = Date.now(); S.error = null;
    } catch (e) { S.error = e.message; }
    await sleep(5000);
  }
}
async function infoLoop() { for (;;) { try { S.info = await econ(`/provider/info?address=${wallet.address}`); S.econ = await econ('/status'); } catch {} await sleep(15000); } }

async function start() {
  gen++; const g = gen; if (pool) { await pool.close(); pool = null; }
  for (let attempt = 0; g === gen; attempt++) {
    try { await join(); break; }
    catch (e) { S.phase = 'offline'; S.error = e.message; log(`サーバーに接続できません。30秒後に再試行します（${e.message}）`, `Cannot reach the server; retrying in 30 s (${e.message})`); await sleep(30000); }
  }
  if (g !== gen) return;
  const t = l1ThreadsFor(); if (t > 0) { pool = new VerifyPool(t); for (let i = 0; i < Math.min(2, t); i++) void l1Loop(g); }
  void aiLoop(g); void heartbeatLoop(g);
}

// ------------------------------------------------------------------ local UI (127.0.0.1 only)
function snapshot() {
  const i = S.info || {};
  return { version: VERSION, address: wallet.address, phase: S.phase, paused: S.paused, pauseReasons: S.pauseReasons, error: S.error, cfg,
    device: { cpus, lentThreads: lentThreads(), l1Threads: l1ThreadsFor(), ramMB: Math.round(os.totalmem() / 2 ** 20), gpu: S.gpu, os: `${process.platform}/${os.arch()}`, othersCpuPct: S.othersCpuPct ?? null },
    session: { l1Verified: S.l1Verified, l1Jobs: S.l1Jobs, aiJobs: S.aiJobs, heartbeats: S.heartbeats, lastHeartbeat: S.lastHeartbeat, startedAt: S.startedAt },
    rewards: { pendingZnyt: i.pendingZnyt ? formatEther(i.pendingZnyt) : '0', earnedZnyt: i.earnedZnyt ? formatEther(i.earnedZnyt) : '0', aiCredits: i.aiCredits || '0',
      units: i.units || null, unpaidUnits: i.unpaidUnits || null, strikes: i.strikes || 0, maxStrikes: i.maxStrikes || 3, attested: !!i.attested, balance: i.balanceWei ? formatEther(i.balanceWei) : '0', epochMs: i.epochMs },
    network: S.econ ? { burnBps: S.econ.fee.burnBps, totalBurned: formatEther(S.econ.fee.totalBurnedWei), providers: S.econ.providers.length, lastEpoch: S.econ.economy.lastEpoch } : null,
    logs: logs.slice(-20) };
}
const ALLOWED_HOSTS = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
const ui = http.createServer(async (req, res) => {
  const send = (c, o, type = 'application/json') => { res.writeHead(c, { 'content-type': type, 'cache-control': 'no-store', 'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'" }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
  if (!ALLOWED_HOSTS.test(req.headers.host || '')) return send(403, { error: 'forbidden host' });          // DNS-rebinding guard
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/') return send(200, UI_HTML, 'text/html; charset=utf-8');
  if (req.method === 'GET' && u.pathname === '/api/state') return send(200, snapshot());
  if (req.method !== 'POST' || req.headers['x-zeronyth-ui'] !== '1') return send(404, { error: 'not found' });  // CSRF guard (custom header)
  let body = ''; for await (const c of req) { body += c; if (body.length > 10000) return send(413, {}); }
  let b = {}; try { b = body ? JSON.parse(body) : {}; } catch { return send(400, { error: 'bad json' }); }
  try {
    if (u.pathname === '/api/pause') { S.manualPause = true; await safetyTick(); return send(200, snapshot()); }
    if (u.pathname === '/api/resume') { S.manualPause = false; await safetyTick(); return send(200, snapshot()); }
    if (u.pathname === '/api/config') {
      const next = { ...cfg };
      if (b.shares) { const s = { l1Bps: Number(b.shares.l1Bps), aiBps: Number(b.shares.aiBps), rentalBps: Number(b.shares.rentalBps) }; if (!validShares(s)) return send(400, { error: 'shares must total 100%' }); next.shares = s; }
      if (b.cpuPct !== undefined) { if (![25, 50, 75].includes(Number(b.cpuPct))) return send(400, { error: 'cpuPct must be 25, 50 or 75' }); next.cpuPct = Number(b.cpuPct); }
      for (const k of ['pauseOnBattery', 'pauseOnHeat', 'pauseWhenBusy', 'openBrowser']) if (typeof b[k] === 'boolean') next[k] = b[k];
      if (b.lang === 'ja' || b.lang === 'en') next.lang = b.lang;
      if (typeof b.server === 'string') { if (!/^https?:\/\/[\w.:-]+\/?$/.test(b.server)) return send(400, { error: 'bad server URL' }); next.server = b.server; }
      const restart = JSON.stringify([next.shares, next.cpuPct, next.server]) !== JSON.stringify([cfg.shares, cfg.cpuPct, cfg.server]);
      cfg = next; saveCfg(); if (restart) { log('設定を変更しました。再参加します…', 'Settings changed; re-joining…'); void start(); }
      return send(200, snapshot());
    }
    if (u.pathname === '/api/withdraw') {
      if (!S.info || BigInt(S.info.pendingZnyt || 0) === 0n) return send(400, { error: 'nothing to withdraw' });
      await sendTx(S.info.economy, ABI.encodeFunctionData('withdraw', []), 100000n);
      log('報酬ZNYTを受け取りました', 'Rewards withdrawn'); S.info = await econ(`/provider/info?address=${wallet.address}`); return send(200, snapshot());
    }
  } catch (e) { return send(400, { error: e.message }); }
  send(404, { error: 'not found' });
});
function listen(port) {
  return new Promise((resolve) => { ui.once('error', () => resolve(port < 8910 ? listen(port + 1) : null)); ui.listen(port, '127.0.0.1', () => resolve(port)); });
}
const port = await listen(Number(process.env.ZERONYTH_UI_PORT || 8899));
const url = `http://127.0.0.1:${port}/`;
console.log('\n  ZERONYTH 参加アプリ / Participant app  ' + VERSION);
console.log(`  状態ページ / Status page: ${url}`);
console.log('  このウィンドウを閉じると停止します / Close this window to stop.\n');
if (cfg.openBrowser && !process.env.ZERONYTH_NO_BROWSER) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(cmd, args, { windowsHide: true }, () => {});
}
S.gpu = await detectGpu();
log(`このPC: CPU ${cpus}スレッド中 ${lentThreads()} を貸し出し（L1検証 ${l1ThreadsFor()}）。GPU: ${S.gpu.length ? S.gpu.join(', ') + '（検証はCPUで実行）' : 'なし'}`,
  `This PC: lending ${lentThreads()} of ${cpus} CPU threads (L1 verify ${l1ThreadsFor()}). GPU: ${S.gpu.length ? S.gpu.join(', ') + ' (verification runs on CPU)' : 'none'}`);
setInterval(safetyTick, 15000); await safetyTick();
void infoLoop(); void start();
