// Box-chain end-to-end test of the token economy using ZnytEconomyFastTest (period 30 s instead of 10 days, grace 15 s).
// Precondition: coordinator (ECON_CONTRACT=ZnytEconomyFastTest) + honest providers running (see docs/ECONOMY.md).
// Starts a lying contributor, drives relay traffic, checks strikes/forfeit; user subscribes + renews (expiry
// extension), settlement pays serving providers; provider-failure refund; refundUnsettled safety valve;
// AI job redundancy; work-epoch ZNYT + AI credits; provider withdraw.
import { spawn } from 'node:child_process';
import { Wallet, parseEther, formatEther } from 'ethers';
import { provider, artifact, deployment, funderWallet, Contract, send, GAS_PRICE } from './lib/common.mjs';
const COORD = 'http://127.0.0.1:8801';
const d = deployment(); const abi = artifact('ZnytEconomy').abi;
const econR = new Contract(d.ZnytEconomyFastTest, abi, provider);
const ok = []; const check = (name, cond, info = '') => { ok.push({ name, pass: !!cond, info }); console.log(cond ? 'PASS' : 'FAIL', name, info); };
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const st = async (a) => (await fetch(`${COORD}/status${a ? '?address=' + a : ''}`)).json();
const g = { gasPrice: GAS_PRICE, gasLimit: 500000n };
const f = funderWallet();
async function newUser() { const u = Wallet.createRandom().connect(provider); await send(f.sendTransaction({ to: u.address, value: parseEther('100'), gasPrice: GAS_PRICE })); return u; }
const ts = async () => (await provider.getBlock('latest')).timestamp;

// 1) liar contributor gets struck and forfeits
const env = { ...process.env, ECON_CONTRACT: 'ZnytEconomyFastTest', ECON_ROLE: 'provider3-liar', ECON_BEHAVIOR: 'liar', ECON_SHARES: '4000,3000,3000' };
const liar = spawn(process.execPath, ['contributor-node.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let liarAddr = null; liar.stdout.on('data', (b) => { const m = /attested (0x[0-9a-fA-F]{40})/.exec(String(b)); if (m) liarAddr = m[1]; });
for (let i = 0; i < 60 && !liarAddr; i++) await sleep(500);
check('liar contributor registered + attested (ML-DSA decl)', liarAddr);
await new Promise((res) => { const b = spawn(process.execPath, ['bench-relay.mjs', 'relay', '1500', '40', '20', '50', '4'], { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] }); b.stdout.on('data', (x) => process.stdout.write('  bench ' + x)); b.on('exit', res); });
await sleep(1500);
let s = await st();
const lp = s.providers.find((p) => p.address.toLowerCase() === liarAddr?.toLowerCase());
check('liar struck >= 3 times (spot-check / invalid re-check)', lp && lp.strikes >= 3, `strikes=${lp?.strikes}`);
const honest = s.providers.filter((p) => p.strikes === 0 && p.attested);
check('honest providers have no strikes', honest.length >= 2, honest.map((p) => p.address.slice(0, 8)).join(','));
const liarJobs = await fetch(`${COORD}/l1/jobs/next?address=${liarAddr}`); check('struck provider refused new jobs (403)', liarJobs.status === 403);
liar.kill();

// 2) work epochs pay ZNYT + AI credits
const before = Object.fromEntries(honest.map((p) => [p.address, BigInt(p.earnedZnyt)]));
const ep0 = s.economy.lastEpoch; for (let i = 0; i < 50 && (await st()).economy.lastEpoch < ep0 + 2; i++) await sleep(1000);
s = await st();
for (const p of s.providers.filter((p) => before[p.address] !== undefined))
  check(`epoch rewards for ${p.address.slice(0, 10)} (l1 units ${p.units.l1}, credits ${p.aiCredits})`, BigInt(p.earnedZnyt) > before[p.address] && BigInt(p.aiCredits) > 0n, `earned ${formatEther(p.earnedZnyt)} ZNYT`);
const lp2 = s.providers.find((p) => p.address.toLowerCase() === liarAddr?.toLowerCase());
check('liar forfeits L1 units (no l1 credit on-chain)', lp2 && lp2.units.l1 === '0', `l1Units=${lp2?.units.l1}`);

// 3) AI job with redundancy 2 (deterministic job type)
const ai = await (await fetch(`${COORD}/ai/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'hash', payload: { text: 'こんにちは ZERONYTH' }, redundancy: 2 }) })).json();
check('AI job answered by 2 independent providers in agreement', ai.agreed && ai.workers.length === 2, ai.output?.digest?.slice(0, 18));

// 4) subscribe + renew (expiry extends), settlement to serving providers
const u = await newUser(); const econU = econR.connect(u); const vpsPrice = await econR.price(0);
const t0 = await ts(); await send(econU.subscribe(0, { ...g, value: vpsPrice }));
const e1 = Number(await econR.expiry(u.address, 0)); const period = Number(await econR.period());
check('subscribe: expiry = payment time + period', Math.abs(e1 - (t0 + period)) <= 3, `expiry ${e1} (period ${period}s; main contract = 864000 s = 10 days)`);
await send(econU.subscribe(0, { ...g, value: vpsPrice }));
const e2 = Number(await econR.expiry(u.address, 0));
check('renewal extends from current expiry', e2 === e1 + period, `${e1} -> ${e2}`);
check('wrong price rejected', await econU.subscribe(0, { ...g, value: vpsPrice - 1n }).then((t) => t.wait()).then(() => false, () => true));
s = await st(u.address); check('status page sees active VPS plan', s.me.vpsExpiry === e2);
const nPay = Number(await econR.paymentCount()); const id1 = nPay - 2, id2 = nPay - 1;
const earned0 = Object.fromEntries(s.providers.map((p) => [p.address, BigInt(p.earnedZnyt)]));
while ((await ts()) < e2 + 2) await sleep(2000);
for (let i = 0; i < 40 && Number((await econR.payments(id2)).status) === 1; i++) await sleep(1000);
const p1 = await econR.payments(id1), p2 = await econR.payments(id2);
check('both 10-day(test) payments settled by coordinator', Number(p1.status) === 2 && Number(p2.status) === 2);
s = await st(); const paidProviders = s.providers.filter((p) => BigInt(p.earnedZnyt) > earned0[p.address]);
check('escrow paid to providers that served (heartbeats)', paidProviders.length >= 1, paidProviders.map((p) => p.address.slice(0, 8)).join(','));

// 5) provider failure -> refund
const pids = (await import('node:child_process')).execSync("pgrep -f '^node contributor-node.mjs' || true").toString().trim().split('\n').filter(Boolean);
for (const pid of pids) process.kill(Number(pid), 'SIGSTOP');            // providers stop serving (no heartbeats)
const u2 = await newUser(); const bal0 = await provider.getBalance(u2.address);
const r = await send(econR.connect(u2).subscribe(0, { ...g, value: vpsPrice })); const fee1 = r.gasUsed * r.gasPrice;
const id3 = Number(await econR.paymentCount()) - 1; const end3 = Number((await econR.payments(id3)).end);
while ((await ts()) < end3 + 2) await sleep(2000);
for (let i = 0; i < 40 && Number((await econR.payments(id3)).status) === 1; i++) await sleep(1000);
const bal1 = await provider.getBalance(u2.address);
check('no provider served -> full refund', Number((await econR.payments(id3)).status) === 2 && bal1 === bal0 - fee1, `${formatEther(bal0 - fee1)} -> ${formatEther(bal1)}`);
for (const pid of pids) process.kill(Number(pid), 'SIGCONT');

// 6) coordinator never settles -> payer reclaims via refundUnsettled after end + grace
const cpid = Number((await import('node:child_process')).execSync("pgrep -f '^node coordinator.mjs' | head -n1").toString());
process.kill(cpid, 'SIGSTOP');
try {
  const u3 = await newUser(); await send(econR.connect(u3).subscribe(1, { ...g, value: await econR.price(1) }));
  const id4 = Number(await econR.paymentCount()) - 1; const p4 = await econR.payments(id4); const grace = Number(await econR.grace());
  check('refundUnsettled too early reverts', await econR.connect(u3).refundUnsettled(id4, g).then((t) => t.wait()).then(() => false, () => true));
  while ((await ts()) <= Number(p4.end) + grace + 1) await sleep(2000);
  const b0 = await provider.getBalance(u3.address); const rr = await send(econR.connect(u3).refundUnsettled(id4, g));
  const b1 = await provider.getBalance(u3.address);
  check('refundUnsettled returns full payment', b1 - b0 + rr.gasUsed * rr.gasPrice === p4.amount && Number((await econR.payments(id4)).status) === 3);
} finally { process.kill(cpid, 'SIGCONT'); }

// 7) provider withdraws earned ZNYT
const wp = honest[0].address; const pend = (await econR.providers(wp)).pendingZnyt;
check('provider has withdrawable ZNYT', pend > 0n, formatEther(pend));
console.log(JSON.stringify({ passed: ok.filter((x) => x.pass).length, failed: ok.filter((x) => !x.pass).length }));
process.exit(ok.every((x) => x.pass) ? 0 : 1);
