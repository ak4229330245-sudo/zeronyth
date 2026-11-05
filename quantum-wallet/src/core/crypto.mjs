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
import { ed25519 } from '@noble/curves/ed25519.js';
import { keccak_256, sha3_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { toHex, concatBytes } from './bytes.mjs';
import { base58Encode, base58CheckEncode, bech32EncodeSegwit, XRP_ALPHABET } from './enc.mjs';

export const SCHEMES = Object.freeze({
  mldsa: Object.freeze({ id: 'mldsa', name: 'ML-DSA-65', secretLength: 32 }),
  falcon: Object.freeze({ id: 'falcon', name: 'Falcon-1024', secretLength: 48 }),
  ecdsa: Object.freeze({ id: 'ecdsa', name: 'ECDSA', secretLength: 32 }),
  // Non-EVM chain families (multi-chain v12). Each has its OWN derived
  // secret (see hd.mjs domains) — an EVM ECDSA key is never reused for
  // BTC/XRP, and Ed25519 families never share material either.
  solana: Object.freeze({ id: 'solana', name: 'Solana', secretLength: 32 }),
  bitcoin: Object.freeze({ id: 'bitcoin', name: 'Bitcoin', secretLength: 32 }),
  xrp: Object.freeze({ id: 'xrp', name: 'XRP', secretLength: 32 }),
  sui: Object.freeze({ id: 'sui', name: 'Sui', secretLength: 32 }),
  aptos: Object.freeze({ id: 'aptos', name: 'Aptos', secretLength: 32 }),
});

/** The original EVM schemes of chain 912701 (the only ones tx.mjs signs). */
export const EVM_SCHEMES = Object.freeze(['ecdsa', 'falcon', 'mldsa']);
/** Non-EVM chain families; each maps 1:1 to its networks in networks.mjs. */
export const CHAIN_FAMILIES = Object.freeze(['solana', 'bitcoin', 'xrp', 'sui', 'aptos']);

export function isScheme(scheme) {
  return Object.prototype.hasOwnProperty.call(SCHEMES, scheme);
}

export function isEvmScheme(scheme) {
  return EVM_SCHEMES.includes(scheme);
}

export function isChainFamily(scheme) {
  return CHAIN_FAMILIES.includes(scheme);
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
 * Chain families: Ed25519 families give the raw 32-byte public key;
 * bitcoin/xrp give the 33-byte compressed secp256k1 public key.
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
    case 'solana':
    case 'sui':
    case 'aptos':
      return ed25519.getPublicKey(secret);
    case 'bitcoin':
    case 'xrp':
      return secp256k1.getPublicKey(secret, true);
    default:
      throw Error(`Unknown scheme: ${scheme}`);
  }
}

/** sha256 → ripemd160 (Bitcoin/XRP "hash160"). */
export function hash160(bytes) {
  return ripemd160(sha256(bytes));
}

/**
 * Canonical address for a secret. EVM schemes use the chain-912701 rules
 * documented at the top of this file. Chain families use their own
 * chain-standard forms (Bitcoin's is the MAINNET bc1 form; the testnet
 * tb1 form is a pure re-encoding produced by the bitcoin engine):
 *   solana:  base58(ed25519 pubkey)
 *   bitcoin: bech32 P2WPKH (bc1…, hash160 of the compressed pubkey)
 *   xrp:     base58check(0x00 ‖ hash160(compressed pubkey), XRP alphabet)
 *   sui:     0x + blake2b-256(0x00 ‖ ed25519 pubkey)
 *   aptos:   0x + sha3-256(ed25519 pubkey ‖ 0x00)
 */
export function addressFromSecret(scheme, secret) {
  return addressFromPublicKey(scheme, publicKeyFromSecret(scheme, secret));
}

/** Address from an already-derived public key (no secret needed). */
export function addressFromPublicKey(scheme, publicKey) {
  if (!isScheme(scheme)) throw Error(`Unknown scheme: ${scheme}`);
  switch (scheme) {
    case 'ecdsa':
      return toHex(keccak_256(publicKey.slice(1)).slice(12));
    case 'mldsa':
    case 'falcon':
      return toHex(keccak_256(publicKey).slice(12));
    case 'solana':
      return base58Encode(publicKey);
    case 'bitcoin':
      return bech32EncodeSegwit('bc', 0, hash160(publicKey));
    case 'xrp':
      return base58CheckEncode(
        concatBytes(new Uint8Array([0x00]), hash160(publicKey)),
        XRP_ALPHABET,
      );
    case 'sui':
      return toHex(blake2b(concatBytes(new Uint8Array([0x00]), publicKey), { dkLen: 32 }));
    case 'aptos':
      return toHex(sha3_256(concatBytes(publicKey, new Uint8Array([0x00]))));
    default:
      throw Error(`Unknown scheme: ${scheme}`);
  }
}
