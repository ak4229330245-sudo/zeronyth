// Bitcoin engine tests (BIP-173 / BIP-143 known-answer vectors, stubbed
// esplora coin selection, and stubbed broadcast with full parse-back
// signature verification). Run: node --test test/chains-bitcoin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { publicKeyFromSecret, addressFromSecret, hash160 } from '../src/core/crypto.mjs';
import { deriveAccountSecret } from '../src/core/hd.mjs';
import { bech32EncodeSegwit, bech32DecodeSegwit } from '../src/core/enc.mjs';
import { concatBytes, toHex } from '../src/core/bytes.mjs';
import {
  DUST_LIMIT,
  deriveAddress,
  convertAddress,
  validateAddress,
  createBitcoinClient,
} from '../src/core/chains/bitcoin.mjs';

// ------------------------------------------------------------ local helpers

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
const bytesToHex = (bytes) => toHex(bytes).slice(2);
const dsha256 = (bytes) => sha256(sha256(bytes));
const reversed = (bytes) => new Uint8Array([...bytes].reverse());

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
function varintBytes(value) {
  if (value < 0xfd) return new Uint8Array([value]);
  throw Error('test varint only supports < 0xfd');
}

/** DER ECDSA signature → 64-byte compact (r ‖ s), test-side parser. */
function derToCompact(der) {
  assert.equal(der[0], 0x30);
  let off = 2;
  assert.equal(der[off], 0x02);
  const rLen = der[off + 1];
  const r = der.slice(off + 2, off + 2 + rLen);
  off += 2 + rLen;
  assert.equal(der[off], 0x02);
  const sLen = der[off + 1];
  const s = der.slice(off + 2, off + 2 + sLen);
  const pad32 = (b) => {
    const trimmed = b.length > 32 ? b.slice(b.length - 32) : b;
    const out = new Uint8Array(32);
    out.set(trimmed, 32 - trimmed.length);
    return out;
  };
  return concatBytes(pad32(r), pad32(s));
}

function secretWithLastByte(n) {
  const secret = new Uint8Array(32);
  secret[31] = n;
  return secret;
}

// ------------------------------------------------------------ derivation KATs

test('bitcoin: BIP-173 published hash160 → bech32 pair', () => {
  // BIP-173 gives hash160 751e76e8199196d454941c45d1b3a323f1433bd6 (the
  // hash of the compressed generator-point pubkey; its P2PKH form is the
  // famous 1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH) the P2WPKH address
  // bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4.
  const program = hexToBytes('751e76e8199196d454941c45d1b3a323f1433bd6');
  assert.equal(
    bech32EncodeSegwit('bc', 0, program),
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  );
});

test('bitcoin: secret 0x00…01 derives the BIP-173 address (full KAT)', () => {
  const secret = secretWithLastByte(1);
  const publicKey = publicKeyFromSecret('bitcoin', secret);
  // Well-known compressed pubkey of private key 1 (the generator point).
  assert.equal(
    bytesToHex(publicKey),
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  );
  assert.equal(bytesToHex(hash160(publicKey)), '751e76e8199196d454941c45d1b3a323f1433bd6');
  assert.equal(deriveAddress(secret, 'mainnet'), 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  // The engine's mainnet form must agree with the shared crypto module.
  assert.equal(deriveAddress(secret, 'mainnet'), addressFromSecret('bitcoin', secret));
  // Testnet is the same witness program under hrp "tb" (BIP-173 lists
  // this exact tb1 string as a valid testnet example for the program).
  assert.equal(deriveAddress(secret, 'testnet'), 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx');
  assert.equal(
    convertAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'testnet'),
    'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
  );
  assert.equal(
    convertAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'mainnet'),
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  );
});

test('bitcoin: validateAddress (BIP-173 valid/invalid examples + variants)', () => {
  const main = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  assert.equal(validateAddress(main, 'mainnet'), true);
  assert.equal(validateAddress(main, 'testnet'), false); // hrp mismatch
  assert.equal(validateAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'testnet'), true);
  // All-uppercase is a valid bech32 form per BIP-173.
  assert.equal(validateAddress('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'mainnet'), true);
  // BIP-173 invalid example: same payload, broken checksum.
  assert.equal(validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty', 'mainnet'), false);
  // Mixed case is invalid bech32.
  assert.equal(validateAddress('bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'mainnet'), false);
  // A 32-byte witness program (P2WSH) is not P2WPKH.
  const p2wsh = bech32EncodeSegwit('bc', 0, new Uint8Array(32).fill(7));
  assert.equal(validateAddress(p2wsh, 'mainnet'), false);
  assert.throws(() => convertAddress(p2wsh, 'testnet'), /20 bytes/);
  // Garbage / empty / wrong variant argument.
  assert.equal(validateAddress('not-an-address', 'mainnet'), false);
  assert.equal(validateAddress('', 'mainnet'), false);
  assert.equal(validateAddress(main, 'signet'), false);
  assert.throws(() => deriveAddress(secretWithLastByte(1), 'signet'), /variant/);
});

test('bitcoin: hd-derived account matches crypto address derivation', () => {
  const master = new Uint8Array(32).fill(0x42); // public test fixture
  const secret = deriveAccountSecret(master, 'bitcoin', 0);
  assert.equal(deriveAddress(secret, 'mainnet'), addressFromSecret('bitcoin', secret));
  assert.equal(deriveAddress(secret, 'testnet'), convertAddress(deriveAddress(secret, 'mainnet'), 'testnet'));
  assert.equal(DUST_LIMIT, 546n);
});

// ------------------------------------------------------------ BIP-143 KAT
//
// Worked "Native P2WPKH" example transcribed from BIP-143
// (https://bitcoin.org/bip/143/, fetched 2026-11-05). The example tx has
// nVersion 1 and nLockTime 0x11, P2PKH outputs, and two inputs; the
// second input is the P2WPKH one being signed (amount 6 BTC). The test
// rebuilds hashPrevouts / hashSequence / hashOutputs and the sighash
// preimage longhand from the BIP's raw components, checks every
// intermediate against the BIP's published values, and verifies the
// BIP's published signature. The engine uses the identical formula
// (with version 2, locktime 0, P2WPKH outputs) — its own signatures are
// verified against a longhand recomputation in the executeSend tests.

const BIP143 = {
  in0Outpoint: 'fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f00000000',
  in0Sequence: 'eeffffff',
  in1Outpoint: 'ef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a01000000',
  in1Sequence: 'ffffffff',
  outputsSerialized:
    '202cb206000000001976a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac' +
    '9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac',
  hashPrevouts: '96b827c8483d4e9b96712b6713a7b68d6e8003a781feba36c31143470b4efd37',
  hashSequence: '52b0a642eea2fb7ae638c36f6252b6750293dbe574a806984b8e4d8548339a3b',
  hashOutputs: '863ef3e1a92afbfdb97f31ad0fc7683ee943e9abcf2501590ff8f6551f47e5e5',
  scriptCode: '1976a9141d0f172a0ecb48aee1be1f2687d2963ae33f71a188ac',
  amountLe: '0046c32300000000', // 6 BTC = 600_000_000 sat
  preimage:
    '01000000' +
    '96b827c8483d4e9b96712b6713a7b68d6e8003a781feba36c31143470b4efd37' +
    '52b0a642eea2fb7ae638c36f6252b6750293dbe574a806984b8e4d8548339a3b' +
    'ef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a01000000' +
    '1976a9141d0f172a0ecb48aee1be1f2687d2963ae33f71a188ac' +
    '0046c32300000000' +
    'ffffffff' +
    '863ef3e1a92afbfdb97f31ad0fc7683ee943e9abcf2501590ff8f6551f47e5e5' +
    '11000000' +
    '01000000',
  sighash: 'c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670',
  signatureWithType:
    '304402203609e17b84f6a7d30c80bfa610b5b4542f32a8a0d5447a12fb1366d7f01cc44a' +
    '0220573a954c4518331561406f90300e8f3358f51928d43c212a8caed02de67eebee01',
  privateKey: '619c335025c7f4012e556c2a58b2506e30b8511b53ade95ea316fd8c3286feb9',
  publicKey: '025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357',
};

test('bitcoin: BIP-143 native P2WPKH sighash KAT (published values)', () => {
  const hashPrevouts = dsha256(concatBytes(hexToBytes(BIP143.in0Outpoint), hexToBytes(BIP143.in1Outpoint)));
  assert.equal(bytesToHex(hashPrevouts), BIP143.hashPrevouts);
  const hashSequence = dsha256(concatBytes(hexToBytes(BIP143.in0Sequence), hexToBytes(BIP143.in1Sequence)));
  assert.equal(bytesToHex(hashSequence), BIP143.hashSequence);
  const hashOutputs = dsha256(hexToBytes(BIP143.outputsSerialized));
  assert.equal(bytesToHex(hashOutputs), BIP143.hashOutputs);

  const preimage = concatBytes(
    hexToBytes('01000000'), // nVersion of the example tx
    hashPrevouts,
    hashSequence,
    hexToBytes(BIP143.in1Outpoint),
    hexToBytes(BIP143.scriptCode),
    hexToBytes(BIP143.amountLe),
    hexToBytes(BIP143.in1Sequence),
    hashOutputs,
    hexToBytes('11000000'), // nLockTime of the example tx
    hexToBytes('01000000'), // SIGHASH_ALL
  );
  assert.equal(bytesToHex(preimage), BIP143.preimage);
  const sighash = dsha256(preimage);
  assert.equal(bytesToHex(sighash), BIP143.sighash);

  // The BIP's private key really derives its published public key, and
  // its published signature verifies against the published sighash.
  const derivedPub = secp256k1.getPublicKey(hexToBytes(BIP143.privateKey), true);
  assert.equal(bytesToHex(derivedPub), BIP143.publicKey);
  const sigWithType = hexToBytes(BIP143.signatureWithType);
  assert.equal(sigWithType[sigWithType.length - 1], 0x01);
  const compact = derToCompact(sigWithType.slice(0, -1));
  assert.equal(
    secp256k1.verify(compact, sighash, hexToBytes(BIP143.publicKey), { prehash: false }),
    true,
  );
});

// ------------------------------------------------------------ stubbed esplora

const BASE = 'https://blockstream.info/api';
const SENDER_SECRET = secretWithLastByte(1);
const SENDER = deriveAddress(SENDER_SECRET, 'mainnet'); // bc1qw508…f3t4
const RECIPIENT = deriveAddress(secretWithLastByte(2), 'mainnet');

const TXID_A = 'aa'.repeat(32);
const TXID_B = 'bb'.repeat(32);
const TXID_C = 'cc'.repeat(32);

function stubResponse(body, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

/**
 * fetchImpl stub for esplora. `posts` (optional array) records POST /tx
 * calls; the POST handler replies with the txid recomputed test-side
 * from the posted hex (see txidOfRawTx) unless postResponse overrides.
 */
function esploraStub({ utxos = [], estimates = { 1: 5.0, 3: 2.5, 6: 1.2 }, posts = null, postResponse = null } = {}) {
  return async (url, init) => {
    const u = String(url);
    if (init?.method === 'POST' && u === `${BASE}/tx`) {
      posts?.push({ url: u, init });
      if (postResponse) return postResponse(init.body);
      return stubResponse(txidOfRawTx(init.body));
    }
    if (u === `${BASE}/blocks/tip/height`) return stubResponse('974669');
    if (u === `${BASE}/fee-estimates`) return stubResponse(estimates);
    if (u === `${BASE}/address/${SENDER}/utxo`) return stubResponse(utxos);
    if (u.startsWith(`${BASE}/address/`) && u.endsWith('/utxo')) return stubResponse([]);
    throw Error(`stub: unexpected fetch ${u}`);
  };
}

test('bitcoin: checkConnection + getBalance against stub', async () => {
  const utxos = [
    { txid: TXID_C, vout: 0, value: 10000 },
    { txid: TXID_A, vout: 1, value: 50000 },
    { txid: TXID_B, vout: 0, value: 30000 },
  ];
  const client = createBitcoinClient(BASE, { fetchImpl: esploraStub({ utxos }) });
  assert.equal(await client.checkConnection(), 974669);
  assert.equal(await client.getBalance(SENDER), 90000n);
  assert.equal(await client.getBalance(RECIPIENT), 0n);
});

test('bitcoin: prepareSend selects largest-first, 2 outputs', async () => {
  const utxos = [
    { txid: TXID_C, vout: 0, value: 10000 },
    { txid: TXID_A, vout: 1, value: 50000 },
    { txid: TXID_B, vout: 0, value: 30000 },
  ];
  const client = createBitcoinClient(BASE, { fetchImpl: esploraStub({ utxos }) });
  const plan = await client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 40000n });
  assert.equal(plan.variant, 'mainnet');
  assert.equal(plan.balance, 90000n);
  assert.equal(plan.feeRateSatVb, 2.5); // estimates['3']
  assert.deepEqual(plan.inputs, [{ txid: TXID_A, vout: 1, value: 50000 }]);
  assert.equal(plan.vsize, 141); // 11 + 68·1 + 31·2
  assert.equal(plan.fee, 353n); // ceil(2.5 · 141)
  assert.equal(plan.change, 9647n); // 50000 − 40000 − 353
  assert.equal(plan.amount, 40000n);
});

test('bitcoin: prepareSend adds inputs largest-first until covered', async () => {
  const utxos = [
    { txid: TXID_C, vout: 0, value: 10000 },
    { txid: TXID_A, vout: 1, value: 50000 },
    { txid: TXID_B, vout: 0, value: 30000 },
  ];
  const client = createBitcoinClient(BASE, { fetchImpl: esploraStub({ utxos }) });
  const plan = await client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 70000 });
  assert.deepEqual(plan.inputs.map((i) => i.txid), [TXID_A, TXID_B]);
  assert.equal(plan.vsize, 209); // 11 + 68·2 + 31·2
  assert.equal(plan.fee, 523n); // ceil(2.5 · 209)
  assert.equal(plan.change, 9477n); // 80000 − 70000 − 523
});

test('bitcoin: prepareSend folds dust change into the fee', async () => {
  // 40500 in, 40000 out: 2-output fee would be 353, leaving 147 sat of
  // dust change → folded: single output, fee = 40500 − 40000 = 500.
  const client = createBitcoinClient(BASE, {
    fetchImpl: esploraStub({ utxos: [{ txid: TXID_A, vout: 0, value: 40500 }] }),
  });
  const plan = await client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 40000n });
  assert.equal(plan.change, 0n);
  assert.equal(plan.fee, 500n);
  assert.equal(plan.vsize, 110); // 11 + 68·1 + 31·1
});

test('bitcoin: prepareSend folds when only the 1-output fee is covered', async () => {
  // 40300 in, 40000 out: cannot cover the 2-output fee (353) but the
  // folded fee (300) covers the 1-output estimate (ceil(2.5·110) = 275).
  const client = createBitcoinClient(BASE, {
    fetchImpl: esploraStub({ utxos: [{ txid: TXID_A, vout: 0, value: 40300 }] }),
  });
  const plan = await client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 40000n });
  assert.equal(plan.change, 0n);
  assert.equal(plan.fee, 300n);
  assert.equal(plan.vsize, 110);
});

test('bitcoin: prepareSend fee-rate target, fallback and 1.0 floor', async () => {
  const utxos = [{ txid: TXID_A, vout: 0, value: 50000 }];
  // Explicit target 1 → estimates['1'] = 5.0.
  const clientA = createBitcoinClient(BASE, { fetchImpl: esploraStub({ utxos }) });
  const planA = await clientA.prepareSend({
    from: SENDER, to: RECIPIENT, amount: 40000n, opts: { feeTargetBlocks: 1 },
  });
  assert.equal(planA.feeRateSatVb, 5.0);
  assert.equal(planA.fee, 705n); // ceil(5 · 141)
  // Sub-1 estimate is clamped to the 1.0 sat/vB floor.
  const clientB = createBitcoinClient(BASE, {
    fetchImpl: esploraStub({ utxos, estimates: { 3: 0.4 } }),
  });
  const planB = await clientB.prepareSend({ from: SENDER, to: RECIPIENT, amount: 40000n });
  assert.equal(planB.feeRateSatVb, 1.0);
  assert.equal(planB.fee, 141n);
  // No estimates at all → the fallback chain ends at '1' → 1.0 sat/vB.
  const clientC = createBitcoinClient(BASE, {
    fetchImpl: esploraStub({ utxos, estimates: {} }),
  });
  const planC = await clientC.prepareSend({ from: SENDER, to: RECIPIENT, amount: 40000n });
  assert.equal(planC.feeRateSatVb, 1.0);
  assert.equal(planC.fee, 141n);
});

test('bitcoin: prepareSend throws on insufficient funds / wrong network', async () => {
  const client = createBitcoinClient(BASE, {
    fetchImpl: esploraStub({ utxos: [{ txid: TXID_A, vout: 0, value: 10000 }] }),
  });
  await assert.rejects(
    client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 40000n }),
    /Insufficient funds/,
  );
  await assert.rejects(
    client.prepareSend({
      from: SENDER,
      to: deriveAddress(secretWithLastByte(2), 'testnet'), // tb1 recipient, bc1 sender
      amount: 1000n,
    }),
    /Recipient/,
  );
  await assert.rejects(
    client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 0n }),
    /positive/,
  );
});

test('bitcoin: getTxStatus confirmed / unconfirmed / unknown', async () => {
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u === `${BASE}/tx/confirmed`) return stubResponse({ status: { confirmed: true, block_height: 100 } });
    if (u === `${BASE}/tx/unconfirmed`) return stubResponse({ status: { confirmed: false } });
    return stubResponse('Transaction not found', 404);
  };
  const client = createBitcoinClient(BASE, { fetchImpl });
  assert.equal(await client.getTxStatus('confirmed'), 'success');
  assert.equal(await client.getTxStatus('unconfirmed'), 'pending');
  assert.equal(await client.getTxStatus('missing'), 'pending');
});

// ------------------------------------------------------------ executeSend
//
// Test-side transaction parser: decodes the posted SegWit serialization
// byte-by-byte and rebuilds the non-witness serialization, so the txid
// and the BIP-143 sighash are recomputed independently of the engine.

function parseTx(rawHex) {
  const bytes = hexToBytes(rawHex);
  let off = 0;
  const read = (n) => { const b = bytes.slice(off, off + n); off += n; return b; };
  const readVarint = () => {
    const first = read(1)[0];
    if (first < 0xfd) return first;
    if (first === 0xfd) return new DataView(read(2).buffer).getUint16(0, true);
    if (first === 0xfe) return new DataView(read(4).buffer).getUint32(0, true);
    return Number(new DataView(read(8).buffer).getBigUint64(0, true));
  };
  const version = read(4);
  let hasWitness = false;
  if (bytes[off] === 0x00 && bytes[off + 1] === 0x01) { hasWitness = true; off += 2; }
  const nIn = readVarint();
  const inputs = [];
  const inputsRaw = [];
  for (let i = 0; i < nIn; i++) {
    const start = off;
    const wireTxid = read(32);
    const vout = new DataView(read(4).buffer).getUint32(0, true);
    const scriptLen = readVarint();
    const script = read(scriptLen);
    const sequence = new DataView(read(4).buffer).getUint32(0, true);
    inputs.push({ txid: bytesToHex(reversed(wireTxid)), vout, script, sequence });
    inputsRaw.push(bytes.slice(start, off));
  }
  const nOut = readVarint();
  const outputs = [];
  const outputsRaw = [];
  for (let i = 0; i < nOut; i++) {
    const start = off;
    const value = new DataView(read(8).buffer).getBigUint64(0, true);
    const scriptLen = readVarint();
    const script = read(scriptLen);
    outputs.push({ value, script });
    outputsRaw.push(bytes.slice(start, off));
  }
  const witnesses = [];
  if (hasWitness) {
    for (let i = 0; i < nIn; i++) {
      const nItems = readVarint();
      const items = [];
      for (let j = 0; j < nItems; j++) items.push(read(readVarint()));
      witnesses.push(items);
    }
  }
  const locktime = read(4);
  assert.equal(off, bytes.length);
  const nonWitness = concatBytes(
    version,
    varintBytes(nIn),
    ...inputsRaw,
    varintBytes(nOut),
    ...outputsRaw,
    locktime,
  );
  return { version, inputs, outputs, witnesses, locktime, nonWitness };
}

function txidOfRawTx(rawHex) {
  return bytesToHex(reversed(dsha256(parseTx(rawHex).nonWitness)));
}

/** Longhand BIP-143 sighash over a parsed engine tx (version 2, locktime 0). */
function testSideSighash(parsed, index, inputValues, scriptCode) {
  const outpoint = (input) => concatBytes(reversed(hexToBytes(input.txid)), u32le(input.vout));
  const hashPrevouts = dsha256(concatBytes(...parsed.inputs.map(outpoint)));
  const hashSequence = dsha256(concatBytes(...parsed.inputs.map(() => u32le(0xffffffff))));
  const serializedOutputs = parsed.outputs.map((o) =>
    concatBytes(u64le(o.value), varintBytes(o.script.length), o.script));
  const hashOutputs = dsha256(concatBytes(...serializedOutputs));
  const preimage = concatBytes(
    u32le(2),
    hashPrevouts,
    hashSequence,
    outpoint(parsed.inputs[index]),
    scriptCode,
    u64le(inputValues[index]),
    u32le(0xffffffff),
    hashOutputs,
    u32le(0),
    u32le(1),
  );
  return dsha256(preimage);
}

function p2wpkhScriptHex(address) {
  const { program } = bech32DecodeSegwit(address);
  return '0014' + bytesToHex(program);
}

test('bitcoin: executeSend builds, signs and broadcasts a 2-input tx', async () => {
  const utxos = [
    { txid: TXID_A, vout: 1, value: 50000 },
    { txid: TXID_B, vout: 0, value: 30000 },
  ];
  const posts = [];
  const client = createBitcoinClient(BASE, { fetchImpl: esploraStub({ utxos, posts }) });
  const plan = await client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 70000n });
  const { hash } = await client.executeSend(plan, SENDER_SECRET);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, `${BASE}/tx`);
  assert.equal(posts[0].init.method, 'POST');
  assert.equal(posts[0].init.headers['content-type'], 'text/plain');
  const rawHex = posts[0].init.body;
  assert.equal(hash, txidOfRawTx(rawHex)); // stub replied with this txid

  const parsed = parseTx(rawHex);
  assert.equal(new DataView(parsed.version.buffer).getUint32(0, true), 2);
  assert.equal(new DataView(parsed.locktime.buffer).getUint32(0, true), 0);
  assert.deepEqual(parsed.inputs.map((i) => i.txid), [TXID_A, TXID_B]);
  assert.deepEqual(parsed.inputs.map((i) => i.vout), [1, 0]);
  for (const input of parsed.inputs) {
    assert.equal(input.script.length, 0);
    assert.equal(input.sequence, 0xffffffff);
  }
  assert.equal(parsed.outputs.length, 2);
  assert.equal(parsed.outputs[0].value, 70000n);
  assert.equal(bytesToHex(parsed.outputs[0].script), p2wpkhScriptHex(RECIPIENT));
  assert.equal(parsed.outputs[1].value, plan.change);
  assert.equal(bytesToHex(parsed.outputs[1].script), p2wpkhScriptHex(SENDER));
  const totalIn = 80000n;
  assert.equal(parsed.outputs[0].value + parsed.outputs[1].value + plan.fee, totalIn);

  // Every witness: [DER sig + 0x01, compressed pubkey], and each
  // signature verifies against the longhand BIP-143 sighash.
  const publicKey = publicKeyFromSecret('bitcoin', SENDER_SECRET);
  const scriptCode = concatBytes(
    hexToBytes('1976a914'),
    hash160(publicKey),
    hexToBytes('88ac'),
  );
  const inputValues = [50000n, 30000n];
  parsed.witnesses.forEach((items, index) => {
    assert.equal(items.length, 2);
    assert.equal(bytesToHex(items[1]), bytesToHex(publicKey));
    const sigWithType = items[0];
    assert.equal(sigWithType[sigWithType.length - 1], 0x01);
    const compact = derToCompact(sigWithType.slice(0, -1));
    const sighash = testSideSighash(parsed, index, inputValues, scriptCode);
    assert.equal(secp256k1.verify(compact, sighash, publicKey, { prehash: false }), true);
  });
});

test('bitcoin: executeSend with folded dust change has a single output', async () => {
  const posts = [];
  const client = createBitcoinClient(BASE, {
    fetchImpl: esploraStub({ utxos: [{ txid: TXID_A, vout: 0, value: 40500 }], posts }),
  });
  const plan = await client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 40000n });
  assert.equal(plan.change, 0n);
  const { hash } = await client.executeSend(plan, SENDER_SECRET);
  const parsed = parseTx(posts[0].init.body);
  assert.equal(parsed.outputs.length, 1);
  assert.equal(parsed.outputs[0].value, 40000n);
  assert.equal(hash, txidOfRawTx(posts[0].init.body));
});

test('bitcoin: executeSend rejects a wrong secret and a txid mismatch', async () => {
  const utxos = [{ txid: TXID_A, vout: 0, value: 50000 }];
  const posts = [];
  const client = createBitcoinClient(BASE, { fetchImpl: esploraStub({ utxos, posts }) });
  const plan = await client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 40000n });
  await assert.rejects(client.executeSend(plan, secretWithLastByte(9)), /does not match/);
  assert.equal(posts.length, 0); // nothing was broadcast

  const lyingClient = createBitcoinClient(BASE, {
    fetchImpl: esploraStub({
      utxos,
      postResponse: () => stubResponse('ff'.repeat(32)),
    }),
  });
  const plan2 = await lyingClient.prepareSend({ from: SENDER, to: RECIPIENT, amount: 40000n });
  await assert.rejects(lyingClient.executeSend(plan2, SENDER_SECRET), /txid mismatch/);
});
