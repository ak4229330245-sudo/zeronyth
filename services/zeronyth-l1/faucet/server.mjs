import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  JsonRpcProvider,
  NonceManager,
  Wallet,
  formatEther,
  getAddress,
  isAddress,
  parseEther,
} from 'ethers';
import { QueuedSigner } from './signer-queue.mjs'; // per-signer nonce queue: in-process + cross-process lock, chain resync

const PORT = Number(process.env.PORT || 8787);
const RPC_URL = process.env.RPC_URL || 'http://node1:8545';
const PRIVATE_KEY = process.env.FAUCET_PRIVATE_KEY;
const EXPECTED_FAUCET_ADDRESS = process.env.FAUCET_ADDRESS;
const DRIP_ZNYT = process.env.FAUCET_DRIP_ZNYT || '100';
// Rolling cooldowns: one drip per address per COOLDOWN_MS, and one per client IP per IP_COOLDOWN_MS (defaults to the
// address cooldown; the IP comes from the loopback gateway's X-Zeronyth-Client-Ip, i.e. CF-Connecting-IP behind the
// tunnel). 0 disables the IP cooldown. Requests without that header (direct/CI use) skip the IP check.
const COOLDOWN_MS = Number(process.env.FAUCET_COOLDOWN_MS || 60_000);
const IP_COOLDOWN_MS = Number(process.env.FAUCET_IP_COOLDOWN_MS ?? COOLDOWN_MS);
const MAX_QUEUE = Number(process.env.FAUCET_MAX_QUEUE || 32);
// Gas price paid by the faucet itself: FAUCET_GAS_PRICE_WEI when set, otherwise the node's eth_gasPrice (validators
// enforce --min-gas-price, so a hard-coded 0 would be rejected when fees are on).
const FAUCET_GAS_PRICE = /^\d{1,24}$/.test(process.env.FAUCET_GAS_PRICE_WEI || '') ? BigInt(process.env.FAUCET_GAS_PRICE_WEI) : null;
const EXPECTED_CHAIN_ID = BigInt(process.env.CHAIN_ID || '9127');
const MAX_BODY_BYTES = 4096;
// Public-launch abuse protection (all 0 = off, which keeps the old testnet behaviour). Counters reset at 00:00 UTC
// and persist in FAUCET_STATE_FILE so a restart does not reset them. No captcha: caps + per-IP + "already funded" check.
const ADDR_DAILY = Number(process.env.FAUCET_ADDR_DAILY || 0);      // successful drips per address per day
const IP_DAILY = Number(process.env.FAUCET_IP_DAILY || 0);          // successful drips per client IP per day (IP from gateway)
const GLOBAL_DAILY = Number(process.env.FAUCET_GLOBAL_DAILY || 0);  // successful drips per day in total
const SKIP_IF_FUNDED = process.env.FAUCET_SKIP_IF_FUNDED === '1';   // refuse when the address already holds >= one drip
const STATE_FILE = process.env.FAUCET_STATE_FILE || '';
// Persisted state (atomic tmp+rename, mode 600): rolling cooldown timestamps per address and per salted IP hash (raw
// IPs are never stored), plus the optional UTC-day counters. A restart therefore does not reset any limit.
const daily = { day: '', total: 0, addr: {}, ip: {} };
const lastClaim = new Map();   // lowercase address -> claimedAt ms
const lastIpClaim = new Map(); // sha256(salt|ip) -> claimedAt ms
let ipSalt = process.env.FAUCET_IP_SALT || '';
try {
  if (STATE_FILE) {
    const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (saved?.v === 2) {
      Object.assign(daily, saved.daily || {});
      for (const [k, t] of Object.entries(saved.addr || {})) lastClaim.set(k, Number(t));
      for (const [k, t] of Object.entries(saved.ip || {})) lastIpClaim.set(k, Number(t));
      if (!ipSalt && typeof saved.salt === 'string') ipSalt = saved.salt;
    } else if (saved && typeof saved === 'object') Object.assign(daily, saved); // v1: daily counters only
  }
} catch { /* first run */ }
if (!ipSalt) ipSalt = randomBytes(16).toString('hex');
// IPv6 clients are bucketed by /64 (one home line / one host), since privacy extensions and some VPN egresses rotate
// the low 64 bits per connection. IPv4 (and IPv4-mapped IPv6) is used as is.
function ipBucket(ip) {
  const v = ip.toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  if (!v.includes(':')) return v;
  const [head, tail = ''] = v.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const full = v.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${full.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(':')}::/64`;
}
const ipKey = (ip) => createHash('sha256').update(`${ipSalt}|${ipBucket(ip)}`).digest('hex').slice(0, 32);
function persistState() {
  if (!STATE_FILE) return;
  const state = { v: 2, salt: process.env.FAUCET_IP_SALT ? undefined : ipSalt, addr: Object.fromEntries(lastClaim), ip: Object.fromEntries(lastIpClaim), daily };
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state), { mode: 0o600 });
    renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
  } catch (error) { console.error(`faucet state not saved: ${error.message}`); }
}
function today() { const d = new Date().toISOString().slice(0, 10); if (daily.day !== d) Object.assign(daily, { day: d, total: 0, addr: {}, ip: {} }); return daily; }
function dailyRefusal(addrKey, ipHash) {
  const d = today();
  if (GLOBAL_DAILY && d.total >= GLOBAL_DAILY) return 'Daily faucet budget reached; try again after 09:00 JST (00:00 UTC)';
  if (ADDR_DAILY && (d.addr[addrKey] || 0) >= ADDR_DAILY) return 'This address already claimed today';
  if (IP_DAILY && ipHash && (d.ip[ipHash] || 0) >= IP_DAILY) return 'Daily limit for your network reached';
  return null;
}
// Global daily budget (FAUCET_GLOBAL_DAILY claims per UTC day = 09:00 JST reset). Japanese message first.
function globalCapRefusal(res, now) {
  const reset = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
  const retryAfterSeconds = Math.max(1, Math.ceil((reset - now) / 1000));
  const messageJa = `本日の配布上限に達しました（1 日 ${GLOBAL_DAILY} 回・合計 ${GLOBAL_DAILY * Number(DRIP_ZNYT)} ZNYT まで）。次に受け取れるのは ${jst(reset)}（日本時間）以降です。`;
  return send(res, 429, {
    ok: false, error: messageJa, messageJa, code: 'daily_cap',
    message: `Daily faucet budget reached (${GLOBAL_DAILY} claims/day). Try again after ${new Date(reset).toISOString()} (09:00 JST).`,
    retryAfterSeconds, nextClaimAt: new Date(reset).toISOString(), nextClaimAtJst: `${jst(reset)}（日本時間）`,
  }, { 'retry-after': String(retryAfterSeconds) });
}
const jstParts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
function jst(ms) { const p = Object.fromEntries(jstParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return `${p.month}月${p.day}日 ${p.hour}:${p.minute}`; }
function spanJa(ms) { return ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)} 時間` : ms >= 60_000 ? `${Math.round(ms / 60_000)} 分` : `${Math.max(1, Math.round(ms / 1000))} 秒`; }
function cooldownRefusal(res, kind, until, now) {
  const retryAfterSeconds = Math.max(1, Math.ceil((until - now) / 1000));
  const who = kind === 'ip' ? 'この接続元（同じネット回線）からは、すでに受け取り済みです' : 'このアドレスは、すでに受け取り済みです';
  const span = spanJa(kind === 'ip' ? IP_COOLDOWN_MS : COOLDOWN_MS);
  const messageJa = `${who}。フォーセットは 1 人 ${span}に 1 回（${DRIP_ZNYT} ZNYT）までです。次に受け取れるのは ${jst(until)}（日本時間）以降です。`;
  return send(res, 429, {
    ok: false, error: messageJa, messageJa,
    message: `${kind === 'ip' ? 'Your network' : 'This address'} already claimed; one claim per ${Math.round((kind === 'ip' ? IP_COOLDOWN_MS : COOLDOWN_MS) / 3_600_000 * 10) / 10}h. Next claim after ${new Date(until).toISOString()}.`,
    code: kind === 'ip' ? 'cooldown_ip' : 'cooldown_address',
    retryAfterSeconds, nextClaimAt: new Date(until).toISOString(), nextClaimAtJst: `${jst(until)}（日本時間）`,
  }, { 'retry-after': String(retryAfterSeconds) });
}

if (!PRIVATE_KEY) throw new Error('FAUCET_PRIVATE_KEY is required');
if (!EXPECTED_FAUCET_ADDRESS || !isAddress(EXPECTED_FAUCET_ADDRESS)) {
  throw new Error('FAUCET_ADDRESS must be a valid EVM address');
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be 1..65535');
if (!Number.isFinite(COOLDOWN_MS) || COOLDOWN_MS < 0) throw new Error('FAUCET_COOLDOWN_MS must be >= 0');
if (!Number.isFinite(IP_COOLDOWN_MS) || IP_COOLDOWN_MS < 0) throw new Error('FAUCET_IP_COOLDOWN_MS must be >= 0');
if (!Number.isInteger(MAX_QUEUE) || MAX_QUEUE < 1 || MAX_QUEUE > 1000) throw new Error('FAUCET_MAX_QUEUE must be 1..1000');

const dripAmount = parseEther(DRIP_ZNYT);
if (dripAmount <= 0n) throw new Error('FAUCET_DRIP_ZNYT must be greater than zero');

const provider = new JsonRpcProvider(RPC_URL);
const wallet = new Wallet(PRIVATE_KEY, provider);
const expectedFaucetAddress = getAddress(EXPECTED_FAUCET_ADDRESS);
if (wallet.address !== expectedFaucetAddress) {
  throw new Error(`FAUCET_PRIVATE_KEY does not match FAUCET_ADDRESS (${expectedFaucetAddress})`);
}

// QueuedSigner instead of NonceManager: the nonce is re-read from the chain (pending) under a cross-process lock for
// every drip, so another process using this key, a dropped tx or a restart can no longer desync it.
const signer = new QueuedSigner(wallet);
const inFlight = new Set();
let txQueue = Promise.resolve();
let queuedTransactions = 0;

function enqueueTransaction(task) {
  if (queuedTransactions >= MAX_QUEUE) {
    const error = new Error('Faucet is busy; retry shortly');
    error.statusCode = 503;
    throw error;
  }
  queuedTransactions += 1;
  const run = txQueue.then(task, task);
  txQueue = run.catch(() => undefined);
  return run.finally(() => { queuedTransactions -= 1; });
}

function send(res, status, payload, extraHeaders = {}) {
  const body = status === 204 ? '' : JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      const error = new Error('Content-Type must be application/json');
      error.statusCode = 415;
      reject(error);
      req.resume();
      return;
    }

    let done = false;
    const chunks = [];
    let size = 0;

    const fail = (error) => {
      if (done) return;
      done = true;
      reject(error);
    };

    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error('Request body too large');
        error.statusCode = 413;
        fail(error);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw || '{}'));
      } catch {
        const error = new Error('Invalid JSON');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', fail);
  });
}

async function assertExpectedChain() {
  const network = await provider.getNetwork();
  if (network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong chain: expected ${EXPECTED_CHAIN_ID}, got ${network.chainId}`);
  }
  return network;
}

async function handleHealth(res) {
  try {
    const network = await assertExpectedChain();
    const balance = await provider.getBalance(wallet.address);
    send(res, 200, {
      ok: true,
      chainId: network.chainId.toString(),
      address: wallet.address,
      balanceZNYT: formatEther(balance),
      dripZNYT: DRIP_ZNYT,
      cooldownSeconds: Math.round(COOLDOWN_MS / 1000),
      cooldownHours: Math.round(COOLDOWN_MS / 360_000) / 10,
      ipCooldownSeconds: Math.round(IP_COOLDOWN_MS / 1000),
      queueDepth: queuedTransactions,
      claimsToday: today().total, dailyCap: GLOBAL_DAILY || null,
    });
  } catch (error) {
    send(res, 503, { ok: false, error: String(error.message || error) });
  }
}

async function handleClaim(req, res) {
  let key;
  let ipHash = '';
  let reserved = false;
  try {
    const body = await readJson(req);
    const address = body?.address;
    if (typeof address !== 'string' || !isAddress(address)) {
      return send(res, 400, { ok: false, error: 'アドレスの形式が正しくありません（0x で始まる 42 文字）', message: 'Invalid EVM address' });
    }

    const checksumAddress = getAddress(address);
    key = checksumAddress.toLowerCase();
    const ip = String(req.headers['x-zeronyth-client-ip'] || '').trim().slice(0, 45);
    ipHash = ip ? ipKey(ip) : '';
    if (inFlight.has(key)) {
      key = undefined; // the other request owns the in-flight marker
      return send(res, 409, { ok: false, error: 'このアドレスへの送金を処理中です。少し待ってください。', message: 'Claim already in progress' });
    }
    // Check-and-reserve is synchronous (no await in between), so parallel requests cannot both pass.
    const now = Date.now();
    const addrUntil = (lastClaim.get(key) || 0) + COOLDOWN_MS;
    if (addrUntil > now) return cooldownRefusal(res, 'address', addrUntil, now);
    const ipUntil = ipHash && IP_COOLDOWN_MS > 0 ? (lastIpClaim.get(ipHash) || 0) + IP_COOLDOWN_MS : 0;
    if (ipUntil > now) return cooldownRefusal(res, 'ip', ipUntil, now);
    // In-flight drips count too, so parallel claims cannot overshoot the cap.
    if (GLOBAL_DAILY && today().total + inFlight.size >= GLOBAL_DAILY) return globalCapRefusal(res, now);
    const refusal = dailyRefusal(key, ipHash);
    if (refusal) return send(res, 429, { ok: false, error: refusal });

    inFlight.add(key);
    const prevAddr = lastClaim.get(key), prevIp = ipHash ? lastIpClaim.get(ipHash) : undefined;
    lastClaim.set(key, now);
    if (ipHash && IP_COOLDOWN_MS > 0) lastIpClaim.set(ipHash, now);
    reserved = { prevAddr, prevIp };
    persistState(); // persist the reservation first: a crash after sending must not allow a second drip
    await assertExpectedChain();
    if (SKIP_IF_FUNDED && await provider.getBalance(checksumAddress) >= dripAmount) {
      const e = new Error('Address already has enough ZNYT for gas'); e.statusCode = 409; throw e;
    }

    const tx = await enqueueTransaction(async () => {
      const balance = await provider.getBalance(wallet.address);
      if (balance < dripAmount) {
        const error = new Error('Faucet balance is too low');
        error.statusCode = 503;
        throw error;
      }
      try {
        const gasPrice = FAUCET_GAS_PRICE ?? BigInt(await provider.send('eth_gasPrice', []));
        return await signer.sendTransaction({ to: checksumAddress, value: dripAmount, gasPrice, gasLimit: 21000n, type: 0 });
      } catch (error) {
        signer.reset();
        throw error;
      }
    });

    reserved = false; // the drip was sent: keep the cooldown
    { const d = today(); d.total += 1; d.addr[key] = (d.addr[key] || 0) + 1; if (ipHash) d.ip[ipHash] = (d.ip[ipHash] || 0) + 1; }
    persistState();
    return send(res, 200, {
      ok: true,
      txHash: tx.hash,
      address: checksumAddress,
      amountZNYT: DRIP_ZNYT,
      nextClaimAt: new Date(now + COOLDOWN_MS).toISOString(),
      nextClaimAtJst: `${jst(now + COOLDOWN_MS)}（日本時間）`,
    });
  } catch (error) {
    if (reserved && key) {
      // Nothing was sent: give the reservation back (restore any older timestamp).
      if (reserved.prevAddr == null) lastClaim.delete(key); else lastClaim.set(key, reserved.prevAddr);
      if (ipHash) { if (reserved.prevIp == null) lastIpClaim.delete(ipHash); else lastIpClaim.set(ipHash, reserved.prevIp); }
      persistState();
    }
    const status = Number(error.statusCode) || 500;
    return send(res, status, { ok: false, error: String(error.shortMessage || error.message || error) });
  } finally {
    if (key) inFlight.delete(key);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') return handleHealth(res);
  if (req.method === 'POST' && url.pathname === '/claim') return handleClaim(req, res);
  return send(res, 404, { ok: false, error: 'Not found' });
});

server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

const cleanup = setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [k, t] of lastClaim) if (t + COOLDOWN_MS < now && !inFlight.has(k)) { lastClaim.delete(k); changed = true; }
  for (const [k, t] of lastIpClaim) if (t + IP_COOLDOWN_MS < now) { lastIpClaim.delete(k); changed = true; }
  if (changed) persistState();
}, 60_000);
cleanup.unref();

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`Received ${signal}; closing faucet`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, process.env.LISTEN_HOST || '127.0.0.1', () => {
  console.log(`ZERONYTH dev faucet listening on :${PORT} for chain ${EXPECTED_CHAIN_ID}: ${DRIP_ZNYT} ZNYT, cooldown ${COOLDOWN_MS / 1000}s/address, ${IP_COOLDOWN_MS / 1000}s/IP, state ${STATE_FILE ? 'persisted' : 'in memory'} (${lastClaim.size} addr, ${lastIpClaim.size} ip loaded)`);
});
