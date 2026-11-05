// Bitcoin engine for the Quantum Wallet v2 multi-chain expansion.
//
// Accounts are secp256k1: the vault secret for family "bitcoin" is a
// 32-byte private key (see crypto.mjs / hd.mjs, domain
// "ZERONYTH/WALLET/V2/BTC") and the address is a native SegWit P2WPKH
// bech32 address (BIP-173): witness program = hash160 of the 33-byte
// compressed public key. Mainnet uses hrp "bc", testnet hrp "tb"; the
// witness program is identical, so the testnet form is a pure
// re-encoding of the mainnet form.
//
// Transfers spend P2WPKH UTXOs via an esplora-compatible HTTP API
// (Blockstream: https://blockstream.info/api for mainnet,
// https://blockstream.info/testnet/api for testnet), are signed
// locally with the BIP-143 digest algorithm, and are broadcast as raw
// hex. The API is only ever sent the fully signed transaction.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { publicKeyFromSecret, hash160 } from '../crypto.mjs';
import { bech32EncodeSegwit, bech32DecodeSegwit, ecdsaDerEncode } from '../enc.mjs';
import { concatBytes, toHex } from '../bytes.mjs';

/** Outputs below this many satoshis are dust and are never created. */
export const DUST_LIMIT = 546n;

const HRP_BY_VARIANT = Object.freeze({ mainnet: 'bc', testnet: 'tb' });
const VARIANT_BY_HRP = Object.freeze({ bc: 'mainnet', tb: 'testnet' });

const TX_VERSION = 2;
const SEQUENCE_FINAL = 0xffffffff;
const SIGHASH_ALL = 1;
const WITNESS_PROGRAM_LENGTH = 20;

// ------------------------------------------------------------------ helpers

function hrpForVariant(variant) {
  const hrp = HRP_BY_VARIANT[variant];
  if (!hrp) throw Error(`Unknown bitcoin variant: ${variant}`);
  return hrp;
}

function variantForHrp(hrp) {
  const variant = VARIANT_BY_HRP[hrp];
  if (!variant) throw Error(`Unknown bitcoin bech32 hrp: ${hrp}`);
  return variant;
}

/** Bare (non-0x-prefixed) even-length hex → bytes. Esplora txids are bare hex. */
function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw Error(`Invalid hex string: ${String(hex).slice(0, 80)}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Bytes → bare lowercase hex (esplora / txid convention; toHex adds 0x). */
function bytesToHex(bytes) {
  return toHex(bytes).slice(2);
}

function reverseBytes(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[bytes.length - 1 - i];
  return out;
}

function dsha256(bytes) {
  return sha256(sha256(bytes));
}

function u32le(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64le(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

/** Bitcoin compact-size varint. */
function varintBytes(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw Error(`varint out of range: ${value}`);
  if (value < 0xfd) return new Uint8Array([value]);
  if (value <= 0xffff) {
    const out = new Uint8Array(3);
    out[0] = 0xfd;
    new DataView(out.buffer).setUint16(1, value, true);
    return out;
  }
  if (value <= 0xffffffff) {
    const out = new Uint8Array(5);
    out[0] = 0xfe;
    new DataView(out.buffer).setUint32(1, value, true);
    return out;
  }
  const out = new Uint8Array(9);
  out[0] = 0xff;
  new DataView(out.buffer).setBigUint64(1, BigInt(value), true);
  return out;
}

function bigIntTo32Bytes(value) {
  const hex = value.toString(16).padStart(64, '0');
  if (hex.length !== 64) throw Error('secp256k1 scalar out of range');
  return hexToBytes(hex);
}

function toSatoshis(amount) {
  let value;
  if (typeof amount === 'bigint') value = amount;
  else if (typeof amount === 'number') {
    if (!Number.isInteger(amount)) throw Error(`Amount must be an integer number of satoshis: ${amount}`);
    value = BigInt(amount);
  } else if (typeof amount === 'string') value = BigInt(amount);
  else throw Error(`Unsupported amount type: ${typeof amount}`);
  if (value <= 0n) throw Error('Amount must be positive');
  return value;
}

/** P2WPKH scriptPubKey: OP_0 <20-byte witness program>. */
function p2wpkhScript(program) {
  if (program.length !== WITNESS_PROGRAM_LENGTH) throw Error('P2WPKH program must be 20 bytes');
  return concatBytes(new Uint8Array([0x00, 0x14]), program);
}

function scriptForAddress(address) {
  const { program } = bech32DecodeSegwit(address);
  return p2wpkhScript(program);
}

// ------------------------------------------------------------------ addresses

/**
 * P2WPKH bech32 address for a 32-byte secp256k1 secret.
 * variant 'mainnet' → "bc1…"; 'testnet' → "tb1…" (same witness program).
 * The mainnet form agrees with addressFromSecret('bitcoin', secret).
 */
export function deriveAddress(secret, variant = 'mainnet') {
  const hrp = hrpForVariant(variant);
  const publicKey = publicKeyFromSecret('bitcoin', secret); // 33-byte compressed
  return bech32EncodeSegwit(hrp, 0, hash160(publicKey));
}

/** Re-encode an existing P2WPKH address for the other variant (hrp swap). */
export function convertAddress(address, variant) {
  const hrp = hrpForVariant(variant);
  const { program } = bech32DecodeSegwit(address);
  if (program.length !== WITNESS_PROGRAM_LENGTH) {
    throw Error('Not a P2WPKH address (witness program is not 20 bytes)');
  }
  return bech32EncodeSegwit(hrp, 0, program);
}

/** True when `address` is a bech32 v0 P2WPKH address for `variant`. */
export function validateAddress(address, variant) {
  if (typeof address !== 'string' || address.length === 0) return false;
  try {
    const { hrp, program } = bech32DecodeSegwit(address);
    return hrp === hrpForVariant(variant) && program.length === WITNESS_PROGRAM_LENGTH;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ tx building

/** Serialized outpoint: prev txid in wire (reversed) order + vout LE. */
function outpointBytes(input) {
  const txidBytes = hexToBytes(input.txid);
  if (txidBytes.length !== 32) throw Error(`Invalid input txid: ${input.txid}`);
  return concatBytes(reverseBytes(txidBytes), u32le(input.vout));
}

function serializeOutput(output) {
  return concatBytes(u64le(output.value), varintBytes(output.script.length), output.script);
}

function serializeOutputs(outputs) {
  return concatBytes(...outputs.map(serializeOutput));
}

function serializeInput(input) {
  // Empty scriptSig (SegWit), final sequence.
  return concatBytes(outpointBytes(input), new Uint8Array([0x00]), u32le(SEQUENCE_FINAL));
}

/**
 * Serialize a transaction. With `witnesses` (one byte array per input)
 * the SegWit marker/flag and witness stacks are included; without, the
 * legacy (non-witness) serialization used for the txid is produced.
 */
function serializeTx({ inputs, outputs, witnesses = null }) {
  const parts = [u32le(TX_VERSION)];
  if (witnesses) parts.push(new Uint8Array([0x00, 0x01]));
  parts.push(varintBytes(inputs.length));
  for (const input of inputs) parts.push(serializeInput(input));
  parts.push(varintBytes(outputs.length));
  for (const output of outputs) parts.push(serializeOutput(output));
  if (witnesses) for (const witness of witnesses) parts.push(witness);
  parts.push(u32le(0)); // nLockTime
  return concatBytes(...parts);
}

/** Witness stack for one P2WPKH input: [signature, compressed pubkey]. */
function witnessBytes(signatureWithType, publicKey) {
  return concatBytes(
    varintBytes(2),
    varintBytes(signatureWithType.length),
    signatureWithType,
    varintBytes(publicKey.length),
    publicKey,
  );
}

/**
 * BIP-143 signature hash for input `index` (SIGHASH_ALL).
 * preimage = version ‖ hashPrevouts ‖ hashSequence ‖ outpoint ‖
 *            scriptCode ‖ amount ‖ sequence ‖ hashOutputs ‖
 *            locktime(0) ‖ hashType(1); sighash = dsha256(preimage).
 */
function bip143Sighash({ inputs, outputs, index, scriptCode, inputValues }) {
  const hashPrevouts = dsha256(concatBytes(...inputs.map(outpointBytes)));
  const hashSequence = dsha256(concatBytes(...inputs.map(() => u32le(SEQUENCE_FINAL))));
  const hashOutputs = dsha256(serializeOutputs(outputs));
  const preimage = concatBytes(
    u32le(TX_VERSION),
    hashPrevouts,
    hashSequence,
    outpointBytes(inputs[index]),
    scriptCode,
    u64le(inputValues[index]),
    u32le(SEQUENCE_FINAL),
    hashOutputs,
    u32le(0),
    u32le(SIGHASH_ALL),
  );
  return dsha256(preimage);
}

// ------------------------------------------------------------------ client

/**
 * Esplora-backed Bitcoin client. `apiBase` is the esplora root
 * (https://blockstream.info/api or …/testnet/api); `fetchImpl` is
 * injectable for tests and defaults to the global fetch.
 */
export function createBitcoinClient(apiBase, { fetchImpl } = {}) {
  const base = String(apiBase).replace(/\/+$/, '');
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));

  async function getText(path) {
    const res = await doFetch(`${base}${path}`);
    if (!res.ok) throw Error(`Esplora GET ${path} failed (HTTP ${res.status})`);
    return res.text();
  }

  async function getJson(path) {
    return JSON.parse(await getText(path));
  }

  async function fetchUtxos(address) {
    const utxos = await getJson(`/address/${address}/utxo`);
    if (!Array.isArray(utxos)) throw Error('Unexpected esplora UTXO response');
    return utxos;
  }

  async function fetchFeeEstimates() {
    try {
      const estimates = await getJson('/fee-estimates');
      return estimates && typeof estimates === 'object' ? estimates : {};
    } catch {
      return {}; // fall through to the spec'd default rate chain (→ 1 sat/vB)
    }
  }

  /** Current tip height; throws unless it is a positive number. */
  async function checkConnection() {
    const text = await getText('/blocks/tip/height');
    const height = Number.parseInt(String(text).trim(), 10);
    if (!Number.isSafeInteger(height) || height <= 0) {
      throw Error(`Unexpected tip height response: ${String(text).slice(0, 80)}`);
    }
    return height;
  }

  /** Balance in satoshis: the sum of ALL UTXOs of the address. */
  async function getBalance(address) {
    const utxos = await fetchUtxos(address);
    return utxos.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
  }

  /**
   * Plan a send: largest-first coin selection over the address's UTXOs.
   * Fee rate comes from esplora /fee-estimates at opts.feeTargetBlocks
   * (default 3), clamped to a 1.0 sat/vB floor. The plan carries the
   * network `variant` (taken from the sender address's hrp) so
   * executeSend can check the secret against the right network.
   */
  async function prepareSend({ from, to, amount, opts } = {}) {
    const value = toSatoshis(amount);
    const fromDecoded = bech32DecodeSegwit(from); // throws on malformed input
    if (fromDecoded.program.length !== WITNESS_PROGRAM_LENGTH) {
      throw Error('Sender is not a P2WPKH address');
    }
    const variant = variantForHrp(fromDecoded.hrp);
    if (!validateAddress(to, variant)) {
      throw Error(`Recipient is not a valid ${variant} P2WPKH address`);
    }

    const feeTargetBlocks = opts?.feeTargetBlocks ?? 3;
    const [utxos, estimates] = await Promise.all([fetchUtxos(from), fetchFeeEstimates()]);
    const rawRate = parseFloat(estimates[String(feeTargetBlocks)] ?? estimates['3'] ?? '1');
    const feeRateSatVb = Math.max(1.0, Number.isFinite(rawRate) ? rawRate : 1.0);
    const balance = utxos.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);

    // Largest-first; txid/vout tie-break keeps selection deterministic.
    const sorted = [...utxos].sort((a, b) => {
      if (a.value !== b.value) return b.value - a.value;
      if (a.txid !== b.txid) return a.txid < b.txid ? -1 : 1;
      return a.vout - b.vout;
    });

    // vsize estimate: 11 + 68·nIn + 31·nOut. Try 2 outputs (recipient +
    // change) first; if the change would be dust it is folded into the
    // fee instead (single output, fee = totalIn − amount), which is
    // only allowed when that fee still covers the 1-output estimate.
    const vsizeFor = (nIn, nOut) => 11 + 68 * nIn + 31 * nOut;
    const feeFor = (nIn, nOut) => BigInt(Math.ceil(feeRateSatVb * vsizeFor(nIn, nOut)));

    const selected = [];
    let totalIn = 0n;
    for (const utxo of sorted) {
      selected.push(utxo);
      totalIn += BigInt(utxo.value);
      const nIn = selected.length;
      const changeTwoOut = totalIn - value - feeFor(nIn, 2);
      if (changeTwoOut >= DUST_LIMIT) {
        return {
          from, to, variant,
          amount: value,
          fee: feeFor(nIn, 2),
          change: changeTwoOut,
          feeRateSatVb,
          vsize: vsizeFor(nIn, 2),
          inputs: selected.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value })),
          balance,
        };
      }
      const foldedFee = totalIn - value;
      if (foldedFee >= feeFor(nIn, 1)) {
        return {
          from, to, variant,
          amount: value,
          fee: foldedFee,
          change: 0n,
          feeRateSatVb,
          vsize: vsizeFor(nIn, 1),
          inputs: selected.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value })),
          balance,
        };
      }
    }
    throw Error(
      `Insufficient funds: balance ${balance} sat cannot cover ${value} sat plus fees`,
    );
  }

  /**
   * Sign a plan (BIP-143, SIGHASH_ALL) and broadcast it.
   * The secret must derive plan.from on the plan's network variant.
   * Returns { hash } with the txid (display-order hex).
   */
  async function executeSend(plan, secret) {
    const variant = plan.variant ?? variantForHrp(bech32DecodeSegwit(plan.from).hrp);
    if (deriveAddress(secret, variant) !== plan.from) {
      throw Error('Secret does not match the plan sender address');
    }
    const toDecoded = bech32DecodeSegwit(plan.to);
    if (toDecoded.hrp !== hrpForVariant(variant) || toDecoded.program.length !== WITNESS_PROGRAM_LENGTH) {
      throw Error('Recipient is not a P2WPKH address on the plan network');
    }

    const publicKey = publicKeyFromSecret('bitcoin', secret); // compressed, 33 B
    const pubkeyHash = hash160(publicKey);
    // BIP-143 scriptCode for P2WPKH: 0x19 76a914 <pubkey hash> 88ac.
    const scriptCode = concatBytes(
      new Uint8Array([0x19, 0x76, 0xa9, 0x14]),
      pubkeyHash,
      new Uint8Array([0x88, 0xac]),
    );

    const inputs = plan.inputs.map((input) => ({ txid: input.txid, vout: input.vout }));
    const inputValues = plan.inputs.map((input) => BigInt(input.value));
    const outputs = [{ value: BigInt(plan.amount), script: scriptForAddress(plan.to) }];
    const change = BigInt(plan.change ?? 0n);
    if (change >= DUST_LIMIT) {
      outputs.push({ value: change, script: scriptForAddress(plan.from) });
    }

    const witnesses = inputs.map((_, index) => {
      const sighash = bip143Sighash({ inputs, outputs, index, scriptCode, inputValues });
      const compact = secp256k1.sign(sighash, secret, { prehash: false }); // low-S by default
      const signature = secp256k1.Signature.fromBytes(compact, 'compact');
      const der = ecdsaDerEncode(bigIntTo32Bytes(signature.r), bigIntTo32Bytes(signature.s));
      const signatureWithType = concatBytes(der, new Uint8Array([SIGHASH_ALL]));
      return witnessBytes(signatureWithType, publicKey);
    });

    const rawTx = serializeTx({ inputs, outputs, witnesses });
    const rawTxHex = bytesToHex(rawTx);
    const txid = bytesToHex(reverseBytes(dsha256(serializeTx({ inputs, outputs }))));

    const res = await doFetch(`${base}/tx`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: rawTxHex,
    });
    const responseText = String(await res.text()).trim();
    if (!res.ok) throw Error(`Broadcast failed (HTTP ${res.status}, txid ${txid}): ${responseText}`);
    const returnedTxid = responseText.toLowerCase().replace(/^0x/, '');
    if (returnedTxid !== txid) {
      throw Error(`Broadcast txid mismatch: esplora returned ${returnedTxid}, computed ${txid}`);
    }
    return { hash: txid };
  }

  /**
   * 'success' once the tx is confirmed; 'pending' while it is
   * unconfirmed or unknown to the API (404).
   */
  async function getTxStatus(txid) {
    const res = await doFetch(`${base}/tx/${txid}`);
    if (res.status === 404) return 'pending';
    if (!res.ok) throw Error(`Esplora GET /tx/${txid} failed (HTTP ${res.status})`);
    const data = JSON.parse(await res.text());
    return data?.status?.confirmed ? 'success' : 'pending';
  }

  return { checkConnection, getBalance, prepareSend, executeSend, getTxStatus };
}
