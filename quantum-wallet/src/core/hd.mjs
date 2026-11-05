// Master-seed derivation for phrase-backed ("master") wallets.
//
// One 32-byte master seed is the single root of a master wallet. Each
// account secret is derived deterministically with domain separation:
//
//   block(i) = keccak256( utf8(domain) || 0x00 || master(32)
//                         || uint32BE(index) || uint8(i) )
//   secret   = block(0) || block(1) || ... truncated to the scheme's
//              secret length (32 / 48 / 32 bytes)
//
// Domains: "ZERONYTH/WALLET/V2/MLDSA", "ZERONYTH/WALLET/V2/FALCON",
// "ZERONYTH/WALLET/V2/ECDSA". ML-DSA and ECDSA need a single block;
// Falcon needs 48 bytes, so block(0) is extended with block(1) and
// truncated. The derived bytes are fed into the UNCHANGED per-scheme
// key generation (crypto.mjs): noble's ml_dsa65.keygen(seed32) and
// falcon1024.keygen(seed48) are deterministic, and the ECDSA bytes are
// a secp256k1 private key, so a (scheme, index) pair always reproduces
// the same address — which is what makes phrase restore exact.
//
// Legacy wallets (random per-account secrets, including v1-migrated
// ones) do not use this module at all; their vault payloads store the
// secrets themselves, exactly as before.

import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8Encode, concatBytes } from './bytes.mjs';
import { isScheme, secretLength, addressFromSecret } from './crypto.mjs';

export const MASTER_SEED_LENGTH = 32;

const DOMAINS = Object.freeze({
  mldsa: 'ZERONYTH/WALLET/V2/MLDSA',
  falcon: 'ZERONYTH/WALLET/V2/FALCON',
  ecdsa: 'ZERONYTH/WALLET/V2/ECDSA',
  // Non-EVM chain families (multi-chain v12). Same KDF construction, own
  // domains — a chain family's secret is never the EVM ECDSA key.
  solana: 'ZERONYTH/WALLET/V2/SOLANA',
  sui: 'ZERONYTH/WALLET/V2/SUI',
  aptos: 'ZERONYTH/WALLET/V2/APTOS',
  xrp: 'ZERONYTH/WALLET/V2/XRP',
  bitcoin: 'ZERONYTH/WALLET/V2/BTC',
});

/** Fresh random master seed (32 bytes). */
export function generateMasterSeed() {
  return crypto.getRandomValues(new Uint8Array(MASTER_SEED_LENGTH));
}

function checkMaster(master) {
  if (!(master instanceof Uint8Array) || master.length !== MASTER_SEED_LENGTH) {
    throw Error(`Master seed must be ${MASTER_SEED_LENGTH} bytes`);
  }
}

function checkIndex(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index > 0xffffffff) {
    throw Error(`Account index out of range: ${index}`);
  }
}

function kdfBlock(master, domain, index, blockIndex) {
  const idx = new Uint8Array(4);
  new DataView(idx.buffer).setUint32(0, index, false); // big-endian
  return keccak_256(
    concatBytes(utf8Encode(domain), new Uint8Array([0]), master, idx, new Uint8Array([blockIndex])),
  );
}

/**
 * Derive the account secret for (scheme, index) from a master seed.
 * Deterministic: the same triple always yields the same bytes.
 */
export function deriveAccountSecret(master, scheme, index) {
  checkMaster(master);
  if (!isScheme(scheme)) throw Error(`Unknown scheme: ${scheme}`);
  checkIndex(index);
  const want = secretLength(scheme);
  const out = new Uint8Array(want);
  let filled = 0;
  for (let block = 0; filled < want; block++) {
    const b = kdfBlock(master, DOMAINS[scheme], index, block);
    out.set(b.subarray(0, Math.min(32, want - filled)), filled);
    filled += 32;
  }
  return out;
}

/** The chain address of the derived (scheme, index) account. */
export function deriveAccountAddress(master, scheme, index) {
  return addressFromSecret(scheme, deriveAccountSecret(master, scheme, index));
}
