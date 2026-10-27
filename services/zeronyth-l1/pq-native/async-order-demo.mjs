/** Research proof: five certified orders, deferred execution and crash-free reopen. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsynchronousOrderingLab } from './asynchronous-ordering-lab.mjs';
import { VoteJournal } from './journal.mjs';
import { proposeOrder, voteOrder } from './order-consensus.mjs';
import { GENESIS_KIND, generateIdentity, signTransaction } from './pq.mjs';

const temp=mkdtempSync(join(tmpdir(),'zeronyth-order-lab-'));
const validators=Array.from({length:4},()=>generateIdentity());
const from=generateIdentity();
const to=generateIdentity();
const genesis={kind:GENESIS_KIND,chainId:'19127',
  validators:validators.map(v=>({publicKey:v.publicKey})),
  allocations:[{address:from.address,balance:'100'}]};
const paths={orderLogPath:join(temp,'orders.jsonl'),stateWalPath:join(temp,'deltas.jsonl')};
let engine=null;
const journals=[];
try{
  engine=await AsynchronousOrderingLab.open(genesis,paths);
  for(let i=0;i<4;i++)journals.push(new VoteJournal(join(temp,`voter-${i}.jsonl`)));
  for(let i=0;i<5;i++){
    const height=BigInt(i+1);
    const transaction=signTransaction({chainId:'19127',nonce:String(i),to:to.address,
      value:'1'},from.privateKey);
    const proposer=i%4;
    const proposal=proposeOrder(genesis,engine.orders.headHash,height,[transaction],
      validators[proposer].privateKey,journals[proposer]);
    const votes=[0,1,2].map(index=>voteOrder(proposal,genesis,engine.orders.headHash,height,
      validators[index].privateKey,journals[index]));
    await engine.orderCertified({proposal,votes});
  }
  const lagging=engine.status();
  if(lagging.orderedHeight!=='5'||lagging.executedHeight!=='0'||
     engine.execution.balance(to.address)!==0n){
    throw Error('Ordering was not separated from execution');
  }
  for(let i=0;i<3;i++)await engine.executeNext();
  await engine.close();engine=null;
  for(const journal of journals)journal.close();
  engine=await AsynchronousOrderingLab.open(genesis,paths);
  const recovered=engine.status();
  if(recovered.orderedHeight!=='5'||recovered.executedHeight!=='3'){
    throw Error('Independent signed-order and state-delta recovery failed');
  }
  for(let i=0;i<2;i++)await engine.executeNext();
  const result=engine.status();
  if(result.executedHeight!=='5'||engine.execution.balance(to.address)!==5n){
    throw Error('Deferred execution failed to catch up after restart');
  }
  console.log(JSON.stringify({status:'DEFERRED EXECUTION RESEARCH VERIFIED',
    orderingWithoutExecution:lagging,afterRestart:recovered,
    finalOrderedHeight:result.orderedHeight,finalExecutedHeight:result.executedHeight,
    destinationBalance:engine.execution.balance(to.address).toString(),
    quantumSignatures:'ML-DSA-65',votesPerOrder:3,
    actualNetworkTps:null,productionReady:false,
    warning:'One-process local ordering/state prototype. No P2P, view-change or real EVM.'},null,2));
}finally{
  await engine?.close().catch(()=>{});
  for(const journal of journals)journal.close();
  rmSync(temp,{recursive:true,force:true});
}
