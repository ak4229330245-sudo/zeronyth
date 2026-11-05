// Sui engine for the Quantum Wallet v2 multi-chain expansion.
//
// Accounts are Ed25519: the vault secret for family "sui" is a 32-byte
// Ed25519 seed (see crypto.mjs / hd.mjs, domain
// "ZERONYTH/WALLET/V2/SUI") and the address is
//   0x ‖ blake2b-256(0x00 ‖ ed25519 public key)
// — the 0x00 is Sui's signature-scheme flag for Ed25519. The address is
// identical on mainnet and testnet, so `variant` never changes
// derivation or validation.
//
// Transport — GraphQL ONLY (verified live 2026-11-05): Sui JSON-RPC on
// public fullnodes is deprecated and refuses requests ("JSON-RPC on
// public fullnodes has been deprecated"); the live public interface is
// the GraphQL service at https://graphql.mainnet.sui.io/graphql and
// https://graphql.testnet.sui.io/graphql (Access-Control-Allow-Origin:
// *). The exact field set this engine ships against, every entry
// verified by introspection + live queries on 2026-11-05:
//
//   connection:  query { chainIdentifier }
//                  → genesis checkpoint digest, base58 (non-empty =
//                    reachable). Testnet 69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9
//                    BZthQea3JNMD, mainnet 4btiuiMPvEENsttpZC7CZ53DruC3M
//                    AgfznDbASZ7DR6S at verification time.
//   balance:     query ($address: SuiAddress!) {
//                  address(address: $address) {
//                    balance(coinType: "0x2::sui::SUI") { totalBalance } } }
//                  → totalBalance is a BigInt scalar (string in JSON);
//                    it counts coin objects AND the newer address
//                    balance. A never-seen address yields address: null
//                    (or a null balance) → 0 MIST.
//   coins:       query ($owner: SuiAddress!, $after: String) {
//                  objects(first: 50, after: $after,
//                          filter: { owner: $owner,
//                                    type: "0x2::coin::Coin<0x2::sui::SUI>" }) {
//                    nodes { address version digest }
//                    pageInfo { hasNextPage endCursor } } }
//                  → address = objectId (0x…), version = UInt53 (JSON
//                    number), digest = base58 object digest. Paginated
//                    via pageInfo until hasNextPage is false.
//   gas price:   query { epoch { referenceGasPrice } }
//                  → BigInt scalar (string in JSON); 1000 MIST at
//                    verification time. Falls back to 1000 if the epoch
//                    query fails (the long-standing reference price).
//   simulation:  query ($transaction: JSON!, $doGasSelection: Boolean) {
//                  simulateTransaction(transaction: $transaction,
//                                      doGasSelection: $doGasSelection) {
//                    effects { status
//                              executionError { message }
//                              gasEffects { gasSummary {
//                                computationCost storageCost storageRebate } } } } }
//                  → NOTE: `transaction` is a gRPC-JSON Transaction, NOT
//                    the BCS form and NOT the read-side transactionJson
//                    shape. Argument JSON verified by probing:
//                    GasCoin = { kind: "GAS" }, Input = { kind: "INPUT",
//                    input: n }, a nested result = { kind: "RESULT",
//                    result: cmd, subresult: idx } (the read-side
//                    "NESTED_RESULT" kind is REJECTED here). Pure inputs
//                    are { kind: "PURE", pure: base64(BCS value bytes) }.
//                    Gas summary values are MIST amounts, so the
//                    estimated charge is computationCost + storageCost
//                    − storageRebate.
//   execution:   mutation ($transactionDataBcs: Base64!,
//                          $signatures: [Base64!]!) {
//                  executeTransaction(transactionDataBcs: $transactionDataBcs,
//                                     signatures: $signatures) {
//                    effects { digest status } } }
//                  → the mutation is named executeTransaction (NOT
//                    executeTransactionBlock — that was the JSON-RPC
//                    name). Bad BCS / bad signatures come back as
//                    GraphQL `errors` with the server message verbatim.
//   tx status:   query ($digest: String!) {
//                  transactionEffects(digest: $digest) { status } }
//                  → status is the ExecutionStatus enum (SUCCESS |
//                    FAILURE); a null transactionEffects (unknown or
//                    not-yet-indexed digest) maps to 'pending'.
//
// Gas budget / fee honesty: prepareSend first builds the PTB with the
// flat DEFAULT_GAS_BUDGET (10_000_000 MIST) and simulates it. When the
// simulation succeeds, the budget becomes 2× the simulated charge
// (clamped to [1_000_000, 10_000_000]) and plan.feeSemantics is
// 'estimated' — plan.fee is that budget, i.e. still a cap: Sui charges
// only the actual gas used and refunds the rest of the budget. When
// simulation is unavailable or fails (e.g. an unfunded account), the
// flat 10_000_000 budget stands and plan.feeSemantics is 'budget-cap'.
// The simulation outcome is kept on plan.simulation either way.
//
// Transfers are hand-built ProgrammableTransactions (BCS, no SDK):
// SplitCoins(GasCoin, [amount]) then TransferObjects the split coin to
// the recipient. ALL of the sender's SUI coin objects are listed as
// gas payment — Sui merges them into the gas coin, so the split works
// regardless of individual coin sizes. Signing is intent-based:
// digest = blake2b-256([0x00,0x00,0x00] ‖ txBytes) (scope
// TransactionData, version V0, app Sui), signed with Ed25519; the
// serialized signature is base64(0x00 ‖ sig64 ‖ pubkey32).

import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { addressFromSecret, publicKeyFromSecret } from '../crypto.mjs';
import { base58Decode } from '../enc.mjs';
import { concatBytes } from '../bytes.mjs';

export const SUI_COIN_TYPE = '0x2::sui::SUI';
/** Flat gas budget (MIST) used when no simulation estimate is available. */
export const DEFAULT_GAS_BUDGET = 10_000_000n;
/** Fallback reference gas price (MIST) if the epoch query fails. */
export const FALLBACK_GAS_PRICE = 1000n;
/** Intent prefix: [TransactionData scope=0, V0=0, Sui app=0]. */
export const INTENT_BYTES = new Uint8Array([0x00, 0x00, 0x00]);

const VARIANTS = Object.freeze(['mainnet', 'testnet']);
const ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
const MAX_COIN_PAGES = 20; // 50 coins/page → at most 1000 gas coins

function checkVariant(variant) {
  if (variant !== undefined && !VARIANTS.includes(variant)) {
    throw Error(`Unknown Sui variant: ${variant}`);
  }
}

function checkSecret(secret) {
  if (!(secret instanceof Uint8Array) || secret.length !== 32) {
    throw Error('Sui secret must be a 32-byte Ed25519 seed');
  }
}

/**
 * 0x address for a 32-byte Ed25519 seed. Agrees with
 * addressFromSecret('sui', secret) by construction; identical for
 * 'mainnet' and 'testnet'.
 */
export function deriveAddress(secret, variant) {
  checkVariant(variant);
  checkSecret(secret);
  return addressFromSecret('sui', secret);
}

/** True when `address` is a canonical 0x-prefixed 32-byte hex address. */
export function validateAddress(address, variant) {
  checkVariant(variant);
  return typeof address === 'string' && ADDRESS_RE.test(address);
}

// ------------------------------------------------------------------- base64

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(text) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------- BCS

/** ULEB128 encoding of a non-negative integer (lengths, enum variants). */
function uleb128(value) {
  let v = typeof value === 'bigint' ? value : BigInt(value);
  if (v < 0n) throw Error(`uleb128: negative value ${value}`);
  const out = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return new Uint8Array(out);
}

function u16Bytes(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffff) throw Error(`u16 out of range: ${value}`);
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
}

function u64Bytes(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

/** BCS bytes for a value: uleb128 length prefix ‖ raw bytes. */
function bcsBytes(raw) {
  return concatBytes(uleb128(raw.length), raw);
}

/** 32 raw bytes of a 0x Sui address / object id. */
function addressBytes(address, what = 'address') {
  if (!validateAddress(address)) throw Error(`Invalid Sui ${what}: ${address}`);
  const hex = address.slice(2);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Serialize a vec<T>: uleb128 count ‖ concatenated items. */
function bcsVec(items) {
  return concatBytes(uleb128(items.length), ...items);
}

// Argument (BCS enum): GasCoin(0) | Input(1, u16) | Result(2, u16) |
// NestedResult(3, u16, u16).
const argGasCoin = () => uleb128(0);
const argInput = (index) => concatBytes(uleb128(1), u16Bytes(index));
const argNestedResult = (cmd, idx) => concatBytes(uleb128(3), u16Bytes(cmd), u16Bytes(idx));

/**
 * Build the BCS TransactionData for a SUI transfer:
 *
 *   TransactionData::V1 {
 *     kind: ProgrammableTransaction {
 *       inputs:   [Pure(recipient address32), Pure(u64 amount)],
 *       commands: [SplitCoins { coin: GasCoin, amounts: [Input(1)] },
 *                  TransferObjects { objects: [NestedResult(0, 0)],
 *                                    address: Input(0) }],
 *     },
 *     sender:   sender,
 *     gasData:  { payment: coins, owner: sender,
 *                 price: gasPrice, budget: gasBudget },
 *     expiration: None,
 *   }
 *
 * `coins` is [{ objectId, version, digest }] with digest base58 (as the
 * GraphQL coins query returns it). Pure inputs carry BCS-bytes values:
 * for an address that is the 32 raw bytes, for a u64 its 8 LE bytes —
 * each wrapped as uleb128 length ‖ bytes inside the Pure variant.
 */
export function buildTransferTransactionBytes({ sender, recipient, amount, coins, gasPrice, gasBudget }) {
  if (!Array.isArray(coins)) throw Error('coins must be an array');
  const value = BigInt(amount);
  if (value < 0n) throw Error('amount cannot be negative');
  const inputs = bcsVec([
    // CallArg::Pure(bcsBytes(address))
    concatBytes(uleb128(0), bcsBytes(addressBytes(recipient, 'recipient address'))),
    // CallArg::Pure(bcsBytes(u64 amount))
    concatBytes(uleb128(0), bcsBytes(u64Bytes(value))),
  ]);
  const commands = bcsVec([
    // Command::SplitCoins(2) { coin: GasCoin, amounts: [Input(1)] }
    concatBytes(uleb128(2), argGasCoin(), bcsVec([argInput(1)])),
    // Command::TransferObjects(1) { objects: [NestedResult(0, 0)], address: Input(0) }
    concatBytes(uleb128(1), bcsVec([argNestedResult(0, 0)]), argInput(0)),
  ]);
  const kind = concatBytes(uleb128(0), inputs, commands); // TransactionKind::ProgrammableTransaction(0)
  const payment = bcsVec(
    coins.map((coin) => {
      const digestBytes = base58Decode(coin.digest);
      if (digestBytes.length !== 32) {
        throw Error(`coin digest must decode to 32 bytes: ${coin.digest}`);
      }
      // ObjectRef: (objectId, SequenceNumber u64, ObjectDigest = bcsBytes)
      return concatBytes(
        addressBytes(coin.objectId, 'coin objectId'),
        u64Bytes(coin.version),
        bcsBytes(digestBytes),
      );
    }),
  );
  const gasData = concatBytes(
    payment,
    addressBytes(sender, 'sender address'), // owner == sender
    u64Bytes(gasPrice),
    u64Bytes(gasBudget),
  );
  return concatBytes(
    uleb128(0), // TransactionData::V1
    kind,
    addressBytes(sender, 'sender address'),
    gasData,
    uleb128(0), // TxExpires::None
  );
}

/** The blake2b-256 digest that is actually signed for `txBytes`. */
export function intentDigest(txBytes) {
  return blake2b(concatBytes(INTENT_BYTES, txBytes), { dkLen: 32 });
}

/**
 * Intent-sign BCS transaction bytes with a 32-byte Ed25519 seed.
 * Returns { digestToSign, signature (64 B), serializedSignature }
 * where serializedSignature = base64(0x00 ‖ sig ‖ pubkey) — the form
 * the executeTransaction mutation takes.
 */
export function signTransactionBytes(txBytes, secret) {
  checkSecret(secret);
  const digestToSign = intentDigest(txBytes);
  const signature = ed25519.sign(digestToSign, secret);
  const publicKey = publicKeyFromSecret('sui', secret);
  const serializedSignature = bytesToBase64(
    concatBytes(new Uint8Array([0x00]), signature, publicKey),
  );
  return { digestToSign, signature, serializedSignature };
}

// ------------------------------------------------- gRPC-JSON (simulation)

/**
 * The gRPC-JSON mirror of the BCS transfer above, for
 * simulateTransaction. Shapes verified by probing (see header): the
 * split coin's nested result is { kind: 'RESULT', result: 0,
 * subresult: 0 }; Pure values are base64 of the BCS value bytes.
 */
function transferSimulationJson({ sender, recipient, amount, coins, gasPrice, gasBudget }) {
  return {
    version: 1,
    kind: {
      kind: 'PROGRAMMABLE_TRANSACTION',
      programmableTransaction: {
        inputs: [
          { kind: 'PURE', pure: bytesToBase64(addressBytes(recipient, 'recipient address')) },
          { kind: 'PURE', pure: bytesToBase64(u64Bytes(BigInt(amount))) },
        ],
        commands: [
          { splitCoins: { coin: { kind: 'GAS' }, amounts: [{ kind: 'INPUT', input: 1 }] } },
          {
            transferObjects: {
              objects: [{ kind: 'RESULT', result: 0, subresult: 0 }],
              address: { kind: 'INPUT', input: 0 },
            },
          },
        ],
      },
    },
    sender,
    gasPayment: {
      objects: coins.map((coin) => ({
        objectId: coin.objectId,
        version: String(coin.version),
        digest: coin.digest,
      })),
      owner: sender,
      price: String(gasPrice),
      budget: String(gasBudget),
    },
    expiration: { kind: 'NONE' },
  };
}

// ------------------------------------------------------------------- client

const Q_CHAIN = '{ chainIdentifier }';
const Q_BALANCE = `query ($address: SuiAddress!) {
  address(address: $address) { balance(coinType: "${SUI_COIN_TYPE}") { totalBalance } }
}`;
const Q_COINS = `query ($owner: SuiAddress!, $after: String) {
  objects(first: 50, after: $after, filter: { owner: $owner, type: "0x2::coin::Coin<${SUI_COIN_TYPE}>" }) {
    nodes { address version digest }
    pageInfo { hasNextPage endCursor }
  }
}`;
const Q_EPOCH = '{ epoch { referenceGasPrice } }';
const Q_SIMULATE = `query ($transaction: JSON!, $doGasSelection: Boolean) {
  simulateTransaction(transaction: $transaction, doGasSelection: $doGasSelection) {
    effects {
      status
      executionError { message }
      gasEffects { gasSummary { computationCost storageCost storageRebate } }
    }
  }
}`;
const M_EXECUTE = `mutation ($transactionDataBcs: Base64!, $signatures: [Base64!]!) {
  executeTransaction(transactionDataBcs: $transactionDataBcs, signatures: $signatures) {
    effects { digest status }
  }
}`;
const Q_TX_EFFECTS = `query ($digest: String!) {
  transactionEffects(digest: $digest) { status }
}`;

export function createSuiClient(apiBase, { fetchImpl } = {}) {
  if (typeof apiBase !== 'string' || apiBase.length === 0) {
    throw Error('createSuiClient: apiBase required');
  }
  const url = apiBase.replace(/\/+$/, '');
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw Error('no fetch implementation available');

  /**
   * One GraphQL round-trip. A response carrying `errors` throws with
   * the server message(s) verbatim — execution and simulation failures
   * are reported this way by the Sui GraphQL service.
   */
  async function graphql(query, variables = {}) {
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(30000);
    }
    const res = await doFetch(url, init);
    if (!res.ok) throw Error(`Sui GraphQL: HTTP ${res.status}`);
    const j = await res.json();
    if (Array.isArray(j?.errors) && j.errors.length > 0) {
      throw Error(`Sui GraphQL: ${j.errors.map((e) => e?.message ?? 'unknown error').join('; ')}`);
    }
    return j?.data ?? null;
  }

  /** True when the endpoint answers chainIdentifier with a digest. Never throws. */
  async function checkConnection() {
    try {
      const data = await graphql(Q_CHAIN);
      return typeof data?.chainIdentifier === 'string' && data.chainIdentifier.length > 0;
    } catch {
      return false;
    }
  }

  /** Total SUI balance of `address` in MIST (bigint); 0 for unseen addresses. */
  async function getBalance(address) {
    if (!validateAddress(address)) throw Error(`Invalid Sui address: ${address}`);
    const data = await graphql(Q_BALANCE, { address });
    const total = data?.address?.balance?.totalBalance;
    return total == null ? 0n : BigInt(total);
  }

  /** All SUI coin objects owned by `address`: [{ objectId, version, digest }]. */
  async function getCoins(address) {
    const coins = [];
    let after = null;
    for (let page = 0; page < MAX_COIN_PAGES; page++) {
      const data = await graphql(Q_COINS, { owner: address, after });
      const conn = data?.objects;
      if (!conn) break;
      for (const node of conn.nodes ?? []) {
        coins.push({ objectId: node.address, version: node.version, digest: node.digest });
      }
      if (!conn.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor;
      if (after == null) break;
    }
    return coins;
  }

  /** Current epoch reference gas price in MIST (bigint). */
  async function getReferenceGasPrice() {
    const data = await graphql(Q_EPOCH);
    const price = data?.epoch?.referenceGasPrice;
    return price == null ? FALLBACK_GAS_PRICE : BigInt(price);
  }

  /**
   * Assemble a send plan: balance + ALL SUI coins of `from`, the
   * reference gas price, and a gas budget from simulation when the
   * simulation verifies (see the header for the fee semantics).
   * `amount` is a bigint of MIST.
   */
  async function prepareSend({ from, to, amount, opts } = {}) {
    void opts;
    if (!validateAddress(from)) throw Error(`Invalid Sui address: ${from}`);
    if (!validateAddress(to)) throw Error(`Invalid Sui address: ${to}`);
    const value = typeof amount === 'bigint' ? amount : BigInt(amount);
    if (value <= 0n) throw Error('amount must be positive');

    const [balance, coins] = await Promise.all([getBalance(from), getCoins(from)]);
    let gasPrice = FALLBACK_GAS_PRICE;
    try {
      gasPrice = await getReferenceGasPrice();
    } catch {
      /* keep the fallback — recorded implicitly via the plan value */
    }

    let budget = DEFAULT_GAS_BUDGET;
    let feeSemantics = 'budget-cap';
    let simulation = null;
    try {
      const data = await graphql(Q_SIMULATE, {
        transaction: transferSimulationJson({
          sender: from,
          recipient: to,
          amount: value,
          coins,
          gasPrice,
          gasBudget: DEFAULT_GAS_BUDGET,
        }),
        doGasSelection: true,
      });
      const effects = data?.simulateTransaction?.effects ?? null;
      const summary = effects?.gasEffects?.gasSummary ?? null;
      if (effects?.status === 'SUCCESS' && summary) {
        const estimated =
          BigInt(summary.computationCost) + BigInt(summary.storageCost) - BigInt(summary.storageRebate);
        simulation = {
          status: effects.status,
          gasSummary: {
            computationCost: String(summary.computationCost),
            storageCost: String(summary.storageCost),
            storageRebate: String(summary.storageRebate),
          },
          estimatedCostMist: estimated.toString(),
        };
        if (estimated > 0n) {
          const doubled = estimated * 2n;
          budget = doubled < 1_000_000n ? 1_000_000n : doubled > DEFAULT_GAS_BUDGET ? DEFAULT_GAS_BUDGET : doubled;
          feeSemantics = 'estimated';
        }
      } else {
        simulation = {
          status: effects?.status ?? null,
          error: effects?.executionError?.message ?? null,
        };
      }
    } catch (e) {
      // e.g. an unfunded account: gas selection refuses with an
      // insufficient-balance message. The plan stays usable — the
      // flat budget stands and execution will report the same class
      // of error on-chain if the account is still unfunded.
      simulation = { status: null, error: e instanceof Error ? e.message : String(e) };
    }

    const txBytes = buildTransferTransactionBytes({
      sender: from,
      recipient: to,
      amount: value,
      coins,
      gasPrice,
      gasBudget: budget,
    });
    return {
      from,
      to,
      amount: value,
      fee: budget,
      feeSemantics,
      balance,
      gasPrice,
      coins,
      txBytes: bytesToBase64(txBytes),
      simulation,
    };
  }

  /**
   * Rebuild the plan's PTB, intent-sign it, and execute it through
   * the GraphQL mutation. The secret must own plan.from — checked
   * against the canonical derivation before anything is signed.
   * Returns { hash } with the transaction digest (base58).
   */
  async function executeSend(plan, secret) {
    checkSecret(secret);
    const from = addressFromSecret('sui', secret);
    if (from !== plan.from) {
      throw Error(`Secret does not own plan.from (${plan.from})`);
    }
    const txBytes = buildTransferTransactionBytes({
      sender: plan.from,
      recipient: plan.to,
      amount: BigInt(plan.amount),
      coins: plan.coins ?? [],
      gasPrice: BigInt(plan.gasPrice ?? FALLBACK_GAS_PRICE),
      gasBudget: BigInt(plan.fee ?? DEFAULT_GAS_BUDGET),
    });
    const { serializedSignature } = signTransactionBytes(txBytes, secret);
    const data = await graphql(M_EXECUTE, {
      transactionDataBcs: bytesToBase64(txBytes),
      signatures: [serializedSignature],
    });
    const effects = data?.executeTransaction?.effects ?? null;
    if (!effects?.digest) throw Error('Sui executeTransaction: no effects digest in response');
    return { hash: effects.digest };
  }

  /**
   * 'success' / 'failed' from the effects ExecutionStatus; 'pending'
   * while the digest is unknown to the indexer (or not yet indexed).
   */
  async function getTxStatus(digest) {
    const data = await graphql(Q_TX_EFFECTS, { digest });
    const status = data?.transactionEffects?.status ?? null;
    if (status === 'SUCCESS') return 'success';
    if (status === 'FAILURE') return 'failed';
    return 'pending';
  }

  return { checkConnection, getBalance, prepareSend, executeSend, getTxStatus };
}

// Re-exported for tests / advanced callers that need raw byte handling.
export { base64ToBytes, bytesToBase64 };
