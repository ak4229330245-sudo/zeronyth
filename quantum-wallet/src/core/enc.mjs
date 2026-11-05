// Encoding helpers shared by the non-EVM chain engines (multi-chain v12):
// base58 / base58check, bech32 (BIP-173), and ECDSA DER encoding.
//
// These are small, standard constructions; each is pinned by published
// test vectors in test/chains-*.test.mjs (Bitcoin Core / BIP-173 vectors,
// the XRP codec fixtures, Solana docs examples).

import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from './bytes.mjs';

// ---------------------------------------------------------------- base58

export const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** XRP uses its own base58 alphabet (ripple-lib "alphabets"). */
export const XRP_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

export function base58Encode(bytes, alphabet = BASE58_ALPHABET) {
  if (!(bytes instanceof Uint8Array)) throw Error('base58Encode: bytes required');
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  // Convert to base-58 digits (big-endian arithmetic on a byte array).
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = alphabet[0].repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += alphabet[digits[i]];
  return bytes.length === 0 ? '' : out;
}

export function base58Decode(text, alphabet = BASE58_ALPHABET) {
  if (typeof text !== 'string' || text.length === 0) throw Error('base58Decode: string required');
  const index = new Map([...alphabet].map((c, i) => [c, i]));
  let zeros = 0;
  while (zeros < text.length && text[zeros] === alphabet[0]) zeros++;
  const bytes = [0];
  for (let i = zeros; i < text.length; i++) {
    const v = index.get(text[i]);
    if (v === undefined) throw Error(`base58Decode: invalid character ${JSON.stringify(text[i])}`);
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + (text.length === zeros ? 0 : bytes.length));
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
  return out;
}

/** base58check: version/payload bytes + 4-byte double-sha256 checksum. */
export function base58CheckEncode(payload, alphabet = BASE58_ALPHABET) {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  return base58Encode(concatBytes(payload, checksum), alphabet);
}

export function base58CheckDecode(text, alphabet = BASE58_ALPHABET) {
  const raw = base58Decode(text, alphabet);
  if (raw.length < 5) throw Error('base58CheckDecode: too short');
  const payload = raw.slice(0, -4);
  const checksum = raw.slice(-4);
  const expect = sha256(sha256(payload)).slice(0, 4);
  if (!checksum.every((b, i) => b === expect[i])) throw Error('base58CheckDecode: bad checksum');
  return payload;
}

// ---------------------------------------------------------------- bech32 (BIP-173)

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const out = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const out = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw Error('convertBits: invalid incomplete group');
  }
  return new Uint8Array(out);
}

/** Encode a SegWit v0 address (bech32, BIP-173) from a witness program. */
export function bech32EncodeSegwit(hrp, version, program) {
  if (version !== 0) throw Error('bech32EncodeSegwit: only witness version 0 (bech32) supported');
  const data = [version, ...convertBits(program, 8, 5, true)];
  const values = [...bech32HrpExpand(hrp), ...data];
  const polymod = bech32Polymod([...values, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [];
  for (let i = 0; i < 6; i++) checksum.push((polymod >> (5 * (5 - i))) & 31);
  return hrp + '1' + [...data, ...checksum].map((d) => BECH32_CHARSET[d]).join('');
}

/** Decode a bech32 string → { hrp, data (5-bit values, checksum stripped) }. */
export function bech32Decode(text) {
  if (typeof text !== 'string') throw Error('bech32Decode: string required');
  const lower = text.toLowerCase();
  if (text !== lower && text !== text.toUpperCase()) throw Error('bech32Decode: mixed case');
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length) throw Error('bech32Decode: invalid separator');
  const hrp = lower.slice(0, pos);
  const data = [];
  for (const c of lower.slice(pos + 1)) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v < 0) throw Error(`bech32Decode: invalid character ${JSON.stringify(c)}`);
    data.push(v);
  }
  if (bech32Polymod([...bech32HrpExpand(hrp), ...data]) !== 1) {
    throw Error('bech32Decode: bad checksum');
  }
  return { hrp, data: new Uint8Array(data.slice(0, -6)) };
}

/** Decode a SegWit v0 bech32 address → { hrp, program (bytes) }. */
export function bech32DecodeSegwit(text) {
  const { hrp, data } = bech32Decode(text);
  if (data.length < 1 || data[0] !== 0) throw Error('bech32DecodeSegwit: not a v0 address');
  return { hrp, program: convertBits(data.slice(1), 5, 8, false) };
}

// ---------------------------------------------------------------- ECDSA DER

function derInteger(x) {
  let b = x;
  while (b.length > 1 && b[0] === 0 && (b[1] & 0x80) === 0) b = b.slice(1);
  if (b[0] & 0x80) b = concatBytes(new Uint8Array([0]), b);
  return concatBytes(new Uint8Array([0x02, b.length]), b);
}

/** DER-encode an ECDSA signature from its 32-byte r and s scalars. */
export function ecdsaDerEncode(rBytes, sBytes) {
  const body = concatBytes(derInteger(rBytes), derInteger(sBytes));
  if (body.length >= 0x80) throw Error('ecdsaDerEncode: unexpectedly long signature');
  return concatBytes(new Uint8Array([0x30, body.length]), body);
}
