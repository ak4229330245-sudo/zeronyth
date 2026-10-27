import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, appendFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GENESIS_KIND, digest, generateIdentity, signTransaction } from './pq.mjs';
import { ValidatorReplica } from './consensus.mjs';

function fixture() {
  const validators = Array.from({ length:4 }, () => generateIdentity());
  const alice = generateIdentity();
  const bob = generateIdentity();
  const genesis = {
    kind:GENESIS_KIND, chainId:'19127',
    validators:validators.map(v => ({ publicKey:v.publicKey })),
    allocations:[{ address:alice.address, balance:'1000' }],
  };
  const tx = signTransaction({chainId:'19127', nonce:'0',to:bob.address,value:'7'},alice.privateKey);
  return { validators, alice, bob, genesis, tx };
}

test('durable blocks recover exactly via full ML-DSA proposer/tx/certificate replay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeronyth-block-replay-'));
  const path = join(dir, 'blocks.jsonl');
  const x = fixture();
  let leader;
  try {
    leader = new ValidatorReplica(x.genesis,x.validators[0].privateKey,{blockStore:path});
    const peers = x.validators.slice(1,3).map(v => new ValidatorReplica(x.genesis,v.privateKey));
    const block = leader.propose([x.tx]);
    const certificate = [leader.vote(block), ...peers.map(peer => peer.vote(block))];
    assert.equal(leader.commit(block,certificate), leader.ledger.headHash);
    assert.equal(leader.ledger.balance(x.bob.address),7n);
    assert.equal(leader.ledger.height,1n);
    assert.match(readFileSync(path,'utf8'), /ZERONYTH_PQ_DURABLE_BLOCK_V1/);
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o077, 0);
    assert.throws(() => new ValidatorReplica(x.genesis,x.validators[0].privateKey,{blockStore:path}),
      /EEXIST|exists/);
    leader.ledger.close();
    leader = null;
    const recovered = new ValidatorReplica(x.genesis,x.validators[0].privateKey,{blockStore:path});
    leader = recovered;
    assert.equal(recovered.ledger.height,1n);
    assert.equal(recovered.ledger.balance(x.bob.address),7n);
    assert.equal(recovered.ledger.nonce(x.alice.address),1n);
    assert.equal(recovered.ledger.headHash,block.proposalSeal.blockHash);
  } finally { leader?.ledger.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('invalid quorum never enters durable log, even if payload itself is valid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeronyth-block-reject-'));
  const path = join(dir, 'blocks.jsonl');
  const x = fixture();
  try {
    const leader = new ValidatorReplica(x.genesis,x.validators[0].privateKey,{blockStore:path});
    const block = leader.propose([x.tx]);
    const onlyOne = [leader.vote(block)];
    assert.throws(() => leader.commit(block,onlyOne), /3 PQ approvals/);
    assert.equal(leader.ledger.height,0n);
    assert.equal(readFileSync(path,'utf8'), '');
    leader.ledger.close();
    const recovered = new ValidatorReplica(x.genesis,x.validators[0].privateKey,{blockStore:path});
    assert.equal(recovered.ledger.height,0n);
    recovered.ledger.close();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('truncated, forged and wrong-genesis journals fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeronyth-block-tamper-'));
  const path = join(dir, 'blocks.jsonl');
  const x = fixture();
  try {
    const leader = new ValidatorReplica(x.genesis,x.validators[0].privateKey,{blockStore:path});
    const block = leader.propose([x.tx]);
    const peers = x.validators.slice(1,3).map(v => new ValidatorReplica(x.genesis,v.privateKey));
    leader.commit(block,[leader.vote(block),...peers.map(p=>p.vote(block))]);
    leader.ledger.close();
    const replacement = fixture();
    assert.throws(() => new ValidatorReplica(replacement.genesis,replacement.validators[0].privateKey,
      {blockStore:path}), /genesis|integrity/);
    appendFileSync(path,'not-json', 'utf8');
    assert.throws(() => new ValidatorReplica(x.genesis,x.validators[0].privateKey,{blockStore:path}),
      /Truncated block journal/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('even a recomputed hash-chain cannot legalize a modified signed transfer on replay', () => {
  const dir=mkdtempSync(join(tmpdir(),'zeronyth-block-forgery-'));
  const path=join(dir,'blocks.jsonl');
  const x=fixture();
  try {
    const leader=new ValidatorReplica(x.genesis,x.validators[0].privateKey,{blockStore:path});
    const peers=x.validators.slice(1,3).map(v=>new ValidatorReplica(x.genesis,v.privateKey));
    const block=leader.propose([x.tx]);
    leader.commit(block,[leader.vote(block),...peers.map(p=>p.vote(block))]);
    leader.ledger.close();
    const record=JSON.parse(readFileSync(path,'utf8'));
    record.block.transactions[0].value='70';
    record.digest=digest('ZERONYTH_PQ_DURABLE_BLOCK_RECORD_V1\0',JSON.stringify([
      record.kind,record.genesisHash,record.height,record.blockHash,
      record.block,record.votes,record.previous,
    ]));
    writeFileSync(path,`${JSON.stringify(record)}\n`,{mode:0o600});
    assert.throws(()=>new ValidatorReplica(x.genesis,x.validators[0].privateKey,{blockStore:path}),
      /Block transaction hash mismatch|Invalid ML-DSA/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
