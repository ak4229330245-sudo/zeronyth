// ZERONYTH contributor accounting (40/30/30) — read-only, rebuilt entirely from on-chain data.
//  node accounting/accounting.mjs [--contract ZnytEconomyFastTest|ZnytEconomy] [--out accounting/out/<network>-<contract>]
// For every EmissionEpoch it recomputes the L1 / AI / VPS buckets and every contributor's capped share with the
// contract's own integer formulas, then checks them against the WorkCredited events and the contract state.
// Service income (10-day plan payments) is attributed per provider by decoding the settlePayment calldata.
// Nothing is signed or sent; no keys are read.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Interface } from 'ethers';
import { provider, artifact, deployment, Contract, formatEther, econRoot, NETWORK } from '../lib/common.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const NAME = arg('--contract', process.env.ECON_CONTRACT || 'ZnytEconomyFastTest');
const OUT = path.resolve(arg('--out', path.join(econRoot, 'accounting', 'out', `${NETWORK}-${NAME}`)));
const CHUNK = Number(process.env.LOG_CHUNK || 1000);
const BPS = 10_000n;
const d = deployment();
const addr = d.v2?.[NAME] || d[NAME];
if (!addr) throw new Error(`no deployment for ${NAME}`);
const abi = artifact('ZnytEconomy').abi; const iface = new Interface(abi);
const econ = new Contract(addr, abi, provider);
const fromBlock = Number(d.v2?.allocatedAtBlock || d.deployedAtBlock || 0);
const toBlock = await provider.getBlockNumber();

const logs = [];
for (let b = fromBlock; b <= toBlock; b += CHUNK) {
  const part = await provider.getLogs({ address: addr, fromBlock: b, toBlock: Math.min(toBlock, b + CHUNK - 1) });
  for (const l of part) { let ev; try { ev = iface.parseLog(l); } catch { continue; } if (ev) logs.push({ ev, l }); }
}
const W = (x) => formatEther(x);
const L = (a) => a.toLowerCase();
const people = new Map();
const who = (a) => { const k = L(a); if (!people.has(k)) people.set(k, { address: a, l1: 0n, ai: 0n, vps: 0n, emission: 0n, service: 0n, withdrawn: 0n, units: { l1: 0n, ai: 0n, vps: 0n }, epochs: 0 }); return people.get(k); };
const checks = []; const fail = (m) => checks.push({ ok: false, m }); const ok = (m) => checks.push({ ok: true, m });
let split = [4000n, 3000n, 3000n], cap = 2500n;      // replaced by EmissionParams history when present
const epochs = []; const credited = new Map();         // key epoch -> [{who,l1,ai,rental,znyt}]
const totals = { released: 0n, paid: 0n, returned: 0n, buckets: [0n, 0n, 0n], bucketPaid: [0n, 0n, 0n], servicePaid: 0n, refunded: 0n, subscribed: 0n, withdrawn: 0n, payments: 0 };
const subs = [];

for (const { ev } of logs) if (ev.name === 'WorkCredited') {
  const e = Number(ev.args.epoch); if (!credited.has(e)) credited.set(e, []);
  credited.get(e).push({ who: ev.args.provider, l1: ev.args.l1Units, ai: ev.args.aiUnits, rental: ev.args.rentalUnits, znyt: ev.args.znyt });
}
let badShares = 0, capHits = 0, splitBad = 0;
for (const { ev, l } of logs) {
  if (ev.name === 'EmissionParams') { split = ev.args.split.map(BigInt); cap = BigInt(ev.args.capBps); }
  if (ev.name === 'EmissionEpoch') {
    const e = Number(ev.args.epoch); const released = ev.args.released; const bucket = ev.args.buckets.map(BigInt);
    const exp = [(released * split[0]) / BPS, (released * split[1]) / BPS]; exp.push(released - exp[0] - exp[1]);
    if (exp.some((x, i) => x !== bucket[i])) splitBad++;
    const rows = credited.get(e) || []; const tot = [0n, 0n, 0n];
    rows.forEach((r) => { tot[0] += r.l1; tot[1] += r.ai; tot[2] += r.rental; });
    const capped = (b, u, t) => { if (t === 0n || u === 0n) return 0n; const s = (b * u) / t; const c = (b * cap) / BPS; if (s >= c && s > 0n) capHits++; return s < c ? s : c; };
    let paid = 0n;
    for (const r of rows) {
      const part = [capped(bucket[0], r.l1, tot[0]), capped(bucket[1], r.ai, tot[1]), capped(bucket[2], r.rental, tot[2])];
      const share = part[0] + part[1] + part[2]; if (share !== r.znyt) badShares++;
      const p = who(r.who); p.l1 += part[0]; p.ai += part[1]; p.vps += part[2]; p.emission += share; p.epochs++;
      p.units.l1 += r.l1; p.units.ai += r.ai; p.units.vps += r.rental;
      part.forEach((x, i) => { totals.bucketPaid[i] += x; }); paid += share;
    }
    if (paid !== ev.args.paid || released - paid !== ev.args.returned) fail(`epoch ${e}: paid/returned mismatch`);
    totals.released += released; totals.paid += ev.args.paid; totals.returned += ev.args.returned; bucket.forEach((x, i) => { totals.buckets[i] += x; });
    epochs.push({ epoch: e, block: l.blockNumber, released: W(released), buckets: bucket.map(W), paid: W(ev.args.paid), returned: W(ev.args.returned), contributors: rows.length });
  }
  if (ev.name === 'Subscribed') { totals.subscribed += ev.args.amount; totals.payments++; subs.push({ id: Number(ev.args.paymentId), payer: ev.args.payer, kind: Number(ev.args.kind) === 0 ? 'VPS' : 'AI', amount: W(ev.args.amount), amountWei: ev.args.amount.toString(), start: Number(ev.args.start), end: Number(ev.args.end), status: 'open' }); }
  if (ev.name === 'Settled') {
    const t = await provider.getTransaction(l.transactionHash); const call = iface.parseTransaction({ data: t.data });
    const ws = call.args.who, wt = call.args.weights.map(BigInt), refundBps = BigInt(call.args.refundBps);
    const pay = await econ.payments(ev.args.paymentId); const refund = (pay.amount * refundBps) / BPS; const toP = pay.amount - refund;
    const totalW = wt.reduce((a, b) => a + b, 0n); let given = 0n;
    ws.forEach((a, i) => { const s = i + 1 === ws.length ? toP - given : (toP * wt[i]) / totalW; given += s; who(a).service += s; });
    if (toP !== ev.args.toProviders || refund !== ev.args.refunded) fail(`payment ${ev.args.paymentId}: settle replay mismatch`);
    totals.servicePaid += ev.args.toProviders; totals.refunded += ev.args.refunded;
    const s = subs.find((x) => x.id === Number(ev.args.paymentId)); if (s) Object.assign(s, { status: 'settled', toProviders: W(ev.args.toProviders), refunded: W(ev.args.refunded), refundBps: Number(refundBps) });
  }
  if (ev.name === 'Refunded') { totals.refunded += ev.args.amount; const s = subs.find((x) => x.id === Number(ev.args.paymentId)); if (s) Object.assign(s, { status: 'self-refunded', refunded: W(ev.args.amount) }); }
  if (ev.name === 'Withdrawn') { who(ev.args.provider).withdrawn += ev.args.amount; totals.withdrawn += ev.args.amount; }
}
// work-epoch (pre-emission) rewards are credited too; account them as "legacy" so the state reconciliation holds
for (const { ev } of logs) if (ev.name === 'WorkEpoch') {
  for (const r of credited.get(Number(ev.args.epoch)) || []) { const p = who(r.who); p.legacy = (p.legacy || 0n) + r.znyt; }
}
badShares ? fail(`${badShares} contributor shares differ from WorkCredited`) : ok('every contributor share recomputed from units, 40/30/30 buckets and the cap matches WorkCredited exactly');
splitBad ? fail(`${splitBad} epochs with a bucket split differing from the configured split`) : ok(`bucket split matches ${split.map((x) => Number(x) / 100).join('/')} in all ${epochs.length} emission epochs`);
ok(`released ${W(totals.released)} = paid ${W(totals.paid)} + returned to pool ${W(totals.returned)}`);
if (totals.released !== totals.paid + totals.returned) fail('released != paid + returned');
// reconcile against contract state
let stateBad = 0;
for (const p of people.values()) {
  const s = await econ.providers(p.address);
  p.onchainEarned = s.earnedZnyt; p.onchainPending = s.pendingZnyt;
  const mine = p.emission + p.service + (p.legacy || 0n);
  if (mine !== s.earnedZnyt || s.earnedZnyt - p.withdrawn !== s.pendingZnyt) stateBad++;
}
stateBad ? fail(`${stateBad} contributors do not reconcile with providers().earnedZnyt/pendingZnyt`) : ok(`all ${people.size} contributors reconcile with on-chain earnedZnyt and pendingZnyt (earned - withdrawn)`);
const [escrowed, pc] = await Promise.all([econ.escrowed(), econ.paymentCount()]);
const openSum = subs.filter((s) => s.status === 'open').reduce((a, s) => a + BigInt(s.amountWei), 0n);
(openSum === escrowed) ? ok(`escrow ${W(escrowed)} ZNYT equals the sum of open plan payments`) : fail(`escrow ${W(escrowed)} != open payments ${W(openSum)}`);
if (Number(pc) !== subs.length) fail(`paymentCount ${pc} != Subscribed events ${subs.length}`);

const ledger = [...people.values()].sort((a, b) => (b.emission + b.service > a.emission + a.service ? 1 : -1)).map((p) => ({
  address: p.address, epochs: p.epochs, units: { l1: p.units.l1.toString(), ai: p.units.ai.toString(), vps: p.units.vps.toString() },
  l1Znyt: W(p.l1), aiZnyt: W(p.ai), vpsZnyt: W(p.vps), emissionZnyt: W(p.emission), servicePlanZnyt: W(p.service), legacyWorkZnyt: W(p.legacy || 0n),
  earnedZnyt: W(p.onchainEarned), withdrawnZnyt: W(p.withdrawn), pendingZnyt: W(p.onchainPending) }));
const report = { generated: new Date().toISOString(), network: NETWORK, contract: NAME, address: addr, blocks: [fromBlock, toBlock],
  config: { splitBps: split.map(Number), capBps: Number(cap), periodSeconds: Number(await econ.period()) },
  totals: { emissionReleased: W(totals.released), emissionPaid: W(totals.paid), returnedToPool: W(totals.returned),
    buckets: { l1: W(totals.buckets[0]), ai: W(totals.buckets[1]), vps: W(totals.buckets[2]) }, bucketsPaid: { l1: W(totals.bucketPaid[0]), ai: W(totals.bucketPaid[1]), vps: W(totals.bucketPaid[2]) },
    planPayments: totals.payments, planPaid: W(totals.subscribed), planToProviders: W(totals.servicePaid), planRefunded: W(totals.refunded), escrowed: W(escrowed), withdrawn: W(totals.withdrawn) },
  checks, allChecksPass: checks.every((c) => c.ok), ledger, plans: subs, epochs: epochs.slice(-50), epochCount: epochs.length };
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'ledger.json'), JSON.stringify(report, null, 2) + '\n');
const cols = ['address', 'epochs', 'l1Znyt', 'aiZnyt', 'vpsZnyt', 'emissionZnyt', 'servicePlanZnyt', 'legacyWorkZnyt', 'earnedZnyt', 'withdrawnZnyt', 'pendingZnyt'];
writeFileSync(path.join(OUT, 'ledger.csv'), [cols.join(','), ...ledger.map((r) => cols.map((c) => r[c]).join(','))].join('\n') + '\n');
const md = [`# ZERONYTH 貢献者精算 (${NAME}, ${NETWORK})`, '', `ブロック ${fromBlock}–${toBlock}・配分 ${split.map((x) => Number(x) / 100).join(' / ')}（L1 / AI / VPS）・1 人あたり上限 ${Number(cap) / 100}%`, '',
  `- 放出 ${report.totals.emissionReleased} ZNYT → 支払い ${report.totals.emissionPaid} / プールに戻し ${report.totals.returnedToPool}`,
  `- 10 日プラン ${totals.payments} 件 ${report.totals.planPaid} ZNYT → 提供者へ ${report.totals.planToProviders} / 返金 ${report.totals.planRefunded} / 預かり中 ${report.totals.escrowed}`, '',
  '| アドレス | L1 | AI | VPS | プラン収入 | 獲得合計 | 引出済 | 未引出 |', '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...ledger.map((r) => `| ${r.address} | ${r.l1Znyt} | ${r.aiZnyt} | ${r.vpsZnyt} | ${r.servicePlanZnyt} | ${r.earnedZnyt} | ${r.withdrawnZnyt} | ${r.pendingZnyt} |`), '',
  '## 検証', ...checks.map((c) => `- ${c.ok ? 'OK' : 'NG'}: ${c.m}`), '', 'テストネットの記録です。ZNYT にお金の価値はありません。'].join('\n');
writeFileSync(path.join(OUT, 'report.md'), md + '\n');
console.log(JSON.stringify({ out: OUT, contributors: ledger.length, epochs: epochs.length, allChecksPass: report.allChecksPass, checks }, null, 1));
if (!report.allChecksPass) process.exitCode = 1;
