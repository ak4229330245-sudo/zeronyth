// Main-chain silent-drop check after raising --tx-pool-max-size (2026-10-27).
// One faucet drip (10 ZNYT) to a throwaway wallet -> split to SENDERS wallets -> each fires PER tiny
// self-transfers in one burst (no client-side window) -> verify every nonce lands -> refund all to the faucet.
// Cost: ~21000 gas * 1 gwei per tx (~0.13 ZNYT for 6000). Keys live only in memory.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
const here = path.dirname(fileURLToPath(import.meta.url));
const { Wallet, JsonRpcProvider, parseEther, formatEther } = createRequire(path.join(here, '../../economy/package.json'))('ethers');
const RPC = process.env.RPC || 'http://127.0.0.1:9545', FAUCET = process.env.FAUCET || 'http://127.0.0.1:9797';
const SENDERS = Number(process.env.SENDERS || 10), PER = Number(process.env.PER || 600), GP = 1_000_000_000n, GAS = 21000n;
const prov = new JsonRpcProvider(RPC, 9127, { staticNetwork: true, pollingInterval: 250 });
const raw = async (body) => (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const main = Wallet.createRandom().connect(prov); const S = Array.from({ length: SENDERS }, () => Wallet.createRandom().connect(prov));
const faucetAddr = (await (await fetch(`${FAUCET}/health`)).json()).address;
console.log('test wallet', main.address, 'faucet', faucetAddr);
const c = await (await fetch(`${FAUCET}/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: main.address }) })).json();
if (!c.ok) throw new Error('faucet: ' + JSON.stringify(c));
for (let k = 0; k < 60 && (await prov.getBalance(main.address)) === 0n; k++) await sleep(1000);
const share = GAS * GP * BigInt(PER) + parseEther('0.01');
let n = 0; const fts = []; for (const w of S) fts.push(await main.sendTransaction({ to: w.address, value: share, gasPrice: GP, gasLimit: GAS, type: 0, nonce: n++ }));
await Promise.all(fts.map((t) => t.wait()));
const raws = []; for (let i = 0; i < PER; i++) for (const w of S) raws.push(await w.signTransaction({ type: 0, chainId: 9127n, to: w.address, value: 0n, gasPrice: GP, gasLimit: GAS, nonce: i }));
const h0 = await prov.getBlockNumber(); const t0 = Date.now(); let accepted = 0; const errors = {};
for (let i = 0; i < raws.length; i += 200) { const r = await raw(raws.slice(i, i + 200).map((x, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_sendRawTransaction', params: [x] })));
  for (const x of r) if (x.result) accepted++; else errors[x.error?.message] = (errors[x.error?.message] || 0) + 1; }
const tSubmit = Date.now() - t0; let landed = 0;
for (let k = 0; k < 120; k++) { await sleep(1000); landed = 0; for (const w of S) landed += Number(await prov.getTransactionCount(w.address, 'latest')); if (landed >= SENDERS * PER) break; }
const h1 = await prov.getBlockNumber(); const tAll = Date.now() - t0;
let maxTx = 0; for (let b = h0 + 1; b <= h1; b++) { const blk = await prov.getBlock(b); maxTx = Math.max(maxTx, blk.transactions.length); }
const res = { sent: raws.length, rpcAccepted: accepted, rpcErrors: errors, landed, silentlyDropped: accepted - landed, submitMs: tSubmit, allLandedMs: tAll, blocks: [h0 + 1, h1], maxTxPerBlock: maxTx };
console.log(JSON.stringify(res));
// refund everything back to the faucet
const all = [...S, main]; for (const w of all) { const b = await prov.getBalance(w.address); const v = b - GAS * GP; if (v > 0n) await (await w.sendTransaction({ to: faucetAddr, value: v, gasPrice: GP, gasLimit: GAS, type: 0 })).wait(); }
let left = 0n; for (const w of all) left += await prov.getBalance(w.address); console.log('refunded; dust left', formatEther(left));
