/** Single-process execution-lane microbenchmark; no real P2P/network TPS. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsynchronousOrderingLab } from './asynchronous-ordering-lab.mjs';
import { VoteJournal } from './journal.mjs';
import { proposeOrder, voteOrder } from './order-consensus.mjs';
import { GENESIS_KIND, generateIdentity, signTransaction } from './pq.mjs';

const perSender=process.argv[2]===undefined?1:Number(process.argv[2]);
if(!Number.isInteger(perSender)||perSender<1||perSender>16){
  throw Error('Demo accepts 1–16 transfers per sender (64–1024 total)');
}
const root=mkdtempSync(join(tmpdir(),'zeronyth-parallel-lab-'));
const validators=Array.from({length:4},()=>generateIdentity());
const pairs=Array.from({length:64},()=>({from:generateIdentity(),to:generateIdentity()}));
const genesis={kind:GENESIS_KIND,chainId:'19127',
  validators:validators.map(v=>({publicKey:v.publicKey})),
  allocations:pairs.map(({from})=>({address:from.address,balance:'100'}))};
const transfers=pairs.flatMap(({from,to})=>Array.from({length:perSender},(_,nonce)=>
  signTransaction({chainId:'19127',nonce:String(nonce),to:to.address,value:'1'},from.privateKey)));

async function trial(name,parallelWorkers,{prewarm=false,signatureWorkers=2}={}){
  const paths={orderLogPath:join(root,`${name}-orders.jsonl`),
    stateWalPath:join(root,`${name}-states.jsonl`)};
  const journal=validators.map((_,i)=>new VoteJournal(join(root,`${name}-vote-${i}.jsonl`)));
  let lab;
  try{
    lab=await AsynchronousOrderingLab.open(genesis,{...paths,parallelWorkers,signatureWorkers});
    const height=1n,head=lab.orders.headHash;
    const proposal=proposeOrder(genesis,head,height,transfers,
      validators[0].privateKey,journal[0]);
    const votes=[0,1,2].map(i=>voteOrder(proposal,genesis,head,height,
      validators[i].privateKey,journal[i]));
    await lab.orderCertified({proposal,votes});
    if(prewarm)await lab.prepareExecution();
    const begin=process.hrtime.bigint();
    const committed=await lab.executeNext();
    const elapsedMs=Number(process.hrtime.bigint()-begin)/1e6;
    if(lab.status().executedHeight!=='1')throw Error('No executed order');
    for(const pair of pairs){
      if(lab.execution.balance(pair.to.address)!==BigInt(perSender)){
        throw Error('Independent transfer balance mismatch');
      }
    }
    return {executionMode:committed.executionMode,
      signatureVerificationMode:committed.signatureVerificationMode,
      executedTransfers:transfers.length,elapsedMs:Number(elapsedMs.toFixed(2)),
      measuredExecutionOnlyTps:Number((transfers.length*1000/elapsedMs).toFixed(1)),
      stateRoot:lab.execution.stateRoot()};
  }finally{
    await lab?.close().catch(()=>{});
    for(const voter of journal)voter.close();
  }
}

try{
  const serial=await trial('serial',0);
  const executionOnlyWarm=await trial('execution-only-warm',2,
    {prewarm:true,signatureWorkers:0});
  const parallel=await trial('signatures-and-execution-cold',2);
  const parallelWarm=await trial('signatures-and-execution-warm',2,{prewarm:true});
  if([executionOnlyWarm,parallel,parallelWarm].some(item=>
    item.stateRoot!==serial.stateRoot||item.executionMode!=='parallel-serial-crosschecked')||
      parallel.signatureVerificationMode!=='parallel-workers'||
      parallelWarm.signatureVerificationMode!=='parallel-workers'){
    throw Error('Parallel output does not agree with canonical serial execution');
  }
  console.log(JSON.stringify({status:'PARALLEL TRANSACTION STATE ROOTS MATCH',
    transactions:transfers.length,perSender,parallelWorkers:2,
    serial,executionOnlyWarm,parallelCold:parallel,parallelWarm,
    ratioColdVsSerial:Number((serial.elapsedMs/parallel.elapsedMs).toFixed(2)),
    ratioWarmVsSerial:Number((serial.elapsedMs/parallelWarm.elapsedMs).toFixed(2)),
    caveat:'One-run local research microbenchmark (execution+state fsync only), not 4-validator network TPS; warmup runs before timer and is NOT free end-to-end.',
    networkTps:null,productionReady:false},null,2));
}finally{
  rmSync(root,{recursive:true,force:true});
}
