/** Isolated CPU worker: independently verifies every ML-DSA-65 signature. */
import { parentPort } from 'node:worker_threads';
import { verifyTransaction } from './pq.mjs';

if (!parentPort) throw Error('Verification worker must be run in a worker thread');

parentPort.on('message', ({ id, transactions, chainId }) => {
  try {
    const verified = transactions.map(tx => {
      const { sender, nonce, value } = verifyTransaction(tx, chainId);
      return { sender, nonce:nonce.toString(), value:value.toString() };
    });
    parentPort.postMessage({ id, verified });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : 'Signature rejected' });
  }
});
