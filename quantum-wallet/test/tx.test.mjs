// Phase 2 known-answer tests for the three transaction engines.
//
// Cross-checks against PortE2ETool (the chain's Java reference tool,
// ~/workspace/besu-2611-recon/e2e) using the Phase 0 test vector fields:
//   nonce 0, gasPrice 1 gwei, gasLimit 200000,
//   to 0x504ad114d057e8bc918958776d4cba964db70a26,
//   value 0.001 ZNYT, chainId 912701.
//
//   ECDSA  — deterministic (RFC 6979): engine raw must BYTE-MATCH the tool.
//   ML-DSA — same account on both sides: the noble expanded secretKey is
//            byte-identical to the tool's key-file format (proven in
//            Phase 1 by mldsa-sender.key == mldsa-account.txt), so the
//            tool signs for the very account the engine derives from the
//            Phase 1 seed vector. Signatures are randomized, so compare
//            decoded fields + digest + verification, not raw bytes.
//   Falcon — the tool's key file holds BouncyCastle polynomial material
//            that cannot be minted from a noble seed, so the tool signs
//            with its own account; the shared anchors are the decoded
//            fields, the Phase 0 digest constant, noble verifying the
//            tool's signature, and the chain's own Java decoder/crypto
//            verifying the ENGINE's raw tx (PqTxVerify harness).
//
// Requires the Besu recon tree (JDK 25 + tool classes + install jars).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

import { toHex, fromHex } from '../src/core/bytes.mjs';
import { rlpEncode, rlpDecode, rlpScalar, bytesToBigInt } from '../src/core/rlp.mjs';
import { INTRINSIC_GAS, transferGasLimit, callGasLimit } from '../src/core/gas.mjs';
import {
  signTransaction,
  signWithVault,
  decodeRawTransaction,
  pqSigningDigest,
  pqVerify,
} from '../src/core/tx.mjs';
import { publicKeyFromSecret } from '../src/core/crypto.mjs';
import { createVault } from '../src/core/vault.mjs';
import { memoryStorage } from '../src/core/storage.mjs';
import { createRpcClient, RpcError, quantityHex } from '../src/core/rpc.mjs';
import { VECTORS, PASSWORD } from './fixtures.mjs';

const HOME = process.env.HOME;
const RECON = path.join(HOME, 'workspace/besu-2611-recon');
const E2E = path.join(RECON, 'e2e');
const JAVA = path.join(RECON, 'work/jdk-25/bin/java');
const JAVAC = path.join(RECON, 'work/jdk-25/bin/javac');
const DIST_CP = path.join(RECON, 'src/build/install/besu/lib/*');
const TOOL_CP = `tool-classes:${path.join(RECON, 'src/build/install/besu/lib/*')}`;
const JVM = { timeout: 120000 };

const FIELDS = {
  nonce: 0n,
  gasPrice: 1000000000n,
  gasLimit: 200000n,
  to: '0x504ad114d057e8bc918958776d4cba964db70a26',
  value: 1000000000000000n,
  chainId: 912701n,
};
// Phase 0 report: the chain/noble-agreed Falcon digest for FIELDS.
const FALCON_DIGEST_KAT = '0xcb41b93249ee341a87bf453685aafd2e12a223a7b5c917184d352adbce9fd174';
const FALCON_TOOL_SENDER = '0x53d59ff2b6be683d485991761106dc695d5b4764';

const tmp = mkdtempSync(path.join(tmpdir(), 'qwallet-v2-txtest-'));
const javaClasses = path.join(tmp, 'java-classes');

function toolArgs(fields, dataHex) {
  const base = [
    String(fields.nonce),
    String(fields.gasPrice),
    String(fields.gasLimit),
    fields.to ?? '-',
    String(fields.value ?? 0n),
  ];
  return dataHex === undefined
    ? [...base, String(fields.chainId)]
    : [...base, dataHex, String(fields.chainId)];
}

function runTool(args) {
  const out = execFileSync(JAVA, ['-cp', TOOL_CP, 'PortE2ETool', ...args], {
    cwd: E2E,
    encoding: 'utf8',
    ...JVM,
  });
  const kv = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^(raw|hash|sender|address)=(\S+)$/);
    if (m) kv[m[1]] = m[2];
  }
  return kv;
}

function javaVerify(rawTx) {
  const file = path.join(tmp, 'raw.txt');
  writeFileSync(file, rawTx);
  const out = execFileSync(
    JAVA,
    ['-cp', `${javaClasses}:${DIST_CP}`, 'org.hyperledger.besu.ethereum.core.PqTxVerify', file],
    { encoding: 'utf8', ...JVM },
  );
  const kv = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([a-zA-Z]+)=(.*)$/);
    if (m) kv[m[1]] = m[2];
  }
  return kv;
}

function assertFieldsMatch(decoded, fields, scheme) {
  assert.equal(decoded.scheme, scheme);
  assert.equal(decoded.nonce, fields.nonce);
  assert.equal(decoded.gasPrice, fields.gasPrice);
  assert.equal(decoded.gasLimit, fields.gasLimit);
  assert.equal(decoded.to, fields.to ?? null);
  assert.equal(decoded.value, fields.value ?? 0n);
  assert.equal(decoded.chainId, fields.chainId);
  const wantData = fields.data ?? '0x';
  assert.equal(toHex(decoded.data), typeof wantData === 'string' ? wantData : toHex(wantData));
}

before(() => {
  execFileSync(
    JAVAC,
    ['-cp', DIST_CP, '-d', javaClasses, path.join('test', 'java', 'PqTxVerify.java')],
    { cwd: path.join(HOME, 'workspace/qwallet-v2'), encoding: 'utf8', ...JVM },
  );
});

// --------------------------------------------------------------------- RLP

test('rlp: canonical known answers + round-trip', () => {
  assert.equal(toHex(rlpScalar(0n)), '0x80');
  assert.equal(toHex(rlpScalar(15n)), '0x0f');
  assert.equal(toHex(rlpScalar(1024n)), '0x820400');
  assert.equal(toHex(rlpEncode(new TextEncoder().encode('dog'))), '0x83646f67');
  assert.equal(toHex(rlpEncode([])), '0xc0');
  const nested = rlpEncode([[], [[]], [[], [[]]]]);
  assert.equal(toHex(nested), '0xc7c0c1c0c3c0c1c0');
  const decoded = rlpDecode(fromHex('0xc7c0c1c0c3c0c1c0'));
  assert.equal(decoded.length, 3);
  assert.equal(bytesToBigInt(rlpDecode(fromHex('0x820400'))), 1024n);
  assert.throws(() => rlpDecode(fromHex('0x82040000')), /trailing/);
});

// --------------------------------------------------------------------- gas

test('gas: intrinsic floors and surcharge policy match PqIntrinsicGas', () => {
  assert.equal(INTRINSIC_GAS.ecdsa, 21000n);
  assert.equal(INTRINSIC_GAS.falcon, 103080n);
  assert.equal(INTRINSIC_GAS.mldsa, 147176n);
  assert.equal(transferGasLimit('falcon'), 103080n);
  assert.equal(callGasLimit('ecdsa', 50000n), 50000n);
  assert.equal(callGasLimit('falcon', 50000n), 132080n);
  assert.equal(callGasLimit('mldsa', 50000n), 176176n);
  assert.throws(() => callGasLimit('nope', 1n), /Unknown scheme/);
});

// ------------------------------------------------------------------- ECDSA

test('ecdsa: engine raw byte-matches PortE2ETool (deterministic EIP-155)', () => {
  const keyFile = path.join(tmp, 'ecdsa.key');
  writeFileSync(keyFile, toHex(VECTORS.ecdsa.secret) + '\n');
  const tool = runTool(['sign-ecdsa', keyFile, ...toolArgs(FIELDS)]);
  assert.equal(tool.sender, VECTORS.ecdsa.address);

  const mine = signTransaction({ scheme: 'ecdsa', secret: VECTORS.ecdsa.secret, ...FIELDS });
  assert.equal(mine.from, VECTORS.ecdsa.address);
  assert.equal(mine.rawTx, tool.raw, 'raw tx must be byte-identical');
  assert.equal(mine.txHash, tool.hash);

  const decoded = decodeRawTransaction(tool.raw);
  assertFieldsMatch(decoded, FIELDS, 'ecdsa');
  assert.equal(decoded.from, VECTORS.ecdsa.address, 'sender recovered from v/r/s');
});

// ------------------------------------------------------------------ ML-DSA

test('mldsa: same-account cross-check vs PortE2ETool + chain-side Java verify', () => {
  // Bridge: noble expanded secretKey == the tool key-file format.
  const kp = ml_dsa65.keygen(VECTORS.mldsa.secret);
  const keyFile = path.join(tmp, 'mldsa.key');
  writeFileSync(keyFile, `${toHex(kp.secretKey)}\n${toHex(kp.publicKey)}\n`);
  const tool = runTool(['sign-mldsa', keyFile, ...toolArgs(FIELDS)]);
  assert.equal(tool.sender, VECTORS.mldsa.address, 'tool signs for the engine account');

  const mine = signTransaction({ scheme: 'mldsa', secret: VECTORS.mldsa.secret, ...FIELDS });
  assert.equal(mine.from, VECTORS.mldsa.address);

  const toolDecoded = decodeRawTransaction(tool.raw);
  assertFieldsMatch(toolDecoded, FIELDS, 'mldsa');
  const myDecoded = decodeRawTransaction(mine.rawTx);
  assertFieldsMatch(myDecoded, FIELDS, 'mldsa');
  assert.equal(myDecoded.publicKey.length, 1952);
  assert.equal(myDecoded.signature.length, 3309);
  assert.equal(toHex(myDecoded.publicKey), toHex(toolDecoded.publicKey));

  // One digest, agreed three ways: engine, tool-tx fields, chain Java code.
  const digest = pqSigningDigest('mldsa', FIELDS);
  const jv = javaVerify(mine.rawTx);
  assert.equal(jv.javaVerify, 'true');
  assert.equal(jv.digest, toHex(digest), 'chain-rebuilt digest == engine digest');
  assert.equal(jv.derivedAddress, VECTORS.mldsa.address);
  assert.equal(jv.txSender, VECTORS.mldsa.address);
  assert.equal(jv.txHash, mine.txHash);

  // Both implementations' signatures verify under noble over that digest.
  assert.equal(pqVerify('mldsa', digest, toolDecoded.signature, toolDecoded.publicKey), true);
  assert.equal(pqVerify('mldsa', digest, myDecoded.signature, myDecoded.publicKey), true);
});

// ------------------------------------------------------------------ Falcon

test('falcon: digest KAT + tool cross-check + chain-side Java verify of engine tx', () => {
  // The Phase 0 constant anchors the exact digest construction.
  assert.equal(toHex(pqSigningDigest('falcon', FIELDS)), FALCON_DIGEST_KAT);

  const tool = runTool([
    'sign-falcon',
    path.join(E2E, 'falcon-sender.key.acct'),
    ...toolArgs(FIELDS),
  ]);
  assert.equal(tool.sender, FALCON_TOOL_SENDER);
  const toolDecoded = decodeRawTransaction(tool.raw);
  assertFieldsMatch(toolDecoded, FIELDS, 'falcon');
  assert.equal(toolDecoded.publicKey.length, 1793);
  assert.ok(toolDecoded.signature.length <= 2048, 'signature within chain cap');
  assert.equal(toolDecoded.signature[0], 0x3a, 'round-3 signature header');
  assert.equal(
    pqVerify('falcon', fromHex(FALCON_DIGEST_KAT), toolDecoded.signature, toolDecoded.publicKey),
    true,
    'noble verifies the BouncyCastle signature over the shared digest',
  );

  const mine = signTransaction({ scheme: 'falcon', secret: VECTORS.falcon.secret, ...FIELDS });
  assert.equal(mine.from, VECTORS.falcon.address);
  const myDecoded = decodeRawTransaction(mine.rawTx);
  assertFieldsMatch(myDecoded, FIELDS, 'falcon');
  assert.equal(myDecoded.publicKey.length, 1793);
  assert.equal(myDecoded.publicKey[0], 0x0a);

  const jv = javaVerify(mine.rawTx);
  assert.equal(jv.javaVerify, 'true', 'chain crypto verifies the engine signature');
  assert.equal(jv.digest, FALCON_DIGEST_KAT);
  assert.equal(jv.derivedAddress, VECTORS.falcon.address);
  assert.equal(jv.txSender, VECTORS.falcon.address);
  assert.equal(jv.txHash, mine.txHash);
});

// ------------------------------------------------------------- call variants

const CALL_FIELDS = {
  nonce: 3n,
  gasPrice: 1000000000n,
  gasLimit: 200000n,
  to: '0x1111111111111111111111111111111111111111',
  value: 0n,
  data: '0x6057361d000000000000000000000000000000000000000000000000000000000000002a',
  chainId: 912701n,
};

test('mldsa call: calldata tx cross-check vs sign-call-mldsa', () => {
  const kp = ml_dsa65.keygen(VECTORS.mldsa.secret);
  const keyFile = path.join(tmp, 'mldsa.key');
  writeFileSync(keyFile, `${toHex(kp.secretKey)}\n${toHex(kp.publicKey)}\n`);
  const tool = runTool(['sign-call-mldsa', keyFile, ...toolArgs(CALL_FIELDS, CALL_FIELDS.data)]);
  const toolDecoded = decodeRawTransaction(tool.raw);
  assertFieldsMatch(toolDecoded, CALL_FIELDS, 'mldsa');

  const mine = signTransaction({ scheme: 'mldsa', secret: VECTORS.mldsa.secret, ...CALL_FIELDS });
  const jv = javaVerify(mine.rawTx);
  assert.equal(jv.javaVerify, 'true');
  assert.equal(jv.digest, toHex(pqSigningDigest('mldsa', CALL_FIELDS)));
  assert.equal(Number(jv.dataLength), 36);
});

test('falcon creation: to=null cross-check vs sign-call-falcon "-"', () => {
  const createFields = { ...CALL_FIELDS, to: null, data: '0x60006000f3' };
  const tool = runTool([
    'sign-call-falcon',
    path.join(E2E, 'falcon-sender.key.acct'),
    ...toolArgs(createFields, createFields.data),
  ]);
  const toolDecoded = decodeRawTransaction(tool.raw);
  assertFieldsMatch(toolDecoded, createFields, 'falcon');
  assert.equal(toolDecoded.to, null);

  const mine = signTransaction({ scheme: 'falcon', secret: VECTORS.falcon.secret, ...createFields });
  const myDecoded = decodeRawTransaction(mine.rawTx);
  assert.equal(myDecoded.to, null);
  const jv = javaVerify(mine.rawTx);
  assert.equal(jv.javaVerify, 'true');
  assert.equal(jv.digest, toHex(pqSigningDigest('falcon', createFields)));
  assert.equal(jv.to, 'null', 'chain decoder also sees a creation tx');
});

// -------------------------------------------------------------------- vault

test('vault: signWithVault matches raw-secret signing; PQ output verifies', async () => {
  const storage = memoryStorage();
  const vault = await createVault(storage, PASSWORD);
  const ids = {};
  for (const scheme of ['ecdsa', 'falcon', 'mldsa']) {
    ids[scheme] = (await vault.addAccount(scheme, { secret: VECTORS[scheme].secret })).id;
  }
  const viaVault = signWithVault(vault, ids.ecdsa, FIELDS);
  const direct = signTransaction({ scheme: 'ecdsa', secret: VECTORS.ecdsa.secret, ...FIELDS });
  assert.equal(viaVault.rawTx, direct.rawTx, 'deterministic ECDSA identical via vault');

  for (const scheme of ['falcon', 'mldsa']) {
    const signed = signWithVault(vault, ids[scheme], FIELDS);
    assert.equal(signed.from, VECTORS[scheme].address);
    const decoded = decodeRawTransaction(signed.rawTx);
    assert.equal(
      pqVerify(scheme, pqSigningDigest(scheme, FIELDS), decoded.signature, decoded.publicKey),
      true,
    );
    assert.equal(signed.txHash, toHex(keccak_256(fromHex(signed.rawTx))));
  }
  assert.throws(() => signWithVault(vault, 'missing-id', FIELDS), /No such account/);
});

// ---------------------------------------------------------------------- rpc

test('rpc: client parses quantities and surfaces node errors', async () => {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { method, id } = JSON.parse(body);
      const reply = (obj) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id, ...obj }));
      };
      if (method === 'eth_getBalance') return reply({ result: '0xde0b6b3a7640000' });
      if (method === 'eth_getTransactionCount') return reply({ result: '0x2a' });
      if (method === 'eth_estimateGas') return reply({ result: quantityHex(43210n) });
      if (method === 'eth_sendRawTransaction')
        return reply({ error: { code: -32004, message: 'Nonce too low' } });
      return reply({ error: { code: -32601, message: 'unknown method' } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const rpc = createRpcClient(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await rpc.getBalance(VECTORS.ecdsa.address), 1000000000000000000n);
    assert.equal(await rpc.getTransactionCount(VECTORS.ecdsa.address), 42);
    assert.equal(await rpc.estimateGas({ from: VECTORS.ecdsa.address, to: FIELDS.to, data: '0x' }), 43210n);
    await assert.rejects(
      () => rpc.sendRawTransaction('0x7f00'),
      (e) => e instanceof RpcError && e.code === -32004 && /Nonce too low/.test(e.message),
    );
  } finally {
    server.close();
  }
});
