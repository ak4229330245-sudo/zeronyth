/** Three certified orders: compare steady-state signature prefetch on/off. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsynchronousOrderingLab } from './asynchronous-ordering-lab.mjs';
import { VoteJournal } from './journal.mjs';
import { proposeOrder, voteOrder } from './order-consensus.mjs';
import { GENESIS_KIND, generateIdentity, signTransaction } from './pq.mjs';

const workerCount=process.argv[2]===undefined?2:Number(process.argv[2]);
if(!Number.isInteger(workerCount)||workerCount<1||workerCount>8){
  throw Error('Signature pipeline demo requires 1–8 workers');
}
const root=mkdtempSync(join(tmpdir(),'zeronyth-pipeline-speed-'));
const validators=Array.from({length:4},()=>generateIdentity());
const pairs=Array.from({length:64},()=>({from:generateIdentity(),to:generateIdentity()}));
const genesis={kind:GENESIS_KIND,chainId:'19127',
  validators:validators.map(v=>({publicKey:v.publicKey})),
  allocations:pairs.map(({from})=>({address:from.address,balance:'100'}))};
const orders=Array.from({length:3},(_,height)=>pairs.flatMap(({from,to})=>
  Array.from({length:8},(_,i)=>signTransaction({
    chainId:'19127',nonce:String(height*8+i),to:to.address,value:'1',
  },from.privateKey))));

async function trial(name,{parallelWorkers,signatureWorkers,prefetchSignatures}){
  const paths={orderLogPath:join(root,`${name}-order.jsonl`),
    stateWalPath:join(root,`${name}-state.jsonl`)};
  const journals=validators.map((_,i)=>new VoteJournal(join(root,`${name}-vote-${i}.jsonl`)));
  let lab;
  try{
    lab=await AsynchronousOrderingLab.open(genesis,{...paths,
      parallelWorkers,signatureWorkers,prefetchSignatures});
    for(let index=0;index<orders.length;index++){
      const head=lab.orders.headHash;
      const height=BigInt(index+1);
      const leader=index%4;
      const proposal=proposeOrder(genesis,head,height,orders[index],
        validators[leader].privateKey,journals[leader]);
      const votes=[0,1,2].map(i=>voteOrder(proposal,genesis,head,height,
        validators[i].privateKey,journals[i]));
      await lab.orderCertified({proposal,votes});
    }
    if(parallelWorkers>0)await lab.prepareExecution();
    const start=process.hrtime.bigint();
    let prefetched=0;
    const phaseMs={verifyAndExecute:0,stateCommit:0};
    for(let height=0;height<orders.length;height++){
      const result=await lab.executeNext();
      if(result.prefetchedSignatureBatch)prefetched++;
      phaseMs.verifyAndExecute+=result.elapsedMs.verifyAndExecute;
      phaseMs.stateCommit+=result.elapsedMs.stateCommit;
    }
    const elapsedMs=Number(process.hrtime.bigint()-start)/1e6;
    for(const {to,from} of pairs){
      if(lab.execution.balance(to.address)!==24n||lab.execution.nonce(from.address)!==24n){
        throw Error('Nonce or balance differs from expected deterministic execution');
      }
    }
    return {transactions:orders.length*orders[0].length,prefetchedOrders:prefetched,
      phaseMs:{verifyAndExecute:Number(phaseMs.verifyAndExecute.toFixed(2)),
        stateCommit:Number(phaseMs.stateCommit.toFixed(2))},
      elapsedMs:Number(elapsedMs.toFixed(2)),
      executionOnlyTps:Number((orders.length*orders[0].length*1000/elapsedMs).toFixed(1)),
      stateRoot:lab.execution.stateRoot()};
  }finally{
    await lab?.close().catch(()=>{});
    for(const journal of journals)journal.close();
  }
}

try{
  const serial=await trial('serial',{
    parallelWorkers:0,signatureWorkers:0,prefetchSignatures:false});
  const noPrefetch=await trial('workers-no-prefetch',{
    parallelWorkers:workerCount,signatureWorkers:workerCount,prefetchSignatures:false});
  const prefetch=await trial('workers-prefetch',{
    parallelWorkers:workerCount,signatureWorkers:workerCount,prefetchSignatures:true});
  if(serial.stateRoot!==noPrefetch.stateRoot||serial.stateRoot!==prefetch.stateRoot||
      noPrefetch.prefetchedOrders!==0||prefetch.prefetchedOrders!==2){
    throw Error('Signed-order/parallel/prefetch state divergence');
  }
  console.log(JSON.stringify({status:'SIGNED THREE-BLOCK PIPELINE STATE ROOTS MATCH',
    orderedBlocks:3,transactions:serial.transactions,workersPerPool:workerCount,
    serial,noPrefetch,prefetch,
    ratioPrefetchVsNoPrefetch:Number((noPrefetch.elapsedMs/prefetch.elapsedMs).toFixed(2)),
    caveat:'One local process, three previously certified orders, worker warmup excluded; not end-to-end network TPS and NOT guaranteed speedup.',
    publicNetworkTps:null,productionReady:false},null,2));
}finally{rmSync(root,{recursive:true,force:true});}
