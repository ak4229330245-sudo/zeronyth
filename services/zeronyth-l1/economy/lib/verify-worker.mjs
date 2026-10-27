// Worker thread: CPU-bound signature checks. ECDSA (tx sender recovery) and ML-DSA-65 (FIPS 204) verify.
import { parentPort } from 'node:worker_threads';
import { Transaction } from 'ethers';
import { verifyMldsa65 } from './mldsa.mjs';

const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
export function checkTx(raw, chainId = 9127n) {
  try {
    const tx = Transaction.from(raw);
    if (!tx.signature || !tx.from) return { hash: tx.hash, ok: false, reason: 'unsigned' };
    if (tx.chainId !== chainId) return { hash: tx.hash, from: tx.from, ok: false, reason: 'wrong-chain' };
    if (tx.gasLimit < 21000n) return { hash: tx.hash, from: tx.from, ok: false, reason: 'intrinsic-gas' };
    const price = tx.type === 2 ? tx.maxFeePerGas : tx.gasPrice;
    return { hash: tx.hash, from: tx.from, nonce: tx.nonce, maxCost: (tx.gasLimit * (price ?? 0n) + tx.value).toString(),
      gasPrice: (price ?? 0n).toString(), ok: true };
  } catch (e) { return { hash: null, ok: false, reason: 'decode:' + String(e.shortMessage || e.message).slice(0, 60) }; }
}
if (parentPort) parentPort.on('message', ({ id, type, items }) => {
  let out;
  if (type === 'tx') out = items.map((raw) => checkTx(raw));
  else if (type === 'mldsa') out = items.map(({ pk, msg, sig }) => { try { return verifyMldsa65(b64(sig), b64(msg), b64(pk)); } catch { return false; } });
  parentPort.postMessage({ id, out });
});
