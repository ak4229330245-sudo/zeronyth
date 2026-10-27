/**
 * Research stub for batch ML-DSA verification.
 * Does NOT skip individual verification. Quantum resistance preserved.
 * Future work: true batch verification if a safe algorithm is available.
 */
export async function verifyBatch(transactions, verifyOne) {
  // Currently verifies each signature fully and independently.
  const results = [];
  for (const tx of transactions) {
    results.push(await verifyOne(tx));
  }
  return results;
}

export const BATCH_NOTE = 'Full individual ML-DSA verification is mandatory. No shortcuts.';
