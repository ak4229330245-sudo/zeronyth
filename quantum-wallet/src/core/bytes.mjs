// Byte / hex helpers.
//
// The encodings intentionally mirror the v1 wallet bundle byte-for-byte:
// v1's `Zl` renders bytes as "0x"-prefixed lowercase hex and its `bu`
// decoder accepts ONLY canonical hex (/^0x(?:[0-9a-f]{2})*$/ — lowercase,
// even length, 0x prefix). Vault blobs written by v1 depend on this.

const HEX_RE = /^0x(?:[0-9a-f]{2})*$/;

/** Uint8Array -> "0x"-prefixed lowercase hex (v1 `Zl`). */
export function toHex(bytes) {
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Canonical "0x" hex -> Uint8Array (v1 `bu`). Throws on non-canonical input. */
export function fromHex(str) {
  if (typeof str !== 'string' || !HEX_RE.test(str)) throw Error('Non-canonical hex');
  const out = new Uint8Array((str.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(str.substr(2 + i * 2, 2), 16);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Encode(str) {
  return encoder.encode(str);
}

export function utf8Decode(bytes) {
  return decoder.decode(bytes);
}

export function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Constant-time-ish equality for byte arrays (used for test vectors). */
export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
