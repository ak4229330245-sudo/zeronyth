// End-to-end demo of 10-day ZNYT plans on the BOX TEST CHAIN (valueless ZNYT; test role wallets only).
// Funds two local test wallets from the test `deployer` role (NOT the faucet / funded account), buys plans on
//   - ZnytEconomy          (real 10-day period) : AI + VPS for "plan-user"
//   - ZnytEconomyFastTest  (30 s period)        : AI + VPS for "plan-user-fast" -> watch expiry, reaper, settlement
// then exercises the access service on 127.0.0.1:8805 and reruns the 40/30/30 accounting.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, parseEther, formatEther } from 'ethers';
import { provider, artifact, deployment, roleWallet, queuedRole, txo, send } from '../lib/common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.ACCESS_URL || 'http://127.0.0.1:8805';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const d = deployment().v2; const abi = artifact('ZnytEconomy').abi;
const TEN = new Contract(d.ZnytEconomy, abi, provider), FAST = new Contract(d.ZnytEconomyFastTest, abi, provider);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const api = async (p, { token, method = 'GET', body } = {}) => { const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => null) }; };

async function fund(w, min = 30n) {
  const bal = await provider.getBalance(w.address);
  if (bal >= parseEther(String(min))) return;
  const dep = await queuedRole('deployer'); // per-signer nonce queue: no race with coordinator/other scripts
  await send(dep.sendTransaction({ to: w.address, value: parseEther(String(min)) - bal + parseEther('1'), ...txo() }));
  log(`funded ${w.address.slice(0, 10)}… from test deployer role -> ${formatEther(await provider.getBalance(w.address))} ZNYT`);
}
async function buy(c, w, kind, name) {
  const now = Math.floor(Date.now() / 1000);
  if (Number(await c.expiry(w.address, kind)) > now + 5) return log(`${name}: already active`);
  const r = await send(c.connect(w).subscribe(kind, { value: await c.price(kind), ...txo() }));
  log(`${name}: subscribed kind=${kind} in block ${r.blockNumber}; expiry ${new Date(Number(await c.expiry(w.address, kind)) * 1000).toISOString()}`);
}
async function login(w) {
  const ch = await api(`/auth/challenge?address=${w.address}`);
  const signature = await w.signMessage(ch.j.message);
  const v = await api('/auth/verify', { method: 'POST', body: { nonce: ch.j.nonce, signature } });
  if (!v.j?.token) throw new Error('login failed ' + JSON.stringify(v.j)); return v.j.token;
}
async function chat(token, q) {
  const r = await fetch(API + '/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ messages: [{ role: 'user', content: q }] }) });
  if (r.status !== 200) return { status: r.status, j: await r.json() };
  let text = '', meta = null, done = null, buf = '';
  for await (const ch of r.body) { buf += Buffer.from(ch).toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { const o = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (o.type === 'meta') meta = o; if (o.type === 'delta') text += o.t; if (o.type === 'done') done = o; } }
  return { status: 200, tier: meta?.tier, tokens: done?.tokens, tokPerSec: done?.tokPerSec, text };
}

const u10 = roleWallet('plan-user'), uF = roleWallet('plan-user-fast'), nobody = roleWallet('plan-nobody');
await fund(u10); await fund(uF);
await buy(TEN, u10, 1, 'plan-user  10-day AI ');
await buy(TEN, u10, 0, 'plan-user  10-day VPS');
await buy(FAST, uF, 1, 'plan-user-fast 30s AI ');
await buy(FAST, uF, 0, 'plan-user-fast 30s VPS');

const t10 = await login(u10), tF = await login(uF), tN = await login(nobody);
log('me(plan-user):', JSON.stringify((await api('/me', { token: t10 })).j.vps));
log('no-plan user VPS start ->', (await api('/vps/start', { token: tN, method: 'POST' })).status, '(expect 402)');
log('no-plan user AI chat  ->', (await chat(tN, 'こんにちは')).status, '(expect 402)');
log('bad token           ->', (await api('/me', { token: t10.slice(0, -2) + 'xx' })).status, '(expect 401)');

const sF = await api('/vps/start', { token: tF, method: 'POST' }); log('fast VPS start:', sF.status, JSON.stringify(sF.j).slice(0, 160));
const s10 = await api('/vps/start', { token: t10, method: 'POST' }); log('10-day VPS start:', s10.status, JSON.stringify(s10.j).slice(0, 160));
const ex = await api('/vps/exec', { token: t10, method: 'POST', body: { cmd: 'id; uname -sr; cat /etc/alpine-release; df -h /home/renter | tail -1; echo hello > note.txt && cat note.txt; (wget -T2 -q -O- http://1.1.1.1 >/dev/null 2>&1 && echo NET-OK) || echo NO-NETWORK' } });
log('10-day VPS exec:', ex.status, '\n' + (ex.j.out || ex.j.error));
const runaway = await api('/vps/exec', { token: t10, method: 'POST', body: { cmd: 'sleep 30; echo should-not-print' } });
log('runaway command killed after 10 s -> code', runaway.j.code, JSON.stringify(runaway.j.out).slice(0, 80));

const c = await chat(t10, 'ZNYT の10日プランで何ができますか？短く教えて。');
log(`plan AI chat: status ${c.status} tier=${c.tier} tokens=${c.tokens} tok/s=${c.tokPerSec}\n  ${String(c.text).slice(0, 200).replace(/\n/g, ' ')}`);

// FastTest: wait for expiry -> reaper stops the container -> coordinator settles the payments
const expF = Number(await FAST.expiry(uF.address, 0));
log(`waiting for FastTest VPS plan expiry (${expF - Math.floor(Date.now() / 1000)} s) + reaper…`);
await sleep(Math.max(0, expF * 1000 - Date.now()) + 15_000);
const st = await api('/vps/status', { token: tF }); log('fast VPS after expiry: plan.active=', st.j.plan.active, 'container=', st.j.container ? st.j.container.state : 'removed');
log('fast VPS exec after expiry ->', (await api('/vps/exec', { token: tF, method: 'POST', body: { cmd: 'echo hi' } })).status, '(expect 402)');

const n = Number(await FAST.paymentCount()); const mine = [];
for (let i = 0; i < n; i++) { const p = await FAST.payments(i); if (p.payer === uF.address) mine.push(i); }
log(`waiting for coordinator to settle FastTest payments ${mine.join(',')}…`);
for (let k = 0; k < 30; k++) { const sts = await Promise.all(mine.map(async (i) => Number((await FAST.payments(i)).status))); if (sts.every((x) => x !== 1)) { log('payment status:', sts.join(','), '(2=settled 3=refunded)'); break; } await sleep(5000); }

for (const contract of ['ZnytEconomyFastTest', 'ZnytEconomy']) {
  const out = execFileSync(process.execPath, [path.join(here, '..', 'accounting', 'accounting.mjs'), '--contract', contract], { cwd: path.join(here, '..') }).toString();
  log(`accounting ${contract}:\n` + out.trim().split('\n').slice(-6).join('\n'));
}
