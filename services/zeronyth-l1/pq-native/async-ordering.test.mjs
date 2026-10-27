import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { AsynchronousOrderingLab, DEFAULT_RESEARCH_WORKERS } from './asynchronous-ordering-lab.mjs';
import { VoteJournal } from './journal.mjs';
import { DeltaStateStore } from './delta-state-store.mjs';
import { Ledger, stateHash } from './ledger.mjs';
import { SignatureVerificationPool } from './verification-pool.mjs';
import { proposeOrder, voteOrder, verifyCertifiedOrder } from './order-consensus.mjs';
import { GENESIS_KIND, digest, generateIdentity, signTransaction } from './pq.mjs';

async function setup(options={}){
  const temp=mkdtempSync(join(tmpdir(),'zeronyth-async-test-'));
  const validators=Array.from({length:4},()=>generateIdentity());
  const sender=generateIdentity(),recipient=generateIdentity();
  const independent=Array.from({length:options.independentCount??0},()=>({
    from:generateIdentity(),to:generateIdentity(),
  }));
  const genesis={kind:GENESIS_KIND,chainId:'19127',
    validators:validators.map(v=>({publicKey:v.publicKey})),
    allocations:[{address:sender.address,balance:'100'},
      ...independent.map(({from})=>({address:from.address,balance:'5'}))]};
  const paths={orderLogPath:join(temp,'orders.jsonl'),stateWalPath:join(temp,'deltas.jsonl')};
  const journals=validators.map((_,i)=>new VoteJournal(join(temp,`vote-${i}.jsonl`)));
  const configuration={...paths,
    parallelWorkers:options.parallelWorkers??2,
    signatureWorkers:options.signatureWorkers??2,
    minParallelTransactions:options.minParallelTransactions??32};
  let engine=await AsynchronousOrderingLab.open(genesis,configuration);
  const signing=(nonce=0)=>signTransaction({chainId:'19127',nonce:String(nonce),
    to:recipient.address,value:'1'},sender.privateKey);
  const certify=(transactions,invalidKey=null)=>{
    const height=engine.orders.height+1n;
    const head=engine.orders.headHash;
    const leader=Number((height-1n)%4n);
    const privateKey=invalidKey??validators[leader].privateKey;
    const proposal=proposeOrder(genesis,head,height,transactions,privateKey,journals[leader]);
    const votes=[0,1,2].map(i=>voteOrder(proposal,genesis,head,height,
      validators[i].privateKey,journals[i]));
    return {proposal,votes};
  };
  const reopen=async()=>{
    await engine.close();
    engine=await AsynchronousOrderingLab.open(genesis,configuration);
    return engine;
  };
  const cleanup=async()=>{
    await engine?.close().catch(()=>{});
    journals.forEach(x=>x.close());
    rmSync(temp,{recursive:true,force:true});
  };
  return {temp,genesis,paths,validators,sender,recipient,independent,journals,
    signing,certify,reopen,cleanup,get engine(){return engine;}};
}

test('signed ordering can outrun execution; restart replays both independent journals',async()=>{
  const x=await setup();
  try{
    for(let i=0;i<5;i++)await x.engine.orderCertified(x.certify([x.signing(i)]));
    assert.equal(x.engine.status().orderedHeight,'5');
    assert.equal(x.engine.status().executedHeight,'0');
    assert.equal(x.engine.execution.balance(x.recipient.address),0n);
    for(let i=0;i<3;i++)await x.engine.executeNext();
    assert.equal(x.engine.state.snapshotAt(1n).get(x.recipient.address).balance,1n);
    const view=x.engine.state.snapshotAt(3n);
    view.get(x.recipient.address).balance=999n;
    assert.equal(x.engine.state.accounts.get(x.recipient.address).balance,3n);
    await x.reopen();
    assert.equal(x.engine.status().pendingOrders,2);
    for(let i=0;i<2;i++)await x.engine.executeNext();
    assert.equal(x.engine.execution.balance(x.recipient.address),5n);
    assert.equal(x.engine.status().executedHeight,'5');
    await assert.rejects(x.engine.executeNext(),/No certified ordering/);
  }finally{await x.cleanup();}
});

test('ordering has full ML-DSA quorum and binds bytes, proposer, parent and chain ID',async()=>{
  const x=await setup();
  try{
    const certified=x.certify([x.signing(0)]);
    const now=x.engine.orders;
    assert.throws(()=>verifyCertifiedOrder({...certified,votes:certified.votes.slice(0,2)},
      x.genesis,now.headHash,1n),/at least 3/);
    assert.throws(()=>verifyCertifiedOrder({...certified,votes:[certified.votes[0],
      certified.votes[0],certified.votes[2]]},x.genesis,now.headHash,1n),/Duplicate/);
    const altered=structuredClone(certified);
    altered.proposal.transactions[0].value='42';
    assert.throws(()=>verifyCertifiedOrder(altered,x.genesis,now.headHash,1n),/hash mismatch/);
    const fakeVote=structuredClone(certified);
    fakeVote.votes[1].signature=Buffer.alloc(3309).toString('base64');
    assert.throws(()=>verifyCertifiedOrder(fakeVote,x.genesis,now.headHash,1n),/Invalid ML-DSA/);
    const wrongChain=structuredClone(certified);
    wrongChain.proposal.header.chainId='999';
    assert.throws(()=>verifyCertifiedOrder(wrongChain,x.genesis,now.headHash,1n),/Wrong ordering domain/);
    const ec=generateKeyPairSync('ec',{namedCurve:'secp256k1'});
    assert.throws(()=>proposeOrder(x.genesis,now.headHash,1n,[x.signing(0)],
      ec.privateKey,x.journals[0]),/ML-DSA-65/);
    await x.engine.orderCertified(certified);
    assert.equal(x.engine.status().executedHeight,'0');
    await assert.rejects(x.engine.orderCertified(certified),/Wrong ordering domain/);
  }finally{await x.cleanup();}
});

test('durable proposal/vote journals refuse conflicting order signatures for same height',async()=>{
  const x=await setup();
  try{
    x.certify([x.signing(0)]);
    const changed=x.signing(0);
    assert.throws(()=>proposeOrder(x.genesis,x.engine.orders.headHash,1n,[changed],
      x.validators[0].privateKey,x.journals[0]),/double-sign/);
  }finally{await x.cleanup();}
});

test('a certified but invalid transaction cannot change balances during deferred execution',async()=>{
  const x=await setup();
  try{
    const tampered={...x.signing(0),signature:'AAAA'};
    await x.engine.orderCertified(x.certify([tampered]));
    await assert.rejects(x.engine.executeNext(),/Invalid ML-DSA/);
    assert.equal(x.engine.status().orderedHeight,'1');
    assert.equal(x.engine.status().executedHeight,'0');
    assert.equal(x.engine.execution.balance(x.recipient.address),0n);
    await x.reopen();
    await assert.rejects(x.engine.executeNext(),/Invalid ML-DSA/);
  }finally{await x.cleanup();}
});

test('order/data WAL truncation and tampering fail closed on restart',async()=>{
  const x=await setup();
  try{
    await x.engine.orderCertified(x.certify([x.signing(0)]));
    await x.engine.executeNext();
    await x.engine.close();
    const raw=readFileSync(x.paths.orderLogPath,'utf8');
    writeFileSync(x.paths.orderLogPath,raw.slice(0,-1));
    await assert.rejects(x.reopen(),/Truncated certified order log/);
    writeFileSync(x.paths.orderLogPath,raw);
    const original=readFileSync(x.paths.stateWalPath,'utf8');
    writeFileSync(x.paths.stateWalPath,original.replace('"height":"1"','"height":"9"'));
    await assert.rejects(x.reopen(),/hash chain or height mismatch/);
  }finally{await x.cleanup();}
});

test('independently replayed signed transactions catch a rehashed but fraudulent state WAL',async()=>{
  const x=await setup();
  try{
    await x.engine.orderCertified(x.certify([x.signing(0)]));
    await x.engine.executeNext();
    await x.engine.close();
    const wal=JSON.parse(readFileSync(x.paths.stateWalPath,'utf8').trim());
    const altered=new Map(new Ledger(x.genesis).accounts);
    for(const delta of wal.updates){
      if(delta.address===x.recipient.address)delta.balance='99';
      altered.set(delta.address,{balance:BigInt(delta.balance),nonce:BigInt(delta.nonce)});
    }
    wal.stateRoot=stateHash(altered);
    wal.digest=digest('ZERONYTH_PQ_DELTA_WAL_RECORD_V1\0',JSON.stringify([
      wal.kind,wal.genesisHash,wal.height,wal.previousOrderHash,
      wal.orderHash,wal.updates,wal.stateRoot,wal.previousDigest,
    ]));
    writeFileSync(x.paths.stateWalPath,`${JSON.stringify(wal)}\n`);
    // Hash-chain-only validation passes, but full ML-DSA order replay detects the fraud.
    const unchecked=await DeltaStateStore.open(x.paths.stateWalPath,x.genesis);
    await unchecked.close();
    await assert.rejects(x.reopen(),/differs from re-executed signed order/);
  }finally{await x.cleanup();}
});

test('concurrent execution and out-of-order state commits do not advance the WAL',async()=>{
  const x=await setup();
  try{
    await x.engine.orderCertified(x.certify([x.signing(0)]));
    const executing=x.engine.executeNext();
    await assert.rejects(x.engine.executeNext(),/busy/);
    assert.equal((await executing).height,'1');
    const before=x.engine.state.stateRoot;
    await assert.rejects(x.engine.state.commit({previousOrderHash:'f'.repeat(64),
      orderHash:'e'.repeat(64),accounts:x.engine.state.accounts}),/Out-of-order/);
    assert.equal(x.engine.state.height,1n);
    assert.equal(x.engine.state.stateRoot,before);
    await x.reopen();
    assert.equal(x.engine.status().pendingOrders,0);
  }finally{await x.cleanup();}
});

test('ordering writes exclude execution and shutdown until journal fsync completes',async()=>{
  const x=await setup();
  try{
    const ordering=x.engine.orderCertified(x.certify([x.signing(0)]));
    await assert.rejects(x.engine.executeNext(),/busy/);
    await assert.rejects(x.engine.close(),/Cannot close during/);
    assert.equal((await ordering).height,'1');
    await x.engine.executeNext();
    assert.equal(x.engine.execution.balance(x.recipient.address),1n);
  }finally{await x.cleanup();}
});

test('aliasing order journal and delta WAL paths is rejected before writes',async()=>{
  const x=await setup();
  try{
    await assert.rejects(AsynchronousOrderingLab.open(x.genesis,{
      orderLogPath:x.paths.orderLogPath,
      stateWalPath:`${x.paths.orderLogPath}.lock`,
    }),/Different ordering and state WAL paths/);
    await assert.rejects(AsynchronousOrderingLab.open(x.genesis,{
      orderLogPath:x.paths.orderLogPath,
      stateWalPath:`${x.paths.orderLogPath.replace('orders','./orders')}`,
    }),/Different ordering and state WAL paths/);
  }finally{await x.cleanup();}
});

test('64 disjoint signed transfers use real workers and match sequential state before fsync',async()=>{
  const x=await setup({independentCount:64,parallelWorkers:2});
  try{
    const transfers=x.independent.map(({from,to})=>signTransaction({
      chainId:'19127',nonce:'0',to:to.address,value:'1',
    },from.privateKey));
    await x.engine.orderCertified(x.certify(transfers));
    const result=await x.engine.executeNext();
    assert.equal(result.executionMode,'parallel-serial-crosschecked');
    assert.equal(result.signatureVerificationMode,'parallel-workers');
    assert.equal(result.serialCrossChecked,true);
    assert.equal(result.deltaAccounts,128);
    assert.equal(x.engine.executionPool.sequence>0,true);
    for(const {to} of x.independent){
      assert.equal(x.engine.execution.balance(to.address),1n);
    }
    const root=x.engine.execution.stateRoot();
    await x.reopen();
    assert.equal(x.engine.execution.stateRoot(),root);
    assert.equal(x.engine.status().pendingOrders,0);
  }finally{await x.cleanup();}
});

test('shared-account transactions retain original nonce order and serial conflict fallback',async()=>{
  const x=await setup();
  try{
    const transfers=Array.from({length:32},(_,i)=>x.signing(i));
    await x.engine.orderCertified(x.certify(transfers));
    const result=await x.engine.executeNext();
    assert.equal(result.executionMode,'serial-conflict-fallback');
    assert.equal(result.serialCrossChecked,false);
    assert.equal(x.engine.execution.balance(x.recipient.address),32n);
    assert.equal(x.engine.execution.nonce(x.sender.address),32n);
  }finally{await x.cleanup();}
});

test('malicious speculative worker root cannot authorize a changed balance',async()=>{
  const x=await setup();
  try{
    const transfers=Array.from({length:32},(_,i)=>x.signing(i));
    await x.engine.orderCertified(x.certify(transfers));
    x.engine.execution.simulateParallel=async()=>({
      stateRoot:'a'.repeat(64),accounts:new Map(),
    });
    await assert.rejects(x.engine.executeNext(),/differs from serial canonical state/);
    assert.equal(x.engine.status().orderedHeight,'1');
    assert.equal(x.engine.status().executedHeight,'0');
    assert.equal(x.engine.execution.balance(x.recipient.address),0n);
    await x.reopen();
    const result=await x.engine.executeNext();
    assert.equal(result.executionMode,'serial-conflict-fallback');
    assert.equal(x.engine.execution.balance(x.recipient.address),32n);
  }finally{await x.cleanup();}
});

test('parallel lane configuration is strictly bounded',async()=>{
  const x=await setup();
  try{
    await assert.rejects(AsynchronousOrderingLab.open(x.genesis,{
      ...x.paths,parallelWorkers:9,
    }),/bounded parallel transaction configuration/);
    await assert.rejects(AsynchronousOrderingLab.open(x.genesis,{
      ...x.paths,minParallelTransactions:0,
    }),/bounded parallel transaction configuration/);
    await assert.rejects(AsynchronousOrderingLab.open(x.genesis,{
      ...x.paths,signatureWorkers:9,
    }),/bounded parallel transaction configuration/);
  }finally{await x.cleanup();}
});

test('signature workers reject invalid signed bytes before deferred state changes',async()=>{
  const x=await setup();
  try{
    const transfers=Array.from({length:32},(_,i)=>x.signing(i));
    transfers[7]={...transfers[7],signature:'AAAA'};
    await x.engine.orderCertified(x.certify(transfers));
    await assert.rejects(x.engine.executeNext(),/ML-DSA verification rejected/);
    assert.equal(x.engine.status().executedHeight,'0');
    assert.equal(x.engine.execution.balance(x.recipient.address),0n);
    await x.reopen();
    await assert.rejects(x.engine.executeNext(),/ML-DSA verification rejected/);
  }finally{await x.cleanup();}
});

test('verified worker result cannot substitute a different signed nonce or amount',async()=>{
  const x=await setup();
  try{
    const pool=Object.create(SignatureVerificationPool.prototype);
    pool.verifyTransactions=async()=>[{
      sender:x.sender.address,nonce:'777',value:'1',
    }];
    await assert.rejects(x.engine.execution.preverifyTransactionsAsync(
      [x.signing(0)],pool),/signed-transaction fields mismatch/);
    pool.verifyTransactions=async()=>[{
      sender:x.sender.address,nonce:'0',value:'777',
    }];
    await assert.rejects(x.engine.execution.preverifyTransactionsAsync(
      [x.signing(0)],pool),/signed-transaction fields mismatch/);
  }finally{await x.cleanup();}
});

test('next certified batch pre-verifies signatures during current execution without state reordering',async()=>{
  const x=await setup({independentCount:64});
  try{
    for(let nonce=0;nonce<3;nonce++){
      const transfers=x.independent.map(({from,to})=>signTransaction({
        chainId:'19127',nonce:String(nonce),to:to.address,value:'1',
      },from.privateKey));
      await x.engine.orderCertified(x.certify(transfers));
    }
    const first=await x.engine.executeNext();
    assert.equal(first.prefetchedSignatureBatch,false);
    assert.equal(x.engine.status().executedHeight,'1');
    const second=await x.engine.executeNext();
    assert.equal(second.prefetchedSignatureBatch,true);
    assert.equal(x.engine.status().executedHeight,'2');
    const third=await x.engine.executeNext();
    assert.equal(third.prefetchedSignatureBatch,true);
    for(const {to} of x.independent){
      assert.equal(x.engine.execution.balance(to.address),3n);
    }
    await x.reopen();
    assert.equal(x.engine.status().pendingOrders,0);
    for(const {to} of x.independent){
      assert.equal(x.engine.execution.balance(to.address),3n);
    }
  }finally{await x.cleanup();}
});

test('prefetched invalid future signature fails only its own certified height',async()=>{
  const x=await setup();
  try{
    await x.engine.orderCertified(x.certify(Array.from({length:32},(_,i)=>x.signing(i))));
    const wrong=Array.from({length:32},(_,i)=>x.signing(i+32));
    wrong[4]={...wrong[4],signature:'AAAA'};
    await x.engine.orderCertified(x.certify(wrong));
    assert.equal((await x.engine.executeNext()).height,'1');
    await assert.rejects(x.engine.executeNext(),/ML-DSA verification rejected/);
    assert.equal(x.engine.status().executedHeight,'1');
    assert.equal(x.engine.execution.balance(x.recipient.address),32n);
    await x.reopen();
    await assert.rejects(x.engine.executeNext(),/ML-DSA verification rejected/);
  }finally{await x.cleanup();}
});

test('different valid signed transfers with identical sender nonce are duplicate replay',async()=>{
  const x=await setup();
  try{
    const collision=signTransaction({chainId:'19127',nonce:'0',
      to:generateIdentity().address,value:'2'},x.sender.privateKey);
    const transfers=[x.signing(0),collision,
      ...Array.from({length:30},(_,i)=>x.signing(i+1))];
    await x.engine.orderCertified(x.certify(transfers));
    await assert.rejects(x.engine.executeNext(),/Duplicate transaction/);
    assert.equal(x.engine.execution.balance(x.recipient.address),0n);
    assert.equal(x.engine.status().executedHeight,'0');
    await x.reopen();
    await assert.rejects(x.engine.executeNext(),/Duplicate transaction/);
  }finally{await x.cleanup();}
});

test('automatic worker budget is bounded by reported logical CPUs and four',async()=>{
  const expected=Math.max(1,Math.min(4,availableParallelism()));
  assert.equal(DEFAULT_RESEARCH_WORKERS,expected);
  const x=await setup();
  let automatic;
  try{
    automatic=await AsynchronousOrderingLab.open(x.genesis,{
      orderLogPath:join(x.temp,'auto-orders.jsonl'),
      stateWalPath:join(x.temp,'auto-deltas.jsonl'),
    });
    assert.equal(automatic.status().parallelWorkers,expected);
    assert.equal(automatic.status().signatureWorkers,expected);
  }finally{
    await automatic?.close().catch(()=>{});
    await x.cleanup();
  }
});
