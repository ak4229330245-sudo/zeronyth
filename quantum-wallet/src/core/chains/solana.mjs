// Solana engine for the Quantum Wallet v2 multi-chain expansion.
//
// Accounts are Ed25519: the vault secret for family "solana" is a
// 32-byte Ed25519 seed (see crypto.mjs / hd.mjs, domain
// "ZERONYTH/WALLET/V2/SOLANA") and the address is the base58 encoding
// of the Ed25519 public key — identical on mainnet and devnet, so
// `variant` never changes derivation or validation.
//
// Transfers are legacy (v0-less) SystemProgram::Transfer transactions
// signed locally with the seed; the node is only ever sent the fully
// serialized, signed transaction (base64) via sendTransaction.

import { ed25519 } from '@noble/curves/ed25519.js';
import { addressFromSecret } from '../crypto.mjs';
import { base58Decode, base58Encode } from '../enc.mjs';
import { concatBytes } from '../bytes.mjs';

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
/** Base fee for a single-signature legacy transaction, in lamports. */
export const BASE_FEE_LAMPORTS = 5000n;

const VARIANTS = Object.freeze(['mainnet', 'devnet']);

function checkVariant(variant) {
  if (variant !== undefined && !VARIANTS.includes(variant)) {
    throw Error(`Unknown Solana variant: ${variant}`);
  }
}

function checkSecret(secret) {
  if (!(secret instanceof Uint8Array) || secret.length !== 32) {
    throw Error('Solana secret must be a 32-byte Ed25519 seed');
  }
}

/**
 * Base58 address for a 32-byte Ed25519 seed. Agrees with
 * addressFromSecret('solana', secret) by construction.
 */
export function deriveAddress(secret, variant) {
  checkVariant(variant);
  checkSecret(secret);
  return addressFromSecret('solana', secret);
}

/** True when `address` base58-decodes to exactly 32 bytes. */
export function validateAddress(address, variant) {
  checkVariant(variant);
  if (typeof address !== 'string' || address.length === 0) return false;
  try {
    return base58Decode(address).length === 32;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ serialization

/** Solana shortvec (compact-u16): 7 bits per byte, little-endian groups. */
function shortvecEncode(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw Error(`shortvec value out of range: ${value}`);
  }
  const out = [];
  let remaining = value;
  for (;;) {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    if (remaining > 0) byte |= 0x80;
    out.push(byte);
    if (remaining === 0) break;
  }
  return new Uint8Array(out);
}

function u32LE(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64LE(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function decode32(text, what) {
  const bytes = base58Decode(text);
  if (bytes.length !== 32) throw Error(`${what} must decode to 32 bytes`);
  return bytes;
}

/**
 * Serialize the legacy message for a SystemProgram transfer.
 *
 * Layout (Solana transaction format):
 *   header:        numRequiredSignatures=1, numReadonlySignedAccounts=0,
 *                  numReadonlyUnsignedAccounts=1            (3 bytes)
 *   accountKeys:   shortvec(3) ‖ from ‖ to ‖ SystemProgram  (1 + 96 bytes)
 *                  from = signer + writable, to = writable,
 *                  SystemProgram = readonly (hence the header's 1)
 *   recentBlockhash: 32 bytes
 *   instructions:  shortvec(1) ‖ instruction
 *   instruction:   programIdIndex=2, shortvec(2) ‖ [0, 1],
 *                  shortvec(12) ‖ u32LE(2 = Transfer) ‖ u64LE(lamports)
 */
function buildTransferMessage({ from, to, amount, blockhash }) {
  const fromBytes = decode32(from, 'from address');
  const toBytes = decode32(to, 'to address');
  const programBytes = decode32(SYSTEM_PROGRAM_ID, 'system program');
  const blockhashBytes = decode32(blockhash, 'blockhash');
  const data = concatBytes(u32LE(2), u64LE(amount));
  const instruction = concatBytes(
    new Uint8Array([2]),
    shortvecEncode(2),
    new Uint8Array([0, 1]),
    shortvecEncode(data.length),
    data,
  );
  return concatBytes(
    new Uint8Array([1, 0, 1]),
    shortvecEncode(3),
    fromBytes,
    toBytes,
    programBytes,
    blockhashBytes,
    shortvecEncode(1),
    instruction,
  );
}

/** Serialize a full transaction: shortvec(sigCount) ‖ signature ‖ message. */
function buildSignedTransaction(messageBytes, secret) {
  const signature = ed25519.sign(messageBytes, secret);
  return { signature, txBytes: concatBytes(shortvecEncode(1), signature, messageBytes) };
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ------------------------------------------------------------------- client

export function createSolanaClient(apiBase, { fetchImpl } = {}) {
  if (typeof apiBase !== 'string' || apiBase.length === 0) {
    throw Error('createSolanaClient: apiBase required');
  }
  const url = apiBase.replace(/\/+$/, '');
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw Error('no fetch implementation available');
  let nextId = 1;

  async function rpc(method, params = []) {
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(30000);
    }
    const res = await doFetch(url, init);
    if (!res.ok) throw Error(`Solana RPC ${method}: HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) {
      const err = new Error(`Solana RPC ${method}: ${j.error.message || 'JSON-RPC error'}`);
      err.code = j.error.code;
      err.data = j.error.data;
      throw err;
    }
    return j.result;
  }

  /** True when the endpoint answers getVersion. Never throws. */
  async function checkConnection() {
    try {
      const result = await rpc('getVersion', []);
      return !!(result && typeof result === 'object' && 'solana-core' in result);
    } catch {
      return false;
    }
  }

  /** Balance in lamports (bigint), from the getBalance `value` field. */
  async function getBalance(address) {
    if (!validateAddress(address)) throw Error(`Invalid Solana address: ${address}`);
    const result = await rpc('getBalance', [address, { commitment: 'confirmed' }]);
    const value = result && typeof result === 'object' && 'value' in result ? result.value : result;
    return BigInt(value);
  }

  async function getLatestBlockhash() {
    const result = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const value = result && typeof result === 'object' && 'value' in result ? result.value : result;
    if (!value || typeof value.blockhash !== 'string') {
      throw Error('Solana RPC getLatestBlockhash: malformed result');
    }
    return value; // { blockhash, lastValidBlockHeight }
  }

  /**
   * Fetch balance + fresh blockhash and assemble a send plan.
   * `amount` is a bigint of lamports; the fee is the 5000-lamport
   * single-signature base fee.
   */
  async function prepareSend({ from, to, amount, opts } = {}) {
    void opts;
    if (!validateAddress(from)) throw Error(`Invalid Solana address: ${from}`);
    if (!validateAddress(to)) throw Error(`Invalid Solana address: ${to}`);
    const value = typeof amount === 'bigint' ? amount : BigInt(amount);
    if (value <= 0n) throw Error('amount must be positive');
    const [balance, latest] = await Promise.all([getBalance(from), getLatestBlockhash()]);
    return {
      from,
      to,
      amount: value,
      fee: BASE_FEE_LAMPORTS,
      balance,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    };
  }

  /**
   * Sign and broadcast the transfer described by `plan`. The secret
   * must own plan.from — checked against the canonical derivation
   * before anything is signed or sent.
   */
  async function executeSend(plan, secret) {
    checkSecret(secret);
    const from = addressFromSecret('solana', secret);
    if (from !== plan.from) {
      throw Error(`Secret does not own plan.from (${plan.from})`);
    }
    const blockhash = plan.blockhash ?? (await getLatestBlockhash()).blockhash;
    const messageBytes = buildTransferMessage({
      from: plan.from,
      to: plan.to,
      amount: BigInt(plan.amount),
      blockhash,
    });
    const { signature, txBytes } = buildSignedTransaction(messageBytes, secret);
    const hash = await rpc('sendTransaction', [
      bytesToBase64(txBytes),
      { encoding: 'base64' },
    ]);
    // The node returns the transaction signature (base58 of the first
    // signature); fall back to our own encoding if it ever does not.
    return { hash: typeof hash === 'string' && hash ? hash : base58Encode(signature) };
  }

  /**
   * 'success' once confirmed/finalized without error, 'failed' when the
   * status carries an error, otherwise 'pending' (unknown, not yet
   * landed, or only processed).
   */
  async function getTxStatus(signature) {
    const result = await rpc('getSignatureStatuses', [
      [signature],
      { searchTransactionHistory: true },
    ]);
    const status = result?.value?.[0] ?? null;
    if (!status) return 'pending';
    if (status.err) return 'failed';
    if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
      return 'success';
    }
    // Pre-confirmationStatus nodes report finalized as confirmations:null.
    if (status.confirmationStatus == null && status.confirmations === null) return 'success';
    return 'pending';
  }

  return { checkConnection, getBalance, prepareSend, executeSend, getTxStatus };
}
