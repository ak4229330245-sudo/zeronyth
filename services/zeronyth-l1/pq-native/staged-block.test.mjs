import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENESIS_KIND, generateIdentity, hashBlock, signProposal, signTransaction } from './pq.mjs';
import { ValidatorReplica } from './consensus.mjs';
import { StagedBlockStore } from './staged-block.mjs';

function fixture() {
  const validators = Array.from({ length:4 }, () => generateIdentity());
  const alice = generateIdentity();
  const bob = generateIdentity();
  const genesis = {
    kind:GENESIS_KIND, chainId:'19127',
    validators:validators.map(v => ({ publicKey:v.publicKey })),
    allocations:[{ address:alice.address, balance:'1000' }],
  };
  const replicas = validators.map(v => new ValidatorReplica(genesis, v.privateKey));
  const stores = replicas.map(replica => new StagedBlockStore(replica));
  const transfer = value => signTransaction({
    chainId:'19127', nonce:'0', to:bob.address, value,
  }, alice.privateKey);
  return { validators, replicas, stores, transfer, bob };
}

test('four separate replicas agree via staged block hash and three ML-DSA votes', () => {
  const x = fixture();
  const block = x.replicas[0].propose([x.transfer('10')]);
  const hash = hashBlock(block.header);
  for (const store of x.stores) assert.equal(store.stage(block), hash);
  const votes = x.stores.slice(0,3).map(store => store.vote(hash));
  assert.throws(() => x.stores[0].commit(hash, votes.slice(0,2)), /3 PQ approvals/);
  for (const store of x.stores) assert.equal(store.commit(hash, votes), hash);
  for (const replica of x.replicas) {
    assert.equal(replica.ledger.balance(x.bob.address), 10n);
    assert.equal(replica.ledger.height, 1n);
  }
  assert.throws(() => x.stores[0].vote(hash), /not independently validated/);
});

test('stage refuses forged payload, unknown hash and conflicting block at same slot', () => {
  const x = fixture();
  const block = x.replicas[0].propose([x.transfer('10')]);
  const hash = x.stores[1].stage(block);
  assert.throws(() => x.stores[1].vote('f'.repeat(64)), /not independently validated/);
  const corrupted = structuredClone(block);
  corrupted.transactions[0].value = '11';
  assert.throws(() => x.stores[1].stage(corrupted), /hash mismatch/);
  const alternative = x.replicas[0].ledger.propose([x.transfer('20')]);
  const sealedAlternative = { ...alternative,
    proposalSeal:signProposal(alternative.header, x.validators[0].privateKey) };
  assert.throws(() => x.stores[1].stage(sealedAlternative), /Conflicting proposed block/);
  assert.equal(x.stores[1].vote(hash).blockHash, hash);
});
