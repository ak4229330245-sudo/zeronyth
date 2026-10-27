import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BlockAdmissionPipeline} from './block-pipeline.mjs';
import {ValidatorReplica} from './consensus.mjs';
import {GENESIS_KIND,generateIdentity,signTransaction} from './pq.mjs';

function fixture(){
  const validators=Array.from({length:4},()=>generateIdentity());
  const source=generateIdentity();
  const destination=generateIdentity();
  const genesis={kind:GENESIS_KIND,chainId:'19127',
    validators:validators.map(v=>({publicKey:v.publicKey})),
    allocations:[{address:source.address,balance:'100'}]};
  const replicas=validators.map(v=>new ValidatorReplica(genesis,v.privateKey));
  const tx=nonce=>signTransaction({chainId:'19127',nonce:String(nonce),
    to:destination.address,value:'1'},source.privateKey);
  const leader=()=>replicas.find(r=>r.id===replicas[0].ledger.expectedProposer());
  return {replicas,tx,leader,source};
}

test('10 candidates preverify concurrently but certificates finalize ONE block in order',async()=>{
  const x=fixture();
  const pipeline=new BlockAdmissionPipeline(x.replicas[0].ledger);
  try{
    const candidates=Array.from({length:10},(_,i)=>[x.tx(i)]);
    const receipts=candidates.map(txs=>pipeline.admit(txs));
    assert.equal(receipts.length,10);
    assert.throws(()=>pipeline.admit([x.tx(10)]),/Maximum 10/);
    assert.equal(pipeline.status().sequentialFinality,true);
    assert.equal(pipeline.status().admissionLanes,2);
    for(let i=0;i<10;i++){
      const block=x.leader().propose(candidates[i]);
      const votes=x.replicas.slice(0,3).map(r=>r.vote(block));
      if(i===0){
        await assert.rejects(pipeline.commitNext(block,votes.slice(0,2)),/at least 3/);
        assert.equal(pipeline.status().queued,10);
        await assert.rejects(pipeline.commitNext({...block,transactions:[x.tx(7)]},votes),/differs/);
      }
      const receipt=await pipeline.commitNext(block,votes);
      assert.equal(receipt.ticket,receipts[i].ticket);
      assert.equal(receipt.height,String(i+1));
      for(let j=1;j<x.replicas.length;j++)x.replicas[j].commit(block,votes);
    }
    assert.equal(pipeline.status().queued,0);
    assert.equal(pipeline.status().committedHeight,'10');
  }finally{await pipeline.close();}
});

test('invalid signed candidates fail closed and can only be dropped explicitly',async()=>{
  const x=fixture();
  const pipeline=new BlockAdmissionPipeline(x.replicas[0].ledger,{lanes:1});
  try{
    const invalid={...x.tx(0),signature:'AAAA'};
    pipeline.admit([invalid]);
    await assert.rejects(pipeline.commitNext({transactions:[invalid]},[]),/Unverified candidate/);
    assert.equal(await pipeline.discardRejectedHead(),true);
    assert.equal(pipeline.status().queued,0);
    pipeline.admit([x.tx(0)]);
    await assert.rejects(pipeline.discardRejectedHead(),/cannot be silently discarded/);
    assert.equal(pipeline.status().queued,1);
  }finally{await pipeline.close();}
});

test('pipeline rejects cross-chain bytes and candidate mutation before commitment',async()=>{
  const x=fixture();
  const pipeline=new BlockAdmissionPipeline(x.replicas[0].ledger);
  try{
    assert.throws(()=>pipeline.admit([{...x.tx(0),chainId:'999'}]),/cross-chain/);
    const mutable=x.tx(0);
    const exactSnapshot=structuredClone(mutable);
    pipeline.admit([mutable]);
    mutable.value='99';
    const block=x.leader().propose([exactSnapshot]);
    const votes=x.replicas.slice(0,3).map(r=>r.vote(block));
    assert.equal((await pipeline.commitNext(block,votes)).height,'1');
  }finally{await pipeline.close();}
});

test('opt-in lookahead predicts ten ordered heights without making even one consensus vote',async()=>{
  const x=fixture();
  const pipeline=new BlockAdmissionPipeline(x.replicas[0].ledger,{speculativeWorkers:2});
  try{
    const before=x.replicas[0].ledger.stateRoot();
    const candidates=Array.from({length:10},(_,i)=>[x.tx(i)]);
    const receipts=candidates.map(items=>pipeline.admit(items));
    const preview=await pipeline.previewStates();
    assert.equal(preview.baseHeight,'0');
    assert.equal(preview.previews.length,10);
    assert.deepEqual(preview.previews.map(item=>item.predictedHeight),
      Array.from({length:10},(_,i)=>String(i+1)));
    assert.deepEqual(preview.previews.map(item=>item.ticket),receipts.map(item=>item.ticket));
    assert.equal(preview.finalized,false);
    assert.equal(preview.quorumVotes,0);
    assert.equal(preview.authoritativeStateChanged,false);
    assert.equal(x.replicas[0].ledger.height,0n);
    assert.equal(x.replicas[0].ledger.stateRoot(),before);
    assert.equal(x.replicas[0].ledger.nonce(x.source.address),0n);

    const block=x.leader().propose(candidates[0]);
    const votes=x.replicas.slice(0,3).map(replica=>replica.vote(block));
    await assert.rejects(pipeline.commitNext(block,votes.slice(0,2)),/at least 3/);
    assert.equal(x.replicas[0].ledger.height,0n);
    await pipeline.commitNext(block,votes);
    for(let i=1;i<4;i++)x.replicas[i].commit(block,votes);
    const shifted=await pipeline.previewStates();
    assert.equal(shifted.baseHeight,'1');
    assert.equal(shifted.previews.length,9);
    assert.equal(shifted.previews[0].predictedHeight,'2');
    assert.equal(shifted.previews[8].predictedStateRoot,preview.previews[9].predictedStateRoot);
  }finally{await pipeline.close();}
});

test('lookahead keeps malicious signatures or stale candidate state out of authoritative ledger',async()=>{
  const x=fixture();
  const pipeline=new BlockAdmissionPipeline(x.replicas[0].ledger,{speculativeWorkers:1});
  try{
    pipeline.admit([x.tx(0)]);
    pipeline.admit([{...x.tx(1),signature:'AAAA'}]);
    const root=x.replicas[0].ledger.stateRoot();
    await assert.rejects(pipeline.previewStates(),/Unverified candidate/);
    assert.equal(x.replicas[0].ledger.stateRoot(),root);
    assert.equal(x.replicas[0].ledger.height,0n);
  }finally{await pipeline.close();}
  const second=new BlockAdmissionPipeline(x.replicas[0].ledger,{speculativeWorkers:1});
  try{
    second.admit([x.tx(0)]);
    assert.equal((await second.previewStates()).previews.length,1);
    const block=x.leader().propose([x.tx(0)]);
    const votes=x.replicas.slice(0,3).map(replica=>replica.vote(block));
    for(const replica of x.replicas)replica.commit(block,votes);
    // No cached forecast survives an externally advanced canonical head.
    await assert.rejects(second.previewStates(),/Nonce\/replay/);
    assert.equal(x.replicas[0].ledger.height,1n);
  }finally{await second.close();}
});

test('parallel preview resolves distinct-account batches against full serial state root',async()=>{
  const validators=Array.from({length:4},()=>generateIdentity());
  const sources=Array.from({length:32},()=>generateIdentity());
  const destinations=Array.from({length:32},()=>generateIdentity());
  const genesis={kind:GENESIS_KIND,chainId:'19127',
    validators:validators.map(v=>({publicKey:v.publicKey})),
    allocations:sources.map(x=>({address:x.address,balance:'100'}))};
  const ledger=new ValidatorReplica(genesis,validators[0].privateKey).ledger;
  const txs=sources.map((source,i)=>signTransaction({chainId:'19127',nonce:'0',
    to:destinations[i].address,value:'2'},source.privateKey));
  const pipeline=new BlockAdmissionPipeline(ledger,{speculativeWorkers:2});
  try{
    pipeline.admit(txs);
    const trusted=ledger.simulate(txs).stateRoot;
    const predictions=await pipeline.previewStates();
    assert.equal(predictions.previews[0].predictedStateRoot,trusted);
    assert.equal(ledger.height,0n);
    assert.equal(ledger.balance(sources[0].address),100n);
    assert.equal(ledger.balance(destinations[0].address),0n);
  }finally{await pipeline.close();}
});

test('speculation is opt-in and queue changes fail rather than publishing stale roots',async()=>{
  const x=fixture();
  const defaultPipeline=new BlockAdmissionPipeline(x.replicas[0].ledger);
  try{
    assert.equal(defaultPipeline.status().speculativePreviewEnabled,false);
    await assert.rejects(defaultPipeline.previewStates(),/disabled/);
  }finally{await defaultPipeline.close();}

  const pipeline=new BlockAdmissionPipeline(x.replicas[0].ledger,{speculativeWorkers:1});
  try{
    pipeline.admit([x.tx(0)]);
    const preview=pipeline.previewStates();
    pipeline.admit([x.tx(1)]);
    await assert.rejects(preview,/candidate queue changed/);
    assert.equal(x.replicas[0].ledger.height,0n);
    assert.equal(pipeline.status().queued,2);
    assert.equal((await pipeline.previewStates()).previews.length,2);
  }finally{await pipeline.close();}
});

test('preview and quorum commit cannot overlap on one admission pipeline',async()=>{
  const x=fixture();
  const pipeline=new BlockAdmissionPipeline(x.replicas[0].ledger,{speculativeWorkers:1});
  try{
    const signed=x.tx(0);
    pipeline.admit([signed]);
    const pending=pipeline.previewStates();
    const block=x.leader().propose([signed]);
    const votes=x.replicas.slice(0,3).map(replica=>replica.vote(block));
    await assert.rejects(pipeline.commitNext(block,votes),/already processing/);
    await pending;
    assert.equal((await pipeline.commitNext(block,votes)).height,'1');
  }finally{await pipeline.close();}
});
