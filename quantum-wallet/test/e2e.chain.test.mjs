// Phase 2 live test-chain E2E.
//
// Boots a single-validator Falcon QBFT chain (chainId 912772, same pattern
// as the Phase 0 / e2e harness chains, pqTxActivationBlock = 5) running
// the ported Besu binary, genesis-funds the three engine accounts derived
// from the Phase 1 fixed seed vectors, and then drives EVERYTHING through
// the v2 modules only (crypto / tx / gas / rpc):
//
//   falcon  : contract creation (nonce 0)
//   falcon  : plain transfer      -> gasUsed EXACTLY 103,080
//   mldsa   : plain transfer      -> gasUsed EXACTLY 147,176
//   ecdsa   : plain transfer      -> gasUsed EXACTLY  21,000
//   falcon  : contract store(42)  -> status 0x1, retrieve() == 42
//   mldsa   : contract store(43)  -> status 0x1, retrieve() == 43
//   replay  : resubmitting the mined ML-DSA transfer is rejected
//             ("Nonce too low") and the sender nonce does not move.
//
// Evidence is written to evidence/phase2-e2e.json (and the genesis to
// evidence/phase2-genesis.json) whether the run passes or fails.
// Set QWALLET_KEEP_CHAIN=1 to keep the chain data dir for debugging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  openSync,
  closeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { keccak_256 } from '@noble/hashes/sha3.js';

import { toHex, fromHex } from '../src/core/bytes.mjs';
import { rlpEncode } from '../src/core/rlp.mjs';
import { addressFromSecret } from '../src/core/crypto.mjs';
import { signTransaction } from '../src/core/tx.mjs';
import { transferGasLimit, callGasLimit } from '../src/core/gas.mjs';
import { createRpcClient, quantityHex } from '../src/core/rpc.mjs';
import { VECTORS } from './fixtures.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECON = path.join(process.env.HOME, 'workspace/besu-2611-recon');
const JDK = path.join(RECON, 'work/jdk-25');
const DIST = path.join(RECON, 'src/build/install/besu');
const CHAIN_ID = 912772;
const ACTIVATION = 5;
const RPC_PORT = 19623;
const P2P_PORT = 41423;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const GAS_PRICE = 1000000000n;
const FUND = '0x33b2e3c9fd0803ce8000000';

// The old harness's hand-built SimpleStorage (run_e2e_port.py, phase B7):
// store(uint256) = 0x6057361d, retrieve() = 0x2e64cec1.
const RUNTIME =
  '60003560e01c80636057361d14601f5780632e64cec11460275760006000fd' +
  '5b600435600055005b60005460005260206000f3';
const INIT_CODE = '0x6033600c60003960336000f3' + RUNTIME;
const storeCalldata = (v) => '0x6057361d' + v.toString(16).padStart(64, '0');
const RETRIEVE = '0x2e64cec1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('e2e: three engines against a live 912772 test chain', { timeout: 600000 }, async () => {
  const rpc = createRpcClient(RPC_URL);
  const evidence = {
    chainId: CHAIN_ID,
    activationBlock: ACTIVATION,
    rpc: RPC_URL,
    steps: [],
    startedAt: new Date().toISOString(),
  };
  const chainDir = mkdtempSync(path.join(tmpdir(), 'qwallet-v2-chain-'));
  const dataDir = path.join(chainDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  let node = null;
  let logTail = '';

  const addresses = {
    ecdsa: addressFromSecret('ecdsa', VECTORS.ecdsa.secret),
    falcon: addressFromSecret('falcon', VECTORS.falcon.secret),
    mldsa: addressFromSecret('mldsa', VECTORS.mldsa.secret),
  };
  evidence.accounts = addresses;

  async function waitReceipt(hash, label) {
    for (let i = 0; i < 90; i++) {
      const receipt = await rpc.getTransactionReceipt(hash);
      if (receipt) return receipt;
      await sleep(1000);
    }
    throw Error(`no receipt for ${label} (${hash}) within 90 s`);
  }

  async function sendAndRecord(step, signed) {
    const hash = await rpc.sendRawTransaction(signed.rawTx);
    assert.equal(hash, signed.txHash, `${step.name}: node hash == engine hash`);
    const receipt = await waitReceipt(hash, step.name);
    const record = {
      ...step,
      hash,
      from: signed.from,
      blockNumber: Number(BigInt(receipt.blockNumber)),
      status: receipt.status,
      gasUsed: Number(BigInt(receipt.gasUsed)),
    };
    if (receipt.contractAddress) record.contractAddress = receipt.contractAddress;
    evidence.steps.push(record);
    return record;
  }

  try {
    // ------------------------------------------------------------ bootstrap
    const env = {
      ...process.env,
      JAVA_HOME: JDK,
      PATH: `${path.join(JDK, 'bin')}:${process.env.PATH}`,
    };
    const valKey = path.join(dataDir, 'falcon1024.key');
    execFileSync(
      path.join(JDK, 'bin/java'),
      ['-cp', path.join(DIST, 'lib/*'), 'org.hyperledger.besu.crypto.Falcon1024KeyFile', 'generate', valKey],
      { env, encoding: 'utf8' },
    );
    const info = execFileSync(
      path.join(JDK, 'bin/java'),
      ['-cp', path.join(DIST, 'lib/*'), 'org.hyperledger.besu.crypto.Falcon1024KeyFile', 'info', valKey],
      { env, encoding: 'utf8' },
    );
    const validator = info.split('\n').find((l) => l.startsWith('address=')).split('=')[1];
    evidence.validator = validator;

    const extraData =
      '0x' +
      Buffer.from(
        rlpEncode([
          new Uint8Array(32),
          [fromHex(validator)],
          [],
          0n,
          [],
        ]),
      ).toString('hex');
    const alloc = {};
    for (const a of Object.values(addresses)) alloc[a.slice(2)] = { balance: FUND };
    const genesis = {
      config: {
        chainId: CHAIN_ID,
        berlinBlock: 0,
        londonBlock: 0,
        shanghaiTime: 0,
        zeroBaseFee: true,
        pqTxActivationBlock: ACTIVATION,
        qbft: {
          blockperiodseconds: 3,
          epochlength: 30000,
          requesttimeoutseconds: 10,
          falcon1024: true,
        },
      },
      nonce: '0x0',
      timestamp: '0x0',
      gasLimit: '0x1c9c380',
      difficulty: '0x1',
      mixHash: '0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365',
      coinbase: '0x0000000000000000000000000000000000000000',
      alloc,
      extraData,
    };
    const genesisPath = path.join(chainDir, 'genesis.json');
    writeFileSync(genesisPath, JSON.stringify(genesis, null, 1));
    mkdirSync(path.join(REPO, 'evidence'), { recursive: true });
    writeFileSync(path.join(REPO, 'evidence/phase2-genesis.json'), JSON.stringify(genesis, null, 1));

    const logFd = openSync(path.join(chainDir, 'node.log'), 'w');
    node = spawn(
      path.join(DIST, 'bin/besu'),
      [
        `--genesis-file=${genesisPath}`,
        `--network-id=${CHAIN_ID}`,
        `--data-path=${dataDir}`,
        '--discovery-enabled=false',
        '--nat-method=NONE',
        '--p2p-host=127.0.0.1',
        `--p2p-port=${P2P_PORT}`,
        '--rpc-http-enabled',
        '--rpc-http-host=127.0.0.1',
        `--rpc-http-port=${RPC_PORT}`,
        '--rpc-http-api=ETH,NET,QBFT,ADMIN,TXPOOL,WEB3',
        '--host-allowlist=localhost,127.0.0.1',
        '--min-gas-price=0',
        '--sync-mode=FULL',
      ],
      { env: { ...env, BESU_FALCON1024_KEY_FILE: valKey }, stdio: ['ignore', logFd, logFd] },
    );
    closeSync(logFd);

    // Wait for RPC, then for the PQ activation block.
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try {
        await rpc.blockNumber();
        up = true;
      } catch {
        if (node.exitCode !== null) throw Error(`besu exited early rc=${node.exitCode}`);
        await sleep(2000);
      }
    }
    assert.ok(up, 'RPC came up');
    for (let i = 0; i < 90; i++) {
      if ((await rpc.blockNumber()) >= ACTIVATION) break;
      await sleep(2000);
    }
    const head = await rpc.blockNumber();
    assert.ok(head >= ACTIVATION, `activation reached (head ${head})`);
    evidence.headAtStart = head;

    const base = { gasPrice: GAS_PRICE, chainId: CHAIN_ID };
    const value = 1000000000000000n; // 0.001 ZNYT

    // ------------------------------------------- falcon: contract creation
    const createSigned = signTransaction({
      scheme: 'falcon',
      secret: VECTORS.falcon.secret,
      ...base,
      nonce: await rpc.getTransactionCount(addresses.falcon),
      gasLimit: 500000n,
      to: null,
      value: 0n,
      data: INIT_CODE,
    });
    const createRec = await sendAndRecord(
      { name: 'falcon-create-contract', scheme: 'falcon', kind: 'create' },
      createSigned,
    );
    assert.equal(createRec.status, '0x1');
    const contract = createRec.contractAddress;
    assert.ok(contract, 'contract address in receipt');
    const expectedContract = toHex(
      keccak_256(rlpEncode([fromHex(addresses.falcon), 0n])).slice(12),
    );
    assert.equal(contract.toLowerCase(), expectedContract, 'contract address = keccak(rlp([sender, 0]))[12:]');
    assert.equal(await rpc.getCode(contract), '0x' + RUNTIME);
    evidence.contract = contract;

    // -------------------------------------------- plain transfers, exact gas
    const mldsaBefore = await rpc.getBalance(addresses.mldsa);
    const falconTransfer = await sendAndRecord(
      { name: 'falcon-transfer', scheme: 'falcon', kind: 'transfer' },
      signTransaction({
        scheme: 'falcon',
        secret: VECTORS.falcon.secret,
        ...base,
        nonce: await rpc.getTransactionCount(addresses.falcon),
        gasLimit: transferGasLimit('falcon'),
        to: addresses.mldsa,
        value,
      }),
    );
    assert.equal(falconTransfer.status, '0x1');
    assert.equal(falconTransfer.gasUsed, 103080, 'falcon transfer gasUsed EXACT');
    assert.equal((await rpc.getBalance(addresses.mldsa)) - mldsaBefore, value);

    const mldsaTransferSigned = signTransaction({
      scheme: 'mldsa',
      secret: VECTORS.mldsa.secret,
      ...base,
      nonce: await rpc.getTransactionCount(addresses.mldsa),
      gasLimit: transferGasLimit('mldsa'),
      to: addresses.ecdsa,
      value,
    });
    const mldsaTransfer = await sendAndRecord(
      { name: 'mldsa-transfer', scheme: 'mldsa', kind: 'transfer' },
      mldsaTransferSigned,
    );
    assert.equal(mldsaTransfer.status, '0x1');
    assert.equal(mldsaTransfer.gasUsed, 147176, 'mldsa transfer gasUsed EXACT');

    const ecdsaTransfer = await sendAndRecord(
      { name: 'ecdsa-transfer', scheme: 'ecdsa', kind: 'transfer' },
      signTransaction({
        scheme: 'ecdsa',
        secret: VECTORS.ecdsa.secret,
        ...base,
        nonce: await rpc.getTransactionCount(addresses.ecdsa),
        gasLimit: transferGasLimit('ecdsa'),
        to: addresses.falcon,
        value,
      }),
    );
    assert.equal(ecdsaTransfer.status, '0x1');
    assert.equal(ecdsaTransfer.gasUsed, 21000, 'ecdsa transfer gasUsed EXACT');

    // ------------------------------------------------------- contract calls
    async function pqCall(scheme, secret, storedValue) {
      const from = addresses[scheme];
      let estimate;
      try {
        estimate = await rpc.estimateGas({ from, to: contract, data: storeCalldata(storedValue) });
      } catch {
        estimate = 100000n; // estimator unavailable for this call; policy still applies
      }
      const gasLimit = callGasLimit(scheme, estimate);
      const rec = await sendAndRecord(
        { name: `${scheme}-call-store-${storedValue}`, scheme, kind: 'call', estimateGas: Number(estimate), gasLimit: Number(gasLimit) },
        signTransaction({
          scheme,
          secret,
          ...base,
          nonce: await rpc.getTransactionCount(from),
          gasLimit,
          to: contract,
          value: 0n,
          data: storeCalldata(storedValue),
        }),
      );
      assert.equal(rec.status, '0x1');
      const readBack = await rpc.ethCall({ to: contract, data: RETRIEVE });
      assert.equal(BigInt(readBack), BigInt(storedValue), `retrieve() == ${storedValue}`);
      return rec;
    }
    await pqCall('falcon', VECTORS.falcon.secret, 42);
    await pqCall('mldsa', VECTORS.mldsa.secret, 43);

    // --------------------------------------------------------------- replay
    const mldsaNonceBefore = await rpc.getTransactionCount(addresses.mldsa);
    let replayError = null;
    try {
      await rpc.sendRawTransaction(mldsaTransferSigned.rawTx);
    } catch (e) {
      replayError = e.message;
    }
    assert.ok(replayError, 'replayed raw tx must be rejected');
    assert.match(replayError, /nonce too low/i);
    evidence.replay = { hash: mldsaTransferSigned.txHash, error: replayError };
    assert.equal(
      await rpc.getTransactionCount(addresses.mldsa),
      mldsaNonceBefore,
      'replay did not move the sender nonce',
    );

    evidence.result = 'pass';
  } catch (e) {
    evidence.result = 'fail';
    evidence.error = String((e && e.message) || e);
    try {
      logTail = readFileSync(path.join(chainDir, 'node.log'), 'utf8').split('\n').slice(-40).join('\n');
    } catch {}
    if (logTail) evidence.nodeLogTail = logTail;
    throw e;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    mkdirSync(path.join(REPO, 'evidence'), { recursive: true });
    writeFileSync(path.join(REPO, 'evidence/phase2-e2e.json'), JSON.stringify(evidence, null, 2));
    if (node) {
      node.kill('SIGTERM');
      await Promise.race([
        new Promise((r) => node.once('exit', r)),
        sleep(20000).then(() => node.kill('SIGKILL')),
      ]);
    }
    if (!process.env.QWALLET_KEEP_CHAIN) rmSync(chainDir, { recursive: true, force: true });
  }
});
