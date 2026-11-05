// Three-scheme transaction engines for chain 912701.
//
// Wire formats (chain-standard; cross-verified against PortE2ETool and
// the chain's own decoders — see test/tx.test.mjs and Phase 0):
//
//   ECDSA (legacy, EIP-155):
//     sighash = keccak256(rlp([nonce, gasPrice, gasLimit, to, value, data,
//                              chainId, 0, 0]))
//     raw     = rlp([nonce, gasPrice, gasLimit, to, value, data, v, r, s])
//               with v = chainId*2 + 35 + recoveryId
//
//   Falcon-1024 (type 0x7E) / ML-DSA-65 (type 0x7F):
//     digest  = keccak256( UTF8(domain) ||
//                 rlp([nonce, gasPrice, gasLimit, to, value, data, chainId]) )
//               domain = "ZERONYTH/FALCON-1024/TX/V1" (falcon)
//                        "ZERONYTH/ML-DSA-65/TX/V1"  (mldsa)
//     raw     = type || rlp([nonce, gasPrice, gasLimit, to, value, data,
//                            chainId, publicKey, signature])
//     sender  = keccak256(publicKey)[12:]  (scheme-bound: a PQ account can
//               only ever be spent by its own scheme's signature)
//
// `to: null` builds a contract-creation transaction (empty `to` field).
// All scalar fields accept bigint | safe-integer number | decimal/0x
// string. Signing is synchronous; note falcon keygen runs per signature
// (~1 s on server-class CPU) — Phase 3 may cache derived keypairs.

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { falcon1024 } from '@noble/post-quantum/falcon.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { toHex, utf8Encode, concatBytes } from './bytes.mjs';
import { rlpBytes, rlpScalar, rlpList, rlpDecode, bytesToBigInt } from './rlp.mjs';
import {
  isScheme,
  publicKeyFromSecret,
  addressFromSecret,
  addressFromPublicKey,
} from './crypto.mjs';

export const DEFAULT_CHAIN_ID = 912701n;

export const PQ_TYPE_BYTE = Object.freeze({ falcon: 0x7e, mldsa: 0x7f });
export const PQ_DOMAIN = Object.freeze({
  falcon: 'ZERONYTH/FALCON-1024/TX/V1',
  mldsa: 'ZERONYTH/ML-DSA-65/TX/V1',
});
const SCHEME_BY_TYPE = Object.freeze({ 0x7e: 'falcon', 0x7f: 'mldsa' });

// ------------------------------------------------------------ field handling

function toScalar(value, name) {
  if (typeof value === 'bigint') {
    if (value < 0n) throw Error(`${name} cannot be negative`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw Error(`${name} must be a non-negative safe integer`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    if (/^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
    if (/^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  }
  throw Error(`${name}: unsupported scalar value`);
}

function hexBytes(value, name) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    const out = new Uint8Array((value.length - 2) / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(value.substr(2 + i * 2, 2), 16);
    return out;
  }
  throw Error(`${name}: expected Uint8Array or 0x-hex string`);
}

function toAddressBytes(to) {
  if (to === null || to === undefined) return new Uint8Array(0); // creation
  const b = hexBytes(to, 'to');
  if (b.length !== 20) throw Error('to: expected a 20-byte address');
  return b;
}

/** Normalize the shared tx fields once; every builder uses this shape. */
function normalizeFields(fields) {
  if (!fields || typeof fields !== 'object') throw Error('tx fields required');
  return {
    nonce: toScalar(fields.nonce, 'nonce'),
    gasPrice: toScalar(fields.gasPrice, 'gasPrice'),
    gasLimit: toScalar(fields.gasLimit, 'gasLimit'),
    toBytes: toAddressBytes(fields.to),
    value: fields.value === undefined ? 0n : toScalar(fields.value, 'value'),
    data: fields.data === undefined ? new Uint8Array(0) : hexBytes(fields.data, 'data'),
    chainId:
      fields.chainId === undefined ? DEFAULT_CHAIN_ID : toScalar(fields.chainId, 'chainId'),
  };
}

/** The seven RLP-encoded unsigned fields, in chain order. */
function unsignedEncodings(f) {
  return [
    rlpScalar(f.nonce),
    rlpScalar(f.gasPrice),
    rlpScalar(f.gasLimit),
    rlpBytes(f.toBytes),
    rlpScalar(f.value),
    rlpBytes(f.data),
    rlpScalar(f.chainId),
  ];
}

// ---------------------------------------------------------------- PQ digest

/**
 * The exact bytes a PQ scheme signs: keccak256(domain || rlp(7 fields)).
 * `fields` takes the same shape as signTransaction's fields.
 */
export function pqSigningDigest(scheme, fields) {
  if (!PQ_DOMAIN[scheme]) throw Error(`Not a PQ scheme: ${scheme}`);
  const f = normalizeFields(fields);
  const message = concatBytes(utf8Encode(PQ_DOMAIN[scheme]), rlpList(unsignedEncodings(f)));
  return keccak_256(message);
}

function pqKeypair(scheme, secret) {
  return scheme === 'mldsa' ? ml_dsa65.keygen(secret) : falcon1024.keygen(secret);
}

function pqSign(scheme, secret, digest) {
  const { secretKey } = pqKeypair(scheme, secret);
  try {
    return scheme === 'mldsa'
      ? ml_dsa65.sign(digest, secretKey)
      : falcon1024.sign(digest, secretKey);
  } finally {
    secretKey.fill(0);
  }
}

/** Verify a PQ signature over a digest (used by tests; handy for Phase 3). */
export function pqVerify(scheme, digest, signature, publicKey) {
  if (!PQ_DOMAIN[scheme]) throw Error(`Not a PQ scheme: ${scheme}`);
  return scheme === 'mldsa'
    ? ml_dsa65.verify(signature, digest, publicKey)
    : falcon1024.verify(signature, digest, publicKey);
}

// ------------------------------------------------------------------- ECDSA

function ecdsaSign(secret, f) {
  const sighash = keccak_256(
    rlpList([...unsignedEncodings(f), rlpScalar(0n), rlpScalar(0n)]),
  );
  const compact = secp256k1.sign(sighash, secret, { prehash: false });
  const sig = secp256k1.Signature.fromBytes(compact, 'compact');
  const pub = publicKeyFromSecret('ecdsa', secret); // 65-byte uncompressed
  let recovery = -1;
  for (const bit of [0, 1]) {
    const recovered = secp256k1.Signature.fromBytes(compact, 'compact')
      .addRecoveryBit(bit)
      .recoverPublicKey(sighash)
      .toBytes(false);
    if (recovered.length === pub.length && recovered.every((b, i) => b === pub[i])) {
      recovery = bit;
      break;
    }
  }
  if (recovery < 0) throw Error('ECDSA: could not determine recovery id');
  const v = f.chainId * 2n + 35n + BigInt(recovery);
  // The signed legacy list replaces the chainId slot of the signing list
  // with (v, r, s).
  return rlpList([
    rlpScalar(f.nonce),
    rlpScalar(f.gasPrice),
    rlpScalar(f.gasLimit),
    rlpBytes(f.toBytes),
    rlpScalar(f.value),
    rlpBytes(f.data),
    rlpScalar(v),
    rlpScalar(sig.r),
    rlpScalar(sig.s),
  ]);
}

// ------------------------------------------------------------------ signing

/**
 * Sign a transaction with a raw secret.
 *
 * @param {object} input
 * @param {'ecdsa'|'falcon'|'mldsa'} input.scheme
 * @param {Uint8Array} input.secret  seed / private key (see crypto.mjs)
 * @param {bigint|number|string} input.nonce
 * @param {bigint|number|string} input.gasPrice
 * @param {bigint|number|string} input.gasLimit
 * @param {string|null} [input.to]   0x address, or null for contract creation
 * @param {bigint|number|string} [input.value]
 * @param {Uint8Array|string} [input.data]
 * @param {bigint|number|string} [input.chainId]  default 912701
 * @returns {{scheme: string, rawTx: string, txHash: string, from: string}}
 */
export function signTransaction(input) {
  const { scheme, secret } = input ?? {};
  if (!isScheme(scheme)) throw Error(`Unknown scheme: ${scheme}`);
  const f = normalizeFields(input);
  const from = addressFromSecret(scheme, secret); // also validates the secret

  let rawBytes;
  if (scheme === 'ecdsa') {
    rawBytes = ecdsaSign(secret, f);
  } else {
    const publicKey = publicKeyFromSecret(scheme, secret);
    const digest = keccak_256(
      concatBytes(utf8Encode(PQ_DOMAIN[scheme]), rlpList(unsignedEncodings(f))),
    );
    const signature = pqSign(scheme, secret, digest);
    rawBytes = concatBytes(
      new Uint8Array([PQ_TYPE_BYTE[scheme]]),
      rlpList([...unsignedEncodings(f), rlpBytes(publicKey), rlpBytes(signature)]),
    );
  }
  return { scheme, rawTx: toHex(rawBytes), txHash: toHex(keccak_256(rawBytes)), from };
}

/**
 * Sign with an account held in an unlocked Vault (Phase 1). The secret is
 * pulled via vault.exportSecret and zeroed immediately after signing.
 */
export function signWithVault(vault, accountId, fields) {
  const account = vault.listAccounts().find((a) => a.id === accountId);
  if (!account) throw Error(`No such account: ${accountId}`);
  const secret = vault.exportSecret(accountId);
  try {
    return signTransaction({ ...fields, scheme: account.scheme, secret });
  } finally {
    secret.fill(0);
  }
}

// ------------------------------------------------------------------ decoding

function scalarAt(items, i) {
  const b = items[i];
  if (b instanceof Array) throw Error('RLP decode: expected scalar field');
  return bytesToBigInt(b);
}

function bytesAt(items, i) {
  const b = items[i];
  if (b instanceof Array) throw Error('RLP decode: expected bytes field');
  return b;
}

/**
 * Decode a raw transaction built by any of the three schemes.
 * Returns the field set plus, for PQ txs, { publicKey, signature } and,
 * for ECDSA, { v, r, s, chainId } (chainId null for pre-EIP-155 v=27/28).
 * `from` is the scheme-bound sender (recovered for ECDSA).
 */
export function decodeRawTransaction(rawTx) {
  const raw = hexBytes(rawTx, 'rawTx');
  const type = raw[0];
  if (SCHEME_BY_TYPE[type]) {
    const scheme = SCHEME_BY_TYPE[type];
    const items = rlpDecode(raw.subarray(1));
    if (!Array.isArray(items) || items.length !== 9) {
      throw Error('PQ tx: expected 9 RLP fields');
    }
    const publicKey = bytesAt(items, 7);
    const signature = bytesAt(items, 8);
    const to = bytesAt(items, 3);
    return {
      scheme,
      type,
      nonce: scalarAt(items, 0),
      gasPrice: scalarAt(items, 1),
      gasLimit: scalarAt(items, 2),
      to: to.length ? toHex(to) : null,
      value: scalarAt(items, 4),
      data: bytesAt(items, 5),
      chainId: scalarAt(items, 6),
      publicKey,
      signature,
      from: addressFromPublicKey(scheme, publicKey),
    };
  }
  // Legacy ECDSA (bare RLP list).
  const items = rlpDecode(raw);
  if (!Array.isArray(items) || items.length !== 9) {
    throw Error('ECDSA tx: expected 9 RLP fields');
  }
  const f = {
    nonce: scalarAt(items, 0),
    gasPrice: scalarAt(items, 1),
    gasLimit: scalarAt(items, 2),
    toBytes: bytesAt(items, 3),
    value: scalarAt(items, 4),
    data: bytesAt(items, 5),
  };
  const v = scalarAt(items, 6);
  const r = scalarAt(items, 7);
  const s = scalarAt(items, 8);
  let chainId = null;
  let recovery;
  if (v >= 35n) {
    chainId = (v - 35n) / 2n;
    recovery = Number(v - 35n - chainId * 2n);
  } else if (v === 27n || v === 28n) {
    recovery = Number(v - 27n);
  } else {
    throw Error(`ECDSA tx: unsupported v ${v}`);
  }
  const sighashFields =
    chainId === null
      ? [rlpScalar(f.nonce), rlpScalar(f.gasPrice), rlpScalar(f.gasLimit), rlpBytes(f.toBytes), rlpScalar(f.value), rlpBytes(f.data)]
      : [...unsignedEncodings({ ...f, chainId }), rlpScalar(0n), rlpScalar(0n)];
  const sighash = keccak_256(rlpList(sighashFields));
  const sig = new secp256k1.Signature(r, s).addRecoveryBit(recovery);
  const pub = sig.recoverPublicKey(sighash).toBytes(false);
  return {
    scheme: 'ecdsa',
    type: null,
    nonce: f.nonce,
    gasPrice: f.gasPrice,
    gasLimit: f.gasLimit,
    to: f.toBytes.length ? toHex(f.toBytes) : null,
    value: f.value,
    data: f.data,
    chainId,
    v,
    r,
    s,
    from: addressFromPublicKey('ecdsa', pub),
  };
}
