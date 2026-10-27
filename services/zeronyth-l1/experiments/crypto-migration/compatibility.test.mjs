import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  GENESIS_KIND, generateIdentity, signTransaction, verifyTransaction, signVote, verifyVote,
} from '../../pq-native/pq.mjs';
import { ValidatorReplica, oneRoundCommit } from '../../pq-native/consensus.mjs';
import { RotationRegistry, signAuthorization } from './rotation.mjs';
const require = createRequire(new URL('../../faucet/package.json', import.meta.url));
const { Wallet, Transaction, SigningKey } = require('ethers');
const operation = { operationHash: 'ab'.repeat(32) };

for (const algorithm of ['ml-dsa-44', 'ml-dsa-65', 'ml-dsa-87']) {
  test(`${algorithm}: real OpenSSL sign/verify, tamper and key export/import`, () => {
    const { publicKey, privateKey } = generateKeyPairSync(algorithm);
    const message = Buffer.from('ZERONYTH_ISOLATED_MESSAGE_V1\0test');
    const signature = sign(null, message, privateKey);
    const expected = { 'ml-dsa-44': 2420, 'ml-dsa-65': 3309, 'ml-dsa-87': 4627 };
    assert.equal(signature.length, expected[algorithm]);
    assert.ok(verify(null, message, publicKey, signature));
    assert.equal(verify(null, Buffer.from('tampered'), publicKey, signature), false);
    const corrupt = Buffer.from(signature); corrupt[100] ^= 1;
    assert.equal(verify(null, message, publicKey, corrupt), false);
    assert.equal(verify(null, message, generateKeyPairSync(algorithm).publicKey, signature), false);
    const importedPrivate = createPrivateKey({
      key: privateKey.export({ format: 'der', type: 'pkcs8' }), format: 'der', type: 'pkcs8',
    });
    const importedPublic = createPublicKey({
      key: publicKey.export({ format: 'der', type: 'spki' }), format: 'der', type: 'spki',
    });
    assert.ok(verify(null, message, importedPublic, sign(null, message, importedPrivate)));
  });
}

test('normal EIP-155 and type-2 transactions still serialize and recover secp256k1 sender offline', async () => {
  const wallet = Wallet.createRandom();
  for (const fee of [{ type: 0, gasPrice: 1n },
    { type: 2, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n }]) {
    const raw = await wallet.signTransaction({ ...fee, chainId: 9127,
      nonce: 0, gasLimit: 21000, to: Wallet.createRandom().address, value: 1n });
    const parsed = Transaction.from(raw);
    assert.equal(parsed.from, wallet.address);
    assert.equal(parsed.chainId, 9127n);
    assert.equal(parsed.signature.serialized.length, 132);
  }
});

test('PQ transaction is NOT an Ethereum raw transaction and ECDSA is NOT silently substituted', () => {
  const sender = generateIdentity(), recipient = generateIdentity();
  const tx = signTransaction({ chainId: '19127', nonce: '0', to: recipient.address, value: '1' }, sender.privateKey);
  assert.ok(verifyTransaction(tx, '19127'));
  assert.throws(() => Transaction.from('0x' + Buffer.from(JSON.stringify(tx)).toString('hex')));
  assert.throws(() => Transaction.from({ ...tx }));
  assert.throws(() => signTransaction({ chainId: '19127', nonce: '0', to: recipient.address, value: '1' },
    generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey), /ML-DSA/);
  assert.throws(() => verifyTransaction({ ...tx,
    publicKey: generateKeyPairSync('ml-dsa-44').publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }, '19127'), /ML-DSA-65 only/);
  assert.throws(() => verifyTransaction(tx, '9127'), /Cross-chain/);
});

function replicas() {
  const validators = Array.from({ length: 4 }, generateIdentity);
  const sender = generateIdentity(), recipient = generateIdentity();
  const genesis = { kind: GENESIS_KIND, chainId: '19127',
    validators: validators.map(({ publicKey }) => ({ publicKey })),
    allocations: [{ address: sender.address, balance: '100' }] };
  const nodes = validators.map(v => new ValidatorReplica(genesis, v.privateKey));
  const tx = signTransaction({ chainId: '19127', nonce: '0', to: recipient.address, value: '7' }, sender.privateKey);
  return { nodes, tx, validators, sender, recipient };
}

test('separate four-replica PQ transfer: 3/4 valid votes commit and execute the same balances', () => {
  const f = replicas();
  const result = oneRoundCommit(f.nodes, [f.tx], { participating: [0, 1, 2] });
  assert.equal(result.votes.length, 3);
  for (const node of f.nodes) {
    assert.equal(node.ledger.balance(f.sender.address), 93n);
    assert.equal(node.ledger.balance(f.recipient.address), 7n);
    assert.equal(node.ledger.height, 1n);
    assert.throws(() => oneRoundCommit(f.nodes, [f.tx]), /nonce/i);
  }
});

test('2/4 votes cannot finalize; duplicate and forged votes cannot meet quorum', () => {
  const f = replicas();
  assert.throws(() => oneRoundCommit(f.nodes, [f.tx], { participating: [0, 1] }), /quorum/);
  assert.ok(f.nodes.every(n => n.ledger.height === 0n));
  const g = replicas();
  assert.throws(() => oneRoundCommit(g.nodes, [g.tx], { participating: [0, 0, 1] }), /Duplicate|duplicate/);
  const h = replicas();
  const leader = h.nodes.find(n => n.id === h.nodes[0].ledger.expectedProposer());
  const block = leader.propose([h.tx]);
  const votes = h.nodes.slice(0, 3).map(n => n.vote(block));
  votes[2].signature = Buffer.alloc(3309).toString('base64');
  assert.throws(() => h.nodes[0].ledger.verifyCertificate(block, votes), /Invalid ML-DSA validator vote/);
  const wrongRound = { ...block.header, round: String(BigInt(block.header.round) + 1n) };
  const vote = signVote(block.header, h.validators[0].privateKey);
  assert.throws(() => verifyVote(wrongRound, vote, h.validators[0].publicKey), /mismatch/);
});

for (const role of ['account', 'validator']) {
  for (const policy of ['pq-only', 'hybrid-and']) {
    function fixture() {
      const old = generateIdentity(), next = generateIdentity();
      const legacy = new SigningKey(Wallet.createRandom().privateKey);
      const { computeAddress } = require('ethers');
      const registry = new RotationRegistry({ publicKey: old.publicKey, role, policy,
        legacyAddress: computeAddress(legacy.publicKey) });
      const auth = (payload, key = old.privateKey, extra = {}) =>
        signAuthorization(payload, key, { legacySigner: legacy, ...extra });
      return { old, next, legacy, registry, auth };
    }

    test(`${role}/${policy}: delayed dual-proof rotation, new-key activation, old-key revocation and stable ID`, () => {
      const { old, next, registry, auth } = fixture();
      const id = registry.snapshot().account;
      const request = auth(registry.payload('rotate', { nextPublicKey: next.publicKey, activateAt: 5 }),
        old.privateKey, { nextPrivateKey: next.privateKey });
      registry.apply(request);
      assert.throws(() => registry.apply(request), /replay/);
      registry.advanceTo(4);
      const before = registry.payload('authorize', operation);
      assert.throws(() => registry.apply(auth(before, next.privateKey)), /ML-DSA signature/);
      registry.apply(auth(before));
      registry.advanceTo(5);
      const after = registry.payload('authorize', operation);
      assert.throws(() => registry.apply(auth(after)), /ML-DSA signature/);
      registry.apply(auth(after, next.privateKey));
      assert.equal(registry.snapshot().epoch, 1);
      assert.equal(registry.snapshot().publicKey, next.publicKey);
      assert.equal(registry.snapshot().account, id);
      assert.throws(() => registry.advanceTo(4), /rollback/);
    });

    test(`${role}/${policy}: invalid proofs, cross-chain/role/policy replay, past activation and overlapping rotation fail atomically`, () => {
      const { old, next, registry, auth } = fixture();
      const request = auth(registry.payload('rotate', { nextPublicKey: next.publicKey, activateAt: 5 }),
        old.privateKey, { nextPrivateKey: next.privateKey });
      for (const field of ['signature', 'nextSignature']) {
        const bad = structuredClone(request); bad[field] = Buffer.alloc(3309).toString('base64');
        assert.throws(() => registry.apply(bad), /signature/);
      }
      for (const [field, value] of [['chainId', '9127'], ['role', role === 'account' ? 'validator' : 'account'],
        ['policy', policy === 'pq-only' ? 'hybrid-and' : 'pq-only'], ['epoch', 3], ['nonce', '1']]) {
        const bad = structuredClone(request); bad.payload[field] = value;
        assert.throws(() => registry.apply(bad), /replay/);
      }
      const missing = { ...request }; delete missing.nextSignature;
      assert.throws(() => registry.apply(missing), /missing fields/);
      assert.equal(registry.snapshot().nonce, '0');
      assert.equal(registry.snapshot().pending, null);
      assert.throws(() => registry.apply(auth(registry.payload('rotate',
        { nextPublicKey: next.publicKey, activateAt: 0 }), old.privateKey,
        { nextPrivateKey: next.privateKey })), /future height/);
      assert.throws(() => registry.apply(auth(registry.payload('rotate',
        { nextPublicKey: old.publicKey, activateAt: 5 }), old.privateKey,
        { nextPrivateKey: old.privateKey })), /Same-key/);
      registry.apply(request);
      const another = generateIdentity();
      assert.throws(() => registry.apply(auth(registry.payload('rotate',
        { nextPublicKey: another.publicKey, activateAt: 8 }), old.privateKey,
        { nextPrivateKey: another.privateKey })), /Pending rotation/);
      assert.equal(registry.snapshot().nonce, '1');
    });

    if (policy === 'hybrid-and') test(`${role}: hybrid requires BOTH signatures, never either/or`, () => {
      const { registry, auth } = fixture();
      const good = auth(registry.payload('authorize', operation));
      const missing = { ...good }; delete missing.legacySignature;
      assert.throws(() => registry.apply(missing), /missing fields/);
      const forgedLegacy = { ...good, legacySignature: new SigningKey(Wallet.createRandom().privateKey)
        .sign('0x' + 'ab'.repeat(32)).serialized };
      assert.throws(() => registry.apply(forgedLegacy), /legacy signature/);
      assert.throws(() => registry.apply({ ...good, signature: Buffer.alloc(3309).toString('base64') }), /ML-DSA/);
      assert.equal(registry.snapshot().nonce, '0');
      registry.apply(good);
      assert.throws(() => registry.apply(good), /replay/);
    });
  }
}
