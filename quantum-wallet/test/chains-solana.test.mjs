// Solana engine tests (multi-chain v12).
//
// Anchors:
//   - RFC 8032 §7.1 TEST 1 keypair for deriveAddress.
//   - A byte-for-byte legacy-message known answer, with the expected
//     bytes written out from the Solana transaction format spec.
//   - A stub JSON-RPC server (fetchImpl) for prepare / execute /
//     status mapping — no network needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ed25519 } from '@noble/curves/ed25519.js';

import { deriveAddress, validateAddress, createSolanaClient } from '../src/core/chains/solana.mjs';
import { addressFromSecret } from '../src/core/crypto.mjs';
import { deriveAccountSecret, deriveAccountAddress } from '../src/core/hd.mjs';
import { base58Encode, base58Decode } from '../src/core/enc.mjs';

// RFC 8032 §7.1 TEST 1: secret seed → public key.
const RFC8032_SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const RFC8032_PUB_HEX = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
// base58(d75a9801…f707511a) — computed from the RFC 8032 public key.
const RFC8032_ADDRESS = 'FVen3X669xLzsi6N2V91DoiyzHzg1uAgqiT8jZ9nS96Z';

function hexBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const RFC8032_SEED = hexBytes(RFC8032_SEED_HEX);
const RFC8032_PUB = hexBytes(RFC8032_PUB_HEX);

// ------------------------------------------------------------------ stub RPC

/**
 * Fake Solana JSON-RPC endpoint. `handlers` maps method name → result
 * value or (params) => result. Every request is recorded in `calls`.
 */
function makeStub(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, jsonrpc: body.jsonrpc, id: body.id, method: body.method, params: body.params });
    const handler = handlers[body.method];
    if (!handler) {
      return {
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: `unknown method ${body.method}` },
        }),
      };
    }
    const result = typeof handler === 'function' ? handler(body.params) : handler;
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
  };
  return { fetchImpl, calls };
}

const BLOCKHASH_ZERO = '11111111111111111111111111111111'; // 32 zero bytes

function standardHandlers(overrides = {}) {
  return {
    getVersion: { 'solana-core': '2.0.0', 'feature-set': 1 },
    getBalance: { context: { slot: 42 }, value: 1000000000 },
    getLatestBlockhash: {
      context: { slot: 42 },
      value: { blockhash: BLOCKHASH_ZERO, lastValidBlockHeight: 1000 },
    },
    // Mimic a real node: the returned signature is base58 of the first
    // 64 signature bytes of the submitted transaction.
    sendTransaction: (params) => {
      const tx = Buffer.from(params[0], 'base64');
      assert.equal(tx[0], 1, 'shortvec signature count');
      return base58Encode(new Uint8Array(tx.subarray(1, 65)));
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------- derivation

test('solana deriveAddress: RFC 8032 vector, variant-independent, agrees with crypto.mjs', () => {
  assert.equal(bytesHex(ed25519.getPublicKey(RFC8032_SEED)), RFC8032_PUB_HEX, 'RFC 8032 keypair');
  assert.equal(base58Encode(RFC8032_PUB), RFC8032_ADDRESS);
  assert.equal(deriveAddress(RFC8032_SEED, 'mainnet'), RFC8032_ADDRESS);
  assert.equal(deriveAddress(RFC8032_SEED, 'devnet'), RFC8032_ADDRESS);
  assert.equal(deriveAddress(RFC8032_SEED), RFC8032_ADDRESS);
  assert.equal(deriveAddress(RFC8032_SEED, 'mainnet'), addressFromSecret('solana', RFC8032_SEED));
  assert.throws(() => deriveAddress(new Uint8Array(31), 'mainnet'), /32-byte/);
  assert.throws(() => deriveAddress(RFC8032_SEED, 'testnet'), /Unknown Solana variant/);
});

test('solana deriveAddress: agrees with hd.mjs account derivation', () => {
  const master = new Uint8Array(32).fill(0x42); // public test fixture
  for (const index of [0, 1, 2]) {
    const secret = deriveAccountSecret(master, 'solana', index);
    assert.equal(deriveAddress(secret, 'devnet'), deriveAccountAddress(master, 'solana', index));
  }
});

test('solana validateAddress: base58 decoding to exactly 32 bytes', () => {
  assert.equal(validateAddress(RFC8032_ADDRESS, 'mainnet'), true);
  assert.equal(validateAddress(RFC8032_ADDRESS, 'devnet'), true);
  assert.equal(validateAddress('11111111111111111111111111111111', 'mainnet'), true); // System Program
  assert.equal(validateAddress('11111111111111111111111111111112', 'devnet'), true); // 31×0x00 ‖ 0x01

  assert.equal(validateAddress('', 'mainnet'), false);
  assert.equal(validateAddress('1111', 'mainnet'), false); // decodes to < 32 bytes
  assert.equal(validateAddress(base58Encode(new Uint8Array(33)), 'mainnet'), false); // 33 bytes
  assert.equal(validateAddress('FVen3X669xLzsi6N2V91DoiyzHzg1uAgqiT8jZ9nS96!', 'mainnet'), false); // bad char
  assert.equal(validateAddress('0Ven3X669xLzsi6N2V91DoiyzHzg1uAgqiT8jZ9nS96Z', 'mainnet'), false); // '0' not in alphabet
  assert.equal(validateAddress(null, 'mainnet'), false);
  assert.equal(validateAddress(undefined, 'devnet'), false);
  assert.equal(validateAddress(12345, 'devnet'), false);
});

// ------------------------------------------------------------- tx known answer

// Expected legacy message for:
//   from      = RFC8032_ADDRESS (pubkey d75a9801…f707511a)
//   to        = 11111111111111111111111111111112 (bytes 00…01)
//   blockhash = 11111111111111111111111111111111 (32 zero bytes)
//   amount    = 5000 lamports
//
// Written out from the Solana transaction format spec:
//   header          01 00 01
//                     numRequiredSignatures=1, numReadonlySignedAccounts=0,
//                     numReadonlyUnsignedAccounts=1 (the System Program)
//   accountKeys     03 ‖ from(32) ‖ to(32) ‖ SystemProgram(32 zero bytes)
//   recentBlockhash 32 zero bytes
//   instructions    01 ‖ instruction
//   instruction     programIdIndex=02
//                   ‖ shortvec(2) ‖ account indices 00 01
//                   ‖ shortvec(12) ‖ instruction data
//   data            u32LE(2 = SystemInstruction::Transfer) = 02 00 00 00
//                   ‖ u64LE(5000) = 88 13 00 00 00 00 00 00
const EXPECTED_MESSAGE_HEX =
  '010001' + // header
  '03' + // shortvec(3) account keys
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a' + // from
  '0000000000000000000000000000000000000000000000000000000000000001' + // to
  '0000000000000000000000000000000000000000000000000000000000000000' + // System Program
  '0000000000000000000000000000000000000000000000000000000000000000' + // blockhash
  '01' + // shortvec(1) instruction
  '02' + // programIdIndex
  '02' + // shortvec(2) accounts
  '0001' + // account indices [0, 1]
  '0c' + // shortvec(12) data length
  '02000000' + // u32LE(2)
  '8813000000000000'; // u64LE(5000)

test('solana tx: deterministic legacy message is byte-exact and the signature verifies', async () => {
  const { fetchImpl, calls } = makeStub(standardHandlers());
  const client = createSolanaClient('https://api.devnet.solana.com', { fetchImpl });
  const to = '11111111111111111111111111111112';

  const plan = await client.prepareSend({ from: RFC8032_ADDRESS, to, amount: 5000n });
  assert.equal(plan.blockhash, BLOCKHASH_ZERO);
  const { hash } = await client.executeSend(plan, RFC8032_SEED);

  const send = calls.find((c) => c.method === 'sendTransaction');
  assert.ok(send, 'sendTransaction was called');
  const tx = Buffer.from(send.params[0], 'base64');
  assert.equal(tx[0], 1, 'shortvec(1) signature count');
  assert.equal(tx.length, 1 + 64 + EXPECTED_MESSAGE_HEX.length / 2);
  const signature = new Uint8Array(tx.subarray(1, 65));
  const message = new Uint8Array(tx.subarray(65));
  assert.equal(bytesHex(message), EXPECTED_MESSAGE_HEX, 'message bytes byte-for-byte');
  assert.equal(ed25519.verify(signature, message, RFC8032_PUB), true, 'signature verifies');
  assert.equal(hash, base58Encode(signature), 'returned hash is the tx signature');
  // The signature the stub "node" returned must match ours exactly.
  assert.equal(hash, base58Encode(new Uint8Array(Buffer.from(send.params[0], 'base64').subarray(1, 65))));
});

// ------------------------------------------------------------------ RPC flows

test('solana client: checkConnection and getBalance request/response shapes', async () => {
  const { fetchImpl, calls } = makeStub(standardHandlers());
  const client = createSolanaClient('https://api.devnet.solana.com/', { fetchImpl });

  assert.equal(await client.checkConnection(), true);
  assert.equal(calls[0].method, 'getVersion');
  assert.equal(calls[0].url, 'https://api.devnet.solana.com', 'trailing slash stripped');
  assert.equal(calls[0].jsonrpc, '2.0');

  const balance = await client.getBalance(RFC8032_ADDRESS);
  assert.equal(balance, 1000000000n);
  const balCall = calls.find((c) => c.method === 'getBalance');
  assert.deepEqual(balCall.params, [RFC8032_ADDRESS, { commitment: 'confirmed' }]);

  const dead = createSolanaClient('https://api.devnet.solana.com', {
    fetchImpl: async () => {
      throw Error('network down');
    },
  });
  assert.equal(await dead.checkConnection(), false, 'connection failure maps to false');

  await assert.rejects(() => client.getBalance('not-an-address'), /Invalid Solana address/);
});

test('solana client: prepareSend returns the full plan from stub RPC reads', async () => {
  const { fetchImpl, calls } = makeStub(standardHandlers());
  const client = createSolanaClient('https://api.devnet.solana.com', { fetchImpl });
  const to = '11111111111111111111111111111112';

  const plan = await client.prepareSend({ from: RFC8032_ADDRESS, to, amount: 123456n });
  assert.equal(plan.from, RFC8032_ADDRESS);
  assert.equal(plan.to, to);
  assert.equal(plan.amount, 123456n);
  assert.equal(plan.fee, 5000n);
  assert.equal(plan.balance, 1000000000n);
  assert.equal(plan.blockhash, BLOCKHASH_ZERO);
  assert.equal(plan.lastValidBlockHeight, 1000);
  assert.deepEqual(
    calls.map((c) => c.method).sort(),
    ['getBalance', 'getLatestBlockhash'],
  );
  const bhCall = calls.find((c) => c.method === 'getLatestBlockhash');
  assert.deepEqual(bhCall.params, [{ commitment: 'confirmed' }]);

  await assert.rejects(
    () => client.prepareSend({ from: RFC8032_ADDRESS, to: 'not-an-address', amount: 1n }),
    /Invalid Solana address/,
  );
  await assert.rejects(
    () => client.prepareSend({ from: RFC8032_ADDRESS, to, amount: 0n }),
    /positive/,
  );
});

test('solana client: executeSend request shape, and wrong secret never broadcasts', async () => {
  const { fetchImpl, calls } = makeStub(standardHandlers());
  const client = createSolanaClient('https://api.devnet.solana.com', { fetchImpl });
  const to = '11111111111111111111111111111112';
  const plan = await client.prepareSend({ from: RFC8032_ADDRESS, to, amount: 5000n });

  const { hash } = await client.executeSend(plan, RFC8032_SEED);
  assert.equal(typeof hash, 'string');
  assert.equal(base58Decode(hash).length, 64, 'signature decodes to 64 bytes');
  const send = calls.find((c) => c.method === 'sendTransaction');
  assert.equal(send.params.length, 2);
  assert.equal(typeof send.params[0], 'string', 'base64 transaction');
  assert.deepEqual(send.params[1], { encoding: 'base64' });

  const before = calls.filter((c) => c.method === 'sendTransaction').length;
  const wrongSecret = new Uint8Array(32).fill(7);
  await assert.rejects(() => client.executeSend(plan, wrongSecret), /does not own plan\.from/);
  assert.equal(
    calls.filter((c) => c.method === 'sendTransaction').length,
    before,
    'no broadcast attempted with the wrong secret',
  );
});

test('solana client: getTxStatus maps confirmed / finalized / errored / missing', async () => {
  const cases = [
    ['confirmed, no err', { confirmationStatus: 'confirmed', err: null }, 'success'],
    ['finalized, no err', { confirmationStatus: 'finalized', err: null }, 'success'],
    ['processed only', { confirmationStatus: 'processed', err: null }, 'pending'],
    ['not landed yet', null, 'pending'],
    ['confirmed with err', { confirmationStatus: 'confirmed', err: { InstructionError: [0, 'InvalidArgument'] } }, 'failed'],
    ['finalized with err', { confirmationStatus: 'finalized', err: { InstructionError: [0, { Custom: 1 }] } }, 'failed'],
  ];
  for (const [label, statusValue, want] of cases) {
    const { fetchImpl, calls } = makeStub({
      getSignatureStatuses: { context: { slot: 42 }, value: [statusValue] },
    });
    const client = createSolanaClient('https://api.devnet.solana.com', { fetchImpl });
    assert.equal(await client.getTxStatus('SomeSignature111'), want, label);
    assert.equal(calls[0].method, 'getSignatureStatuses');
    assert.deepEqual(calls[0].params, [['SomeSignature111'], { searchTransactionHistory: true }]);
  }
});
