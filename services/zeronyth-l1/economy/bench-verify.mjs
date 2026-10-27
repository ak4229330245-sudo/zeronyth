// Parallel signature verification benchmark (CPU, worker_threads). No GPU path: no GPU on this host and no
// vetted GPU ML-DSA library is used, so no GPU numbers are claimed.
// Usage: node bench-verify.mjs [threadsList=1,2,4] [mldsaCount=400] [txCount=2000]
import { VerifyPool } from './lib/verify-pool.mjs';
import { ml_dsa65 } from '../dashboard/assets/vendor-noble.mjs';
import { Wallet, Transaction } from 'ethers';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { BACKEND } from './lib/mldsa.mjs';
const threads = (process.argv[2] || '1,2,4').split(',').map(Number);
const M = Number(process.argv[3] || 400); const T = Number(process.argv[4] || 2000);
const kp = ml_dsa65.keygen(randomBytes(32)); const b64 = (u) => Buffer.from(u).toString('base64');
const ml = Array.from({ length: M }, (_, i) => { const msg = randomBytes(96); return { pk: b64(kp.publicKey), msg: b64(msg), sig: b64(ml_dsa65.sign(msg, kp.secretKey)) }; });
const wallets = Array.from({ length: 20 }, () => Wallet.createRandom());
const txs = await Promise.all(Array.from({ length: T }, (_, i) => wallets[i % 20].signTransaction({ to: wallets[(i + 1) % 20].address, value: 1n, nonce: Math.floor(i / 20), gasLimit: 21000n, gasPrice: 1_000_000_000n, chainId: 9127n, type: 0 })));
console.log(`host: ${os.cpus().length} logical CPUs (${os.cpus()[0].model}), node ${process.version}, ML-DSA backend: ${BACKEND}, GPU: none tested`);
for (const n of threads) {
  const pool = new VerifyPool(n);
  await pool.parallel('mldsa', ml.slice(0, n * 4)); await pool.parallel('tx', txs.slice(0, n * 4)); // warm-up
  let t = performance.now(); const okM = (await pool.parallel('mldsa', ml)).filter(Boolean).length; const msM = performance.now() - t;
  t = performance.now(); const okT = (await pool.parallel('tx', txs)).filter((r) => r.ok).length; const msT = performance.now() - t;
  console.log(JSON.stringify({ threads: n, mldsa65: { n: M, valid: okM, ms: +msM.toFixed(1), perSec: Math.round(M / msM * 1000) }, ecdsaTx: { n: T, valid: okT, ms: +msT.toFixed(1), perSec: Math.round(T / msT * 1000) } }));
  await pool.close();
}
