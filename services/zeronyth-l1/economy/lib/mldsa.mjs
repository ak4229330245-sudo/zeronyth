// ML-DSA-65 (FIPS 204) verification with an automatic backend:
//   native : Node >= 24 OpenSSL 3.5 `crypto.verify` (much faster), public KeyObjects cached by key bytes
//   noble  : @noble/post-quantum (pure JS) on older Node
// Both are full, independent verifications of every signature (no result caching, no sampling, no shortcuts).
// Interoperability noble <-> native is checked in tests/mldsa-backends.test.mjs.
import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto';
import { ml_dsa65 } from '../../dashboard/assets/vendor-noble.mjs';

export const PK_LEN = 1952, SIG_LEN = 3309;
const SPKI_HDR = Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'); // id-ml-dsa-65 SPKI prefix
let native = false;
try { native = createPublicKey({ key: Buffer.concat([SPKI_HDR, Buffer.alloc(PK_LEN)]), format: 'der', type: 'spki' }).asymmetricKeyType === 'ml-dsa-65'; } catch { native = false; }
if (process.env.ZERONYTH_MLDSA_BACKEND === 'noble') native = false;
export const BACKEND = native ? 'native' : 'noble';

const keys = new Map(); const MAX_KEYS = 1024; // PUBLIC keys only
function keyObject(pk) {
  const id = createHash('sha256').update(pk).digest('base64');
  let k = keys.get(id);
  if (!k) { k = createPublicKey({ key: Buffer.concat([SPKI_HDR, pk]), format: 'der', type: 'spki' }); if (keys.size >= MAX_KEYS) keys.delete(keys.keys().next().value); keys.set(id, k); }
  return k;
}
/** @returns {boolean} true only if sig is a valid ML-DSA-65 signature of msg under pk (empty context). */
export function verifyMldsa65(sig, msg, pk) {
  if (!(sig instanceof Uint8Array) || !(msg instanceof Uint8Array) || !(pk instanceof Uint8Array)) return false;
  if (pk.length !== PK_LEN || sig.length !== SIG_LEN) return false;
  try { return native ? nodeVerify(null, msg, keyObject(pk), sig) : ml_dsa65.verify(sig, msg, pk); } catch { return false; }
}
