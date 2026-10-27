import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import {
  GENESIS_KIND, ProtocolError, addressOf, exportPrivatePem, generateIdentity, signTransaction,
  verifyTransaction, verifyVote, signVote, signProposal,
} from './pq.mjs';
import { Ledger } from './ledger.mjs';
import { ValidatorReplica, oneRoundCommit } from './consensus.mjs';

function fixture() {
  const validators = Array.from({ length: 4 }, () => generateIdentity());
  const alice = generateIdentity();
  const bob = generateIdentity();
  const genesis = {
    kind: GENESIS_KIND, chainId: '19127',
    validators: validators.map(v => ({ publicKey: v.publicKey })),
    allocations: [{ address: alice.address, balance: '1000' }],
  };
  const replicas = validators.map(v => new ValidatorReplica(genesis, v.privateKey));
  const transfer = ({ nonce = '0', value = '10', to = bob.address, chainId = '19127', memo = '' } = {}) =>
    signTransaction({ chainId, nonce, to, value, memo }, alice.privateKey);
  return { validators, alice, bob, genesis, replicas, transfer };
}

test('ML-DSA-65 signs and verifies canonical transaction bytes', () => {
  const x = fixture();
  const tx = x.transfer({ value: '20', memo: 'hello' });
  assert.equal(verifyTransaction(tx, '19127').sender, x.alice.address);
  assert.equal(Buffer.from(tx.signature, 'base64').length, 3309);
  assert.match(x.alice.address, /^qspq_[0-9a-f]{64}$/);
  assert.equal(addressOf(x.alice.publicKey), x.alice.address);
});

test('cached canonical ML-DSA public-key identity is stable and never legalizes a forged signature', () => {
  const x = fixture();
  for (let i = 0; i < 16; i++) {
    assert.equal(addressOf(x.alice.publicKey), x.alice.address);
    assert.equal(verifyTransaction(x.transfer(), '19127').sender, x.alice.address);
  }
  const tx = x.transfer();
  assert.throws(() => verifyTransaction({ ...tx, signature:Buffer.alloc(3309).toString('base64') },
    '19127'), /Invalid ML-DSA/);
  assert.throws(() => addressOf('%%%%'), /invalid base64/);
});

test('cached public SPKI of an in-process signer agrees with freshly imported private key', () => {
  const x = fixture();
  const transferred = signTransaction({chainId:'19127',nonce:'0',to:x.bob.address,value:'1'},
    x.alice.privateKey);
  const reimported = createPrivateKey(exportPrivatePem(x.alice.privateKey));
  const differentNonce = signTransaction({chainId:'19127',nonce:'1',to:x.bob.address,value:'1'},
    reimported);
  assert.equal(transferred.publicKey, differentNonce.publicKey);
  assert.equal(verifyTransaction(transferred,'19127').sender, x.alice.address);
  assert.equal(verifyTransaction(differentNonce,'19127').sender, x.alice.address);
});

test('tampered destination/amount/memo/signature fail closed', () => {
  const x = fixture();
  const tx = x.transfer();
  const other = generateIdentity();
  for (const variant of [
    { ...tx, to: other.address }, { ...tx, value: '20' },
    { ...tx, memo: 'tampered' },
    { ...tx, signature: Buffer.alloc(3309).toString('base64') },
    { ...tx, hiddenField: 'bypass' },
  ]) assert.throws(() => verifyTransaction(variant, '19127'), ProtocolError);
});

test('wrong chain, noncanonical numbers, invalid address and public key are blocked', () => {
  const x = fixture();
  const tx = x.transfer();
  assert.throws(() => verifyTransaction(tx, '9127'), /Cross-chain/);
  for (const bad of [
    { ...tx, nonce: '00' }, { ...tx, value: '-1' }, { ...tx, value: '1.5' },
    { ...tx, to: '0x1234' }, { ...tx, publicKey: '@@@' },
  ]) assert.throws(() => verifyTransaction(bad, '19127'), ProtocolError);
});

test('ECDSA and Ed25519 cannot authorize transactions or validator votes', () => {
  const x = fixture();
  const ec = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const ed = generateKeyPairSync('ed25519');
  assert.throws(() => signTransaction({
    chainId:'19127', nonce:'0', to:x.bob.address, value:'1',
  }, ec.privateKey), /ML-DSA-65/);
  assert.throws(() => signTransaction({
    chainId:'19127', nonce:'0', to:x.bob.address, value:'1',
  }, ed.privateKey), /ML-DSA-65/);
  assert.throws(() => new ValidatorReplica(x.genesis, ec.privateKey), /ML-DSA-65/);
  const tx = x.transfer();
  const forged = {
    ...tx,
    publicKey: ec.publicKey.export({ format:'der', type:'spki' }).toString('base64'),
    signature: sign('sha256', Buffer.from('fake'), ec.privateKey).toString('base64'),
  };
  assert.throws(() => verifyTransaction(forged), /ECDSA\/legacy/);
});

test('3-of-4 ML-DSA approvals finalize same balances on four isolated ledgers', () => {
  const x = fixture();
  const result = oneRoundCommit(x.replicas, [x.transfer({ value:'25' })], { participating:[0,2,3] });
  assert.equal(result.votes.length, 3);
  for (const r of x.replicas) {
    assert.equal(r.ledger.height, 1n);
    assert.equal(r.ledger.balance(x.alice.address), 975n);
    assert.equal(r.ledger.nonce(x.alice.address), 1n);
    assert.equal(r.ledger.balance(x.bob.address), 25n);
    assert.equal(r.ledger.headHash, result.hash);
  }
});

test('2 approvals cannot finalize and do not alter state', () => {
  const x = fixture();
  assert.throws(() => oneRoundCommit(x.replicas, [x.transfer()], { participating:[0,1] }), /3 PQ approvals/);
  for (const r of x.replicas) {
    assert.equal(r.ledger.height, 0n);
    assert.equal(r.ledger.balance(x.alice.address), 1000n);
  }
});

test('replays and insufficient funds are rejected by every replica', () => {
  const x = fixture();
  const tx = x.transfer({ value:'900' });
  oneRoundCommit(x.replicas, [tx]);
  assert.throws(() => oneRoundCommit(x.replicas, [tx]), /Nonce\/replay/);
  assert.throws(() => oneRoundCommit(x.replicas, [x.transfer({ nonce:'1',value:'101' })]), /Insufficient/);
});

test('validator cannot equivocate at identical height and round', () => {
  const x = fixture();
  x.replicas[0].propose([x.transfer({ value:'10' })]);
  assert.throws(() => x.replicas[0].propose([x.transfer({ value:'11' })]), /equivocation/);
});

test('unknown, duplicate, mismatched and corrupted validator votes fail', () => {
  const x = fixture();
  const block = x.replicas[0].propose([x.transfer()]);
  const votes = x.replicas.slice(0,3).map(r => r.vote(block));
  const ledger = new Ledger(x.genesis);
  assert.equal(ledger.verifyCertificate(block, votes), true);
  assert.throws(() => ledger.verifyCertificate(block, [votes[0], votes[0], votes[2]]), /Duplicate/);
  const stranger = generateIdentity();
  assert.throws(() => ledger.verifyCertificate(block, [
    votes[0], votes[1], signVote(block.header, stranger.privateKey),
  ]), /unknown validator/);
  assert.throws(() => ledger.verifyCertificate(block, [votes[0], votes[1], {
    ...votes[2], signature: Buffer.alloc(3309).toString('base64'),
  }]), /Invalid ML-DSA validator vote/);
  assert.throws(() => verifyVote({ ...block.header, stateRoot:'f'.repeat(64) }, votes[0], x.validators[0].publicKey),
    /block mismatch/);
});

test('tampered block payload and state root rejected by honest validators', () => {
  const x = fixture();
  const block = x.replicas[0].propose([x.transfer()]);
  assert.throws(() => x.replicas[0].vote({
    ...block, transactions: [x.transfer({ value:'12' })],
  }), /hash mismatch/);
  assert.throws(() => x.replicas[0].vote({
    ...block, header: { ...block.header, stateRoot:'1'.repeat(64) },
  }), /Proposal seal mismatch/);
});

test('multiple signed blocks maintain the same deterministic state', () => {
  const x = fixture();
  oneRoundCommit(x.replicas, [x.transfer({ value:'100' })]);
  oneRoundCommit(x.replicas, [x.transfer({ nonce:'1',value:'60' })], { participating:[1,2,3] });
  for (const r of x.replicas) {
    assert.equal(r.ledger.height, 2n);
    assert.equal(r.ledger.balance(x.alice.address), 840n);
    assert.equal(r.ledger.balance(x.bob.address), 160n);
    assert.equal(r.ledger.nonce(x.alice.address), 2n);
  }
});

test('self-send advances nonce but does not manufacture balance', () => {
  const x = fixture();
  oneRoundCommit(x.replicas, [x.transfer({ to:x.alice.address, value:'1000' })]);
  for (const r of x.replicas) {
    assert.equal(r.ledger.balance(x.alice.address), 1000n);
    assert.equal(r.ledger.nonce(x.alice.address), 1n);
  }
});

test('canonical transaction and header hashing is independent of JSON key order', () => {
  const x = fixture();
  const tx = x.transfer();
  const unorderedTx = Object.fromEntries(Object.entries(tx).reverse());
  const block = x.replicas[0].propose([tx]);
  assert.equal(x.replicas[1].ledger.simulate([unorderedTx]).stateRoot,
    x.replicas[0].ledger.simulate([tx]).stateRoot);
  const wireBlock = {
    ...block,
    header: Object.fromEntries(Object.entries(block.header).reverse()),
    transactions: [unorderedTx],
  };
  assert.doesNotThrow(() => x.replicas[1].vote(wireBlock));
});

test('oversized transaction count is explicitly rejected without execution', () => {
  const x = fixture();
  const tx = x.transfer();
  assert.throws(() => x.replicas[0].ledger.simulate(Array(1537).fill(tx)), /1 to 1536/);
});

test('cached block validation cannot be abused by modifying proposer seal or transactions', () => {
  const x = fixture();
  const block = x.replicas[0].propose([x.transfer()]);
  const replica = x.replicas[1];
  assert.doesNotThrow(() => replica.ledger.inspect(block));
  assert.doesNotThrow(() => replica.ledger.inspect(block)); // exact signed bytes may use cache
  const tamperedSeal = structuredClone(block);
  tamperedSeal.proposalSeal.signature = Buffer.alloc(3309).toString('base64');
  assert.throws(() => replica.ledger.inspect(tamperedSeal), /Invalid ML-DSA proposer/);
  const tamperedTx = structuredClone(block);
  tamperedTx.transactions[0].value = '12';
  assert.throws(() => replica.ledger.inspect(tamperedTx), /hash mismatch/);
});

test('proposer execution reuse is strictly bound to exact signed batch and state root',()=>{
  const x=fixture();
  const block=x.replicas[0].propose([x.transfer({value:'13'})]);
  const proposerLedger=x.replicas[0].ledger;
  assert.equal(proposerLedger.inspect(block).stateRoot,block.header.stateRoot);
  const alternate=structuredClone(block);
  alternate.header.stateRoot='a'.repeat(64);
  alternate.proposalSeal=signProposal(alternate.header,x.validators[0].privateKey);
  assert.throws(()=>proposerLedger.inspect(alternate),/state root mismatch/);
  const forged=structuredClone(block);
  forged.transactions[0].memo='mutated after proposing';
  assert.throws(()=>proposerLedger.inspect(forged),/hash mismatch/);
  const votes=x.replicas.slice(0,3).map(r=>r.vote(block));
  assert.equal(x.replicas[0].commit(block,votes),block.proposalSeal.blockHash);
  assert.equal(proposerLedger.height,1n);
  assert.equal(proposerLedger.balance(x.alice.address),987n);
});

test('independent mempool preverification does not commit, authorize replay, or trust changed signed bytes', () => {
  const x = fixture();
  const tx = x.transfer({ value:'10', memo:'preverified' });
  const ledger = x.replicas[0].ledger;
  assert.equal(ledger.preverifyTransactions([tx]), 1);
  assert.equal(ledger.preverifyTransactions([tx]), 1);
  assert.equal(ledger.balance(x.alice.address), 1000n);
  assert.equal(ledger.nonce(x.alice.address), 0n);
  for (const mutation of [
    { ...tx, value:'11' },
    { ...tx, memo:'changed' },
    { ...tx, signature:Buffer.alloc(3309).toString('base64') },
    { ...tx, bogus:true },
  ]) assert.throws(() => ledger.preverifyTransactions([mutation]), ProtocolError);
  assert.throws(() => ledger.preverifyTransactions([{ ...tx, chainId:'9127' }]), /Cross-chain/);
  oneRoundCommit(x.replicas, [tx]);
  // A previously valid signature is not permission to spend a second time.
  assert.throws(() => ledger.simulate([tx]), /Nonce\/replay/);
});

test('preverified transaction cannot be smuggled into a tampered block', () => {
  const x = fixture();
  const tx = x.transfer();
  for (const replica of x.replicas) replica.ledger.preverifyTransactions([tx]);
  const block = x.replicas[0].propose([tx]);
  const forged = structuredClone(block);
  forged.transactions[0].to = generateIdentity().address;
  assert.throws(() => x.replicas[1].vote(forged), /hash mismatch/);
  assert.equal(x.replicas[1].ledger.height, 0n);
});

test('divergent replica head aborts before any new block is committed', () => {
  const x = fixture();
  x.replicas[3].ledger.headHash = 'f'.repeat(64);
  assert.throws(() => oneRoundCommit(x.replicas, [x.transfer()]), /Replica parent divergence/);
  for (const r of x.replicas) assert.equal(r.ledger.height, 0n);
});
