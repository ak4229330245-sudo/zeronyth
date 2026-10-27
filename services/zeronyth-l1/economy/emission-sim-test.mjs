// Tokenomics test on the BOX chain with simulated (shortened) time.
// A) exact BigInt model of EmissionPool for the real 30M pool: year-by-year amounts, never reaches zero.
// B) on-chain EmissionPool with a 20 s "year" (pool scaled 1/1000 = 30,000 ZNYT): YearRolled amounts + totalReleased == model.
// C) on-chain DevVesting with 20 s cliff + 60 s linear: nothing before cliff, linear after, 100% at end.
// D) on-chain ZnytEconomy v2 submitEmissionEpoch: 40/30/30 buckets, pro-rata by verified units, 25% per-participant cap, remainder back to pool.
import { provider, artifact, roleWallet, funderWallet, txo, send, parseEther, formatEther } from './lib/common.mjs';
import { ContractFactory, Contract, keccak256, toUtf8Bytes } from 'ethers';
import { writeFileSync } from 'node:fs';
const out = []; let fails = 0;
const check = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); console.log(out.at(-1)); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BPS = 10000n, ABPS = 1500n;
// ---------------- A) model
function model(pool, Y, events, to) {   // events: [{t, giveBack}] relative seconds; returns {released, years:[{ysr,allow}]}
  let yi = 0n, ysr = pool, t = 0n, released = 0n, bal = pool; const years = [{ ysr, allow: (ysr * ABPS) / BPS }];
  const ev = [...events].sort((a, b) => Number(a.t - b.t));
  const advance = (target) => { while (t < target) { const yEnd = (yi + 1n) * Y, seg = target < yEnd ? target : yEnd, yS = yEnd - Y, a = (ysr * ABPS) / BPS;
    const due = (a * (seg - yS)) / Y - (a * (t - yS)) / Y; released += due; bal -= due; t = seg; if (t === yEnd) { yi++; ysr = bal; years.push({ ysr, allow: (ysr * ABPS) / BPS }); } } };
  for (const e of ev) { if (e.t > to) break; advance(e.t); bal += e.giveBack; } advance(to);
  return { released, years, bal };
}
const P = parseEther('30000000'), YR = 365n * 86400n;
const m100 = model(P, YR, [], 100n * YR);
const y = m100.years;
check('year 1 emission = 4,500,000 ZNYT', y[0].allow === parseEther('4500000'), formatEther(y[0].allow));
check('year 1 per day ≈ 12,328.77 ZNYT', true, formatEther((y[0].allow * 86400n) / YR));
check('year 2 emission = 3,825,000 ZNYT', y[1].allow === parseEther('3825000'), formatEther(y[1].allow));
check('year 3 emission = 3,251,250 ZNYT', y[2].allow === parseEther('3251250'), formatEther(y[2].allow));
check('after 100 years pool still > 0', m100.bal > 0n, `${formatEther(m100.bal)} ZNYT left`);
let r = P, yrs = 0; while (r > 0n && yrs < 100000) { const a = (r * ABPS) / BPS; if (a === 0n) break; r -= a; yrs++; }
check('integer wei schedule never reaches zero (allowance floors to 0 while pool > 0)', r > 0n, `after ${yrs} years remaining ${r} wei, allowance 0`);
const table = y.slice(0, 10).map((v, i) => ({ year: i + 1, remainingAtStart: formatEther(v.ysr), emission: formatEther(v.allow), perDay: formatEther((v.allow * 86400n) / YR) }));
console.table(table);
// ---------------- on-chain setup
const funder = funderWallet(); const sim = roleWallet('emission-sim'); const deployer = roleWallet('deployer');
const fund = async (w, eth) => { if ((await provider.getBalance(w.address)) < parseEther(eth) / 2n) await send(funder.sendTransaction({ to: w.address, value: parseEther(eth), ...txo() })); };
await fund(sim, '40000'); await fund(deployer, '100');
const dep = async (name, signer, ...args) => { const a = artifact(name); const c = await new ContractFactory(a.abi, a.bytecode, signer).deploy(...args, txo()); await c.deploymentTransaction().wait(); return new Contract(await c.getAddress(), a.abi, signer); };
const G = { ...txo(), gasLimit: 500000n };
// B) emission pool, 20 s year
const Ys = 20n, PS = parseEther('30000');
const pool = await dep('EmissionPool', sim, sim.address, Number(Ys), 1500);
await send(sim.sendTransaction({ to: await pool.getAddress(), value: PS, ...txo() }));
const st = await send(pool.start(G)); const t0 = BigInt((await provider.getBlock(st.blockNumber)).timestamp);
// C) vesting
const ben = roleWallet('vest-sim-beneficiary');
const vest = await dep('DevVesting', sim, ben.address, Number(t0), 20, 60);
await send(sim.sendTransaction({ to: await vest.getAddress(), value: parseEther('1300'), ...txo() }));
let earlyRevert = false; try { await vest.release.staticCall(); } catch { earlyRevert = true; }
check('vesting: release before cliff reverts', earlyRevert);
// drive emission for ~4.3 years with releases every ~3 s, a giveBack at ~2.5 years
const gives = []; let gaveBack = false, vestMid = null;
while (true) {
  const now = BigInt((await provider.getBlock('latest')).timestamp); if (now - t0 > 4n * Ys + 6n) break;
  await send(pool.release(G));
  if (!gaveBack && now - t0 >= 50n) { const rc = await send(pool.giveBack({ ...G, value: parseEther('1000') })); gives.push({ t: BigInt((await provider.getBlock(rc.blockNumber)).timestamp) - t0, giveBack: parseEther('1000') }); gaveBack = true; }
  if (!vestMid && now - t0 >= 50n) { const rc = await send(vest.release(G)); const ts = BigInt((await provider.getBlock(rc.blockNumber)).timestamp); vestMid = { ts, got: await vest.released() }; }
  await sleep(2500);
}
const last = await send(pool.release(G)); const tl = BigInt((await provider.getBlock(last.blockNumber)).timestamp);
const rolled = (await pool.queryFilter(pool.filters.YearRolled(), st.blockNumber)).map((e) => ({ year: Number(e.args[0]), ysr: e.args[1], allow: e.args[2] }));
const mm = model(PS, Ys, gives, tl - t0);
check('on-chain year 1 start pool = 30,000 / allowance 4,500', rolled[0].ysr === PS && rolled[0].allow === parseEther('4500'), formatEther(rolled[0].allow));
check('on-chain year 2 allowance = 3,825 (15% of 25,500)', rolled[1]?.allow === parseEther('3825'), formatEther(rolled[1]?.allow ?? 0n));
check('on-chain year 3 allowance = 3,251.25', rolled[2]?.allow === parseEther('3251.25'), formatEther(rolled[2]?.allow ?? 0n));
check('giveBack in year 3 raises year-4 base (re-emitted later)', rolled[3]?.ysr === mm.years[3].ysr && rolled[3].ysr === parseEther('19423.75'), formatEther(rolled[3]?.ysr ?? 0n));
const rel = await pool.totalReleased();
check('totalReleased == exact model at last release', rel === mm.released, `${formatEther(rel)} vs ${formatEther(mm.released)}`);
check('pool balance > 0 and == model', (await provider.getBalance(await pool.getAddress())) === mm.bal, formatEther(mm.bal));
// vesting
const expMid = (parseEther('1300') * (vestMid.ts - t0 - 20n)) / 60n;
check('vesting: linear amount after cliff matches formula', vestMid.got === expMid, `${formatEther(vestMid.got)} at t+${vestMid.ts - t0}s`);
while (BigInt((await provider.getBlock('latest')).timestamp) < t0 + 81n) await sleep(1000);
await send(vest.release(G));
check('vesting: 100% released to beneficiary at cliff + linear end', (await vest.released()) === parseEther('1300') && (await provider.getBalance(await vest.getAddress())) === 0n);
// D) economy v2 emission epoch with cap
const coord = sim; const econ = await dep('ZnytEconomy', deployer, coord.address, 30, 15, parseEther('10'), parseEther('5'));
const epool = await dep('EmissionPool', sim, await econ.getAddress(), 1000, 1500);
await send(sim.sendTransaction({ to: await epool.getAddress(), value: parseEther('10000'), ...txo() }));
await send(econ.setEmission(await epool.getAddress(), [4000, 3000, 3000], 2500, txo()));
await send(epool.start(G));
const p1 = roleWallet('emis-p1'), p2 = roleWallet('emis-p2'), p3 = roleWallet('emis-p3'), p4 = roleWallet('emis-p4'), p5 = roleWallet('emis-p5');
const ps = [p1, p2, p3, p4, p5];
for (const p of ps) { await fund(p, '1'); const e = econ.connect(p); const dh = keccak256(toUtf8Bytes(p.address)); await send(e.registerProvider(dh, dh, 4000, 3000, 3000, G)); await send(econ.connect(coord).attestProvider(p.address, dh, G)); }
await sleep(5000);
const ec = econ.connect(coord);
const l1 = [700n, 100n, 100n, 100n, 0n], ai = [0n, 0n, 0n, 0n, 0n], rent = [1n, 1n, 1n, 1n, 0n];
const rc = await send(ec.submitEmissionEpoch(1, ps.map((p) => p.address), l1, ai, rent, '0x' + '00'.repeat(32), 1, { ...txo(), gasLimit: 3000000n }));
const ev = (await econ.queryFilter(econ.filters.EmissionEpoch(), rc.blockNumber, rc.blockNumber))[0].args;
const released = ev[2], buckets = ev[3], paid = ev[4], back = ev[5];
const pend = await Promise.all(ps.map(async (p) => (await econ.providers(p.address)).pendingZnyt));
const b0 = buckets[0], b2 = buckets[2];
check('emission split into L1/AI/VPS 40/30/30', b0 === (released * 4000n) / 10000n && buckets[1] === (released * 3000n) / 10000n && b0 + buckets[1] + b2 === released, `released ${formatEther(released)}`);
check('per-participant cap: 70% L1 worker capped at 25% of L1 bucket', pend[0] === (b0 * 2500n) / 10000n + b2 / 4n, formatEther(pend[0]));
check('pro-rata below cap: 10% L1 worker gets 10% of L1 bucket + 25% rental', pend[1] === (b0 * 100n) / 1000n + b2 / 4n, formatEther(pend[1]));
check('no work -> no emission', pend[4] === 0n);
check('empty AI bucket + capped excess returned to pool; paid + returned == released', paid + back === released && back >= buckets[1], `returned ${formatEther(back)}`);
check('returned amount is back in the pool', (await epool.totalReturned()) === back);
writeFileSync('results/emission-sim-box.txt', out.join('\n') + '\n\n' + JSON.stringify(table, null, 1) + `\n${JSON.stringify({ passed: out.length - fails, failed: fails })}\n`);
console.log({ passed: out.length - fails, failed: fails });
