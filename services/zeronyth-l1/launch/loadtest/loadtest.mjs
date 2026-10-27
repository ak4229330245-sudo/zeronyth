// Ramp test of the gateway → explorer/RPC/PQ path. Usage: node loadtest.mjs <baseUrl> <light|visitor> <levels csv> [seconds=20] [procs=4]
// Pass criteria per level: p95 < 1000 ms (one block), errors < 1 %, >= 95 % of 1 s ticks executed (not skipped).
import { fork } from 'node:child_process';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [base, kind, levels, secs = '20', procs = '4'] = process.argv.slice(2);
const P = Number(procs); const S = Number(secs);
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
let ipBase = 1;
for (const n of levels.split(',').map(Number)) {
  const per = Math.ceil(n / P);
  const parts = await Promise.all(Array.from({ length: P }, (_, k) => new Promise((res) => {
    const w = fork(path.join(here, 'worker.mjs'), [base, kind, String(per), String(S), String(ipBase + k * per)], { execArgv: ['--max-old-space-size=512'] });
    w.on('message', res);
  })));
  ipBase += P * per;
  const lat = parts.flatMap((p) => p.lat).sort((a, b) => a - b);
  const sum = (k) => parts.reduce((s, p) => s + p[k], 0);
  const total = sum('ok') + sum('err'); const errRate = total ? sum('err') / total : 1;
  const tickRate = sum('cycles') / (sum('cycles') + sum('skipped'));
  const pass = pct(lat, 0.95) < 1000 && errRate < 0.01 && tickRate >= 0.95;
  console.log(JSON.stringify({ kind, clients: per * P, rps: Math.round(total / S), p50: +pct(lat, .5).toFixed(1), p95: +pct(lat, .95).toFixed(1), p99: +pct(lat, .99).toFixed(1),
    errors: sum('err'), s429: sum('s429'), s5xx: sum('s5xx'), ticksDone: +(tickRate * 100).toFixed(1), MBps: +(sum('bytes') / S / 1e6).toFixed(2), pass }));
  await new Promise((r) => setTimeout(r, 4000));
}
