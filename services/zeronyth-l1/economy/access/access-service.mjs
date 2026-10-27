// ZERONYTH access service — 10-day ZNYT plans for AI chat and a container "VPS" (BOX TEST CHAIN ONLY).
// Listens on 127.0.0.1 only. Reads chain state; never holds or asks for user keys. Users prove address ownership
// by signing a one-time challenge (EIP-191 personal_sign) in their own wallet.
import http from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, getAddress, verifyMessage, formatEther } from 'ethers';
import { provider, artifact, deployment, NETWORK } from '../lib/common.mjs';
import * as vps from './vps-backend.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ACCESS_PORT || 8805);
const CHAT_URL = process.env.ACCESS_CHAT_URL || 'http://127.0.0.1:9803';
const STATE = process.env.ACCESS_STATE_DIR || '/workspace/zeronyth-access';
const SESSION_S = 3600, CHALLENGE_S = 300;
mkdirSync(STATE, { recursive: true, mode: 0o700 }); chmodSync(STATE, 0o700);
const secretFile = (n) => { const f = path.join(STATE, n); if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString('hex'), { mode: 0o600 }); chmodSync(f, 0o600); return readFileSync(f, 'utf8').trim(); };
const HMAC_KEY = secretFile('session.key');
const TIER_KEY = secretFile('tier.key'); // shared only with the local chat server via ZERONYTH_AI_TIER_KEY_FILE
const receipt = (o) => appendFileSync(path.join(STATE, 'usage.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n', { mode: 0o600 });

const d = deployment().v2 || {};
const abi = artifact('ZnytEconomy').abi;
const CONTRACTS = [
  { key: 'ZnytEconomy', label: '10日プラン（本番仕様・テストチェーン）', address: d.ZnytEconomy },
  { key: 'ZnytEconomyFastTest', label: '高速テスト（30秒＝「10日」の縮小版）', address: d.ZnytEconomyFastTest },
].filter((c) => c.address).map((c) => ({ ...c, c: new Contract(c.address, abi, provider) }));
const KIND = { vps: 0, ai: 1 };

async function plans() {
  return Promise.all(CONTRACTS.map(async (x) => {
    const [period, grace, pv, pa] = await Promise.all([x.c.period(), x.c.grace(), x.c.price(0), x.c.price(1)]);
    return { contract: x.key, label: x.label, address: x.address, periodSeconds: Number(period), graceSeconds: Number(grace),
      plans: [{ kind: 'ai', kindId: 1, priceZnyt: formatEther(pa), includes: 'AI チャット優先キュー＋長めの回答' },
        { kind: 'vps', kindId: 0, priceZnyt: formatEther(pv), includes: 'コンテナ VPS 1台（ネット無し・64MB 作業領域）' }],
      howToBuy: `自分のウォレットから ${x.address} の subscribe(kindId) を、価格ちょうどの ZNYT を付けて呼び出す` };
  }));
}
async function access(address, kind) {
  const now = Math.floor(Date.now() / 1000); const out = [];
  for (const x of CONTRACTS) { const e = Number(await x.c.expiry(address, KIND[kind])); out.push({ contract: x.key, expiry: e, active: e > now }); }
  const best = out.filter((o) => o.active).sort((a, b) => b.expiry - a.expiry)[0];
  return { active: !!best, expiry: best?.expiry || Math.max(0, ...out.map((o) => o.expiry)), via: best?.contract || null, detail: out };
}

// --- wallet-signature sessions ---
const challenges = new Map();
// Public view of the VPS: no internal runtime/host details (container engine, cgroups, host).
const PUBLIC_BACKEND = () => (vps.BACKEND === 'mock' ? 'mock' : 'container');
const PUBLIC_SPEC = { os: 'Alpine Linux 3.20', network: 'なし（インターネットに出られない隔離環境）', storage: '作業領域 64 MB（期限で消去）', limits: '1 コマンド 10 秒まで・メモリ／ファイル数に上限あり' };
const challengeText = (a, n, exp) => `ZERONYTH access login (${NETWORK === 'main' ? 'public testnet' : 'box test chain'} 9127)\naddress: ${a}\nnonce: ${n}\nexpires: ${new Date(exp * 1000).toISOString()}\nThis signature only proves you own this address. It cannot move funds.`;
const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (p) => createHmac('sha256', HMAC_KEY).update(p).digest('base64url');
const makeToken = (a) => { const p = b64(JSON.stringify({ a, exp: Math.floor(Date.now() / 1000) + SESSION_S })); return `${p}.${sign(p)}`; };
function session(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); const [p, s] = t.split('.');
  if (!p || !s) return null; const want = sign(p);
  if (want.length !== s.length || !timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() / 1000 ? o.a : null; } catch { return null; }
}

// --- helpers ---
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
async function body(req, max = 8192) { let n = 0; const ch = []; for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error('too large'), { code: 413 }); ch.push(c); } try { return JSON.parse(Buffer.concat(ch).toString() || '{}'); } catch { throw Object.assign(new Error('invalid JSON'), { code: 400 }); } }
const hits = new Map();
const limited = (key, perMin) => { const now = Date.now(); const a = (hits.get(key) || []).filter((t) => now - t < 60_000); a.push(now); hits.set(key, a); return a.length > perMin; };
const vpsStarted = new Map(); // name -> {address, startedMs}
const execBusy = new Set();

let ledgerCache = { at: 0, data: null };
function ledger(contract) {
  return new Promise((resolve) => {
    if (ledgerCache.data?.[contract] && Date.now() - ledgerCache.at < 60_000) return resolve(ledgerCache.data[contract]);
    execFile(process.execPath, [path.join(here, '..', 'accounting', 'accounting.mjs'), '--contract', contract], { timeout: 60_000, cwd: path.join(here, '..') }, () => {
      try { const f = path.join(here, '..', 'accounting', 'out', `${NETWORK}-${contract}`, 'ledger.json'); const j = JSON.parse(readFileSync(f, 'utf8'));
        ledgerCache = { at: Date.now(), data: { ...(ledgerCache.data || {}), [contract]: j } }; resolve(j); } catch { resolve(null); }
    });
  });
}

// --- reaper: stop containers whose VPS plan has expired ---
async function reap() {
  for (const c of await vps.list()) {
    if (!c.owner || !/^0x[0-9a-f]{40}$/.test(c.owner)) continue;
    let a; try { a = await access(getAddress(c.owner), 'vps'); } catch { continue; }
    if (!a.active) {
      const st = vpsStarted.get(c.name); await vps.stop(c.owner); vpsStarted.delete(c.name);
      receipt({ type: 'vps-stop', reason: 'plan expired', address: c.owner, container: c.name, seconds: st ? Math.round((Date.now() - st.startedMs) / 1000) : null });
      console.log(`[reaper] stopped ${c.name} (plan expired)`);
    }
  }
}
setInterval(() => reap().catch((e) => console.error('[reaper]', e.message)), 10_000).unref();

async function route(req, res) {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  // Behind the public gateway every request comes from loopback; the gateway (never the client) sets X-Zeronyth-Client-Ip.
  const fwd = String(req.headers['x-zeronyth-client-ip'] || '');
  const ip = /^(::ffff:)?127\.0\.0\.1$/.test(req.socket.remoteAddress) && /^[0-9a-fA-F:.]{3,45}$/.test(fwd) ? fwd : req.socket.remoteAddress;
  if (limited(`all:${ip}`, 240)) return json(res, 429, { error: 'rate limited' });
  if (p === '/' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(readFileSync(path.join(here, 'ui', 'plans.html'))); }
  if (p === '/health') return json(res, 200, { ok: true, network: NETWORK, vpsBackend: PUBLIC_BACKEND() });
  if (p === '/plans') return json(res, 200, { network: `${NETWORK} (test chain 9127, valueless ZNYT)`, vps: { backend: PUBLIC_BACKEND(), spec: PUBLIC_SPEC, maxConcurrent: vps.MAX_VPS }, contracts: await plans() });
  if (p === '/accounting') { const c = u.searchParams.get('contract') || 'ZnytEconomyFastTest'; if (!CONTRACTS.some((x) => x.key === c)) return json(res, 400, { error: 'unknown contract' }); const l = await ledger(c); return l ? json(res, 200, l) : json(res, 503, { error: 'accounting unavailable' }); }
  if (p === '/auth/challenge') {
    let a; try { a = getAddress(u.searchParams.get('address') || ''); } catch { return json(res, 400, { error: 'bad address' }); }
    if (limited(`ch:${ip}`, 20)) return json(res, 429, { error: 'rate limited' });
    const n = randomBytes(16).toString('hex'), exp = Math.floor(Date.now() / 1000) + CHALLENGE_S;
    challenges.set(n, { a, exp }); if (challenges.size > 5000) challenges.delete(challenges.keys().next().value);
    return json(res, 200, { nonce: n, message: challengeText(a, n, exp) });
  }
  if (p === '/auth/verify' && req.method === 'POST') {
    const b = await body(req); const ch = challenges.get(b.nonce); challenges.delete(b.nonce);
    if (!ch || ch.exp < Date.now() / 1000) return json(res, 400, { error: 'unknown or expired nonce' });
    let rec; try { rec = verifyMessage(challengeText(ch.a, b.nonce, ch.exp), b.signature); } catch { return json(res, 400, { error: 'bad signature' }); }
    if (rec !== ch.a) return json(res, 401, { error: 'signature does not match address' });
    return json(res, 200, { token: makeToken(ch.a), expiresIn: SESSION_S, address: ch.a });
  }
  const me = session(req);
  if (!me) return json(res, 401, { error: 'login required (sign /auth/challenge)' });
  if (p === '/me') { const [ai, v] = await Promise.all([access(me, 'ai'), access(me, 'vps')]); return json(res, 200, { address: me, ai, vps: v }); }

  if (p === '/ai/chat' && req.method === 'POST') {
    const a = await access(me, 'ai'); if (!a.active) return json(res, 402, { error: 'AI plan not active', expiry: a.expiry });
    if (limited(`ai:${me}`, 20)) return json(res, 429, { error: 'plan rate limit (20/min)' });
    const b = await body(req, 24576);
    const ac = new AbortController(); res.on('close', () => ac.abort());
    let up; try { up = await fetch(`${CHAT_URL}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ZNYT-Tier-Key': TIER_KEY }, body: JSON.stringify({ messages: b.messages, consent: b.consent === true }), signal: AbortSignal.any([ac.signal, AbortSignal.timeout(240_000)]) }); }
    catch { return json(res, 502, { error: 'AI unavailable' }); }
    res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
    let tail = '', tokens = 0, tier = null;
    try { for await (const chunk of up.body) { res.write(chunk); tail = (tail + Buffer.from(chunk).toString()).slice(-4096);
      for (const line of tail.split('\n')) { try { const o = JSON.parse(line); if (o.type === 'done' && o.tokens) tokens = o.tokens; if (o.type === 'meta') tier = o.tier; } catch {} } } } catch {}
    receipt({ type: 'ai-chat', address: me, via: a.via, tier, tokens });
    return res.end();
  }
  if (p.startsWith('/vps/')) {
    const a = await access(me, 'vps'); const name = vps.nameFor(me);
    if (p === '/vps/status') { const c = (await vps.list()).find((x) => x.name === name); return json(res, 200, { plan: a, backend: PUBLIC_BACKEND(), spec: PUBLIC_SPEC, container: c || null }); }
    if (p === '/vps/stop' && req.method === 'POST') { const st = vpsStarted.get(name); const ok = await vps.stop(me); vpsStarted.delete(name); receipt({ type: 'vps-stop', reason: 'user', address: me, container: name, seconds: st ? Math.round((Date.now() - st.startedMs) / 1000) : null }); return json(res, 200, { stopped: ok }); }
    if (!a.active) return json(res, 402, { error: 'VPS plan not active', expiry: a.expiry });
    if (p === '/vps/start' && req.method === 'POST') {
      if (limited(`vs:${me}`, 6)) return json(res, 429, { error: 'rate limited' });
      try { const r = await vps.start(me, a.expiry); if (!vpsStarted.has(name)) vpsStarted.set(name, { address: me, startedMs: Date.now() }); receipt({ type: 'vps-start', address: me, container: name, via: a.via, backend: vps.BACKEND }); return json(res, 200, { ...r, backend: PUBLIC_BACKEND(), spec: PUBLIC_SPEC, planExpiry: a.expiry }); }
      catch (e) { return json(res, 503, { error: e.message }); }
    }
    if (p === '/vps/exec' && req.method === 'POST') {
      const b = await body(req, 4096); if (typeof b.cmd !== 'string' || !b.cmd.trim() || b.cmd.length > 2000) return json(res, 400, { error: 'cmd required (max 2000 chars)' });
      if (limited(`vx:${me}`, 30)) return json(res, 429, { error: 'rate limited (30/min)' });
      if (execBusy.has(name)) return json(res, 409, { error: 'previous command still running' });
      if (!(await vps.list()).some((x) => x.name === name && (x.state === 'running' || x.mock))) return json(res, 409, { error: 'VPS not running; POST /vps/start first' });
      execBusy.add(name); try { const r = await vps.exec(me, b.cmd); return json(res, 200, { ...r, backend: PUBLIC_BACKEND() }); } finally { execBusy.delete(name); }
    }
  }
  return json(res, 404, { error: 'not found' });
}

http.createServer((req, res) => route(req, res).catch((e) => { try { json(res, e.code || 500, { error: e.code ? e.message : 'internal error' }); } catch {} }))
  .listen(PORT, '127.0.0.1', () => console.log(`[access] 127.0.0.1:${PORT} network=${NETWORK} vps=${vps.BACKEND} contracts=${CONTRACTS.map((c) => c.key).join(',')}`));
