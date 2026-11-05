// Minimal canonical RLP encoding / decoding (chain 912701 transaction
// building). Encoding semantics are a faithful port of the gateway's
// znyRlp* helpers (~/workspace/qwallet-fix/gateway-only.mjs), which match
// Besu's transaction encoding byte-for-byte:
//   scalar 0            -> empty byte string (0x80)
//   single byte < 0x80  -> the byte itself, no prefix
//   len < 56            -> 0x80+len / 0xc0+len prefix
//   otherwise           -> 0xb7+lenOfLen / 0xf7+lenOfLen, then length, then data

import { concatBytes } from './bytes.mjs';

/** Minimal big-endian bytes for a non-negative bigint (0n -> empty). */
export function bigIntToBytes(v) {
  if (typeof v !== 'bigint') throw Error('bigIntToBytes expects a bigint');
  if (v < 0n) throw Error('RLP scalar cannot be negative');
  if (v === 0n) return new Uint8Array(0);
  let hex = v.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Big-endian bytes -> bigint (empty -> 0n). */
export function bytesToBigInt(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function lenPrefix(len, offset) {
  if (len < 56) return new Uint8Array([offset + len]);
  const lb = bigIntToBytes(BigInt(len));
  return concatBytes(new Uint8Array([offset + 55 + lb.length]), lb);
}

/** RLP-encode a byte string. */
export function rlpBytes(b) {
  if (b.length === 1 && b[0] < 0x80) return new Uint8Array(b);
  return concatBytes(lenPrefix(b.length, 0x80), b);
}

/** RLP-encode a non-negative bigint scalar. */
export function rlpScalar(v) {
  return rlpBytes(bigIntToBytes(v));
}

/** RLP-encode a list whose items are ALREADY RLP-encoded byte strings. */
export function rlpList(encodedItems) {
  const payload = concatBytes(...encodedItems);
  return concatBytes(lenPrefix(payload.length, 0xc0), payload);
}

/**
 * Convenience encoder: Uint8Array -> rlpBytes, bigint/number -> rlpScalar,
 * Array -> rlpList of recursively encoded items.
 */
export function rlpEncode(value) {
  if (value instanceof Uint8Array) return rlpBytes(value);
  if (Array.isArray(value)) return rlpList(value.map(rlpEncode));
  if (typeof value === 'bigint') return rlpScalar(value);
  if (typeof value === 'number') return rlpScalar(BigInt(value));
  throw Error(`Cannot RLP-encode ${typeof value}`);
}

// ------------------------------------------------------------------ decoding

function decodeItem(bytes, pos) {
  if (pos >= bytes.length) throw Error('RLP decode: unexpected end of input');
  const b = bytes[pos];
  if (b < 0x80) return [bytes.subarray(pos, pos + 1), pos + 1];
  if (b < 0xb8) {
    const len = b - 0x80;
    const start = pos + 1;
    if (start + len > bytes.length) throw Error('RLP decode: string overruns input');
    return [bytes.subarray(start, start + len), start + len];
  }
  if (b < 0xc0) {
    const ll = b - 0xb7;
    if (pos + 1 + ll > bytes.length) throw Error('RLP decode: length overruns input');
    const len = Number(bytesToBigInt(bytes.subarray(pos + 1, pos + 1 + ll)));
    const start = pos + 1 + ll;
    if (start + len > bytes.length) throw Error('RLP decode: string overruns input');
    return [bytes.subarray(start, start + len), start + len];
  }
  let payloadLen, start;
  if (b < 0xf8) {
    payloadLen = b - 0xc0;
    start = pos + 1;
  } else {
    const ll = b - 0xf7;
    if (pos + 1 + ll > bytes.length) throw Error('RLP decode: length overruns input');
    payloadLen = Number(bytesToBigInt(bytes.subarray(pos + 1, pos + 1 + ll)));
    start = pos + 1 + ll;
  }
  if (start + payloadLen > bytes.length) throw Error('RLP decode: list overruns input');
  const items = [];
  let p = start;
  const end = start + payloadLen;
  while (p < end) {
    const [item, next] = decodeItem(bytes, p);
    items.push(item);
    p = next;
  }
  if (p !== end) throw Error('RLP decode: list payload mismatch');
  return [items, end];
}

/**
 * Decode exactly one RLP item (byte string -> Uint8Array, list -> Array).
 * Throws on trailing bytes.
 */
export function rlpDecode(bytes) {
  const [value, next] = decodeItem(bytes, 0);
  if (next !== bytes.length) throw Error('RLP decode: trailing bytes');
  return value;
}
