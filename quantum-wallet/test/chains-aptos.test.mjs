// Aptos engine tests (multi-chain v12).
//
// Anchors:
//   - Address known answers computed independently in-test with raw
//     noble calls (ed25519.getPublicKey + sha3_256(pubkey ‖ 0x00)),
//     NOT via crypto.mjs — the construction the Aptos account docs
//     specify (https://aptos.dev/network/blockchain/accounts :
//     auth_key = sha3-256(pubkey_A | 0x00) for Ed25519 accounts),
//     pinned to the hardcoded results for seed 0x00…01 and for the
//     RFC 8032 §7.1 TEST 1 seed.
//   - A byte-for-byte BCS known answer for a coin transfer, with the
//     expected RawTransaction written out field-by-field from the BCS
//     spec; the Ed25519 signature is checked with ed25519.verify over
//     sha3_256("APTOS::RawTransaction") ‖ rawTx.
//   - A stub REST endpoint (fetchImpl) for balance / prepare /
//     execute / status mapping — no network needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha3_256 } from '@noble/hashes/sha3.js';

import { deriveAddress, validateAddress, createAptosClient } from '../src/core/chains/aptos.mjs';
import { addressFromSecret, publicKeyFromSecret } from '../src/core/crypto.mjs';
import { deriveAccountSecret, deriveAccountAddress } from '../src/core/hd.mjs';

function hexBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function utf8Hex(str) {
  return bytesHex(new TextEncoder().encode(str));
}

// Seed 0x000…001 and its independently computed key material:
//   pub    = ed25519.getPublicKey(seed)
//   addr   = sha3_256(pub ‖ 0x00)   (recomputed in the test below)
const SEED_ONE = new Uint8Array(32);
SEED_ONE[31] = 1;
const SEED_ONE_PUB_HEX = '4cb5abf6ad79fbf5abbccafcc269d85cd2651ed4b885b5869f241aedf0a5ba29';
const SEED_ONE_ADDRESS = '0xf90391c81027f03cdea491ed8b36ffaced26b6df208a9b569e5baf2590eb9b16';

// RFC 8032 §7.1 TEST 1 keypair, a published Ed25519 vector.
const RFC8032_SEED = hexBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
const RFC8032_PUB_HEX = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const RFC8032_ADDRESS = '0x63c5215e87770d17b9f4cd47c777e322f4eb152cfd2054c1080fd9d57c48913b';

// ------------------------------------------------------------------ stub API

/**
 * Fake Aptos fullnode REST API. `handlers` maps a route key to
 * { status?, json } or (record) => { status?, json }. Routes:
 *   ledger  GET  /
 *   view    POST /view
 *   account GET  /accounts/{address}
 *   gas     GET  /estimate_gas_price
 *   submit  POST /transactions
 *   tx      GET  /transactions/by_hash/{hash}
 * Every request is recorded in `calls`.
 */
function makeStub(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace(/\/v1\/?/, '/');
    let route = null;
    if (path === '/' && (init.method ?? 'GET') === 'GET') route = 'ledger';
    else if (path === '/view') route = 'view';
    else if (path.startsWith('/accounts/')) route = 'account';
    else if (path === '/estimate_gas_price') route = 'gas';
    else if (path === '/transactions' && init.method === 'POST') route = 'submit';
    else if (path.startsWith('/transactions/by_hash/')) route = 'tx';
    const record = { url, path, route, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body };
    calls.push(record);
    const handler = handlers[route];
    if (!handler) throw Error(`stub: no handler for route ${route} (${url})`);
    const out = typeof handler === 'function' ? handler(record) : handler;
    const status = out.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => out.json,
    };
  };
  return { fetchImpl, calls };
}

const SUBMIT_HASH = '0x' + 'ab'.repeat(32);

function standardHandlers(overrides = {}) {
  return {
    ledger: { json: { chain_id: 2, epoch: '100', ledger_version: '123456', block_height: '999' } },
    view: { json: ['123'] },
    account: { json: { sequence_number: '7', authentication_key: SEED_ONE_ADDRESS } },
    gas: { json: { deprioritized_gas_estimate: 100, gas_estimate: 100, prioritized_gas_estimate: 150 } },
    submit: { json: { hash: SUBMIT_HASH, sender: SEED_ONE_ADDRESS, sequence_number: '0' } },
    tx: { json: { hash: SUBMIT_HASH, success: true, vm_status: 'Executed successfully' } },
    ...overrides,
  };
}

const FIXED_NOW_MS = 1700000000000; // → expiration 1700000600 with the default 600 s TTL

function stubClient(handlers, opts = {}) {
  const { fetchImpl, calls } = makeStub(handlers);
  const client = createAptosClient('https://aptos.test/v1', { fetchImpl, now: () => FIXED_NOW_MS, ...opts });
  return { client, calls };
}

// ---------------------------------------------------------------- derivation

test('aptos deriveAddress: seed 0x00…01 matches the independently computed sha3-256(pubkey ‖ 0x00)', () => {
  // Independent recomputation with raw noble primitives only.
  const pub = ed25519.getPublicKey(SEED_ONE);
  assert.equal(bytesHex(pub), SEED_ONE_PUB_HEX);
  const authKey = sha3_256(new Uint8Array([...pub, 0x00]));
  const expected = '0x' + bytesHex(authKey);
  assert.equal(expected, SEED_ONE_ADDRESS, 'hardcoded anchor matches the raw computation');

  assert.equal(deriveAddress(SEED_ONE, 'mainnet'), SEED_ONE_ADDRESS);
  assert.equal(deriveAddress(SEED_ONE, 'testnet'), SEED_ONE_ADDRESS, 'same address on both networks');
  assert.equal(deriveAddress(SEED_ONE), SEED_ONE_ADDRESS);
  assert.equal(deriveAddress(SEED_ONE), addressFromSecret('aptos', SEED_ONE));
  assert.equal(bytesHex(publicKeyFromSecret('aptos', SEED_ONE)), SEED_ONE_PUB_HEX);
});

test('aptos deriveAddress: RFC 8032 published keypair maps to its hardcoded address', () => {
  assert.equal(bytesHex(ed25519.getPublicKey(RFC8032_SEED)), RFC8032_PUB_HEX, 'RFC 8032 keypair');
  assert.equal(deriveAddress(RFC8032_SEED, 'mainnet'), RFC8032_ADDRESS);
  assert.equal(deriveAddress(RFC8032_SEED, 'testnet'), RFC8032_ADDRESS);
  assert.throws(() => deriveAddress(new Uint8Array(31)), /32-byte/);
  assert.throws(() => deriveAddress(SEED_ONE, 'devnet'), /Unknown Aptos variant/);
});

test('aptos deriveAddress: agrees with hd.mjs account derivation', () => {
  const master = new Uint8Array(32).fill(0x42); // public test fixture
  for (const index of [0, 1, 2]) {
    const secret = deriveAccountSecret(master, 'aptos', index);
    assert.equal(deriveAddress(secret, 'testnet'), deriveAccountAddress(master, 'aptos', index));
  }
});

test('aptos validateAddress: full 0x + 64 hex only, case-insensitive', () => {
  assert.equal(validateAddress(SEED_ONE_ADDRESS, 'mainnet'), true);
  assert.equal(validateAddress(SEED_ONE_ADDRESS, 'testnet'), true);
  assert.equal(validateAddress('0x' + SEED_ONE_ADDRESS.slice(2).toUpperCase()), true, 'uppercase hex ok');
  assert.equal(validateAddress('0x0000000000000000000000000000000000000000000000000000000000000001'), true);

  assert.equal(validateAddress('0x1', 'mainnet'), false, 'short form rejected');
  assert.equal(validateAddress(SEED_ONE_ADDRESS.slice(2), 'mainnet'), false, 'missing 0x rejected');
  assert.equal(validateAddress(SEED_ONE_ADDRESS + '00', 'mainnet'), false, '66 hex digits rejected');
  assert.equal(validateAddress(SEED_ONE_ADDRESS.slice(0, -2), 'mainnet'), false, '62 hex digits rejected');
  assert.equal(validateAddress('0x' + 'zz'.repeat(32), 'mainnet'), false, 'non-hex rejected');
  assert.equal(validateAddress('', 'mainnet'), false);
  assert.equal(validateAddress(null, 'mainnet'), false);
  assert.equal(validateAddress(undefined, 'testnet'), false);
  assert.equal(validateAddress(12345, 'testnet'), false);
});

// ------------------------------------------------------------- BCS known answer
//
// Expected RawTransaction for:
//   sender     = SEED_ONE_ADDRESS (seed 0x00…01)
//   sequence   = 0
//   recipient  = 0x000…002
//   amount     = 1000 octas
//   max gas    = 200, gas unit price = 100
//   expiration = 1700000600, chain_id = 2 (testnet)
//
// Written out field-by-field from the BCS spec:
//   address        32 raw bytes, no prefix
//   u64            8-byte little-endian
//   ULEB128        enum variants, vector counts, byte-string lengths
//   string         ULEB128 length ‖ UTF-8 bytes
//   bytes (args)   ULEB128 length ‖ raw argument bytes
const RECIPIENT = '0x0000000000000000000000000000000000000000000000000000000000000002';
const EXPECTED_RAW_TX_HEX =
  // --- RawTransaction ---
  'f90391c81027f03cdea491ed8b36ffaced26b6df208a9b569e5baf2590eb9b16' + // sender (address)
  '0000000000000000' + // sequence_number u64 = 0
  // payload: TransactionPayload enum variant 2 (EntryFunction)
  '02' +
  '0000000000000000000000000000000000000000000000000000000000000001' + // module address 0x1
  '04' + utf8Hex('coin') + // module name string
  '08' + utf8Hex('transfer') + // function name string
  '01' + // type_args vector count = 1
  // TypeTag enum variant 7 (Struct): 0x1::aptos_coin::AptosCoin, no type args
  '07' +
  '0000000000000000000000000000000000000000000000000000000000000001' + // struct address 0x1
  '0a' + utf8Hex('aptos_coin') + // struct module string
  '09' + utf8Hex('AptosCoin') + // struct name string
  '00' + // struct type_args count = 0
  '02' + // args vector count = 2
  '20' + // arg0: 32 bytes follow
  '0000000000000000000000000000000000000000000000000000000000000002' + // arg0: recipient address
  '08' + // arg1: 8 bytes follow
  'e803000000000000' + // arg1: amount u64 LE = 1000
  'c800000000000000' + // max_gas_amount u64 = 200
  '6400000000000000' + // gas_unit_price u64 = 100
  '58f3536500000000' + // expiration_timestamp_secs u64 = 1700000600
  '02'; // chain_id u8 = 2

test('aptos BCS: signed coin transfer is byte-exact and the signature verifies', async () => {
  const { client, calls } = stubClient(standardHandlers());
  const plan = {
    from: SEED_ONE_ADDRESS,
    to: RECIPIENT,
    amount: 1000n,
    fee: 20000n,
    balance: 0n,
    sequence: 0n,
    gasUnitPrice: 100,
    maxGasAmount: 200,
    chainId: 2,
    expirationSecs: 1700000600,
  };
  const { hash } = await client.executeSend(plan, SEED_ONE);
  assert.equal(hash, SUBMIT_HASH, 'submit response hash passthrough');

  const submit = calls.find((c) => c.route === 'submit');
  assert.ok(submit, 'POST /transactions was called');
  assert.equal(submit.headers['Content-Type'], 'application/x.aptos.signed_transaction+bcs');
  assert.ok(submit.body instanceof Uint8Array, 'body is raw BCS bytes');

  const signedHex = bytesHex(submit.body);
  const rawBytes = hexBytes(EXPECTED_RAW_TX_HEX);
  assert.equal(
    signedHex.slice(0, EXPECTED_RAW_TX_HEX.length),
    EXPECTED_RAW_TX_HEX,
    'RawTransaction bytes byte-for-byte',
  );

  // Authenticator: variant 0 (Ed25519) ‖ bytes(pubkey) ‖ bytes(signature).
  const authHex = signedHex.slice(EXPECTED_RAW_TX_HEX.length);
  assert.equal(authHex.slice(0, 2), '00', 'authenticator variant 0 = Ed25519');
  assert.equal(authHex.slice(2, 4), '20', 'pubkey length 32');
  assert.equal(authHex.slice(4, 4 + 64), SEED_ONE_PUB_HEX, 'pubkey bytes');
  assert.equal(authHex.slice(4 + 64, 4 + 64 + 2), '40', 'signature length 64');
  const signature = hexBytes(authHex.slice(4 + 64 + 2));
  assert.equal(signature.length, 64);
  assert.equal(authHex.length, 2 + 2 + 64 + 2 + 128, 'no trailing bytes');

  // The signature must verify over the domain-separated message,
  // recomputed here with raw noble calls only.
  const message = new Uint8Array([
    ...sha3_256(new TextEncoder().encode('APTOS::RawTransaction')),
    ...rawBytes,
  ]);
  assert.equal(ed25519.verify(signature, message, hexBytes(SEED_ONE_PUB_HEX)), true, 'signature verifies');
  // Ed25519 is deterministic: the submitted signature is exactly the
  // noble signature of that message under this seed.
  assert.deepEqual(signature, ed25519.sign(message, SEED_ONE));
});

// ------------------------------------------------------------------ RPC flows

test('aptos client: checkConnection and getChainId from the ledger info', async () => {
  const { client, calls } = stubClient(standardHandlers());
  assert.equal(await client.checkConnection(), true);
  assert.equal(calls[0].route, 'ledger');
  assert.equal(await client.getChainId(), 2);

  const dead = createAptosClient('https://aptos.test/v1', {
    fetchImpl: async () => {
      throw Error('network down');
    },
  });
  assert.equal(await dead.checkConnection(), false, 'connection failure maps to false');
  await assert.rejects(() => dead.getChainId(), /network down/);

  const noChain = stubClient({ ledger: { json: { epoch: '1' } } });
  assert.equal(await noChain.client.checkConnection(), false, 'ledger info without chain_id is not a connection');
});

test('aptos client: getBalance parses the /view string and posts the exact view request', async () => {
  const { client, calls } = stubClient(standardHandlers());
  const balance = await client.getBalance(SEED_ONE_ADDRESS);
  assert.equal(balance, 123n, '"123" string parses to 123n');

  const view = calls.find((c) => c.route === 'view');
  assert.equal(view.method, 'POST');
  assert.deepEqual(JSON.parse(view.body), {
    function: '0x1::coin::balance',
    type_arguments: ['0x1::aptos_coin::AptosCoin'],
    arguments: [SEED_ONE_ADDRESS],
  });

  const zero = stubClient(standardHandlers({ view: { json: ['0'] } }));
  assert.equal(await zero.client.getBalance(SEED_ONE_ADDRESS), 0n);
});

test('aptos client: nonexistent account reads balance 0 and sequence 0', async () => {
  // The live nodes answer ["0"] for a fresh address's balance view and
  // may 404 the account resource; both paths must read as empty.
  const viewZero = stubClient(
    standardHandlers({
      view: { json: ['0'] },
      account: { status: 404, json: { message: 'Account not found', error_code: 'account_not_found' } },
    }),
  );
  const fresh = '0x' + '11'.repeat(32);
  assert.equal(await viewZero.client.getBalance(fresh), 0n);
  const plan = await viewZero.client.prepareSend({ from: fresh, to: RECIPIENT, amount: 1n });
  assert.equal(plan.balance, 0n);
  assert.equal(plan.sequence, 0n, '404 account → sequence 0');

  const view404 = stubClient(
    standardHandlers({
      view: { status: 404, json: { message: 'Account not found', error_code: 'account_not_found' } },
    }),
  );
  assert.equal(await view404.client.getBalance(fresh), 0n, 'view 404 → balance 0n');
});

test('aptos client: prepareSend assembles the full plan (fee bound, gas fallback, expiration)', async () => {
  const { client, calls } = stubClient(standardHandlers());
  const plan = await client.prepareSend({ from: SEED_ONE_ADDRESS, to: RECIPIENT, amount: 5000n });
  assert.equal(plan.from, SEED_ONE_ADDRESS);
  assert.equal(plan.to, RECIPIENT);
  assert.equal(plan.amount, 5000n);
  assert.equal(plan.balance, 123n);
  assert.equal(plan.sequence, 7n, 'sequence_number string → bigint');
  assert.equal(plan.gasUnitPrice, 100);
  assert.equal(plan.maxGasAmount, 200000, 'default max gas (SDK-sized cap, above the network minimum)');
  assert.equal(plan.fee, 20000000n, 'fee = maxGasAmount × gasUnitPrice');
  assert.equal(plan.chainId, 2);
  assert.equal(plan.expirationSecs, 1700000600, 'fixed now + 600 s TTL');
  assert.deepEqual(
    calls.map((c) => c.route).sort(),
    ['account', 'gas', 'ledger', 'view'],
  );

  // Gas estimate failure → fallback 100.
  const noGas = stubClient(standardHandlers({ gas: { status: 500, json: { message: 'boom' } } }));
  const fallbackPlan = await noGas.client.prepareSend({ from: SEED_ONE_ADDRESS, to: RECIPIENT, amount: 1n });
  assert.equal(fallbackPlan.gasUnitPrice, 100, 'fallback gas price');

  // opts overrides.
  const custom = stubClient(standardHandlers());
  const customPlan = await custom.client.prepareSend({
    from: SEED_ONE_ADDRESS,
    to: RECIPIENT,
    amount: 1n,
    opts: { maxGasAmount: 500, ttlSecs: 60 },
  });
  assert.equal(customPlan.maxGasAmount, 500);
  assert.equal(customPlan.fee, 50000n);
  assert.equal(customPlan.expirationSecs, 1700000060);

  await assert.rejects(
    () => client.prepareSend({ from: SEED_ONE_ADDRESS, to: RECIPIENT, amount: 0n }),
    /positive/,
  );
  await assert.rejects(
    () => client.prepareSend({ from: 'not-an-address', to: RECIPIENT, amount: 1n }),
    /Invalid Aptos/,
  );
  await assert.rejects(
    () => client.prepareSend({ from: SEED_ONE_ADDRESS, to: '0xzz', amount: 1n }),
    /Invalid Aptos/,
  );
});

test('aptos client: prepareSend normalizes short-form send inputs by zero-padding', async () => {
  const { client, calls } = stubClient(standardHandlers());
  const plan = await client.prepareSend({ from: '0x1', to: '0x2', amount: 1n });
  assert.equal(plan.from, '0x0000000000000000000000000000000000000000000000000000000000000001');
  assert.equal(plan.to, RECIPIENT);
  const account = calls.find((c) => c.route === 'account');
  assert.ok(
    account.url.endsWith('/accounts/0x0000000000000000000000000000000000000000000000000000000000000001'),
    'account lookup uses the padded form',
  );
});

test('aptos client: executeSend rejects a secret that does not own plan.from, without broadcasting', async () => {
  const { client, calls } = stubClient(standardHandlers());
  const plan = {
    from: SEED_ONE_ADDRESS,
    to: RECIPIENT,
    amount: 1000n,
    fee: 20000n,
    balance: 0n,
    sequence: 0n,
    gasUnitPrice: 100,
    maxGasAmount: 200,
    chainId: 2,
    expirationSecs: 1700000600,
  };
  await assert.rejects(() => client.executeSend(plan, RFC8032_SEED), /does not own plan\.from/);
  assert.equal(calls.filter((c) => c.route === 'submit').length, 0, 'no broadcast attempted');
  await assert.rejects(() => client.executeSend(plan, new Uint8Array(31)), /32-byte/);
});

test('aptos client: executeSend surfaces node rejection errors', async () => {
  const { client } = stubClient(
    standardHandlers({
      submit: { status: 400, json: { message: 'Transaction expired', error_code: 'invalid_input' } },
    }),
  );
  const plan = {
    from: SEED_ONE_ADDRESS,
    to: RECIPIENT,
    amount: 1000n,
    sequence: 0n,
    gasUnitPrice: 100,
    maxGasAmount: 200,
    chainId: 2,
    expirationSecs: 1700000600,
  };
  await assert.rejects(() => client.executeSend(plan, SEED_ONE), /HTTP 400 — Transaction expired/);
});

test('aptos client: getTxStatus maps success / failed / pending', async () => {
  const cases = [
    ['committed success', { json: { hash: SUBMIT_HASH, success: true, vm_status: 'Executed successfully' } }, 'success'],
    ['committed failure with vm_status', { json: { hash: SUBMIT_HASH, success: false, vm_status: 'Move abort: insufficient balance' } }, 'failed'],
    ['pending transaction (no success field yet)', { json: { hash: SUBMIT_HASH, type: 'pending_transaction' } }, 'pending'],
    ['unknown hash → 404', { status: 404, json: { message: 'Transaction not found', error_code: 'transaction_not_found' } }, 'pending'],
  ];
  for (const [label, tx, want] of cases) {
    const { client, calls } = stubClient(standardHandlers({ tx }));
    assert.equal(await client.getTxStatus(SUBMIT_HASH), want, label);
    assert.equal(calls[0].route, 'tx');
    assert.ok(calls[0].url.endsWith(`/transactions/by_hash/${SUBMIT_HASH}`));
  }
});
