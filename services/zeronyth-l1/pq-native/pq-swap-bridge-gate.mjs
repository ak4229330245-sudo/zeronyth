/**
 * Quantum-resistant gate for native swap / bridge operations.
 * Full ML-DSA verification is required. No shortcuts.
 */
import { ProtocolError } from './pq.mjs';

export async function authorizeNativeSwapOrBridge(tx, verifyMlDsa) {
  if (!tx || !tx.signature) {
    throw new ProtocolError('Missing signature for native swap/bridge');
  }
  const ok = await verifyMlDsa(tx);
  if (!ok) {
    throw new ProtocolError('ML-DSA verification failed — quantum resistance not satisfied');
  }
  return { authorized: true, scheme: 'ML-DSA-65' };
}

export const PQ_REQUIRED = true;
