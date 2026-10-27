import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENESIS_KIND,generateIdentity,signTransaction } from './pq.mjs';
import { Ledger } from './ledger.mjs';
import { ParallelExecutionPool } from './execution-pool.mjs';

function fixture() {
  const validators=Array.from({length:4},()=>generateIdentity());
  const senders=Array.from({length:8},()=>generateIdentity());
  const recipients=Array.from({length:8},()=>generateIdentity());
  const genesis={
    kind:GENESIS_KIND,chainId:'19127',
    validators:validators.map(v=>({publicKey:v.publicKey})),
    allocations:senders.map(v=>({address:v.address,balance:'1000'})),
  };
  const ledger=new Ledger(genesis);
  const transactions=[];
  for (let nonce=0;nonce<8;nonce++) {
    for (let sender=0;sender<8;sender++) transactions.push(signTransaction({
      chainId:'19127',nonce:String(nonce),to:recipients[sender].address,value:'1',
    },senders[sender].privateKey));
  }
  return {ledger,transactions,senders,recipients};
}

test('parallel disjoint-account execution matches sequential state root exactly',async()=>{
  const x=fixture();
  const pool=new ParallelExecutionPool({workers:4});
  try {
    const sequential=x.ledger.simulate(x.transactions);
    const parallel=await x.ledger.simulateParallel(x.transactions,pool);
    assert.equal(parallel.stateRoot,sequential.stateRoot);
    assert.deepEqual([...parallel.accounts],[...sequential.accounts]);
    assert.equal(x.ledger.height,0n);
  } finally { await pool.close(); }
});

test('cross-account dependencies merge into one ordered component',async()=>{
  const x=fixture();
  x.transactions.push(signTransaction({
    chainId:'19127',nonce:'8',to:x.senders[1].address,value:'100',
  },x.senders[0].privateKey));
  const pool=new ParallelExecutionPool({workers:3});
  try {
    assert.equal((await x.ledger.simulateParallel(x.transactions,pool)).stateRoot,
      x.ledger.simulate(x.transactions).stateRoot);
  } finally { await pool.close(); }
});

test('parallel execution rejects replay, invalid signature and unavailable workers',async()=>{
  const x=fixture();
  const pool=new ParallelExecutionPool({workers:2});
  try {
    const forged=x.transactions.map(tx=>({...tx}));
    forged[4].value='999';
    await assert.rejects(x.ledger.simulateParallel(forged,pool),/Invalid ML-DSA/);
    const replay=x.transactions.map(tx=>({...tx}));
    replay[8]={...replay[0]};
    await assert.rejects(x.ledger.simulateParallel(replay,pool),/Duplicate transaction/);
    const badNonceOrder=x.transactions.map(tx=>({...tx}));
    [badNonceOrder[0],badNonceOrder[8]]=[badNonceOrder[8],badNonceOrder[0]];
    await assert.rejects(x.ledger.simulateParallel(badNonceOrder,pool),/Nonce\/replay/);
    // An invalid transfer cannot permanently disable the execution workers.
    assert.equal((await x.ledger.simulateParallel(x.transactions,pool)).stateRoot,
      x.ledger.simulate(x.transactions).stateRoot);
  } finally { await pool.close(); }
  await assert.rejects(x.ledger.simulateParallel(x.transactions,pool),/live bounded/);
});
