// RPC read throughput through the gateway: single upstream (before) vs ZERONYTH_RPC_UPSTREAMS balancing (after).
// Box TEST chain only (default upstreams 8545 + admin ports 8646-8648). Starts a throwaway gateway on a spare port per mode;
// read cache off and the per-IP rate limit raised so we measure the node path, not the limiter.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.BENCH_PORT || 22691);
const DUR = Number(process.env.BENCH_SECONDS || 15) * 1000, CONC = Number(process.env.BENCH_CONC || 32);
const UPS = process.env.BENCH_UPSTREAMS || '8545,8646,8647,8648';
const busy = await new Promise((r) => { const s = net.connect(PORT, '127.0.0.1', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
if (busy) throw new Error(`port ${PORT} busy`);
const cid = await (await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["0x0",false]}' })).json();
if (!cid.result.hash.startsWith('0x6ff4fbac')) throw new Error('not the box test chain');

const harness = `import { createGateway } from ${JSON.stringify(path.join(here, '../scripts/replit-gateway.mjs'))};
createGateway(${JSON.stringify(path.join(here, '../dashboard'))}).listen(${PORT}, '127.0.0.1', () => console.log('up'));`;
async function startGw(env) {
  const p = spawn(process.execPath, ['--input-type=module', '-e', harness], { env: { ...process.env, ZERONYTH_RPC_PORT: '8545', ZERONYTH_READ_CACHE_MS: '0', ZERONYTH_RPC_RPS: '1000000000', ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => p.stdout.once('data', r)); await new Promise((r) => setTimeout(r, 2500)); return p;
}
const head = Number(BigInt((await (await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}' })).json()).result));
const addr = '0x' + '11'.repeat(20);
const bodies0 = [
  { method: 'eth_getBlockByNumber', params: ['latest', true] },
  { method: 'eth_getBalance', params: [addr, 'latest'] },
  { method: 'eth_getBlockByNumber', params: ['0x' + Math.max(1, head - 50).toString(16), false] },
  { method: 'eth_chainId', params: [] },
];
// BENCH_MIX=heavy: CPU-bound eth_call (init-code loop, 65536 iterations ≈ 1.7M gas) = node-bound dapp simulation load
const heavy = [{ method: 'eth_call', params: [{ data: '0x62010000' + '5b600190038060045700', gas: '0x989680' }, 'latest'] }];
const MIX = process.env.BENCH_MIX === 'heavy' ? heavy : bodies0;
const bodies = MIX.map((b, i) => JSON.stringify({ jsonrpc: '2.0', id: i, ...b }));
async function load(url) {
  const lat = []; let ok = 0, err = 0; const end = Date.now() + DUR;
  await Promise.all(Array.from({ length: CONC }, async (_, w) => {
    let i = w;
    while (Date.now() < end) {
      const t = performance.now();
      try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: bodies[i++ % bodies.length] }); const j = await r.json(); if (r.status === 200 && !j.error) ok++; else err++; }
      catch { err++; }
      lat.push(performance.now() - t);
    }
  }));
  lat.sort((a, b) => a - b);
  return { rps: +(ok / (DUR / 1000)).toFixed(1), ok, err, p50_ms: +lat[lat.length >> 1].toFixed(1), p99_ms: +lat[Math.floor(lat.length * 0.99)].toFixed(1) };
}
const out = { at: new Date().toISOString(), chain: 'box test chain 9127 (genesis 0x6ff4fbac…)', concurrency: CONC, seconds: DUR / 1000, mix: process.env.BENCH_MIX === 'heavy' ? 'eth_call 1.7M-gas loop' : 'getBlock(latest,full) / getBalance / getBlock(old) / chainId' };
for (const [name, env] of [['before_single_upstream', {}], ['after_balanced_' + UPS.replaceAll(',', '+'), { ZERONYTH_RPC_UPSTREAMS: UPS }]]) {
  const gw = await startGw(env);
  try {
    out[name] = await load(`http://127.0.0.1:${PORT}/rpc`);
    out[name].upstreams = await (await fetch(`http://127.0.0.1:${PORT}/api/rpc-lb`)).json();
  } finally { gw.kill(); await new Promise((r) => setTimeout(r, 500)); }
  console.log(name, JSON.stringify(out[name]));
}
out.speedup = +(out[Object.keys(out).at(-1)].rps / out.before_single_upstream.rps).toFixed(2);
console.log(JSON.stringify(out, null, 1));
if (process.env.BENCH_OUT) (await import('node:fs')).writeFileSync(process.env.BENCH_OUT, JSON.stringify(out, null, 1) + '\n');
