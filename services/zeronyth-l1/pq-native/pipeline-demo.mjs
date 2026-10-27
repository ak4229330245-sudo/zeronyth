/** Opt-in ten-block state preview; canonical ML-DSA finality remains serial. */
import { performance } from 'node:perf_hooks';
import { BlockAdmissionPipeline } from './block-pipeline.mjs';
import { ValidatorReplica } from './consensus.mjs';
import { GENESIS_KIND, generateIdentity, signTransaction } from './pq.mjs';

const validators=Array.from({length:4},()=>generateIdentity());
const sender=generateIdentity();
const receiver=generateIdentity();
const genesis={kind:GENESIS_KIND,chainId:'19127',
  validators:validators.map(v=>({publicKey:v.publicKey})),
  allocations:[{address:sender.address,balance:'100'}]};
const replicas=validators.map(v=>new ValidatorReplica(genesis,v.privateKey));
const pipeline=new BlockAdmissionPipeline(replicas[0].ledger,{lanes:2,speculativeWorkers:2});

try{
  const candidates=Array.from({length:10},(_,index)=>[
    signTransaction({chainId:'19127',nonce:String(index),to:receiver.address,value:'1'},
      sender.privateKey),
  ]);
  for(const txs of candidates)pipeline.admit(txs);
  const started=performance.now();
  const lookahead=await pipeline.previewStates();
  const previewMs=performance.now()-started;
  if(replicas.some(r=>r.ledger.height!==0n))throw Error('Preview incorrectly mutated consensus');

  for(let i=0;i<candidates.length;i++){
    const proposer=replicas.find(r=>r.id===replicas[0].ledger.expectedProposer());
    const block=proposer.propose(candidates[i]);
    const votes=replicas.slice(0,3).map(r=>r.vote(block));
    const outcome=await pipeline.commitNext(block,votes);
    for(let j=1;j<replicas.length;j++)replicas[j].commit(block,votes);
    if(outcome.height!==lookahead.previews[i].predictedHeight||
       replicas.some(r=>r.ledger.stateRoot()!==lookahead.previews[i].predictedStateRoot)){
      throw Error('Predicted state differs from canonical 3/4 certified state');
    }
  }
  console.log(JSON.stringify({status:'SAFE LOCAL SPECULATIVE PREVIEW',
    admittedCandidates:10,predictedStateRoots:lookahead.previews.length,
    independentlySignedVotesPerBlock:3,finalizedHeight:replicas[0].ledger.height.toString(),
    simultaneousFinalityBlocks:1,previewMs:+previewMs.toFixed(2),
    recipientBalance:replicas[0].ledger.balance(receiver.address).toString(),
    currentPublicNetworkTps:null,real5000TpsVerified:false,
    warning:'One machine, opt-in research only. No execution-consensus decoupling or distributed P2P.'},null,2));
}finally{await pipeline.close();}
