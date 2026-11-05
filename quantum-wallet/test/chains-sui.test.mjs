// Sui engine tests (multi-chain v12).
//
// Anchors:
//   - blake2b-256 of the empty string (published digest, also the
//     dkLen-32 truncation anchor for the RFC 7693 primitive).
//   - RFC 8032 §7.1 TEST 1 Ed25519 keypair: the Sui address is
//     blake2b-256(0x00 ‖ pubkey), asserted both through the engine and
//     through an independent raw-noble path in this file (offline).
//     (No published secret→Sui-address vector was used; the
//     construction is the chain rule documented in crypto.mjs and in
//     the Sui docs' "create an account" flow — the flag byte 0x00 is
//     the Ed25519 signature-scheme flag.)
//   - A byte-for-byte BCS TransactionData known answer, with the
//     expected bytes written out field-by-field from the BCS / PTB
//     layout (see the comment above EXPECTED_TX_HEX).
//   - A stub GraphQL endpoint (fetchImpl) for balance / coin parsing,
//     simulation-driven budgets, the execute mutation shape, status
//     mapping, and GraphQL `errors` propagation — no network needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';

import {
  deriveAddress,
  validateAddress,
  createSuiClient,
  buildTransferTransactionBytes,
  intentDigest,
  signTransactionBytes,
  DEFAULT_GAS_BUDGET,
} from '../src/core/chains/sui.mjs';
import { addressFromSecret, publicKeyFromSecret } from '../src/core/crypto.mjs';
import { deriveAccountSecret, deriveAccountAddress } from '../src/core/hd.mjs';
import { base58Encode, base58Decode } from '../src/core/enc.mjs';
import { toHex, concatBytes } from '../src/core/bytes.mjs';

function hexBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// RFC 8032 §7.1 TEST 1: secret seed → public key.
const RFC8032_SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const RFC8032_PUB_HEX = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const RFC8032_SEED = hexBytes(RFC8032_SEED_HEX);
const RFC8032_PUB = hexBytes(RFC8032_PUB_HEX);
// blake2b-256(0x00 ‖ d75a9801…f707511a) — the Sui address of the
// RFC 8032 TEST 1 keypair.
const RFC8032_SUI_ADDRESS = '0x304af458e90e97c841685b8cbbc59b909f3e2cf150df590ada4c81452c29737d';

// Published blake2b-256 of the empty string.
const BLAKE2B256_EMPTY = '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8';

// ------------------------------------------------------------------ stub GQL

/**
 * Fake Sui GraphQL endpoint. `handlers` maps a query substring →
 * `data` value, a (variables) => data function, or { errors: [...] }.
 * Every request is recorded in `calls` as { url, query, variables }.
 */
function makeStub(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, query: body.query, variables: body.variables ?? {} });
    for (const [needle, handler] of Object.entries(handlers)) {
      if (body.query.includes(needle)) {
        const out = typeof handler === 'function' ? handler(body.variables ?? {}) : handler;
        if (out && typeof out === 'object' && 'errors' in out) {
          return { ok: true, json: async () => ({ errors: out.errors }) };
        }
        return { ok: true, json: async () => ({ data: out }) };
      }
    }
    return {
      ok: true,
      json: async () => ({ errors: [{ message: `unstubbed query: ${body.query.slice(0, 60)}` }] }),
    };
  };
  return { fetchImpl, calls };
}

const SENDER = RFC8032_SUI_ADDRESS;
const RECIPIENT = '0x' + '22'.repeat(32);
const COIN_ID = '0x' + '33'.repeat(32);
const COIN_DIGEST_B58 = base58Encode(new Uint8Array(32).fill(0x44));
const EXEC_DIGEST = base58Encode(new Uint8Array(32).fill(0x99));

function standardHandlers(overrides = {}) {
  return {
    chainIdentifier: { chainIdentifier: '69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD' },
    // balance route must be matched before the generic objects route
    'balance(coinType': { address: { balance: { totalBalance: '2500000000' } } },
    'objects(first: 50': {
      objects: {
        nodes: [{ address: COIN_ID, version: 7, digest: COIN_DIGEST_B58 }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
    'epoch {': { epoch: { referenceGasPrice: '1000' } },
    simulateTransaction: {
      simulateTransaction: {
        effects: {
          status: 'SUCCESS',
          executionError: null,
          gasEffects: {
            gasSummary: { computationCost: 1000000, storageCost: 988000, storageRebate: 0 },
          },
        },
      },
    },
    executeTransaction: {
      executeTransaction: { effects: { digest: EXEC_DIGEST, status: 'SUCCESS' } },
    },
    transactionEffects: { transactionEffects: { status: 'SUCCESS' } },
    ...overrides,
  };
}

// ---------------------------------------------------------------- derivation

test('sui blake2b: dkLen-32 empty-string known answer', () => {
  assert.equal(bytesHex(blake2b(new Uint8Array(0), { dkLen: 32 })), BLAKE2B256_EMPTY);
});

test('sui deriveAddress: RFC 8032 keypair, independent construction, variant-independent', () => {
  assert.equal(bytesHex(ed25519.getPublicKey(RFC8032_SEED)), RFC8032_PUB_HEX, 'RFC 8032 keypair');
  // Independent path: raw noble calls only — flag byte 0x00 (Ed25519)
  // ‖ pubkey, blake2b-256, hex. Does NOT go through crypto.mjs.
  const independent =
    '0x' +
    bytesHex(blake2b(concatBytes(new Uint8Array([0x00]), ed25519.getPublicKey(RFC8032_SEED)), { dkLen: 32 }));
  assert.equal(independent, RFC8032_SUI_ADDRESS, 'independent construction anchor');
  assert.equal(deriveAddress(RFC8032_SEED, 'mainnet'), RFC8032_SUI_ADDRESS);
  assert.equal(deriveAddress(RFC8032_SEED, 'testnet'), RFC8032_SUI_ADDRESS);
  assert.equal(deriveAddress(RFC8032_SEED), RFC8032_SUI_ADDRESS);
  assert.equal(deriveAddress(RFC8032_SEED, 'mainnet'), addressFromSecret('sui', RFC8032_SEED));
  assert.equal(publicKeyFromSecret('sui', RFC8032_SEED).length, 32);
  assert.throws(() => deriveAddress(new Uint8Array(31), 'mainnet'), /32-byte/);
  assert.throws(() => deriveAddress(RFC8032_SEED, 'devnet'), /Unknown Sui variant/);
});

test('sui deriveAddress: agrees with hd.mjs account derivation', () => {
  const master = new Uint8Array(32).fill(0x42); // public test fixture
  for (const index of [0, 1, 2]) {
    const secret = deriveAccountSecret(master, 'sui', index);
    assert.equal(deriveAddress(secret, 'testnet'), deriveAccountAddress(master, 'sui', index));
  }
});

test('sui validateAddress: canonical 0x + 64 hex only', () => {
  assert.equal(validateAddress(RFC8032_SUI_ADDRESS, 'mainnet'), true);
  assert.equal(validateAddress(RFC8032_SUI_ADDRESS, 'testnet'), true);
  assert.equal(validateAddress('0x' + 'AB'.repeat(32), 'mainnet'), true, 'uppercase hex accepted');
  assert.equal(validateAddress('0x0000000000000000000000000000000000000000000000000000000000000002', 'testnet'), true);

  assert.equal(validateAddress('', 'mainnet'), false);
  assert.equal(validateAddress(RFC8032_SUI_ADDRESS.slice(2), 'mainnet'), false, 'missing 0x');
  assert.equal(validateAddress('0x' + '22'.repeat(31), 'mainnet'), false, '31 bytes');
  assert.equal(validateAddress('0x' + '22'.repeat(33), 'mainnet'), false, '33 bytes');
  assert.equal(validateAddress('0x' + 'zz'.repeat(32), 'mainnet'), false, 'non-hex');
  assert.equal(validateAddress(null, 'mainnet'), false);
  assert.equal(validateAddress(undefined, 'testnet'), false);
  assert.equal(validateAddress(12345, 'testnet'), false);
});

// ------------------------------------------------------------- BCS known answer

// Expected TransactionData for:
//   sender    = 0x11…11, recipient = 0x22…22, amount = 1_000_000 MIST
//   gas coin  = objectId 0x33…33, version 7, digest 32×0x44
//   gasPrice  = 1000, gasBudget = 10_000_000
//
// Written out field-by-field from the BCS / PTB layout:
//   00                                  TransactionData::V1
//   00                                  TransactionKind::ProgrammableTransaction
//   02                                  inputs: vec len 2
//     00 20 <22…×32>                    CallArg::Pure, bcsBytes len 32, recipient
//     00 08 40420f0000000000            CallArg::Pure, bcsBytes len 8, u64LE(1_000_000)
//   02                                  commands: vec len 2
//     02 00 01 01 0100                  SplitCoins: GasCoin(0),
//                                       amounts vec len 1: Input(1) index u16LE 1
//     01 01 03 0000 0000 01 0000        TransferObjects: objects vec len 1:
//                                       NestedResult(3) (u16LE 0, u16LE 0),
//                                       address Input(1) index u16LE 0
//   <11…×32>                            sender
//   01 <33…×32> 0700000000000000        gas payment vec len 1: objectId,
//     20 <44…×32>                       version u64LE 7, digest bcsBytes len 32
//   <11…×32>                            gas owner (== sender)
//   e803000000000000                    gas price u64LE 1000
//   8096980000000000                    gas budget u64LE 10_000_000
//   00                                  expiration::None
const EXPECTED_TX_HEX =
  '00' + // TransactionData::V1
  '00' + // ProgrammableTransaction
  '02' + // inputs vec len
  '00' + '20' + '22'.repeat(32) + // Pure(recipient)
  '00' + '08' + '40420f0000000000' + // Pure(u64 amount)
  '02' + // commands vec len
  '02' + '00' + '01' + '01' + '0100' + // SplitCoins
  '01' + '01' + '03' + '0000' + '0000' + '01' + '0000' + // TransferObjects
  '11'.repeat(32) + // sender
  '01' + '33'.repeat(32) + '0700000000000000' + '20' + '44'.repeat(32) + // gas payment
  '11'.repeat(32) + // gas owner
  'e803000000000000' + // price
  '8096980000000000' + // budget
  '00'; // expiration None

test('sui BCS: transfer TransactionData is byte-exact; intent signature verifies', () => {
  const txBytes = buildTransferTransactionBytes({
    sender: '0x' + '11'.repeat(32),
    recipient: RECIPIENT,
    amount: 1000000n,
    coins: [{ objectId: COIN_ID, version: 7, digest: COIN_DIGEST_B58 }],
    gasPrice: 1000n,
    gasBudget: 10000000n,
  });
  assert.equal(bytesHex(txBytes), EXPECTED_TX_HEX, 'txBytes byte-for-byte');
  assert.equal(txBytes.length, EXPECTED_TX_HEX.length / 2);

  // Intent signing over the same bytes with the RFC 8032 key: the
  // signature must verify against blake2b-256([0,0,0] ‖ txBytes).
  const digest = intentDigest(txBytes);
  assert.equal(
    bytesHex(digest),
    bytesHex(blake2b(concatBytes(new Uint8Array([0, 0, 0]), txBytes), { dkLen: 32 })),
    'intent digest construction',
  );
  const { signature, serializedSignature } = signTransactionBytes(txBytes, RFC8032_SEED);
  assert.equal(ed25519.verify(signature, digest, RFC8032_PUB), true, 'signature verifies');
  const serialized = new Uint8Array(Buffer.from(serializedSignature, 'base64'));
  assert.equal(serialized.length, 1 + 64 + 32, 'flag ‖ sig ‖ pubkey');
  assert.equal(serialized[0], 0x00, 'Ed25519 scheme flag');
  assert.deepEqual(serialized.subarray(1, 65), signature);
  assert.deepEqual(serialized.subarray(65), RFC8032_PUB);
  // Digest base58 sanity: the coin digest used above round-trips.
  assert.deepEqual(base58Decode(COIN_DIGEST_B58), new Uint8Array(32).fill(0x44));
});

// ------------------------------------------------------------------ RPC flows

test('sui client: checkConnection and getBalance request/response shapes', async () => {
  const { fetchImpl, calls } = makeStub(standardHandlers());
  const client = createSuiClient('https://graphql.testnet.sui.io/graphql/', { fetchImpl });

  assert.equal(await client.checkConnection(), true);
  assert.equal(calls[0].url, 'https://graphql.testnet.sui.io/graphql', 'trailing slash stripped');
  assert.ok(calls[0].query.includes('chainIdentifier'));

  const balance = await client.getBalance(SENDER);
  assert.equal(balance, 2500000000n, 'totalBalance string → bigint MIST');
  const balCall = calls.find((c) => c.query.includes('balance(coinType'));
  assert.deepEqual(balCall.variables, { address: SENDER });

  const dead = createSuiClient('https://graphql.testnet.sui.io/graphql', {
    fetchImpl: async () => {
      throw Error('network down');
    },
  });
  assert.equal(await dead.checkConnection(), false, 'connection failure maps to false');

  await assert.rejects(() => client.getBalance('not-an-address'), /Invalid Sui address/);
});

test('sui client: unseen address balance parses as zero', async () => {
  const { fetchImpl } = makeStub(
    standardHandlers({ 'balance(coinType': { address: null } }),
  );
  const client = createSuiClient('https://graphql.testnet.sui.io/graphql', { fetchImpl });
  assert.equal(await client.getBalance(SENDER), 0n);
});

test('sui client: prepareSend parses coins, uses simulation for the budget', async () => {
  const { fetchImpl, calls } = makeStub(standardHandlers());
  const client = createSuiClient('https://graphql.testnet.sui.io/graphql', { fetchImpl });

  const plan = await client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 1000000n });
  assert.equal(plan.from, SENDER);
  assert.equal(plan.to, RECIPIENT);
  assert.equal(plan.amount, 1000000n);
  assert.equal(plan.balance, 2500000000n);
  assert.equal(plan.gasPrice, 1000n);
  assert.deepEqual(plan.coins, [{ objectId: COIN_ID, version: 7, digest: COIN_DIGEST_B58 }]);
  // Simulated charge = 1_000_000 + 988_000 − 0 = 1_988_000 → budget 2×.
  assert.equal(plan.simulation.status, 'SUCCESS');
  assert.equal(plan.simulation.estimatedCostMist, '1988000');
  assert.equal(plan.fee, 3976000n);
  assert.equal(plan.feeSemantics, 'estimated');
  // plan.txBytes must be the BCS build with the simulated budget.
  const rebuilt = buildTransferTransactionBytes({
    sender: SENDER,
    recipient: RECIPIENT,
    amount: 1000000n,
    coins: plan.coins,
    gasPrice: 1000n,
    gasBudget: 3976000n,
  });
  assert.equal(toHex(new Uint8Array(Buffer.from(plan.txBytes, 'base64'))), toHex(rebuilt));

  // The simulation request must carry the verified gRPC-JSON shape.
  const simCall = calls.find((c) => c.query.includes('simulateTransaction'));
  assert.equal(simCall.variables.doGasSelection, true);
  const simTx = simCall.variables.transaction;
  assert.equal(simTx.sender, SENDER);
  assert.equal(simTx.kind.programmableTransaction.commands[1].transferObjects.objects[0].kind, 'RESULT');
  assert.equal(simTx.kind.programmableTransaction.commands[1].transferObjects.objects[0].subresult, 0);
  assert.deepEqual(simTx.gasPayment.objects, [
    { objectId: COIN_ID, version: '7', digest: COIN_DIGEST_B58 },
  ]);

  await assert.rejects(
    () => client.prepareSend({ from: SENDER, to: 'nope', amount: 1n }),
    /Invalid Sui address/,
  );
  await assert.rejects(() => client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 0n }), /positive/);
});

test('sui client: failed simulation falls back to the flat budget cap', async () => {
  const { fetchImpl } = makeStub(
    standardHandlers({
      simulateTransaction: {
        simulateTransaction: {
          effects: {
            status: 'FAILURE',
            executionError: { message: 'InsufficientCoinBalance' },
            gasEffects: { gasSummary: null },
          },
        },
      },
    }),
  );
  const client = createSuiClient('https://graphql.testnet.sui.io/graphql', { fetchImpl });
  const plan = await client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 1000000n });
  assert.equal(plan.fee, DEFAULT_GAS_BUDGET);
  assert.equal(plan.feeSemantics, 'budget-cap');
  assert.equal(plan.simulation.status, 'FAILURE');
  assert.equal(plan.simulation.error, 'InsufficientCoinBalance');
});

test('sui client: executeSend mutation shape, signature verifies, wrong secret never broadcasts', async () => {
  const { fetchImpl, calls } = makeStub(standardHandlers());
  const client = createSuiClient('https://graphql.testnet.sui.io/graphql', { fetchImpl });
  const plan = await client.prepareSend({ from: SENDER, to: RECIPIENT, amount: 1000000n });

  const { hash } = await client.executeSend(plan, RFC8032_SEED);
  assert.equal(hash, EXEC_DIGEST, 'hash is the effects digest');

  const exec = calls.find((c) => c.query.includes('executeTransaction'));
  assert.ok(exec, 'executeTransaction was called');
  assert.equal(typeof exec.variables.transactionDataBcs, 'string');
  assert.equal(exec.variables.signatures.length, 1);
  const sentTx = new Uint8Array(Buffer.from(exec.variables.transactionDataBcs, 'base64'));
  const rebuilt = buildTransferTransactionBytes({
    sender: SENDER,
    recipient: RECIPIENT,
    amount: 1000000n,
    coins: plan.coins,
    gasPrice: plan.gasPrice,
    gasBudget: plan.fee,
  });
  assert.equal(bytesHex(sentTx), bytesHex(rebuilt), 'mutation carries the rebuilt BCS bytes');
  const serialized = new Uint8Array(Buffer.from(exec.variables.signatures[0], 'base64'));
  assert.equal(serialized[0], 0x00);
  assert.equal(
    ed25519.verify(serialized.subarray(1, 65), intentDigest(sentTx), RFC8032_PUB),
    true,
    'mutation signature verifies over the intent digest',
  );

  const before = calls.filter((c) => c.query.includes('executeTransaction')).length;
  const wrongSecret = new Uint8Array(32).fill(7);
  await assert.rejects(() => client.executeSend(plan, wrongSecret), /does not own plan\.from/);
  assert.equal(
    calls.filter((c) => c.query.includes('executeTransaction')).length,
    before,
    'no broadcast attempted with the wrong secret',
  );
});

test('sui client: getTxStatus maps SUCCESS / FAILURE / unknown digest', async () => {
  const cases = [
    ['SUCCESS effects', { transactionEffects: { status: 'SUCCESS' } }, 'success'],
    ['FAILURE effects', { transactionEffects: { status: 'FAILURE' } }, 'failed'],
    ['unknown digest (null effects)', { transactionEffects: null }, 'pending'],
  ];
  for (const [label, data, want] of cases) {
    const { fetchImpl, calls } = makeStub(standardHandlers({ transactionEffects: data }));
    const client = createSuiClient('https://graphql.testnet.sui.io/graphql', { fetchImpl });
    assert.equal(await client.getTxStatus(EXEC_DIGEST), want, label);
    assert.deepEqual(calls[0].variables, { digest: EXEC_DIGEST });
  }
});

test('sui client: a GraphQL errors response throws with the server message', async () => {
  const { fetchImpl } = makeStub(
    standardHandlers({
      'balance(coinType': { errors: [{ message: 'Indexer is lagging behind' }] },
    }),
  );
  const client = createSuiClient('https://graphql.testnet.sui.io/graphql', { fetchImpl });
  await assert.rejects(() => client.getBalance(SENDER), /Indexer is lagging behind/);

  const execStub = makeStub(
    standardHandlers({
      executeTransaction: {
        errors: [{ message: 'Invalid signature: unable to verify' }],
      },
    }),
  );
  const client2 = createSuiClient('https://graphql.testnet.sui.io/graphql', {
    fetchImpl: execStub.fetchImpl,
  });
  const plan = {
    from: SENDER,
    to: RECIPIENT,
    amount: 1000000n,
    fee: DEFAULT_GAS_BUDGET,
    gasPrice: 1000n,
    coins: [{ objectId: COIN_ID, version: 7, digest: COIN_DIGEST_B58 }],
  };
  await assert.rejects(() => client2.executeSend(plan, RFC8032_SEED), /Invalid signature/);
});
