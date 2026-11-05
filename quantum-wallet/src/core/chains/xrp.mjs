// XRP Ledger engine for the Quantum Wallet v2 multi-chain expansion.
//
// Accounts are raw 32-byte secp256k1 private keys derived per chain by
// hd.mjs (domain "ZERONYTH/WALLET/V2/XRP"). An XRPL "family seed" (the
// 's…' strings a faucet hands out) is a different encoding of different
// material and is NEVER decoded or used here.
//
// Serialization implements the canonical XRPL binary codec for exactly
// the fields of a native-XRP Payment (see the field table below). It is
// pinned byte-for-byte by the ripple-binary-codec data-driven fixtures
// in test/chains-xrp.test.mjs.
//
// Type-code note: the canonical XRPL type codes are UInt16 = 1 and
// UInt32 = 2 (the fixtures' field headers prove it: TransactionType
// "12", Flags "22", Sequence "24", LastLedgerSequence "201B"). An early
// interface draft listed the UInt fields with type codes one higher;
// the canonical values are used here, as the live ledger rejects
// anything else as malformed.
//
// Signing-form note: the serialization that is hashed for signing
// INCLUDES the real SigningPubKey (it is a signing field) and excludes
// only TxnSignature — byte-identical to ripple-binary-codec's
// encodeForSigning, cross-checked against that package. (The empty-
// SigningPubKey form is the multi-signing form; with it, rippled
// rejects a regular Payment with "Invalid signature".)

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { publicKeyFromSecret, addressFromSecret, hash160 } from '../crypto.mjs';
import {
  base58CheckEncode,
  base58CheckDecode,
  XRP_ALPHABET,
  ecdsaDerEncode,
} from '../enc.mjs';
import { concatBytes } from '../bytes.mjs';

// ------------------------------------------------------------------ fields

const TYPE_UINT16 = 1;
const TYPE_UINT32 = 2;
const TYPE_AMOUNT = 6;
const TYPE_VLEN = 7; // Blob
const TYPE_ACCOUNT_ID = 8;

/** tfFullyCanonicalSig — required so the ledger enforces strict DER + low-S. */
export const TF_FULLY_CANONICAL_SIG = 0x80000000;

const FIELDS = Object.freeze({
  // [name, typeCode, fieldCode]
  TransactionType: ['TransactionType', TYPE_UINT16, 2],
  Flags: ['Flags', TYPE_UINT32, 2],
  Sequence: ['Sequence', TYPE_UINT32, 4],
  DestinationTag: ['DestinationTag', TYPE_UINT32, 14],
  LastLedgerSequence: ['LastLedgerSequence', TYPE_UINT32, 27],
  Amount: ['Amount', TYPE_AMOUNT, 1],
  Fee: ['Fee', TYPE_AMOUNT, 8],
  SigningPubKey: ['SigningPubKey', TYPE_VLEN, 3],
  TxnSignature: ['TxnSignature', TYPE_VLEN, 4],
  Account: ['Account', TYPE_ACCOUNT_ID, 1],
  Destination: ['Destination', TYPE_ACCOUNT_ID, 3],
});

/** Signing prefix "STX\0" and transaction-ID prefix "TXN\0". */
const SIGNING_PREFIX = new Uint8Array([0x53, 0x54, 0x58, 0x00]);
const TXID_PREFIX = new Uint8Array([0x54, 0x58, 0x4e, 0x00]);

// ------------------------------------------------------------------ hex

export function bytesToHexUpper(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out.toUpperCase();
}

function hexToBytes(hex) {
  const clean = String(hex).replace(/^0x/i, '');
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(clean)) throw Error('Invalid hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// ------------------------------------------------------------------ codec

/**
 * Field header bytes. With type code t and field code f:
 *   t < 16 && f < 16  → [(t << 4) | f]
 *   t < 16 && f ≥ 16  → [t << 4, f]
 *   t ≥ 16 && f < 16  → [f, t]
 *   t ≥ 16 && f ≥ 16  → [0, t, f]
 */
export function encodeFieldHeader(typeCode, fieldCode) {
  if (typeCode < 16 && fieldCode < 16) return new Uint8Array([(typeCode << 4) | fieldCode]);
  if (typeCode < 16) return new Uint8Array([typeCode << 4, fieldCode]);
  if (fieldCode < 16) return new Uint8Array([fieldCode, typeCode]);
  return new Uint8Array([0, typeCode, fieldCode]);
}

/**
 * Variable-length length prefix:
 *   len < 193           → 1 byte [len]
 *   len ≤ 12480         → 2 bytes [193 + ((len-193) >> 8), (len-193) & 0xff]
 *   len ≤ 918744        → 3 bytes [241 + ((len-12481) >> 16),
 *                                  ((len-12481) >> 8) & 0xff, (len-12481) & 0xff]
 */
export function encodeVlenLength(len) {
  if (!Number.isSafeInteger(len) || len < 0) throw Error(`Invalid VLEN length: ${len}`);
  if (len < 193) return new Uint8Array([len]);
  if (len <= 12480) {
    const rest = len - 193;
    return new Uint8Array([193 + (rest >> 8), rest & 0xff]);
  }
  if (len <= 918744) {
    const rest = len - 12481;
    return new Uint8Array([241 + (rest >> 16), (rest >> 8) & 0xff, rest & 0xff]);
  }
  throw Error(`VLEN length too large: ${len}`);
}

function vlenEncode(bytes) {
  return concatBytes(encodeVlenLength(bytes.length), bytes);
}

function uint16BE(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw Error(`UInt16 out of range: ${value}`);
  }
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, false);
  return out;
}

function uint32BE(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw Error(`UInt32 out of range: ${value}`);
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

/**
 * Native XRP amount encoding: drops as an unsigned 62-bit value inside
 * an 8-byte big-endian word with bit 62 set (positive) and bit 63 clear
 * (native currency): encoded = drops | (1 << 62).
 *   0 drops       → 0x4000000000000000
 *   1,000,000     → 0x40000000000F4240  (1 XRP)
 *   12            → 0x400000000000000C
 */
export function encodeAmountDrops(drops) {
  const value = typeof drops === 'bigint' ? drops : BigInt(drops);
  if (value < 0n || value >= 1n << 62n) throw Error(`XRP amount out of range: ${value}`);
  const encoded = value | (1n << 62n);
  const out = new Uint8Array(8);
  let rest = encoded;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/**
 * Serialize a Payment. `tx` carries raw parts (no classic addresses):
 *   { accountId: 20B, destinationId: 20B, amountDrops, feeDrops,
 *     sequence, flags?, destinationTag?, lastLedgerSequence?,
 *     signingPubKey?, txnSignature? }
 * Optional VLEN fields are serialized only when present. The signing
 * form carries the real signingPubKey and no txnSignature. Fields are
 * emitted in canonical (typeCode, fieldCode) ascending order.
 */
export function serializePayment(tx) {
  const parts = [];
  const add = (field, valueBytes) => {
    const [, t, f] = FIELDS[field];
    parts.push({ t, f, bytes: concatBytes(encodeFieldHeader(t, f), valueBytes) });
  };

  add('TransactionType', uint16BE(0)); // 0 = Payment
  add('Flags', uint32BE(tx.flags ?? TF_FULLY_CANONICAL_SIG));
  add('Sequence', uint32BE(tx.sequence));
  if (tx.destinationTag != null) add('DestinationTag', uint32BE(tx.destinationTag));
  if (tx.lastLedgerSequence != null) add('LastLedgerSequence', uint32BE(tx.lastLedgerSequence));
  add('Amount', encodeAmountDrops(tx.amountDrops));
  add('Fee', encodeAmountDrops(tx.feeDrops));
  if (tx.signingPubKey !== undefined) add('SigningPubKey', vlenEncode(tx.signingPubKey));
  if (tx.txnSignature !== undefined) add('TxnSignature', vlenEncode(tx.txnSignature));
  if (!(tx.accountId instanceof Uint8Array) || tx.accountId.length !== 20) {
    throw Error('serializePayment: accountId must be 20 bytes');
  }
  if (!(tx.destinationId instanceof Uint8Array) || tx.destinationId.length !== 20) {
    throw Error('serializePayment: destinationId must be 20 bytes');
  }
  add('Account', vlenEncode(tx.accountId));
  add('Destination', vlenEncode(tx.destinationId));

  parts.sort((a, b) => a.t - b.t || a.f - b.f);
  return concatBytes(...parts.map((p) => p.bytes));
}

/** First 32 bytes of SHA-512 (XRPL "sha512half"). */
export function sha512Half(bytes) {
  return sha512(bytes).slice(0, 32);
}

/** The hash a Payment signature commits to: sha512half(0x53545800 ‖ signingData). */
export function paymentSigningHash(signingData) {
  return sha512Half(concatBytes(SIGNING_PREFIX, signingData));
}

/** Transaction ID: sha512half(0x54584E00 ‖ signedBlob), uppercase hex. */
export function computeTxId(signedBlob) {
  return bytesToHexUpper(sha512Half(concatBytes(TXID_PREFIX, signedBlob)));
}

// ------------------------------------------------------------------ addresses

/** Classic address for a raw 32-byte secret. Variant is ignored: the
 *  classic address encoding is identical on mainnet and testnet. */
export function deriveAddress(secret, variant) {
  void variant;
  return addressFromSecret('xrp', secret);
}

/** True when `address` base58check-decodes (XRP alphabet) to exactly
 *  21 bytes with version byte 0x00. Variant is ignored (see above). */
export function validateAddress(address, variant) {
  void variant;
  if (typeof address !== 'string' || address.length === 0) return false;
  try {
    const payload = base58CheckDecode(address, XRP_ALPHABET);
    return payload.length === 21 && payload[0] === 0x00;
  } catch {
    return false;
  }
}

/** AccountID (20 bytes) of a 33-byte compressed secp256k1 public key. */
export function accountIdFromPublicKey(pub33) {
  if (!(pub33 instanceof Uint8Array) || pub33.length !== 33) {
    throw Error('accountIdFromPublicKey: compressed public key must be 33 bytes');
  }
  return hash160(pub33);
}

/** Classic address encoding of a 20-byte AccountID. */
export function classicAddressFromAccountId(accountId20) {
  if (!(accountId20 instanceof Uint8Array) || accountId20.length !== 20) {
    throw Error('classicAddressFromAccountId: AccountID must be 20 bytes');
  }
  return base58CheckEncode(concatBytes(new Uint8Array([0x00]), accountId20), XRP_ALPHABET);
}

/** AccountID (20 bytes) behind a classic address. Throws on bad input. */
export function accountIdFromAddress(address) {
  const payload = base58CheckDecode(address, XRP_ALPHABET);
  if (payload.length !== 21 || payload[0] !== 0x00) throw Error(`Invalid XRP address: ${address}`);
  return payload.slice(1);
}

// ------------------------------------------------------------------ client

function toDropsBigInt(amount) {
  if (typeof amount === 'bigint') {
    if (amount < 0n) throw Error('amount cannot be negative');
    return amount;
  }
  if (typeof amount === 'number') {
    if (!Number.isSafeInteger(amount) || amount < 0) throw Error(`Invalid drops amount: ${amount}`);
    return BigInt(amount);
  }
  if (typeof amount === 'string' && /^[0-9]+$/.test(amount)) return BigInt(amount);
  throw Error(`Invalid drops amount: ${amount}`);
}

/** reserve_base_xrp arrives as a JSON number in XRP (e.g. 1, sometimes
 *  in exponent form from Clio) — convert to drops without float drift
 *  for the integer values the ledger actually uses. */
function xrpNumberToDrops(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) throw Error(`Invalid reserve_base_xrp: ${value}`);
  return BigInt(Math.round(n * 1_000_000));
}

/**
 * JSON-RPC client for a rippled / Clio endpoint (POST style:
 * { method, params: [ {...} ] }). Balances and reserves are BigInt
 * drops (1 XRP = 1,000,000 drops).
 */
export function createXrpClient(apiBase, { fetchImpl } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw Error('no fetch implementation available');
  const base = String(apiBase).replace(/\/+$/, '');

  async function rpc(method, params = {}) {
    const res = await doFetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params: [params] }),
    });
    if (!res.ok) throw Error(`XRP RPC HTTP ${res.status} from ${base}`);
    const j = await res.json();
    if (j.error) throw Error(j.error.message ?? `XRP RPC error in ${method}`);
    if (!j.result || typeof j.result !== 'object') throw Error(`XRP RPC: no result for ${method}`);
    return j.result;
  }

  async function serverInfo() {
    const result = await rpc('server_info', {});
    if (result.status !== 'success' || !result.info?.validated_ledger) {
      throw Error('server_info failed');
    }
    return result.info;
  }

  /** account_data for a funded account, null when the account does not
   *  exist on the ledger yet (actNotFound). Other errors throw. */
  async function accountInfo(address) {
    const result = await rpc('account_info', {
      account: address,
      strict: true,
      ledger_index: 'validated',
    });
    if (result.error != null || result.status === 'error') {
      if (result.error === 'actNotFound') return null;
      throw Error(result.error_message ?? result.error ?? 'account_info failed');
    }
    return result.account_data;
  }

  async function checkConnection() {
    try {
      const result = await rpc('server_info', {});
      return result.status === 'success';
    } catch {
      return false;
    }
  }

  /** Balance in drops (BigInt). An unfunded account has balance 0. */
  async function getBalance(address) {
    const data = await accountInfo(address);
    return data ? BigInt(data.Balance) : 0n;
  }

  /** { baseReserveDrops } — the reserve an account must hold to exist. */
  async function getReserveInfo() {
    const info = await serverInfo();
    return { baseReserveDrops: xrpNumberToDrops(info.validated_ledger.reserve_base_xrp) };
  }

  /**
   * Build the review plan for a Payment. `amount` is drops (bigint /
   * integer / decimal string). Nothing is signed here.
   * Throws 'XRP new account requires at least the base reserve' when
   * the destination does not exist yet and amount < base reserve —
   * such a Payment can never succeed on the ledger.
   */
  async function prepareSend({ from, to, amount, opts } = {}) {
    if (!validateAddress(from)) throw Error(`Invalid XRP source address: ${from}`);
    if (!validateAddress(to)) throw Error(`Invalid XRP destination address: ${to}`);
    const amountDrops = toDropsBigInt(amount);
    const destinationTag = opts?.destinationTag;
    if (
      destinationTag !== undefined &&
      (!Number.isSafeInteger(destinationTag) || destinationTag < 0 || destinationTag > 0xffffffff)
    ) {
      throw Error(`Invalid destinationTag: ${destinationTag}`);
    }

    const info = await serverInfo();
    const baseReserveDrops = xrpNumberToDrops(info.validated_ledger.reserve_base_xrp);
    const lastLedgerSequence = Number(info.validated_ledger.seq) + 20;

    let fee;
    try {
      const feeResult = await rpc('fee', {});
      fee = BigInt(feeResult.drops.base_fee);
    } catch {
      fee = 12n; // documented fallback when the fee RPC is unavailable
    }

    const fromData = await accountInfo(from);
    const toData = await accountInfo(to);
    const destinationExists = toData !== null;
    if (!destinationExists && amountDrops < baseReserveDrops) {
      throw Error('XRP new account requires at least the base reserve');
    }

    const balance = fromData ? BigInt(fromData.Balance) : 0n;
    const sequence = fromData ? Number(fromData.Sequence) : 0;
    const spendable = balance > baseReserveDrops + fee ? balance - baseReserveDrops - fee : 0n;

    return {
      from,
      to,
      amount: amountDrops,
      fee,
      balance,
      sequence,
      baseReserveDrops,
      destinationExists,
      spendable,
      lastLedgerSequence,
      destinationTag,
    };
  }

  /**
   * Sign a prepared plan and submit it. Returns { hash, engineResult }
   * for tes/ter/tef-class results (the session polls getTxStatus for
   * finality). A tem* result means the blob itself was malformed — a
   * bug, not a ledger state — and throws with the ledger's message.
   */
  async function executeSend(plan, secret) {
    const publicKey = publicKeyFromSecret('xrp', secret); // also validates the secret
    const baseTx = {
      accountId: accountIdFromAddress(plan.from),
      destinationId: accountIdFromAddress(plan.to),
      amountDrops: toDropsBigInt(plan.amount),
      feeDrops: toDropsBigInt(plan.fee),
      sequence: plan.sequence,
      destinationTag: plan.destinationTag ?? undefined,
      lastLedgerSequence: plan.lastLedgerSequence ?? undefined,
    };

    // Signing serialization: real SigningPubKey (a signing field),
    // TxnSignature excluded — ripple-binary-codec's encodeForSigning form.
    const signingData = serializePayment({ ...baseTx, signingPubKey: publicKey });
    const signHash = paymentSigningHash(signingData);
    // noble returns a 64-byte compact (r ‖ s) signature with low-S by
    // default — exactly what tfFullyCanonicalSig requires once DER-encoded.
    const compact = secp256k1.sign(signHash, secret, { prehash: false });
    const derSignature = ecdsaDerEncode(compact.slice(0, 32), compact.slice(32, 64));

    const blob = serializePayment({ ...baseTx, signingPubKey: publicKey, txnSignature: derSignature });
    const hash = computeTxId(blob);

    const result = await rpc('submit', { tx_blob: bytesToHexUpper(blob) });
    const engineResult = result.engine_result;
    if (typeof engineResult !== 'string' || engineResult.length === 0) {
      throw Error(result.error_message ?? result.error ?? 'submit failed');
    }
    if (engineResult.startsWith('tem')) {
      throw Error(result.engine_result_message ?? engineResult);
    }
    return { hash, engineResult };
  }

  /**
   * 'success' | 'failed' | 'pending' for a transaction hash. Only a
   * validated tesSUCCESS is success; a validated transaction with any
   * other result failed (its fee was still claimed). Unknown or not-yet
   * validated transactions are pending.
   */
  async function getTxStatus(hash) {
    let result;
    try {
      result = await rpc('tx', { transaction: hash, binary: false });
    } catch (e) {
      if (/txnNotFound|not found/i.test(e.message)) return 'pending';
      throw e;
    }
    if (result.error != null || result.status === 'error') {
      if (result.error === 'txnNotFound') return 'pending';
      throw Error(result.error_message ?? result.error ?? 'tx lookup failed');
    }
    if (result.validated !== true) return 'pending';
    const meta = result.meta ?? result.metaData;
    return meta?.TransactionResult === 'tesSUCCESS' ? 'success' : 'failed';
  }

  return { checkConnection, getBalance, getReserveInfo, prepareSend, executeSend, getTxStatus };
}
