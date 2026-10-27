// TPS/latency benchmark: direct to Besu vs through the pre-verification relay (coordinator /rpc).
// usage: node bench-relay.mjs <direct|relay> <nTx> <invalidPct> [senders=20] [batch=100] [concurrency=1]
// Pre-signs nTx transfers from `senders` funded test wallets (valueless box ZNYT); invalidPct of them
// are junk (wrong chainId / nonce-too-low / unfunded sender / bad signature). Measures:
//   submit time, submit tx/s, inclusion TPS (first send -> last valid tx mined), p50/p95 inclusion latency.
import { Wallet, Transaction, parseEther, keccak256, randomBytes as rb, hexlify } from 'ethers';
import { provider, queuedRole, send, GAS_PRICE, RPC_URL, rpc } from './lib/common.mjs';
const [mode = 'direct', nArg = '2000', badArg = '0', sArg = '20', bArg = '100', cArg = '1'] = process.argv.slice(2);
const C = Number(cArg);
const N = Number(nArg), BAD = Number(badArg) / 100, S = Number(sArg), B = Number(bArg);
const URL_ = mode === 'relay' ? (process.env.ECON_COORDINATOR || 'http://127.0.0.1:8801') + '/rpc' : RPC_URL;
const net = await provider.getNetwork();
const senders = Array.from({ length: S }, () => Wallet.createRandom());
const f = await queuedRole('deployer'); // test deployer role via nonce queue (not the faucet key)
await Promise.all(senders.map((w) => f.sendTransaction({ to: w.address, value: parseEther(process.env.BENCH_FUND || '10'), gasPrice: GAS_PRICE }).then((t) => t.wait())));
const nonces = new Map(await Promise.all(senders.map(async (w) => [w.address, BigInt(await provider.getTransactionCount(w.address))])));
const raws = []; const validHashes = new Set();
for (let i = 0; i < N; i++) {
  const w = senders[i % S]; const bad = Math.random() < BAD; const kind = bad ? i % 4 : -1;
  const tx = { type: 0, to: w.address, value: 1n, gasLimit: 21000n, gasPrice: GAS_PRICE, chainId: net.chainId, nonce: nonces.get(w.address) };
  if (kind === 0) tx.chainId = 1n;                                    // wrong chain
  if (kind === 1) tx.nonce = 0n;                                      // nonce too low (after first)
  let signer = w; if (kind === 2) signer = Wallet.createRandom();     // unfunded sender
  if (kind === 1 && tx.nonce === nonces.get(w.address)) tx.nonce = 2n ** 40n; // ensure invalid-ish
  let raw = await signer.signTransaction(tx);
  if (kind === 3) raw = raw.slice(0, -6) + (raw.slice(-6, -4) === '00' ? '01' : '00') + raw.slice(-4); // corrupt s
  if (!bad) { nonces.set(w.address, nonces.get(w.address) + 1n); validHashes.add(keccak256(raw)); }
  raws.push(raw);
}
const head0 = await provider.getBlockNumber();
const t0 = performance.now(); const sentAt = new Map(); let accepted = 0, rejected = 0;
const chunks = []; for (let i = 0; i < raws.length; i += B) chunks.push(raws.slice(i, i + B));
async function lane() { for (let chunk; (chunk = chunks.shift()); ) { const ts = performance.now();
  const body = chunk.map((r, k) => ({ jsonrpc: '2.0', id: k, method: 'eth_sendRawTransaction', params: [r] }));
  const res = await (await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  for (const r of res) { if (r.error) rejected++; else accepted++; }
  chunk.forEach((r) => sentAt.set(keccak256(r), ts));
} }
await Promise.all(Array.from({ length: C }, lane));
const tSubmit = performance.now() - t0;
const mined = new Map(); let bn = head0 + 1;
const deadline = Date.now() + 120_000;
while (mined.size < validHashes.size && Date.now() < deadline) {
  const head = await provider.getBlockNumber();
  for (; bn <= head; bn++) { const b = await rpc('eth_getBlockByNumber', ['0x' + bn.toString(16), false]); const tb = performance.now();
    for (const h of b.transactions) if (validHashes.has(h) && !mined.has(h)) mined.set(h, tb); }
  await new Promise((s) => setTimeout(s, 100));
}
const tEnd = Math.max(...mined.values()) - t0;
const lat = [...mined].map(([h, t]) => t - sentAt.get(h)).sort((a, b) => a - b);
const pct = (p) => Math.round(lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]);
console.log(JSON.stringify({ mode, n: N, invalidPct: Number(badArg), senders: S, batch: B, concurrency: C, valid: validHashes.size, accepted, rejected,
  submitMs: Math.round(tSubmit), submitTxPerSec: Math.round(N / (tSubmit / 1000)), minedValid: mined.size, inclusionTps: Math.round(mined.size / (tEnd / 1000)),
  latencyMs: { p50: pct(0.5), p95: pct(0.95), max: Math.round(lat.at(-1)) }, blocks: bn - 1 - head0 }));
