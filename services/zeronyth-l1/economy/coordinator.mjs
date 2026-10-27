// ZERONYTH economy coordinator (testnet, valueless ZNYT).
//  - verifies ML-DSA-65 + ECDSA signed provider declarations, attests them on-chain
//  - challenge/response ML-DSA heartbeats (uptime -> rental availability + refund coverage)
//  - L1 pre-verification relay: eth_sendRawTransaction batches are split into jobs for contributor
//    workers (ECDSA sender recovery, chainId/intrinsic-gas, nonce/balance pre-checks). Results are
//    ML-DSA signed, hash-checked for every tx, spot-checked (SPOT fraction) and every "invalid" verdict
//    is re-checked locally, so a lying worker can neither smuggle nor censor txs. Besu still fully
//    validates every tx; pre-verification only filters junk early and offloads the gateway.
//  - AI jobs with redundancy agreement (for the chat-assistant eval/embedding loop)
//  - epoch keeper: FeeSplitter.distribute (20/80), validator claims, submitWorkEpoch, 10-day settlement/refunds
// HTTP 127.0.0.1:${ECON_PORT||8801}. No secrets are ever logged or served.
import http from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { keccak256, toUtf8Bytes, concat } from 'ethers';
import { QueuedSigner } from './lib/signer-queue.mjs'; // per-signer nonce queue (in-process + cross-process lock)
import { provider, artifact, deployment, roleWallet, Contract, rpc, RPC_URL, econRoot, NETWORK, GAS_PRICE, formatEther } from './lib/common.mjs';
import { DOMAINS, b64, hashOf, pqKeyHash, pqVerify, validShares, ecdsaSigner, canonical } from './lib/proto.mjs';
import { VerifyPool } from './lib/verify-pool.mjs';
import { checkTx } from './lib/verify-worker.mjs';
import { totalSupply } from './lib/supply.mjs';

const PORT = Number(process.env.ECON_PORT || 8801);
const HOST = process.env.ECON_HOST || '127.0.0.1';
const EPOCH_MS = Number(process.env.ECON_EPOCH_MS || 60_000);
const EPOCH_BUDGET = BigInt(process.env.ECON_EPOCH_BUDGET_WEI || 1_000_000_000_000_000_000n); // 1 ZNYT / epoch
const CREDIT_PER_UNIT = BigInt(process.env.ECON_CREDIT_PER_UNIT || 1);
const SPOT = Number(process.env.ECON_SPOT || 0.1);
const JOB_SIZE = Number(process.env.ECON_JOB_SIZE || 64);
const JOB_TIMEOUT_MS = Number(process.env.ECON_JOB_TIMEOUT_MS || 1500);
const HB_SLOT_S = Number(process.env.ECON_HB_SLOT_S || 10);
const MAX_STRIKES = 3;
const LOCAL_THREADS = Number(process.env.ECON_LOCAL_THREADS || 1);
const ECON_NAME = process.env.ECON_CONTRACT || 'ZnytEconomy';
const gasPrice = GAS_PRICE;

const d = deployment();
const coordW = new QueuedSigner(roleWallet('coordinator'), { chainId: 9127 });
const adminW = new QueuedSigner(roleWallet('deployer'), { chainId: 9127 });
const ECON_V = process.env.ECON_V1 === '1' || !d.v2?.[ECON_NAME] ? 'v1' : 'v2';
const ECON_ADDR = ECON_V === 'v2' ? d.v2[ECON_NAME] : d[ECON_NAME];
const ZERO = '0x0000000000000000000000000000000000000000';
const econ = new Contract(ECON_ADDR, artifact('ZnytEconomy').abi, coordW);
let emissionAddr = ZERO; try { if (ECON_V === 'v2') emissionAddr = await econ.emission(); } catch {}
const emissionPool = new Contract(emissionAddr, artifact('EmissionPool').abi, coordW);
const splitter = new Contract(d.FeeSplitter, artifact('FeeSplitter').abi, coordW);
const pool = new Contract(d.RewardPool, artifact('RewardPool').abi, adminW);
const stateDir = path.join(econRoot, 'state'); mkdirSync(stateDir, { recursive: true });
const receiptsFile = path.join(stateDir, `receipts-${NETWORK}.jsonl`);
const stateFile = path.join(stateDir, `coordinator-${NETWORK}-${ECON_NAME}${ECON_V === 'v2' ? '-v2' : ''}.json`);
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ------------------------------------------------------------------ persistent state
const S = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { providers: {}, epoch: 0, history: [] };
const save = () => writeFileSync(stateFile, JSON.stringify(S));
const prov = (a) => (S.providers[a.toLowerCase()] ||= { pk: null, decl: null, attested: false, strikes: 0, slots: [], units: { l1: 0, ai: 0, rental: 0 } });
const epochReceipts = [];
const receipt = (r) => { const h = hashOf(r); epochReceipts.push(h); appendFileSync(receiptsFile, JSON.stringify({ ...r, h }) + '\n'); return h; };

let txChain = Promise.resolve();
const tx = (fn) => (txChain = txChain.then(async () => { const t = await fn(); const r = await t.wait(); if (r.status !== 1) throw new Error('reverted'); return r; }).catch((e) => { log('tx error', e.shortMessage || e.message); return null; }));
const ov = () => ({ gasPrice, gasLimit: 3_000_000n });

// ------------------------------------------------------------------ declarations + heartbeats
async function declare(body) {
  const { decl, pqPk, pqSig, ecdsaSig } = body || {};
  if (!decl || decl.v !== 1 || decl.chainId !== 9127 || !validShares(decl.shares)) throw new Error('bad declaration');
  const h = hashOf(decl); const pk = b64.dec(pqPk);
  if (pk.length !== 1952) throw new Error('bad ML-DSA-65 public key');
  if (!pqVerify(DOMAINS.decl, h, pqSig, pk)) throw new Error('ML-DSA signature invalid');
  const signer = ecdsaSigner(h, ecdsaSig);
  if (!signer || signer.toLowerCase() !== String(decl.address).toLowerCase()) throw new Error('ECDSA binding invalid');
  const on = await econ.providers(decl.address);
  if (!on.registered || on.declHash !== h || on.pqKeyHash !== pqKeyHash(pk)) throw new Error('on-chain registration does not match declaration');
  if (Number(on.l1Bps) !== decl.shares.l1Bps || Number(on.aiBps) !== decl.shares.aiBps || Number(on.rentalBps) !== decl.shares.rentalBps) throw new Error('shares mismatch');
  const p = prov(decl.address); p.pk = pqPk; p.decl = decl;
  if (!on.attested) { const r = await tx(() => econ.attestProvider(decl.address, h, ov())); if (!r) throw new Error('attest tx failed'); }
  p.attested = true; save();
  receipt({ t: 'decl', address: decl.address, declHash: h });
  return { attested: true, declHash: h };
}
const challenges = new Map();
function challenge(address) { const n = '0x' + randomBytes(16).toString('hex'); challenges.set(n, { address: address.toLowerCase(), exp: Date.now() + 60_000 }); return { nonce: n }; }
function heartbeat({ address, nonce, sig }) {
  const c = challenges.get(nonce); challenges.delete(nonce);
  if (!c || c.exp < Date.now() || c.address !== String(address).toLowerCase()) throw new Error('bad or expired challenge');
  const p = prov(address); if (!p.attested || !p.pk) throw new Error('not attested');
  if (!pqVerify(DOMAINS.hb, keccak256(concat([address, nonce])), sig, b64.dec(p.pk))) throw new Error('ML-DSA heartbeat invalid');
  const slot = Math.floor(Date.now() / 1000 / HB_SLOT_S);
  if (!p.slots.includes(slot)) { p.slots.push(slot); if (p.slots.length > 200_000) p.slots.shift();
    p.units.rental += p.decl.shares.rentalBps / 10000; }
  return { ok: true, slot };
}

// ------------------------------------------------------------------ L1 pre-verification relay
const localPool = new VerifyPool(LOCAL_THREADS);
const queue = []; const waitingWorkers = []; const jobs = new Map();
const stats = { txIn: 0, txForwarded: 0, txRejectedPre: 0, besuRejected: 0, jobsWorker: 0, jobsLocal: 0, jobsTimedOut: 0, spotChecks: 0, recheckedInvalid: 0, strikes: 0, workerTx: 0, localTx: 0 };

async function stateCheck(results) {
  const ok = results.filter((r) => r.ok); if (!ok.length) return results;
  const senders = [...new Set(ok.map((r) => r.from))];
  const calls = senders.flatMap((a) => [{ jsonrpc: '2.0', id: 0, method: 'eth_getTransactionCount', params: [a, 'latest'] }, { jsonrpc: '2.0', id: 0, method: 'eth_getBalance', params: [a, 'latest'] }]).map((c, i) => ({ ...c, id: i }));
  const res = await (await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls) })).json();
  const byId = new Map((Array.isArray(res) ? res : []).map((x) => [x.id, x.result]));
  // fail-open on read errors: Besu still fully validates, so a missing pre-check only loses filtering, never safety
  const st = new Map(senders.map((a, i) => [a, byId.get(2 * i) != null && byId.get(2 * i + 1) != null ? { nonce: BigInt(byId.get(2 * i)), bal: BigInt(byId.get(2 * i + 1)) } : null]));
  return results.map((r) => {
    if (!r.ok) return r; const s = st.get(r.from); if (!s) return r;
    if (BigInt(r.nonce) < s.nonce) return { ...r, ok: false, reason: 'nonce-too-low' };
    if (BigInt(r.maxCost) > s.bal) return { ...r, ok: false, reason: 'insufficient-funds' };
    if (BigInt(r.gasPrice) < gasPrice) return { ...r, ok: false, reason: 'gas-price-below-min' };
    return r;
  });
}
const STATE_REASONS = new Set(['nonce-too-low', 'insufficient-funds', 'gas-price-below-min']);
const same = (a, b) => a.ok === b.ok && (a.hash || null) === (b.hash || null) && (!a.ok || (a.from === b.from && String(a.nonce) === String(b.nonce)));

async function finishJob(job, results, by) {
  if (job.done) return; job.done = true; clearTimeout(job.timer); jobs.delete(job.id);
  const valid = []; const answers = new Array(job.items.length);
  results.forEach((r, i) => { if (r.ok) valid.push(i); else { answers[i] = { error: { code: -32000, message: `pre-verify rejected: ${r.reason}` } }; stats.txRejectedPre++; } });
  if (valid.length) {
    const body = valid.map((i, k) => ({ jsonrpc: '2.0', id: k, method: 'eth_sendRawTransaction', params: [job.items[i].raw] }));
    const res = await (await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (!Array.isArray(res)) throw new Error('besu batch error: ' + JSON.stringify(res).slice(0, 200));
    for (const r of res) { const i = valid[r.id]; answers[i] = r.error ? { error: r.error } : { result: r.result }; if (r.error) stats.besuRejected++; else stats.txForwarded++; }
  }
  job.items.forEach((it, i) => it.resolve(answers[i]));
  if (by) { const p = prov(by); p.units.l1 += job.items.length; stats.workerTx += job.items.length; receipt({ t: 'l1', job: job.id, by, n: job.items.length, resultsHash: hashOf(results) }); }
  else stats.localTx += job.items.length;
}
async function runLocal(job) {
  stats.jobsLocal++;
  try { const r = await localPool.parallel('tx', job.items.map((x) => x.raw)); await finishJob(job, await stateCheck(r), null); }
  catch (e) { log('local job error', e.message); if (!job.done) { job.done = true; jobs.delete(job.id); job.items.forEach((it) => it.resolve({ error: { code: -32603, message: 'relay internal error' } })); } }
}

function dispatch() {
  while (queue.length) {
    const items = queue.splice(0, JOB_SIZE); const id = '0x' + randomBytes(12).toString('hex');
    const job = { id, items, done: false, worker: null };
    jobs.set(id, job);
    const w = waitingWorkers.shift();
    if (w) {
      job.worker = w.address; stats.jobsWorker++;
      job.timer = setTimeout(() => { if (!job.done) { stats.jobsTimedOut++; void runLocal(job); } }, JOB_TIMEOUT_MS);
      w.res({ jobId: id, type: 'l1-tx', items: items.map((x) => x.raw) });
    } else void runLocal(job);
  }
}
let dispatchTimer = null;
function enqueue(raw) { stats.txIn++; return new Promise((resolve) => { queue.push({ raw, resolve }); if (queue.length >= JOB_SIZE) dispatch(); else dispatchTimer ||= setTimeout(() => { dispatchTimer = null; dispatch(); }, 5); }); }

async function workerResult({ jobId, address, results, sig }) {
  const job = jobs.get(jobId); if (!job || job.done) return { accepted: false, reason: 'unknown or finished job' };
  if (job.worker?.toLowerCase() !== String(address).toLowerCase()) return { accepted: false, reason: 'not your job' };
  const p = prov(address);
  const h = keccak256(concat([jobId, hashOf(results)]));
  let lie = !pqVerify(DOMAINS.l1, h, sig, b64.dec(p.pk)) || !Array.isArray(results) || results.length !== job.items.length;
  if (!lie) {
    for (let i = 0; i < results.length && !lie; i++) {
      if (results[i].hash && results[i].hash !== keccak256(job.items[i].raw)) lie = true;      // cheap, every tx
    }
    // all "invalid" verdicts + a SPOT sample are re-verified. Strikes only for the deterministic, stateless part
    // (signature/sender/chainId/hash/intrinsic gas); state-dependent verdicts (nonce/balance) can race with new
    // blocks, so the coordinator simply replaces them with its own fresh check (anti-censorship, no strike).
    const idx = results.map((r, i) => i).filter((i) => !results[i].ok || Math.random() < SPOT);
    if (!lie && idx.length) {
      const mine = await localPool.parallel('tx', idx.map((i) => job.items[i].raw)); const mineS = await stateCheck(mine);
      stats.spotChecks += idx.length; stats.recheckedInvalid += idx.filter((i) => !results[i].ok).length;
      idx.forEach((i, k) => {
        const w = results[i], m = mine[k];
        const wStateless = w.ok || STATE_REASONS.has(w.reason);   // worker's claim about the stateless checks
        if (wStateless !== m.ok || (m.ok && w.ok && (w.from !== m.from || String(w.nonce) !== String(m.nonce)))) lie = true;
        else if (!w.ok && STATE_REASONS.has(w.reason) && mineS[k].ok) { results[i] = mineS[k]; stats.overridden = (stats.overridden || 0) + 1; }
      });
    }
  }
  if (lie) {
    p.strikes++; stats.strikes++; receipt({ t: 'strike', job: jobId, by: address });
    log(`strike for ${address} (${p.strikes})`); void runLocal(job); save();
    return { accepted: false, reason: 'verification mismatch (strike)' };
  }
  await finishJob(job, results, address); return { accepted: true };
}

// ------------------------------------------------------------------ AI jobs (redundant, agreement-verified)
const aiQueue = []; const aiJobs = new Map(); const aiWaiting = [];
export function addAiJob(kind, payload, redundancy = 2) {
  const id = '0x' + randomBytes(12).toString('hex');
  return new Promise((resolve) => { const j = { id, kind, payload, redundancy, answers: new Map(), assigned: new Set(), resolve, created: Date.now() }; aiJobs.set(id, j); aiQueue.push(j); pumpAi(); });
}
function pumpAi() {
  for (let k = 0; k < aiWaiting.length; k++) {
    const w = aiWaiting[k]; const j = aiQueue.find((x) => !x.assigned.has(w.address) && x.assigned.size < x.redundancy);
    if (!j) continue; j.assigned.add(w.address); aiWaiting.splice(k--, 1);
    w.res({ jobId: j.id, type: 'ai-' + j.kind, payload: j.payload });
    if (j.assigned.size >= j.redundancy) aiQueue.splice(aiQueue.indexOf(j), 1);
  }
}
function aiResult({ jobId, address, output, sig }) {
  const j = aiJobs.get(jobId); if (!j || !j.assigned.has(String(address).toLowerCase())) return { accepted: false };
  const p = prov(address); const h = keccak256(concat([jobId, hashOf(output)]));
  if (!pqVerify(DOMAINS.ai, h, sig, b64.dec(p.pk))) { p.strikes++; return { accepted: false, reason: 'bad signature' }; }
  j.answers.set(address.toLowerCase(), { output, h: hashOf(output) });
  if (j.answers.size >= j.redundancy) {
    const groups = {}; for (const [a, x] of j.answers) (groups[x.h] ||= []).push(a);
    const [winH, winners] = Object.entries(groups).sort((a, b) => b[1].length - a[1].length)[0];
    const agreed = winners.length >= Math.ceil(j.redundancy / 2) + (j.redundancy > 1 ? 0 : 0);
    for (const a of winners) if (agreed) prov(a).units.ai += 1;
    receipt({ t: 'ai', job: jobId, kind: j.kind, agreed, winners, outputHash: winH });
    aiJobs.delete(jobId); j.resolve({ agreed, output: [...j.answers.values()].find((x) => x.h === winH).output, workers: winners });
  }
  return { accepted: true };
}

// ------------------------------------------------------------------ epoch keeper
let supplyCache = null;
async function epochTick() {
  try {
    await tx(() => splitter.distribute(ov()));
    const vals = (await rpc('qbft_getValidatorsByBlockNumber', ['latest'])).map((x) => x.toLowerCase());
    const cur = (await pool.getValidators()).map((x) => x.toLowerCase());
    if (canonical([...vals].sort()) !== canonical([...cur].sort())) await tx(() => pool.setValidators(vals, ov()));
    for (const v of vals) if ((await pool.pending(v)) > 0n) await tx(() => pool.claim(v, ov()));
    // work epoch
    const who = []; const l1 = []; const ai = []; const rental = [];
    for (const [a, p] of Object.entries(S.providers)) {
      const units = p.units; const tot = Math.floor(units.l1) + Math.floor(units.ai) + Math.floor(units.rental);
      if (!p.attested || tot === 0) continue;
      if (p.strikes >= MAX_STRIKES) { p.units = { l1: 0, ai: 0, rental: 0 }; continue; }        // lying node forfeits
      who.push(a); l1.push(Math.floor(units.l1)); ai.push(Math.floor(units.ai)); rental.push(Math.floor(units.rental));
    }
    const epoch = Number(await econ.lastEpoch()) + 1;
    const root = keccak256(epochReceipts.length ? concat(epochReceipts) : '0x');
    const useEmission = emissionAddr !== ZERO;
    let budget = 0n;
    if (!useEmission) { const budgetAvail = await econ.rewardBudget(); budget = budgetAvail < EPOCH_BUDGET ? budgetAvail : EPOCH_BUDGET; }
    else budget = await emissionPool.pendingRelease();
    // with on-chain emission an epoch is submitted even when nobody worked: the released amount goes straight back to the pool
    if (who.length || useEmission) {
      const r = await tx(() => useEmission ? econ.submitEmissionEpoch(epoch, who, l1, ai, rental, root, CREDIT_PER_UNIT, ov())
                                          : econ.submitWorkEpoch(epoch, who, l1, ai, rental, root, budget, CREDIT_PER_UNIT, ov()));
      if (r) { for (let i = 0; i < who.length; i++) { const u = S.providers[who[i]].units; u.l1 -= l1[i]; u.ai -= ai[i]; u.rental -= rental[i]; }
        S.history.push({ epoch, block: r.blockNumber, who, l1, ai, rental, budget: budget.toString(), root }); S.history = S.history.slice(-200);
        log(`epoch ${epoch}: ${who.length} providers, budget ${formatEther(budget)} ZNYT`); epochReceipts.length = 0; }
    }
    await settleDue(); save();
    supplyCache = await totalSupply().then((s) => ({ ...s, supplyWei: s.supplyWei.toString(), at: Date.now() })).catch(() => supplyCache);
  } catch (e) { log('epoch error', e.shortMessage || e.message); }
}
async function settleDue() {
  const n = Number(await econ.paymentCount()); const now = Math.floor(Date.now() / 1000);
  for (let id = Math.max(0, n - 500); id < n; id++) {
    const p = await econ.payments(id);
    if (Number(p.status) !== 1 || Number(p.end) > now) continue;
    const kind = Number(p.kind); const s0 = Math.floor(Number(p.start) / HB_SLOT_S); const s1 = Math.floor(Number(p.end) / HB_SLOT_S);
    const total = Math.max(1, s1 - s0); const covered = new Set(); const weights = {};
    for (const [a, pr] of Object.entries(S.providers)) {
      if (!pr.attested || pr.strikes >= MAX_STRIKES) continue;
      const share = kind === 0 ? pr.decl.shares.rentalBps : pr.decl.shares.aiBps; if (!share) continue;
      const mine = pr.slots.filter((s) => s >= s0 && s < s1); if (!mine.length) continue;
      mine.forEach((s) => covered.add(s)); weights[a] = mine.length * share;
    }
    const coverageBps = Math.min(10000, Math.floor((covered.size * 10000) / total));
    const refundBps = 10000 - coverageBps;  // refund the fraction of the period with no serving provider
    const who = Object.keys(weights); const w = who.map((a) => weights[a]);
    const r = await tx(() => econ.settlePayment(id, who, w, who.length ? refundBps : 10000, ov()));
    if (r) { receipt({ t: 'settle', id, who, w, refundBps: who.length ? refundBps : 10000 }); log(`settled payment ${id}: coverage ${coverageBps / 100}% refund ${(who.length ? refundBps : 10000) / 100}%`); }
  }
}

// ------------------------------------------------------------------ status for explorer pages
async function emissionInfo() {
  if (emissionAddr === ZERO) return null;
  const [rem, allow, daily, yi, ysr, rel, ret, start, yearS, bps, pend, cap, split, paid, back] = await Promise.all([emissionPool.remaining(), emissionPool.currentAllowance(),
    emissionPool.dailyEmission(), emissionPool.yearIndex(), emissionPool.yearStartRemaining(), emissionPool.totalReleased(), emissionPool.totalReturned(), emissionPool.startTime(),
    emissionPool.yearSeconds(), emissionPool.annualBps(), emissionPool.pendingRelease(), econ.capBps(), Promise.all([0, 1, 2].map((i) => econ.emissionSplit(i))), econ.totalEmissionPaid(), econ.totalEmissionReturned()]);
  return { remainingWei: rem.toString(), yearAllowanceWei: allow.toString(), dailyEmissionWei: daily.toString(), year: Number(yi) + 1, yearStartRemainingWei: ysr.toString(),
    totalReleasedWei: rel.toString(), totalReturnedWei: ret.toString(), totalPaidWei: paid.toString(), economyReturnedWei: back.toString(), startTime: Number(start), yearSeconds: Number(yearS),
    annualBps: Number(bps), pendingReleaseWei: pend.toString(), capBps: Number(cap), splitBps: split.map(Number), epochMs: EPOCH_MS };
}
let tokCache = null;
function tokenomics() {
  if (tokCache) return tokCache;
  const v = d.v2 || {};
  tokCache = { totalSupply: '100000000', allocation: [
    { key: 'rewardPool', bps: 3000, amount: '30000000', address: v.EmissionPool || null, note: '15%/year of remaining, L1 40 / AI 30 / VPS 30 by verified work' },
    { key: 'developerUnlocked', bps: 200, amount: '2000000', address: v.developer || null, note: 'unlocked at genesis' },
    { key: 'developerVesting', bps: 1300, amount: '13000000', address: v.DevVesting || null, note: '1-year cliff, then 3-year linear' },
    { key: 'grants', bps: 2000, amount: '20000000', address: v.grants || null },
    { key: 'treasury', bps: 1500, amount: '15000000', address: v.treasury || null },
    { key: 'liquidity', bps: 1000, amount: '10000000', address: v.liquidity || null },
    { key: 'earlyParticipants', bps: 1000, amount: '10000000', address: v.earlyParticipants || null, note: 'box: faucet account' } ] };
  return tokCache;
}
async function vestingInfo() {
  if (!d.v2?.DevVesting) return null;
  const v = new Contract(d.v2.DevVesting, artifact('DevVesting').abi, provider);
  const [tot, rel, able, start, cliff, lin] = await Promise.all([v.totalAllocation(), v.released(), v.releasable(), v.start(), v.cliff(), v.linear()]);
  return { totalWei: tot.toString(), releasedWei: rel.toString(), releasableWei: able.toString(), start: Number(start), cliffEnd: Number(start + cliff), end: Number(start + cliff + lin),
    developerUnlockedBalanceWei: d.v2.developer ? (await provider.getBalance(d.v2.developer)).toString() : null };
}

async function status(user) {
  const [budget, escrowed, lastEpoch, workPaid, servicePaid, refunded, pc, burned, toPool, bps, vps, aip, pr] = await Promise.all([
    econ.rewardBudget(), econ.escrowed(), econ.lastEpoch(), econ.totalWorkRewards(), econ.totalServicePaid(), econ.totalRefunded(), econ.paymentCount(),
    splitter.totalBurned(), splitter.totalToPool(), splitter.burnBps(), econ.price(0), econ.price(1), econ.period()]);
  const providers = [];
  for (const a of (await Promise.all(Array.from({ length: Number(await econ.providerCount()) }, (_, i) => econ.providerList(i))))) {
    const p = await econ.providers(a); const off = S.providers[a.toLowerCase()];
    providers.push({ address: a, attested: p.attested, shares: { l1Bps: Number(p.l1Bps), aiBps: Number(p.aiBps), rentalBps: Number(p.rentalBps) },
      resources: off?.decl?.resources || null, aiCredits: p.aiCredits.toString(), pendingZnyt: p.pendingZnyt.toString(), earnedZnyt: p.earnedZnyt.toString(),
      units: { l1: p.l1Units.toString(), ai: p.aiUnits.toString(), rental: p.rentalUnits.toString() }, strikes: off?.strikes || 0,
      online: off ? off.slots.at(-1) >= Math.floor(Date.now() / 1000 / HB_SLOT_S) - 2 : false });
  }
  let me = null;
  if (user && /^0x[0-9a-fA-F]{40}$/.test(user)) {
    const [ev, ea] = await Promise.all([econ.expiry(user, 0), econ.expiry(user, 1)]);
    me = { address: user, vpsExpiry: Number(ev), aiExpiry: Number(ea), balance: (await provider.getBalance(user)).toString() };
  }
  return { network: NETWORK, contract: ECON_NAME, version: ECON_V, addresses: { economy: ECON_ADDR, emissionPool: emissionAddr, feeSplitter: d.FeeSplitter, rewardPool: d.RewardPool, devVesting: d.v2?.DevVesting || null },
    emission: await emissionInfo(), tokenomics: tokenomics(), vesting: await vestingInfo(),
    fee: { burnBps: Number(bps), totalBurnedWei: burned.toString(), totalToPoolWei: toPool.toString(), minGasPriceWei: gasPrice.toString() },
    supply: supplyCache, prices: { vpsWei: vps.toString(), aiWei: aip.toString(), periodSeconds: Number(pr) },
    economy: { rewardBudgetWei: budget.toString(), escrowedWei: escrowed.toString(), lastEpoch: Number(lastEpoch), totalWorkRewardsWei: workPaid.toString(), totalServicePaidWei: servicePaid.toString(), totalRefundedWei: refunded.toString(), payments: Number(pc) },
    providers, l1: { ...stats, queue: queue.length, waitingWorkers: waitingWorkers.length, spot: SPOT, jobSize: JOB_SIZE }, epochs: S.history.slice(-10), me };
}

// ------------------------------------------------------------------ HTTP
const readBody = (req) => new Promise((resolve, reject) => { let n = 0; const c = []; req.on('data', (x) => { n += x.length; if (n > 4_000_000) { reject(new Error('too large')); req.destroy(); } else c.push(x); }); req.on('end', () => { try { resolve(c.length ? JSON.parse(Buffer.concat(c)) : {}); } catch (e) { reject(e); } }); });
const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(b); };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && u.pathname === '/status') return send(res, 200, await status(u.searchParams.get('address')));
    if (req.method === 'GET' && u.pathname === '/provider/info') {
      const a = String(u.searchParams.get('address') || ''); if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return send(res, 400, { error: 'address required' });
      const p = await econ.providers(a); const off = S.providers[a.toLowerCase()];
      return send(res, 200, { address: a, economy: ECON_ADDR, registered: p.registered, attested: p.attested, declHash: p.declHash, pqKeyHash: p.pqKeyHash,
        shares: { l1Bps: Number(p.l1Bps), aiBps: Number(p.aiBps), rentalBps: Number(p.rentalBps) }, aiCredits: p.aiCredits.toString(), pendingZnyt: p.pendingZnyt.toString(),
        earnedZnyt: p.earnedZnyt.toString(), units: { l1: p.l1Units.toString(), ai: p.aiUnits.toString(), rental: p.rentalUnits.toString() },
        unpaidUnits: off ? { l1: Math.floor(off.units.l1), ai: Math.floor(off.units.ai), rental: Math.floor(off.units.rental) } : null,
        strikes: off?.strikes || 0, maxStrikes: MAX_STRIKES, lastEpoch: Number(await econ.lastEpoch()), epochMs: EPOCH_MS, gasPriceWei: gasPrice.toString(), balanceWei: (await provider.getBalance(a)).toString() });
    }
    if (req.method === 'GET' && u.pathname === '/provider/challenge') return send(res, 200, challenge(String(u.searchParams.get('address') || '')));
    if (req.method === 'POST' && u.pathname === '/provider/declare') return send(res, 200, await declare(await readBody(req)));
    if (req.method === 'POST' && u.pathname === '/provider/heartbeat') return send(res, 200, heartbeat(await readBody(req)));
    if (req.method === 'GET' && (u.pathname === '/l1/jobs/next' || u.pathname === '/ai/jobs/next')) {
      const address = String(u.searchParams.get('address') || '').toLowerCase(); const p = S.providers[address];
      if (!p?.attested || p.strikes >= MAX_STRIKES) return send(res, 403, { error: 'not an attested provider in good standing' });
      const list = u.pathname.startsWith('/l1') ? waitingWorkers : aiWaiting;
      const entry = { address, res: (job) => { clearTimeout(t); send(res, 200, job); } };
      const t = setTimeout(() => { const i = list.indexOf(entry); if (i >= 0) list.splice(i, 1); send(res, 204, {}); }, 15_000);
      req.on('close', () => { const i = list.indexOf(entry); if (i >= 0) { list.splice(i, 1); clearTimeout(t); } });
      list.push(entry); if (list === aiWaiting) pumpAi(); else if (queue.length) dispatch();
      return;
    }
    if (req.method === 'POST' && u.pathname === '/l1/jobs/result') return send(res, 200, await workerResult(await readBody(req)));
    if (req.method === 'POST' && u.pathname === '/ai/jobs/result') return send(res, 200, aiResult(await readBody(req)));
    if (req.method === 'POST' && u.pathname === '/ai/jobs') { const b = await readBody(req); return send(res, 200, await addAiJob(String(b.kind || 'eval'), b.payload, Math.min(3, Math.max(1, Number(b.redundancy || 2))))); }
    if (req.method === 'POST' && u.pathname === '/rpc') {
      const body = await readBody(req); const arr = Array.isArray(body) ? body : [body];
      if (arr.length > 500) return send(res, 400, { error: 'batch too large' });
      const out = await Promise.all(arr.map(async (c) => {
        if (c.method === 'eth_sendRawTransaction' && typeof c.params?.[0] === 'string') return { jsonrpc: '2.0', id: c.id, ...(await enqueue(c.params[0])) };
        if (c.method === 'eth_chainId') return { jsonrpc: '2.0', id: c.id, result: '0x23a7' };
        return { jsonrpc: '2.0', id: c.id, error: { code: -32601, message: 'relay accepts eth_sendRawTransaction only' } };
      }));
      return send(res, 200, Array.isArray(body) ? out : out[0]);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 400, { error: String(e.message || e).slice(0, 200) }); }
});
server.listen(PORT, HOST, () => log(`economy coordinator on ${HOST}:${PORT} (${NETWORK}/${ECON_NAME}), epoch ${EPOCH_MS} ms, spot ${SPOT}`));
setInterval(epochTick, EPOCH_MS); setTimeout(epochTick, 3000);

process.on('unhandledRejection', (e) => log('unhandled', e?.message || e));
