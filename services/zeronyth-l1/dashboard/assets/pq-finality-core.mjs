// ZERONYTH PQ finality layer: shared (browser + Node) message format and verification.
// ML-DSA-65 (FIPS 204) via @noble/post-quantum, bundled in vendor-noble.mjs.
import { ml_dsa65, keccak_256, secp256k1 } from './vendor-noble.mjs';
import { hexToBytes, bytesToHex, recoverAddress } from './light-client.mjs';

export const SCHEME = 'ML-DSA-65';
export const DOMAIN = 'ZERONYTH-PQ-FINALITY-v1';
const enc = new TextEncoder();
export const b64 = {
  enc: (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); },
  dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};
const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
const cat = (...a) => { const o = new Uint8Array(a.reduce((x, y) => x + y.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

export const pqQuorum = (n) => Math.floor((2 * n) / 3) + 1;
export function pqSetHash(publicKeysB64) { return bytesToHex(keccak_256(cat(...publicKeysB64.map(b64.dec)))); }
export function finalityMessage({ chainId, height, blockHash, validatorSetHash, pqSetHash: ps }) {
  return cat(enc.encode(DOMAIN), u64(chainId), u64(height), hexToBytes(blockHash), hexToBytes(validatorSetHash), hexToBytes(ps));
}
// Binding of a PQ key to an ECDSA validator: both keys sign keccak(domain|address|pqPublicKey).
export function bindingHash(address, pqPublicKey) {
  return keccak_256(cat(enc.encode('ZERONYTH-PQ-BIND-v1'), hexToBytes(address), pqPublicKey));
}
export function signBinding(address, ecdsaPriv32, pqSecretKey, pqPublicKey) {
  const h = bindingHash(address, pqPublicKey);
  const s = secp256k1.sign(h, ecdsaPriv32);
  const ecdsa = cat(s.toCompactRawBytes(), Uint8Array.of(s.recovery));
  return { ecdsaBinding: bytesToHex(ecdsa), pqBinding: b64.enc(ml_dsa65.sign(h, pqSecretKey)) };
}

// Verifies the PQ validator registry: every PQ key is bound to its ECDSA validator
// (ECDSA proof) and proves possession of its own ML-DSA secret key.
export function verifyRegistry(reg, ecdsaValidators = null) {
  if (reg.scheme !== SCHEME) throw new Error('unsupported PQ scheme');
  const allowed = ecdsaValidators ? new Set(ecdsaValidators.map((a) => a.toLowerCase())) : null;
  for (const v of reg.validators) {
    const pk = b64.dec(v.publicKey);
    if (pk.length !== 1952) throw new Error('bad ML-DSA-65 public key length');
    const h = bindingHash(v.address, pk);
    if (recoverAddress(h, hexToBytes(v.ecdsaBinding)) !== v.address.toLowerCase()) throw new Error(`bad ECDSA binding for ${v.address}`);
    if (!ml_dsa65.verify(b64.dec(v.pqBinding), h, pk)) throw new Error(`bad ML-DSA binding for ${v.address}`);
    if (allowed && !allowed.has(v.address.toLowerCase())) throw new Error(`PQ key for non-validator ${v.address}`);
  }
  const hash = pqSetHash(reg.validators.map((v) => v.publicKey));
  if (hash !== reg.setHash) throw new Error('PQ set hash mismatch');
  return hash;
}

// Verifies an ML-DSA quorum certificate. Returns the number of valid distinct signers.
export function verifyCertificate(cert, reg) {
  if (cert.scheme !== SCHEME || cert.pqSetHash !== reg.setHash || cert.chainId !== reg.chainId) throw new Error('certificate/registry mismatch');
  const msg = finalityMessage(cert);
  const seen = new Set();
  for (const s of cert.signatures) {
    const v = reg.validators[s.index];
    if (!v || seen.has(s.index)) throw new Error('bad signer index');
    if (!ml_dsa65.verify(b64.dec(s.signature), msg, b64.dec(v.publicKey))) throw new Error(`invalid ML-DSA signature from #${s.index}`);
    seen.add(s.index);
  }
  const need = pqQuorum(reg.validators.length);
  if (seen.size < need) throw new Error(`PQ quorum not reached ${seen.size}/${need}`);
  return seen.size;
}
export { ml_dsa65, keccak_256 };
