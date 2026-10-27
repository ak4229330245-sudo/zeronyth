/** Ten-candidate admission pipeline; ONE block at a time may be FINALIZED. */
import { Ledger, MAX_BLOCK_BYTES, MAX_BLOCK_TRANSACTIONS } from './ledger.mjs';
import { ProtocolError, canonicalTransaction, digest } from './pq.mjs';
import { SignatureVerificationPool } from './verification-pool.mjs';
import { ParallelExecutionPool } from './execution-pool.mjs';

const MAX_CANDIDATES=10;
const MAX_QUEUED_BYTES=32*1024*1024;

export class BlockAdmissionPipeline {
  #queue=[];
  #lanes=[];
  #laneTail=[];
  #sequence=0;
  #closed=false;
  #committing=false;
  #previewing=false;
  #revision=0;
  #speculativePool=null;

  constructor(ledger,{lanes=2,speculativeWorkers=0}={}) {
    if(!(ledger instanceof Ledger)) throw new ProtocolError('Canonical PQ Ledger required');
    if(!Number.isInteger(lanes)||lanes<1||lanes>2) {
      throw new ProtocolError('Maximum two CPU admission lanes in this safe laboratory');
    }
    if(!Number.isInteger(speculativeWorkers)||speculativeWorkers<0||speculativeWorkers>2){
      throw new ProtocolError('Speculative workers must be 0 (off), 1 or 2');
    }
    this.ledger=ledger;
    this.#lanes=Array.from({length:lanes},()=>new SignatureVerificationPool({workers:1}));
    this.#laneTail=this.#lanes.map(()=>Promise.resolve());
    if(speculativeWorkers) this.#speculativePool=new ParallelExecutionPool({workers:speculativeWorkers});
  }

  admit(transactions){
    if(this.#closed) throw new ProtocolError('Block admission pipeline is closed');
    if(this.#queue.length>=MAX_CANDIDATES) throw new ProtocolError('Maximum 10 unfinalized candidates');
    if(!Array.isArray(transactions)||!transactions.length||transactions.length>MAX_BLOCK_TRANSACTIONS){
      throw new ProtocolError('Invalid bounded block candidate');
    }
    const snapshot=transactions.map(canonicalTransaction);
    if(snapshot.some(tx=>tx.chainId!==this.ledger.genesis.chainId)){
      throw new ProtocolError('Candidate cross-chain replay rejected');
    }
    const encoded=JSON.stringify(snapshot);
    const bytes=Buffer.byteLength(encoded,'utf8');
    if(bytes>MAX_BLOCK_BYTES||this.#queue.reduce((total,e)=>total+e.bytes,bytes)>MAX_QUEUED_BYTES){
      throw new ProtocolError('Candidate pipeline memory budget exceeded');
    }
    const ticket=digest('ZERONYTH_PQ_10_BLOCK_ADMISSION_V1\0',`${++this.#sequence}:${encoded}`);
    const entry={ticket,snapshot,encoded,bytes,state:'verifying',error:null,done:null};
    const lane=(this.#sequence-1)%this.#lanes.length;
    const check=async()=>{
      try{
        const result=await this.#lanes[lane].verifyTransactions(snapshot,this.ledger.genesis.chainId);
        if(result.length!==snapshot.length) throw new ProtocolError('Incomplete admission verification');
        if(!this.#closed) entry.state='verified';
      }catch(error){
        entry.state='rejected';
        entry.error=error instanceof Error?error.message:'Unknown verification failure';
      }
    };
    entry.done=this.#laneTail[lane].then(check,check);
    this.#laneTail[lane]=entry.done;
    this.#queue.push(entry);
    this.#revision++;
    return {ticket,position:this.#queue.length,finalized:false};
  }

  status(){
    return {queued:this.#queue.length,maxQueued:MAX_CANDIDATES,
      admissionLanes:this.#lanes.length,committedHeight:this.ledger.height.toString(),
      sequentialFinality:true,speculativePreviewEnabled:this.#speculativePool!==null,
      candidates:this.#queue.map(({ticket,state,error})=>({ticket,state,error}))};
  }

  async previewStates(){
    // Opt-in research: execute up to ten already-admitted candidates on a
    // completely isolated in-memory fork. This does NOT propose, vote, write
    // consensus history or pre-authorize a later block. Height ordering and
    // the trusted sequential state root remain canonical at every step.
    if(this.#closed||this.#committing||this.#previewing||!this.#speculativePool){
      throw new ProtocolError('Speculative preview disabled or pipeline busy');
    }
    this.#previewing=true;
    try{
      const revision=this.#revision;
      const height=this.ledger.height;
      const head=this.ledger.headHash;
      const initialRoot=this.ledger.stateRoot();
      const fork=new Ledger(this.ledger.genesis);
      fork.accounts=new Map([...this.ledger.accounts].map(([id,state])=>[id,{...state}]));
      fork.height=height;
      fork.headHash=head;
      const predictions=[];
      for(const entry of this.#queue){
        await entry.done;
        if(entry.state!=='verified'){
          throw new ProtocolError(`Unverified candidate cannot be previewed: ${entry.error}`);
        }
        const speculative=await fork.simulateParallel(entry.snapshot,this.#speculativePool);
        const trusted=fork.simulate(entry.snapshot);
        if(speculative.stateRoot!==trusted.stateRoot){
          throw new ProtocolError('Speculative state differs from canonical serial state');
        }
        fork.accounts=trusted.accounts;
        fork.height++;
        predictions.push({ticket:entry.ticket,predictedHeight:fork.height.toString(),
          predictedStateRoot:trusted.stateRoot});
      }
      if(this.#closed||this.#revision!==revision||this.ledger.height!==height||
          this.ledger.headHash!==head||this.ledger.stateRoot()!==initialRoot){
        throw new ProtocolError('Authoritative head or candidate queue changed during preview');
      }
      return {baseHeight:height.toString(),baseHeadHash:head,previews:predictions,
        finalized:false,quorumVotes:0,authoritativeStateChanged:false};
    }finally{this.#previewing=false;}
  }

  async commitNext(block,votes){
    if(this.#closed||this.#committing||this.#previewing){
      throw new ProtocolError('Pipeline unavailable or already processing');
    }
    const head=this.#queue[0];
    if(!head) throw new ProtocolError('No candidate to commit');
    this.#committing=true;
    try{
      await head.done;
      if(head.state!=='verified') throw new ProtocolError(`Unverified candidate: ${head.error}`);
      const canonical=JSON.stringify(block?.transactions?.map(canonicalTransaction));
      if(canonical!==head.encoded) throw new ProtocolError('Finalization block differs from verified candidate');
      // Ledger still checks proposer, block state root, parent, transaction signatures,
      // and independent ML-DSA 3-of-4 certificate. Admission grants NO voting privilege.
      const committedHash=this.ledger.commit(block,votes);
      this.#queue.shift();
      this.#revision++;
      return {ticket:head.ticket,committedHash,height:this.ledger.height.toString()};
    }finally{this.#committing=false;}
  }

  async discardRejectedHead(){
    if(this.#committing||this.#previewing) throw new ProtocolError('Cannot discard while processing');
    const head=this.#queue[0];
    if(!head) return false;
    await head.done;
    if(head.state!=='rejected') throw new ProtocolError('Verified candidate cannot be silently discarded');
    this.#queue.shift();
    this.#revision++;
    return true;
  }

  async close(){
    this.#closed=true;
    await Promise.allSettled([
      ...this.#lanes.map(lane=>lane.close()),
      ...(this.#speculativePool?[this.#speculativePool.close()]:[]),
    ]);
    await Promise.allSettled(this.#laneTail);
  }
}
