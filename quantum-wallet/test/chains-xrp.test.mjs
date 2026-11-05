// XRP engine tests (src/core/chains/xrp.mjs). Run with:
//   node --test test/chains-xrp.test.mjs
//
// Serializer known-answer tests use the ripple-binary-codec data-driven
// fixtures published by XRPLF (fetched 2026-11-05 from
// https://raw.githubusercontent.com/XRPLF/xrpl.js/main/packages/ripple-binary-codec/test/fixtures/data-driven-tests.json),
// embedded below with their tx_json, plus a hand-computed Payment whose
// every field is justified from the codec rules in comments.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { publicKeyFromSecret, addressFromSecret } from '../src/core/crypto.mjs';
import { deriveAccountSecret } from '../src/core/hd.mjs';
import {
  base58Encode,
  base58CheckEncode,
  base58CheckDecode,
  XRP_ALPHABET,
  ecdsaDerEncode,
} from '../src/core/enc.mjs';
import {
  deriveAddress,
  validateAddress,
  accountIdFromPublicKey,
  classicAddressFromAccountId,
  accountIdFromAddress,
  createXrpClient,
  serializePayment,
  encodeAmountDrops,
  encodeFieldHeader,
  encodeVlenLength,
  paymentSigningHash,
  computeTxId,
  bytesToHexUpper,
  TF_FULLY_CANONICAL_SIG,
} from '../src/core/chains/xrp.mjs';

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const unhex = (s) => new Uint8Array(Buffer.from(s, 'hex'));

/** Private key 0x00…01 — its compressed pubkey is the secp256k1 generator. */
const SECRET_ONE = new Uint8Array(32);
SECRET_ONE[31] = 1;
const GENERATOR_PUBKEY_HEX =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

// ------------------------------------------------------------ addresses

test('xrp: base58check + XRP alphabet anchors (enc vectors)', () => {
  // The XRP alphabet differs from Bitcoin's: its zero byte renders 'r',
  // not '1', and the well-known AccountID-zero classic address is
  // rrrrrrrrrrrrrrrrrrrrrhoLvTp (21 bytes: 0x00 version ‖ 20 zero bytes
  // + 4-byte double-sha256 checksum, XRP alphabet).
  assert.equal(XRP_ALPHABET[0], 'r');
  const zeroPayload = new Uint8Array(21); // version 0x00 + 20 zero bytes
  assert.equal(base58CheckEncode(zeroPayload, XRP_ALPHABET), 'rrrrrrrrrrrrrrrrrrrrrhoLvTp');
  assert.deepEqual(base58CheckDecode('rrrrrrrrrrrrrrrrrrrrrhoLvTp', XRP_ALPHABET), zeroPayload);
  assert.equal(classicAddressFromAccountId(new Uint8Array(20)), 'rrrrrrrrrrrrrrrrrrrrrhoLvTp');
  // A Bitcoin-alphabet rendering of the same payload is NOT an XRP address.
  assert.equal(validateAddress(base58CheckEncode(zeroPayload)), false);
  // Roundtrip on a non-trivial payload.
  const payload = unhex('00' + '5ccb151f6e9d603f394ae778acf10d3bece874f6');
  assert.deepEqual(base58CheckDecode(base58CheckEncode(payload, XRP_ALPHABET), XRP_ALPHABET), payload);
  assert.equal(base58Encode(new Uint8Array([0, 0, 1]), XRP_ALPHABET), 'rrp');
});

test('xrp: address derivation KAT (generator point, HD, crypto agreement)', () => {
  // secret = 1 → compressed pubkey is the generator point (published constant).
  const pub = publicKeyFromSecret('xrp', SECRET_ONE);
  assert.equal(hex(pub), GENERATOR_PUBKEY_HEX);
  const accountId = accountIdFromPublicKey(pub);
  assert.equal(accountId.length, 20);
  // Engine address, crypto.mjs address and the AccountID re-encoding agree.
  const address = deriveAddress(SECRET_ONE);
  assert.equal(address, addressFromSecret('xrp', SECRET_ONE));
  assert.equal(address, classicAddressFromAccountId(accountId));
  assert.deepEqual(accountIdFromAddress(address), accountId);
  assert.equal(validateAddress(address), true);
  // Variant is ignored: mainnet and testnet give the same classic address.
  assert.equal(deriveAddress(SECRET_ONE, 'mainnet'), deriveAddress(SECRET_ONE, 'testnet'));
  assert.equal(validateAddress(address, 'mainnet'), validateAddress(address, 'testnet'));
  // HD derivation (domain ZERONYTH/WALLET/V2/XRP) is deterministic and
  // agrees with crypto.mjs for the derived secret.
  const master = new Uint8Array(32).fill(0x42);
  const s0 = deriveAccountSecret(master, 'xrp', 0);
  assert.deepEqual(deriveAccountSecret(master, 'xrp', 0), s0);
  assert.equal(deriveAddress(s0), addressFromSecret('xrp', s0));
  assert.notDeepEqual(deriveAccountSecret(master, 'xrp', 1), s0);
});

test('xrp: validateAddress rejects malformed input', () => {
  const good = deriveAddress(SECRET_ONE);
  assert.equal(validateAddress(good), true);
  // Corrupted final character → checksum failure.
  const bad = good.slice(0, -1) + (good.endsWith('x') ? 'y' : 'x');
  assert.equal(validateAddress(bad), false);
  assert.equal(validateAddress(''), false);
  assert.equal(validateAddress('not-an-address'), false);
  assert.equal(validateAddress(null), false);
  assert.equal(validateAddress(42), false);
  // A 20-byte payload (no version byte) is not a classic address.
  assert.equal(validateAddress(base58CheckEncode(new Uint8Array(20), XRP_ALPHABET)), false);
});

// ------------------------------------------------------------ codec units

test('xrp: field header encoding', () => {
  // (t<16, f<16): single byte (t<<4)|f — fixture headers 12/22/24/61/68/73/74/81/83.
  assert.equal(hex(encodeFieldHeader(1, 2)), '12'); // TransactionType (UInt16)
  assert.equal(hex(encodeFieldHeader(2, 2)), '22'); // Flags (UInt32)
  assert.equal(hex(encodeFieldHeader(2, 4)), '24'); // Sequence
  assert.equal(hex(encodeFieldHeader(2, 14)), '2e'); // DestinationTag
  assert.equal(hex(encodeFieldHeader(6, 1)), '61'); // Amount
  assert.equal(hex(encodeFieldHeader(6, 8)), '68'); // Fee
  assert.equal(hex(encodeFieldHeader(7, 3)), '73'); // SigningPubKey
  assert.equal(hex(encodeFieldHeader(7, 4)), '74'); // TxnSignature
  assert.equal(hex(encodeFieldHeader(8, 1)), '81'); // Account
  assert.equal(hex(encodeFieldHeader(8, 3)), '83'); // Destination
  // (t<16, f≥16): [t<<4, f] — LastLedgerSequence is the fixture's "201B".
  assert.equal(hex(encodeFieldHeader(2, 27)), '201b');
  // (t≥16, f<16): [f, t].
  assert.equal(hex(encodeFieldHeader(16, 1)), '0110');
});

test('xrp: VLEN length encoding boundaries', () => {
  assert.equal(hex(encodeVlenLength(0)), '00');
  assert.equal(hex(encodeVlenLength(20)), '14'); // AccountID length in fixtures
  assert.equal(hex(encodeVlenLength(33)), '21'); // compressed pubkey length
  assert.equal(hex(encodeVlenLength(192)), 'c0'); // last 1-byte length
  assert.equal(hex(encodeVlenLength(193)), 'c100'); // first 2-byte length
  assert.equal(hex(encodeVlenLength(12480)), 'f0ff'); // last 2-byte length
  assert.equal(hex(encodeVlenLength(12481)), 'f10000'); // first 3-byte length
  assert.throws(() => encodeVlenLength(918745), /too large/);
});

test('xrp: native amount encoding', () => {
  // encoded = drops | (1<<62), 8-byte big-endian.
  assert.equal(hex(encodeAmountDrops(0n)), '4000000000000000');
  assert.equal(hex(encodeAmountDrops(1000000n)), '40000000000f4240'); // 1 XRP
  assert.equal(hex(encodeAmountDrops(12n)), '400000000000000c');
  assert.equal(hex(encodeAmountDrops(25000000n)), '40000000017d7840'); // fixture value
  assert.throws(() => encodeAmountDrops(-1n), /out of range/);
  assert.throws(() => encodeAmountDrops(1n << 62n), /out of range/);
});

// ------------------------------------------------------------ fixture KATs

// ripple-binary-codec whole-object fixture #1 (native Payment):
//   tx_json: { Account: 'r9TeThyi5xiuUUrFjtPKZiHcDxs7K9H6Rb',
//              Destination: 'r4BPgS7DHebQiU31xWELvZawwSG2fSPJ7C',
//              TransactionType: 'Payment', Amount: '25000000',
//              Fee: '10', Flags: 0, Sequence: 2 }
//   field AccountIDs: Account 5CCB151F…, Destination E851BBBE…
const FIXTURE1_BLOB =
  '120000220000000024000000026140000000017D784068400000000000000A' +
  '81145CCB151F6E9D603F394AE778ACF10D3BECE874F6' +
  '8314E851BBBE79E328E43D68F43445368133DF5FBA5A';

// Fixture #2: same shape plus LastLedgerSequence 6220218 (header "201B").
const FIXTURE2_BLOB =
  '12000022000000002400000090201B005EE9BA614000000000030D4068400000000000000F' +
  '8114AA1BD19D9E87BE8069FDBF6843653C43837C03C6' +
  '831467FE6EC28E0464DD24FB2D62A492AAC697CFAD02';

test('xrp: serializer KAT vs ripple-binary-codec fixtures', () => {
  // The fixtures also pin the address → AccountID decoding.
  assert.equal(
    bytesToHexUpper(accountIdFromAddress('r9TeThyi5xiuUUrFjtPKZiHcDxs7K9H6Rb')),
    '5CCB151F6E9D603F394AE778ACF10D3BECE874F6',
  );
  assert.equal(
    bytesToHexUpper(accountIdFromAddress('r4BPgS7DHebQiU31xWELvZawwSG2fSPJ7C')),
    'E851BBBE79E328E43D68F43445368133DF5FBA5A',
  );
  const blob1 = serializePayment({
    accountId: accountIdFromAddress('r9TeThyi5xiuUUrFjtPKZiHcDxs7K9H6Rb'),
    destinationId: accountIdFromAddress('r4BPgS7DHebQiU31xWELvZawwSG2fSPJ7C'),
    amountDrops: 25000000n,
    feeDrops: 10n,
    sequence: 2,
    flags: 0, // fixture carries Flags 0; the engine default is tfFullyCanonicalSig
  });
  assert.equal(bytesToHexUpper(blob1), FIXTURE1_BLOB);

  const blob2 = serializePayment({
    accountId: accountIdFromAddress('rGWTUVmm1fB5QUjMYn8KfnyrFNgDiD9H9e'),
    destinationId: accountIdFromAddress('rw71Qs1UYQrSQ9hSgRohqNNQcyjCCfffkQ'),
    amountDrops: 200000n,
    feeDrops: 15n,
    sequence: 144,
    flags: 0,
    lastLedgerSequence: 6220218,
  });
  assert.equal(bytesToHexUpper(blob2), FIXTURE2_BLOB);
});

test('xrp: serializer hand-computed KAT (flags on, destination tag)', () => {
  // Hand computation, field by field (canonical order (type, field) asc):
  //   TransactionType (1,2)  header 12, UInt16 0 (Payment)      → 12 0000
  //   Flags           (2,2)  header 22, UInt32 0x80000000       → 22 80000000
  //   Sequence        (2,4)  header 24, UInt32 1                → 24 00000001
  //   DestinationTag  (2,14) header 2E, UInt32 305419896        → 2E 12345678
  //   Amount          (6,1)  header 61, 1000000 drops encoded   → 61 40000000000F4240
  //   Fee             (6,8)  header 68, 12 drops encoded        → 68 400000000000000C
  //   SigningPubKey   (7,3)  header 73, VLEN 0 (empty-pubkey form) → 73 00
  //   Account         (8,1)  header 81, VLEN 20, bytes 00..13   → 81 14 0001…13
  //   Destination     (8,3)  header 83, VLEN 20, bytes 14..27   → 83 14 1415…27
  // (The empty-SigningPubKey serialization is a valid codec form — it
  // is the multi-signing placeholder. The engine's own signing form
  // carries the real pubkey instead; see the sign/verify test, whose
  // byte shape was cross-checked against ripple-binary-codec's
  // encodeForSigning: prefix 53545800 ‖ … 73 21 <33-byte pubkey> … .)
  const accountId = unhex('000102030405060708090a0b0c0d0e0f10111213');
  const destinationId = unhex('1415161718191a1b1c1d1e1f2021222324252627');
  const signingForm = serializePayment({
    accountId,
    destinationId,
    amountDrops: 1000000n,
    feeDrops: 12n,
    sequence: 1,
    destinationTag: 0x12345678,
    signingPubKey: new Uint8Array(0),
  });
  assert.equal(
    hex(signingForm),
    '120000' +
      '2280000000' +
      '2400000001' +
      '2e12345678' +
      '6140000000000f4240' +
      '68400000000000000c' +
      '7300' +
      '8114000102030405060708090a0b0c0d0e0f10111213' +
      '83141415161718191a1b1c1d1e1f2021222324252627',
  );
  // Default flags are tfFullyCanonicalSig.
  assert.equal(TF_FULLY_CANONICAL_SIG, 0x80000000);
});

test('xrp: sign/verify roundtrip over the sha512half signing hash', () => {
  const secret = deriveAccountSecret(new Uint8Array(32).fill(0x42), 'xrp', 0);
  const pub = publicKeyFromSecret('xrp', secret);
  const tx = {
    accountId: accountIdFromPublicKey(pub),
    destinationId: accountIdFromAddress('r4BPgS7DHebQiU31xWELvZawwSG2fSPJ7C'),
    amountDrops: 1000000n,
    feeDrops: 12n,
    sequence: 3,
    lastLedgerSequence: 1000,
    // The signing form carries the REAL SigningPubKey (a signing
    // field); only TxnSignature is excluded. Cross-checked byte-for-
    // byte against ripple-binary-codec encodeForSigning.
    signingPubKey: pub,
  };
  const signingData = serializePayment(tx);
  // The sign hash binds the "STX\0" prefix (0x53545800): a signature over
  // the raw serialization (no prefix) must NOT verify against it.
  const signHash = paymentSigningHash(signingData);
  assert.equal(signHash.length, 32);
  const compact = secp256k1.sign(signHash, secret, { prehash: false });
  assert.equal(secp256k1.verify(compact, signHash, pub, { prehash: false }), true);
  const der = ecdsaDerEncode(compact.slice(0, 32), compact.slice(32, 64));
  const compactFromDer = secp256k1.Signature.fromBytes(der, 'der').toBytes('compact');
  assert.deepEqual(compactFromDer, compact);
  assert.equal(secp256k1.verify(compactFromDer, signHash, pub, { prehash: false }), true);
  // Low-S (canonical) — s must be in the lower half of the curve order.
  const s = BigInt('0x' + hex(compact.slice(32, 64)));
  const HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
  assert.ok(s <= HALF_N, 'signature must be low-S');
  // Tampering with any amount bit invalidates the signature.
  const tampered = serializePayment({ ...tx, amountDrops: 1000001n });
  assert.equal(
    secp256k1.verify(compact, paymentSigningHash(tampered), pub, { prehash: false }),
    false,
  );
  // TX id: 64 uppercase hex chars, deterministic for a given blob.
  const blob = serializePayment({ ...tx, signingPubKey: pub, txnSignature: der });
  assert.match(computeTxId(blob), /^[0-9A-F]{64}$/);
  assert.equal(computeTxId(blob), computeTxId(blob.slice()));
});

// ------------------------------------------------------------ stub client

const FROM_SECRET = deriveAccountSecret(new Uint8Array(32).fill(0x42), 'xrp', 0);
const FROM = deriveAddress(FROM_SECRET);
const TO = deriveAddress(SECRET_ONE);
const NEW_DEST = deriveAddress(new Uint8Array(32).fill(0x07));

/** Canned rippled answers keyed by method (+ account for account_info). */
function makeStubFetch({ submitResult, txResult, feeFails = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const { method, params } = body;
    const p = params[0] ?? {};
    const respond = (result) => ({ ok: true, status: 200, json: async () => ({ result }) });
    switch (method) {
      case 'server_info':
        return respond({
          status: 'success',
          info: {
            validated_ledger: { reserve_base_xrp: 1, reserve_inc_xrp: 0.2, seq: 1000 },
          },
        });
      case 'fee':
        if (feeFails) throw Error('fee endpoint down');
        return respond({ status: 'success', drops: { base_fee: '10' } });
      case 'account_info': {
        if (p.account === FROM) {
          return respond({
            status: 'success',
            account_data: { Account: FROM, Balance: '5000000', Sequence: 7 },
            validated: true,
          });
        }
        if (p.account === TO) {
          return respond({
            status: 'success',
            account_data: { Account: TO, Balance: '2000000', Sequence: 0 },
            validated: true,
          });
        }
        return respond({ status: 'error', error: 'actNotFound', account_id: p.account });
      }
      case 'submit':
        return respond(
          submitResult ?? {
            status: 'success',
            engine_result: 'tesSUCCESS',
            engine_result_message: 'The transaction was applied.',
          },
        );
      case 'tx':
        return respond(txResult ?? { status: 'success', validated: false });
      default:
        throw Error(`unexpected method ${method}`);
    }
  };
  return { fetchImpl, calls };
}

/** Minimal positional decoder for our own serializer output (tests only). */
function parsePaymentBlob(blob) {
  const out = new Map();
  let i = 0;
  while (i < blob.length) {
    let t = blob[i] >> 4;
    let f = blob[i] & 0x0f;
    i++;
    if (f === 0) f = blob[i++];
    else if (t === 0) {
      t = blob[i++];
      if (f === 0) f = blob[i++];
    }
    let value;
    if (t === 1) {
      value = blob.slice(i, i + 2);
      i += 2;
    } else if (t === 2) {
      value = blob.slice(i, i + 4);
      i += 4;
    } else if (t === 6) {
      value = blob.slice(i, i + 8);
      i += 8;
    } else {
      // VLEN: only 1-byte lengths occur in these test blobs (≤ 72 bytes).
      const len = blob[i++];
      assert.ok(len < 193, 'test parser handles 1-byte VLEN only');
      value = blob.slice(i, i + len);
      i += len;
    }
    out.set(`${t}:${f}`, value);
  }
  return out;
}

const dropsFromAmountBytes = (bytes) => {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v & ((1n << 62n) - 1n); // clear the positive/native bits
};

test('xrp client: connection, balance, reserve (stub)', async () => {
  const { fetchImpl } = makeStubFetch();
  const client = createXrpClient('https://stub.invalid:51234', { fetchImpl });
  assert.equal(await client.checkConnection(), true);
  assert.equal(await client.getBalance(FROM), 5000000n);
  assert.equal(await client.getBalance(NEW_DEST), 0n); // actNotFound → 0
  assert.deepEqual(await client.getReserveInfo(), { baseReserveDrops: 1000000n });
});

test('xrp client: prepareSend plan fields + fee fallback (stub)', async () => {
  const { fetchImpl } = makeStubFetch();
  const client = createXrpClient('https://stub.invalid:51234', { fetchImpl });
  const plan = await client.prepareSend({ from: FROM, to: TO, amount: 1000000n });
  assert.equal(plan.fee, 10n);
  assert.equal(plan.balance, 5000000n);
  assert.equal(plan.sequence, 7);
  assert.equal(plan.baseReserveDrops, 1000000n);
  assert.equal(plan.destinationExists, true);
  assert.equal(plan.lastLedgerSequence, 1020); // validated seq 1000 + 20
  // spendable = balance − base reserve − fee
  assert.equal(plan.spendable, 5000000n - 1000000n - 10n);

  const fallback = makeStubFetch({ feeFails: true });
  const client2 = createXrpClient('https://stub.invalid:51234', { fetchImpl: fallback.fetchImpl });
  const plan2 = await client2.prepareSend({ from: FROM, to: TO, amount: 1000000n });
  assert.equal(plan2.fee, 12n); // documented fallback
});

test('xrp client: unfunded destination below reserve throws before any submit (stub)', async () => {
  const { fetchImpl, calls } = makeStubFetch();
  const client = createXrpClient('https://stub.invalid:51234', { fetchImpl });
  await assert.rejects(
    client.prepareSend({ from: FROM, to: NEW_DEST, amount: 999999n }),
    /XRP new account requires at least the base reserve/,
  );
  assert.equal(calls.filter((c) => c.method === 'submit').length, 0);
  // Exactly the reserve is enough to fund a new account.
  const plan = await client.prepareSend({ from: FROM, to: NEW_DEST, amount: 1000000n });
  assert.equal(plan.destinationExists, false);
});

test('xrp client: executeSend submits a parseable, verifiable blob (stub)', async () => {
  const { fetchImpl, calls } = makeStubFetch();
  const client = createXrpClient('https://stub.invalid:51234', { fetchImpl });
  const plan = await client.prepareSend({
    from: FROM,
    to: TO,
    amount: 1500000n,
    opts: { destinationTag: 424242 },
  });
  const { hash, engineResult } = await client.executeSend(plan, FROM_SECRET);
  assert.equal(engineResult, 'tesSUCCESS');
  assert.match(hash, /^[0-9A-F]{64}$/);

  const submit = calls.find((c) => c.method === 'submit');
  const blob = unhex(submit.params[0].tx_blob);
  assert.equal(computeTxId(blob), hash); // submitted blob hashes to the returned id
  const fields = parsePaymentBlob(blob);
  const u32 = (b) => new DataView(b.buffer, b.byteOffset).getUint32(0, false);
  const u16 = (b) => new DataView(b.buffer, b.byteOffset).getUint16(0, false);
  assert.equal(u16(fields.get('1:2')), 0); // TransactionType = Payment (UInt16)
  assert.equal(u32(fields.get('2:2')), 0x80000000); // Flags = tfFullyCanonicalSig
  assert.equal(u32(fields.get('2:4')), 7); // Sequence from account_info
  assert.equal(u32(fields.get('2:14')), 424242); // DestinationTag
  assert.equal(u32(fields.get('2:27')), 1020); // LastLedgerSequence
  assert.equal(dropsFromAmountBytes(fields.get('6:1')), 1500000n); // Amount
  assert.equal(dropsFromAmountBytes(fields.get('6:8')), 10n); // Fee
  assert.deepEqual(fields.get('7:3'), publicKeyFromSecret('xrp', FROM_SECRET)); // SigningPubKey
  assert.deepEqual(fields.get('8:1'), accountIdFromAddress(FROM)); // Account
  assert.deepEqual(fields.get('8:3'), accountIdFromAddress(TO)); // Destination

  // The embedded DER signature verifies against the signing hash of
  // the same transaction in signing form (real SigningPubKey, no
  // TxnSignature).
  const pub = publicKeyFromSecret('xrp', FROM_SECRET);
  const signingData = serializePayment({
    accountId: accountIdFromAddress(FROM),
    destinationId: accountIdFromAddress(TO),
    amountDrops: 1500000n,
    feeDrops: 10n,
    sequence: 7,
    destinationTag: 424242,
    lastLedgerSequence: 1020,
    signingPubKey: pub,
  });
  const compact = secp256k1.Signature.fromBytes(fields.get('7:4'), 'der').toBytes('compact');
  assert.equal(
    secp256k1.verify(compact, paymentSigningHash(signingData), pub, { prehash: false }),
    true,
  );
});

test('xrp client: tem* submit results throw with the ledger message (stub)', async () => {
  const { fetchImpl } = makeStubFetch({
    submitResult: {
      status: 'success',
      engine_result: 'temMALFORMED',
      engine_result_message: 'Malformed transaction.',
    },
  });
  const client = createXrpClient('https://stub.invalid:51234', { fetchImpl });
  const plan = {
    from: FROM,
    to: TO,
    amount: 1000000n,
    fee: 12n,
    sequence: 7,
    lastLedgerSequence: 1020,
    destinationTag: undefined,
  };
  await assert.rejects(client.executeSend(plan, FROM_SECRET), /Malformed transaction\./);
});

test('xrp client: getTxStatus mapping (stub)', async () => {
  const mk = (txResult) =>
    createXrpClient('https://stub.invalid:51234', { fetchImpl: makeStubFetch({ txResult }).fetchImpl });
  const hash = 'A'.repeat(64);
  assert.equal(
    await mk({ status: 'success', validated: true, meta: { TransactionResult: 'tesSUCCESS' } }).getTxStatus(hash),
    'success',
  );
  assert.equal(
    await mk({ status: 'success', validated: true, meta: { TransactionResult: 'tecUNFUNDED_PAYMENT' } }).getTxStatus(hash),
    'failed',
  );
  assert.equal(await mk({ status: 'success', validated: false }).getTxStatus(hash), 'pending');
  assert.equal(
    await mk({ status: 'error', error: 'txnNotFound', error_message: 'Transaction not found.' }).getTxStatus(hash),
    'pending',
  );
});
