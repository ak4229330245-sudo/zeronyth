// ZERONYTH contributor node: lends CPU (GPU if present) to L1 pre-verification, AI jobs and VPS rental.
// Resource split (default L1 40% / AI 30% / rental 30%, must total 100%):
//   ECON_SHARES=4000,3000,3000  (basis points l1,ai,rental)
// The L1 share decides how many worker threads verify signatures: floor(cpus * l1Bps / 10000), min 1.
// GPU: detected via nvidia-smi only for the declaration; verification runs on CPU (no vetted GPU ML-DSA /
// secp256k1 batch library is used here), so no GPU speedup is claimed.
// Keys: eth key + ML-DSA-65 seed live in economy/.secrets (0600) and are never printed.
// Usage: ECON_ROLE=provider1 [ECON_BEHAVIOR=honest|liar] node contributor-node.mjs
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { keccak256, concat, getBytes } from 'ethers';
import { provider, artifact, deployment, roleWallet, funderWallet, Contract, send, parseEther, econRoot, NETWORK, GAS_PRICE, RPC_URL } from './lib/common.mjs';
import { DOMAINS, DEFAULT_SHARES, b64, hashOf, pqKeyHash, pqSign, validShares } from './lib/proto.mjs';
import { ml_dsa65 } from '../dashboard/assets/vendor-noble.mjs';
import { VerifyPool } from './lib/verify-pool.mjs';

const COORD = process.env.ECON_COORDINATOR || 'http://127.0.0.1:8801';
const ROLE = process.env.ECON_ROLE || 'provider1';
const BEHAVIOR = process.env.ECON_BEHAVIOR || 'honest';
const ECON_NAME = process.env.ECON_CONTRACT || 'ZnytEconomy';
const [l1Bps, aiBps, rentalBps] = (process.env.ECON_SHARES || `${DEFAULT_SHARES.l1Bps},${DEFAULT_SHARES.aiBps},${DEFAULT_SHARES.rentalBps}`).split(',').map(Number);
const shares = { l1Bps, aiBps, rentalBps };
if (!validShares(shares)) throw new Error('ECON_SHARES must be three basis-point integers totalling 10000');
const cpus = Number(process.env.ECON_CPUS || os.cpus().length);
const l1Threads = Math.max(1, Math.floor((cpus * l1Bps) / 10000));
const log = (...a) => console.log(new Date().toISOString(), `[${ROLE}]`, ...a);

function gpus() { try { return execFileSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { timeout: 3000 }).toString().trim().split('\n').filter(Boolean); } catch { return []; } }
const wallet = roleWallet(ROLE);
const seedDir = path.join(econRoot, '.secrets'); mkdirSync(seedDir, { recursive: true, mode: 0o700 });
const seedFile = path.join(seedDir, `${NETWORK}-${ROLE}.mldsa65.seed`);
if (!existsSync(seedFile)) writeFileSync(seedFile, randomBytes(32), { mode: 0o600 });
const kp = ml_dsa65.keygen(new Uint8Array(readFileSync(seedFile)));
const dep = deployment();   // same selection as coordinator.mjs: v2 (EmissionPool-funded) unless ECON_V1=1
const ECON_ADDR = process.env.ECON_V1 !== '1' && dep.v2?.[ECON_NAME] ? dep.v2[ECON_NAME] : dep[ECON_NAME];
const econ = new Contract(ECON_ADDR, artifact('ZnytEconomy').abi, wallet);
const j = async (url, opt) => { const r = await fetch(url, opt); if (r.status === 204) return null; const x = await r.json(); if (r.status >= 400) throw new Error(x.error || r.status); return x; };
const post = (p, body) => j(COORD + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// 1) fund (box only, valueless), register + ML-DSA-signed declaration
if (NETWORK === 'box' && (await provider.getBalance(wallet.address)) < parseEther('1'))
  await send(funderWallet().sendTransaction({ to: wallet.address, value: parseEther('5'), gasPrice: GAS_PRICE }));
const decl = { v: 1, chainId: 9127, address: wallet.address, shares, ts: Math.floor(Date.now() / 1000),
  resources: { cpus, l1Threads, ramMB: Math.round(os.totalmem() / 2 ** 20), diskGB: Number(process.env.ECON_DISK_GB || 20), gpu: gpus(), gpuUsedForVerification: false, arch: os.arch() } };
const declHash = hashOf(decl);
const on = await econ.providers(wallet.address);
if (on.declHash !== declHash) await send(econ.registerProvider(pqKeyHash(kp.publicKey), declHash, l1Bps, aiBps, rentalBps, { gasPrice: GAS_PRICE, gasLimit: 400000n }));
const att = await post('/provider/declare', { decl, pqPk: b64.enc(kp.publicKey), pqSig: pqSign(DOMAINS.decl, declHash, kp.secretKey), ecdsaSig: await wallet.signMessage(getBytes(declHash)) });
log(`attested ${wallet.address} shares L1 ${l1Bps / 100}% / AI ${aiBps / 100}% / rental ${rentalBps / 100}% -> ${l1Threads} L1 threads, GPU: ${decl.resources.gpu.length ? decl.resources.gpu.join('; ') : 'none'}`, att.attested);

// 2) heartbeats (challenge/response)
async function beat() { try { const { nonce } = await j(`${COORD}/provider/challenge?address=${wallet.address}`); await post('/provider/heartbeat', { address: wallet.address, nonce, sig: pqSign(DOMAINS.hb, keccak256(concat([wallet.address, nonce])), kp.secretKey) }); } catch (e) { log('heartbeat', e.message); } }
await beat(); setInterval(beat, Number(process.env.ECON_HB_MS || 5000));

// 3) L1 pre-verification worker loop
const pool = new VerifyPool(l1Threads);
async function stateCheck(results) {
  const ok = results.filter((r) => r.ok); if (!ok.length) return results;
  const senders = [...new Set(ok.map((r) => r.from))];
  const calls = senders.flatMap((a, i) => [{ jsonrpc: '2.0', id: 2 * i, method: 'eth_getTransactionCount', params: [a, 'latest'] }, { jsonrpc: '2.0', id: 2 * i + 1, method: 'eth_getBalance', params: [a, 'latest'] }]);
  const res = await (await fetch(process.env.ECON_READ_RPC || RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls) })).json();
  const byId = new Map((Array.isArray(res) ? res : []).map((x) => [x.id, x.result]));
  // fail-open on read errors: Besu still fully validates, so a missing pre-check only loses filtering, never safety
  const st = new Map(senders.map((a, i) => [a, byId.get(2 * i) != null && byId.get(2 * i + 1) != null ? { nonce: BigInt(byId.get(2 * i)), bal: BigInt(byId.get(2 * i + 1)) } : null]));
  return results.map((r) => { if (!r.ok) return r; const s = st.get(r.from); if (!s) return r;
    if (BigInt(r.nonce) < s.nonce) return { ...r, ok: false, reason: 'nonce-too-low' };
    if (BigInt(r.maxCost) > s.bal) return { ...r, ok: false, reason: 'insufficient-funds' };
    if (BigInt(r.gasPrice) < GAS_PRICE) return { ...r, ok: false, reason: 'gas-price-below-min' };
    return r; });
}
let done = 0;
async function l1Loop() {
  for (;;) {
    try {
      const job = await j(`${COORD}/l1/jobs/next?address=${wallet.address}`); if (!job) continue;
      let results = await stateCheck(await pool.parallel('tx', job.items));
      if (BEHAVIOR === 'liar') results = results.map((r) => ({ ...r, ok: true, reason: undefined }));   // claims invalid txs are valid
      if (BEHAVIOR === 'censor') results = results.map((r) => ({ ...r, ok: false, reason: 'censored' }));
      const h = keccak256(concat([job.jobId, hashOf(results)]));
      const r = await post('/l1/jobs/result', { jobId: job.jobId, address: wallet.address, results, sig: pqSign(DOMAINS.l1, h, kp.secretKey) });
      done += job.items.length; if (!r.accepted) log('result rejected:', r.reason);
    } catch (e) { log('l1', e.message); await new Promise((s) => setTimeout(s, 1000)); }
  }
}
// 4) AI job loop (pluggable executor; see ai/ for the chat assistant backends)
const aiExec = async (job) => {
  if (job.type === 'ai-hash') return { digest: keccak256(new TextEncoder().encode(String(job.payload?.text || ''))) };
  const url = process.env.ECON_AI_BACKEND; if (!url) throw new Error('no AI backend configured');
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: job.type, payload: job.payload }) });
  return await r.json();
};
async function aiLoop() {
  if (aiBps === 0) return;
  for (;;) {
    try {
      const job = await j(`${COORD}/ai/jobs/next?address=${wallet.address}`); if (!job) continue;
      const output = await aiExec(job);
      await post('/ai/jobs/result', { jobId: job.jobId, address: wallet.address, output, sig: pqSign(DOMAINS.ai, keccak256(concat([job.jobId, hashOf(output)])), kp.secretKey) });
    } catch (e) { log('ai', e.message); await new Promise((s) => setTimeout(s, 2000)); }
  }
}
const parallelPolls = Math.max(1, Math.min(4, l1Threads));
for (let i = 0; i < parallelPolls; i++) void l1Loop();
void aiLoop();
setInterval(() => log(`l1 txs verified: ${done}`), 30000);
