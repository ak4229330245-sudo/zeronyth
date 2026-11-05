// Three-scheme key derivation for chain 912701.
//
// Schemes and secret material (the vault stores exactly these bytes):
//   "mldsa"  — ML-DSA-65:   32-byte seed  -> @noble/post-quantum ml_dsa65.keygen(seed)
//   "falcon" — Falcon-1024: 48-byte seed  -> @noble/post-quantum falcon1024.keygen(seed)
//              (UNPADDED export only; the padded variant is a different wire
//               format and is rejected by the chain — see Phase 0 report)
//   "ecdsa"  — ECDSA:       32-byte secp256k1 private key
//
// Address derivation (chain-standard, matches the v1 bundle's `$y`, the
// gateway, pq-lib and the CLI wallet — PQ accounts are scheme-bound and can
// never be operated via another scheme):
//   mldsa / falcon: address = keccak256(publicKey)[12:]   (lowercase hex)
//   ecdsa:          address = keccak256(uncompressedPublicKey[1:])[12:]
//
// PIN: @noble/post-quantum is pinned to EXACTLY 0.7.1. Its falcon module is
// pre-FIPS-206 (NIST round-3 Falcon, matching the chain's BouncyCastle
// verifier) and will change incompatibly when FN-DSA finalizes. Do NOT
// upgrade it. See README.md.

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { falcon1024 } from '@noble/post-quantum/falcon.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { toHex } from './bytes.mjs';

export const SCHEMES = Object.freeze({
  mldsa: Object.freeze({ id: 'mldsa', name: 'ML-DSA-65', secretLength: 32 }),
  falcon: Object.freeze({ id: 'falcon', name: 'Falcon-1024', secretLength: 48 }),
  ecdsa: Object.freeze({ id: 'ecdsa', name: 'ECDSA', secretLength: 32 }),
});

export function isScheme(scheme) {
  return Object.prototype.hasOwnProperty.call(SCHEMES, scheme);
}

export function secretLength(scheme) {
  if (!isScheme(scheme)) throw Error(`Unknown scheme: ${scheme}`);
  return SCHEMES[scheme].secretLength;
}

/** Fresh random secret material for a scheme (vault seed / private key). */
export function generateSecret(scheme) {
  return crypto.getRandomValues(new Uint8Array(secretLength(scheme)));
}

function checkSecret(scheme, secret) {
  const want = secretLength(scheme);
  if (!(secret instanceof Uint8Array) || secret.length !== want) {
    throw Error(`${SCHEMES[scheme].name} secret must be ${want} bytes`);
  }
}

/**
 * Public key bytes for a secret. For ecdsa this is the 65-byte uncompressed
 * secp256k1 public key (0x04 || x || y); for the PQ schemes it is the chain's
 * canonical public key (mldsa 1952 B, falcon 1793 B incl. 0x0a header).
 */
export function publicKeyFromSecret(scheme, secret) {
  checkSecret(scheme, secret);
  switch (scheme) {
    case 'mldsa':
      return ml_dsa65.keygen(secret).publicKey;
    case 'falcon':
      return falcon1024.keygen(secret).publicKey;
    case 'ecdsa':
      return secp256k1.getPublicKey(secret, false);
    default:
      throw Error(`Unknown scheme: ${scheme}`);
  }
}

/** Chain address ("0x" + 40 lowercase hex) for a secret. */
export function addressFromSecret(scheme, secret) {
  const pub = publicKeyFromSecret(scheme, secret);
  const material = scheme === 'ecdsa' ? pub.slice(1) : pub;
  return toHex(keccak_256(material).slice(12));
}

/** Address from an already-derived public key (no secret needed). */
export function addressFromPublicKey(scheme, publicKey) {
  if (!isScheme(scheme)) throw Error(`Unknown scheme: ${scheme}`);
  const material = scheme === 'ecdsa' ? publicKey.slice(1) : publicKey;
  return toHex(keccak_256(material).slice(12));
}
