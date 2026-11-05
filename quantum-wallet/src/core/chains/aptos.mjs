// Aptos engine for the Quantum Wallet v2 multi-chain expansion.
//
// Accounts are Ed25519: the vault secret for family "aptos" is a
// 32-byte Ed25519 seed (see crypto.mjs / hd.mjs, domain
// "ZERONYTH/WALLET/V2/APTOS") and the address is
//   0x ‖ sha3-256(ed25519 pubkey ‖ 0x00)
// — the legacy single-signer authentication key. It is identical on
// mainnet and testnet, so `variant` never changes derivation or
// validation; it is accepted (and checked) only for interface symmetry
// with the other chain engines.
//
// Transfers are EntryFunction payloads
//   0x1::coin::transfer<0x1::aptos_coin::AptosCoin>(recipient, amount)
// serialized as BCS RawTransactions, signed locally with the domain
// prefix hash sha3-256("APTOS::RawTransaction"), and submitted as raw
// BCS bytes — the node is only ever sent the fully signed transaction.
//
// Endpoints (verified live 2026-11-05 against
// fullnode.{mainnet,testnet}.aptoslabs.com):
//   GET  /                        ledger info, carries chain_id
//   POST /view                    0x1::coin::balance<AptosCoin> → ["<u64>"]
//   GET  /accounts/{address}      { sequence_number: "<u64>", … }
//   GET  /estimate_gas_price      { gas_estimate, … }
//   POST /transactions            application/x.aptos.signed_transaction+bcs
//   GET  /transactions/by_hash/{hash}

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { addressFromSecret, publicKeyFromSecret } from '../crypto.mjs';
import { concatBytes, toHex, utf8Encode } from '../bytes.mjs';

/**
 * Default max_gas_amount for a coin transfer (caps the fee bound).
 * Must stay above the network minimum transaction gas units
 * (validation rejects below it with
 * MAX_GAS_UNITS_BELOW_MIN_TRANSACTION_GAS_UNITS — hit live on
 * devnet 2026-11-06 with the old 200 default); a first transfer
 * to a fresh recipient also burned a full 10,000-unit cap
 * (Out of gas, new storage creation), so the default matches
 * the official Aptos SDK's 200,000-unit cap.
 */
export const DEFAULT_MAX_GAS_AMOUNT = 200000;
/** Fallback gas unit price (octas) when the node gives no estimate. */
export const FALLBACK_GAS_UNIT_PRICE = 100;
/** Default transaction TTL added on top of `now`, in seconds. */
export const DEFAULT_TTL_SECS = 600;

const VARIANTS = Object.freeze(['mainnet', 'testnet']);

function checkVariant(variant) {
  if (variant !== undefined && !VARIANTS.includes(variant)) {
    throw Error(`Unknown Aptos variant: ${variant}`);
  }
}

function checkSecret(secret) {
  if (!(secret instanceof Uint8Array) || secret.length !== 32) {
    throw Error('Aptos secret must be a 32-byte Ed25519 seed');
  }
}

/**
 * Canonical address for a 32-byte Ed25519 seed:
 * 0x + sha3-256(pubkey ‖ 0x00). Same on both networks.
 */
export function deriveAddress(secret, variant) {
  checkVariant(variant);
  checkSecret(secret);
  return addressFromSecret('aptos', secret);
}

/**
 * True for a full-length Aptos address: "0x" + exactly 64 hex digits
 * (32 bytes), case-insensitive. Short forms such as 0x1 are NOT valid
 * here — they are only accepted (and zero-padded) as send inputs in
 * prepareSend / getBalance, never as canonical stored addresses.
 */
export function validateAddress(address, variant) {
  checkVariant(variant);
  return typeof address === 'string' && /^0x[0-9a-fA-F]{64}$/.test(address);
}

// ------------------------------------------------------------- addresses

/**
 * Parse an address input of 1–64 hex digits (optional 0x prefix) into
 * its 32 raw bytes, left-padding with zeroes. Used for send inputs,
 * where the chain itself accepts short forms like 0x1.
 */
function addressToBytes(input, what = 'address') {
  if (typeof input !== 'string') throw Error(`Invalid Aptos ${what}: ${input}`);
  const hex = input.startsWith('0x') || input.startsWith('0X') ? input.slice(2) : input;
  if (!/^[0-9a-fA-F]{1,64}$/.test(hex)) throw Error(`Invalid Aptos ${what}: ${input}`);
  const padded = hex.toLowerCase().padStart(64, '0');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(padded.substr(i * 2, 2), 16);
  return out;
}

/** Canonical 0x + 64-lowercase-hex form of any accepted address input. */
function canonicalAddress(input, what = 'address') {
  return toHex(addressToBytes(input, what));
}

// ------------------------------------------------------------------- BCS
//
// Minimal BCS writer — only the pieces a RawTransaction needs:
//   ULEB128        variable-length, 7 bits per byte, little-endian groups
//   u8 / u64       fixed little-endian
//   bytes          ULEB128 length prefix ‖ raw bytes
//   string         bytes of the UTF-8 encoding
//   address        32 raw bytes, no length prefix
//   vector<T>      ULEB128 count ‖ items
//   enum           ULEB128 variant index ‖ variant fields

function uleb128(value) {
  let v = BigInt(value);
  if (v < 0n) throw Error(`ULEB128 cannot encode negative value: ${value}`);
  const out = [];
  for (;;) {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
    if (v === 0n) break;
  }
  return new Uint8Array(out);
}

function u8(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 0xff) throw Error(`u8 out of range: ${value}`);
  return new Uint8Array([n]);
}

function u64(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function bcsBytes(bytes) {
  return concatBytes(uleb128(bytes.length), bytes);
}

function bcsString(str) {
  return bcsBytes(utf8Encode(str));
}

/**
 * TypeTag for 0x1::aptos_coin::AptosCoin:
 *   TypeTag enum variant 7 (Struct — variant order: Bool 0, U8 1,
 *   U64 2, U128 3, Address 4, Signer 5, Vector 6, Struct 7)
 *   ‖ address(0x1) ‖ module "aptos_coin" ‖ name "AptosCoin"
 *   ‖ type_args count 0.
 * (Was wrongly variant 1 until 2026-11-06: the node then misread the
 * tag as U8 and every following field shifted, surfacing as an
 * Ed25519PublicKey deserialization error on submit.)
 */
function bcsAptosCoinStructTag() {
  const one = new Uint8Array(32);
  one[31] = 1;
  return concatBytes(
    uleb128(7),
    one,
    bcsString('aptos_coin'),
    bcsString('AptosCoin'),
    uleb128(0),
  );
}

/**
 * EntryFunction payload for
 *   0x1::coin::transfer<0x1::aptos_coin::AptosCoin>(to, amount):
 *   payload enum variant 2 ‖ module address(0x1) ‖ module "coin"
 *   ‖ function "transfer" ‖ type_args [AptosCoin StructTag]
 *   ‖ args: vector of BCS-encoded arguments, each itself
 *     length-prefixed — arg0 = recipient address (32 raw bytes),
 *     arg1 = amount as u64 LE (8 bytes).
 */
function bcsTransferPayload(toBytes, amount) {
  const one = new Uint8Array(32);
  one[31] = 1;
  return concatBytes(
    uleb128(2), // TransactionPayload::EntryFunction
    one, // module address 0x1
    bcsString('coin'),
    bcsString('transfer'),
    uleb128(1), // one type argument
    bcsAptosCoinStructTag(),
    uleb128(2), // two arguments
    bcsBytes(toBytes),
    bcsBytes(u64(amount)),
  );
}

/**
 * BCS RawTransaction, fields in order:
 *   sender (address), sequence_number (u64), payload,
 *   max_gas_amount (u64), gas_unit_price (u64),
 *   expiration_timestamp_secs (u64), chain_id (u8).
 */
function buildRawTransaction({ fromBytes, sequence, toBytes, amount, maxGasAmount, gasUnitPrice, expirationSecs, chainId }) {
  return concatBytes(
    fromBytes,
    u64(sequence),
    bcsTransferPayload(toBytes, amount),
    u64(maxGasAmount),
    u64(gasUnitPrice),
    u64(expirationSecs),
    u8(chainId),
  );
}

/**
 * Signed transaction = BCS(RawTransaction) ‖ authenticator, where the
 * Ed25519 authenticator is: enum variant 0 ‖ bytes(pubkey 32)
 * ‖ bytes(signature 64). The signature is over
 * sha3-256("APTOS::RawTransaction") ‖ BCS(RawTransaction).
 */
function buildSignedTransaction(rawTx, secret) {
  const prefixHash = sha3_256(utf8Encode('APTOS::RawTransaction'));
  const message = concatBytes(prefixHash, rawTx);
  const signature = ed25519.sign(message, secret);
  const publicKey = publicKeyFromSecret('aptos', secret);
  return concatBytes(rawTx, uleb128(0), bcsBytes(publicKey), bcsBytes(signature));
}

// ----------------------------------------------------------------- client

export function createAptosClient(apiBase, { fetchImpl, now } = {}) {
  if (typeof apiBase !== 'string' || apiBase.length === 0) {
    throw Error('createAptosClient: apiBase required');
  }
  const base = apiBase.replace(/\/+$/, '');
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw Error('no fetch implementation available');
  // `now` is a millisecond clock (Date.now-shaped) so tests can pin
  // the transaction expiration deterministically.
  const nowMs = typeof now === 'function' ? now : Date.now;

  async function request(path, init = {}) {
    const finalInit = { ...init };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' && !finalInit.signal) {
      finalInit.signal = AbortSignal.timeout(30000);
    }
    const res = await doFetch(base + path, finalInit);
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { res, json };
  }

  function httpError(path, res, json) {
    const detail = json?.message || json?.error_code || '';
    const err = new Error(`Aptos ${path}: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
    err.status = res.status;
    err.body = json;
    return err;
  }

  /** Ledger info (GET /). Throws on HTTP error or malformed body. */
  async function getLedgerInfo() {
    const { res, json } = await request('/');
    if (!res.ok) throw httpError('/', res, json);
    if (!json || json.chain_id == null) throw Error('Aptos /: ledger info missing chain_id');
    return json;
  }

  /** True when GET / answers with a chain_id. Never throws. */
  async function checkConnection() {
    try {
      const info = await getLedgerInfo();
      return typeof info.chain_id === 'number' || typeof info.chain_id === 'string';
    } catch {
      return false;
    }
  }

  /** Numeric chain id from the ledger info (1 mainnet, 2 testnet). */
  async function getChainId() {
    const info = await getLedgerInfo();
    return Number(info.chain_id);
  }

  /**
   * APT balance in octas (bigint), read via the view function
   * 0x1::coin::balance<0x1::aptos_coin::AptosCoin>, which answers
   * ["<u64>"]. An account that does not exist yet reads as 0n
   * (the view answers ["0"] for fresh addresses on the live nodes,
   * and a not-found error maps to 0n as well).
   */
  async function getBalance(address) {
    const account = canonicalAddress(address);
    const { res, json } = await request('/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        function: '0x1::coin::balance',
        type_arguments: ['0x1::aptos_coin::AptosCoin'],
        arguments: [account],
      }),
    });
    if (!res.ok) {
      const notFound =
        res.status === 404 ||
        /not.?found/i.test(json?.message ?? '') ||
        /account/i.test(json?.error_code ?? '');
      if (notFound) return 0n;
      throw httpError('/view', res, json);
    }
    if (!Array.isArray(json) || json.length === 0) throw Error('Aptos /view: malformed balance response');
    return BigInt(json[0]);
  }

  /** Sequence number (bigint) of an account; 0n when it does not exist. */
  async function getSequence(address) {
    const account = canonicalAddress(address);
    const { res, json } = await request(`/accounts/${account}`);
    if (res.status === 404) return 0n;
    if (!res.ok) throw httpError(`/accounts/${account}`, res, json);
    return BigInt(json?.sequence_number ?? '0');
  }

  /** Gas unit price estimate (number, octas); falls back to 100. */
  async function getGasUnitPrice() {
    try {
      const { res, json } = await request('/estimate_gas_price');
      if (res.ok && json && json.gas_estimate != null) return Number(json.gas_estimate);
    } catch {
      // fall through to the default below
    }
    return FALLBACK_GAS_UNIT_PRICE;
  }

  /**
   * Fetch balance, sequence, gas price and chain id, and assemble a
   * send plan. `amount` is a bigint of octas. The plan's `fee` is the
   * worst-case fee bound maxGasAmount × gasUnitPrice.
   * opts: { maxGasAmount, ttlSecs, expirationSecs }.
   */
  async function prepareSend({ from, to, amount, opts } = {}) {
    const fromCanonical = canonicalAddress(from, 'from address');
    const toCanonical = canonicalAddress(to, 'to address');
    const value = typeof amount === 'bigint' ? amount : BigInt(amount);
    if (value <= 0n) throw Error('amount must be positive');
    const maxGasAmount = Number(opts?.maxGasAmount ?? DEFAULT_MAX_GAS_AMOUNT);
    if (!Number.isSafeInteger(maxGasAmount) || maxGasAmount <= 0) {
      throw Error(`maxGasAmount out of range: ${opts?.maxGasAmount}`);
    }
    const [balance, sequence, gasUnitPrice, chainId] = await Promise.all([
      getBalance(fromCanonical),
      getSequence(fromCanonical),
      getGasUnitPrice(),
      getChainId(),
    ]);
    const expirationSecs =
      opts?.expirationSecs != null
        ? Number(opts.expirationSecs)
        : Math.floor(nowMs() / 1000) + Number(opts?.ttlSecs ?? DEFAULT_TTL_SECS);
    return {
      from: fromCanonical,
      to: toCanonical,
      amount: value,
      fee: BigInt(maxGasAmount) * BigInt(gasUnitPrice),
      balance,
      sequence,
      gasUnitPrice,
      maxGasAmount,
      chainId,
      expirationSecs,
    };
  }

  /**
   * Sign and broadcast the transfer described by `plan` as a BCS
   * signed transaction. The secret must own plan.from — checked
   * against the canonical derivation before anything is signed.
   * Returns { hash } from the node's JSON response.
   */
  async function executeSend(plan, secret) {
    checkSecret(secret);
    const owned = deriveAddress(secret);
    if (owned !== canonicalAddress(plan.from, 'from address')) {
      throw Error(`Secret does not own plan.from (${plan.from})`);
    }
    const rawTx = buildRawTransaction({
      fromBytes: addressToBytes(plan.from, 'from address'),
      sequence: BigInt(plan.sequence ?? 0),
      toBytes: addressToBytes(plan.to, 'to address'),
      amount: BigInt(plan.amount),
      maxGasAmount: BigInt(plan.maxGasAmount ?? DEFAULT_MAX_GAS_AMOUNT),
      gasUnitPrice: BigInt(plan.gasUnitPrice ?? FALLBACK_GAS_UNIT_PRICE),
      expirationSecs: BigInt(
        plan.expirationSecs ?? Math.floor(nowMs() / 1000) + DEFAULT_TTL_SECS,
      ),
      chainId: Number(plan.chainId),
    });
    const signedTx = buildSignedTransaction(rawTx, secret);
    const { res, json } = await request('/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x.aptos.signed_transaction+bcs',
        Accept: 'application/json',
      },
      body: signedTx,
    });
    if (!res.ok) throw httpError('/transactions', res, json);
    if (!json || typeof json.hash !== 'string') {
      throw Error('Aptos /transactions: response missing hash');
    }
    return { hash: json.hash };
  }

  /**
   * 'success' when the transaction committed with success === true,
   * 'failed' when it committed with success === false and a vm_status,
   * 'pending' while the hash is unknown (404) or not yet final.
   */
  async function getTxStatus(hash) {
    const { res, json } = await request(`/transactions/by_hash/${hash}`);
    if (res.status === 404) return 'pending';
    if (!res.ok) throw httpError(`/transactions/by_hash/${hash}`, res, json);
    if (json?.success === true) return 'success';
    if (json?.success === false && json?.vm_status) return 'failed';
    return 'pending';
  }

  return { checkConnection, getChainId, getBalance, prepareSend, executeSend, getTxStatus };
}
