// Nonce-race reproduction + fix check on the BOX TEST CHAIN only (chain 9127 @ 127.0.0.1:8545, valueless).
// Spawns P processes x N concurrent sends from ONE test key. mode=naive uses ethers NonceManager per process (old way),
// mode=queued uses lib/signer-queue.mjs. Usage: node tests/nonce-race.mjs [P=3] [N=10]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NonceManager, parseEther } from 'ethers';
import { provider, roleWallet, GAS_PRICE } from '../lib/common.mjs';
import { QueuedSigner } from '../lib/signer-queue.mjs';
const me = fileURLToPath(import.meta.url);
const [,, a1, a2, a3] = process.argv;
if (a1 === 'child') {
  const mode = a2, N = Number(a3);
  const w = roleWallet('nonce-race-test');
  const s = mode === 'queued' ? new QueuedSigner(w, { chainId: 9127 }) : new NonceManager(w);
  const res = await Promise.allSettled(Array.from({ length: N }, () => s.sendTransaction({ to: w.address, value: 1n, gasLimit: 21000n, gasPrice: GAS_PRICE, type: 0 })));
  const ok = res.filter((r) => r.status === 'fulfilled');
  await Promise.all(ok.map((r) => r.value.wait(1, 60_000).catch(() => null)));
  const errs = res.filter((r) => r.status === 'rejected').map((r) => (r.reason?.shortMessage || r.reason?.message || '').slice(0, 60));
  console.log(JSON.stringify({ ok: ok.length, failed: errs.length, errs: [...new Set(errs)], retries: s.stats?.retries }));
  process.exit(0);
}
const P = Number(a1 || 3), N = Number(a2 || 10);
const dep = new QueuedSigner(roleWallet('deployer'), { chainId: 9127 });
const t = roleWallet('nonce-race-test');
if ((await provider.getBalance(t.address)) < parseEther('1')) await (await dep.sendTransaction({ to: t.address, value: parseEther('2'), gasPrice: GAS_PRICE })).wait();
const runChild = (mode) => new Promise((res) => { let out = ''; const c = spawn(process.execPath, [me, 'child', mode, String(N)], { stdio: ['ignore', 'pipe', 'inherit'] }); c.stdout.on('data', (d) => (out += d)); c.on('exit', () => res(JSON.parse(out.trim().split('\n').pop()))); });
for (const mode of ['naive', 'queued', 'mixed']) {
  const n0 = await provider.getTransactionCount(t.address, 'latest'); const t0 = Date.now();
  const r = await Promise.all(Array.from({ length: P }, (_, i) => runChild(mode === 'mixed' ? (i === 0 ? 'naive' : 'queued') : mode)));
  // mixed: process 0 is an uncoordinated NonceManager sender, the rest are queued -> queued ones must still all succeed
  await new Promise((s) => setTimeout(s, 3000));
  const mined = (await provider.getTransactionCount(t.address, 'latest')) - n0;
  console.log(JSON.stringify({ mode, processes: P, perProcess: N, attempted: P * N, accepted: r.reduce((a, x) => a + x.ok, 0), queuedFailed: mode === 'mixed' ? r.slice(1).reduce((a, x) => a + x.failed, 0) : undefined, failed: r.reduce((a, x) => a + x.failed, 0), mined, errors: [...new Set(r.flatMap((x) => x.errs))], sec: (Date.now() - t0) / 1000 }));
}
process.exit(0);
