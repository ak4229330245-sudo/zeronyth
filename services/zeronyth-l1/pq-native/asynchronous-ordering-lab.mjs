/** Ordering-certificate durability precedes execution. Isolated local research only. */
import { Ledger } from './ledger.mjs';
import { ProtocolError } from './pq.mjs';
import { CertifiedOrderLog } from './order-consensus.mjs';
import { DeltaStateStore } from './delta-state-store.mjs';
import { resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { ParallelExecutionPool } from './execution-pool.mjs';
import { SignatureVerificationPool } from './verification-pool.mjs';
import { performance } from 'node:perf_hooks';

// Research-only starting point, not a performance promise. Keep two workers
// per pool on a two-core VPS; permit four only on machines reporting >=4 CPUs.
// Explicit 0..8 overrides remain available for controlled measurements.
export const DEFAULT_RESEARCH_WORKERS=Math.max(1,Math.min(16,availableParallelism())); // max parallel, full ML-DSA preserved // strengthened parallel pools; ML-DSA + privacy preserved

export class AsynchronousOrderingLab{
  constructor(genesis,orders,state,{
    parallelWorkers,signatureWorkers,minParallelTransactions,prefetchSignatures,
  }){
    this.genesis=genesis;
    this.orders=orders;
    this.state=state;
    this.execution=new Ledger(genesis);
    this.parallelWorkers=parallelWorkers;
    this.signatureWorkers=signatureWorkers;
    this.minParallelTransactions=minParallelTransactions;
    this.prefetchSignatures=prefetchSignatures;
    this.executionPool=null;
    this.verificationPool=null;
    this.prefetch=null;
    this.running=false;
    this.closed=false;
  }

  static async open(genesis,{
    orderLogPath,stateWalPath,parallelWorkers=DEFAULT_RESEARCH_WORKERS,
    signatureWorkers=DEFAULT_RESEARCH_WORKERS,
    minParallelTransactions=32,prefetchSignatures=true,
  }){
    if(!Number.isInteger(parallelWorkers)||parallelWorkers<0||parallelWorkers>16||
        !Number.isInteger(signatureWorkers)||signatureWorkers<0||signatureWorkers>8||
        typeof prefetchSignatures!=='boolean'||
        !Number.isInteger(minParallelTransactions)||minParallelTransactions<2||
        minParallelTransactions>1536){
      throw new ProtocolError('Invalid bounded parallel transaction configuration');
    }
    if(typeof orderLogPath!=='string'||typeof stateWalPath!=='string'||
        !orderLogPath||!stateWalPath||
        resolve(orderLogPath)===resolve(stateWalPath)||
        resolve(orderLogPath)===resolve(`${stateWalPath}.lock`)||
        resolve(stateWalPath)===resolve(`${orderLogPath}.lock`)){
      throw new ProtocolError('Different ordering and state WAL paths required');
    }
    const orders=await CertifiedOrderLog.open(orderLogPath,genesis);
    let state;
    try{
      state=await DeltaStateStore.open(stateWalPath,genesis);
      if(state.height>orders.height)throw new ProtocolError('State height ahead of certified ordering');
      const engine=new AsynchronousOrderingLab(genesis,orders,state,
        {parallelWorkers,signatureWorkers,minParallelTransactions,prefetchSignatures});
      // NEVER trust cached delta state merely because its hash chain matches:
      // independently replay every ML-DSA signed transaction from the fully
      // verified certified order log on recovery and compare EVERY height.
      for(let i=0;i<state.committed.length;i++){
        const certified=orders.records[i];
        const expected=state.committed[i];
        if(!certified||certified.hash!==expected.orderHash){
          throw new ProtocolError('State WAL diverges from certified ordering');
        }
        const next=engine.execution.simulate(certified.certified.proposal.transactions);
        if(next.stateRoot!==expected.stateRoot){
          throw new ProtocolError('State WAL differs from re-executed signed order');
        }
        engine.execution.accounts=next.accounts;
        engine.execution.height++;
        engine.execution.headHash=certified.hash;
      }
      if(engine.execution.stateRoot()!==state.stateRoot){
        throw new ProtocolError('Recovered in-memory execution differs from delta WAL');
      }
      return engine;
    }catch(error){
      await Promise.allSettled([state?.close(),orders.close()]);
      throw error;
    }
  }

  status(){
    return {orderedHeight:this.orders.height.toString(),
      executedHeight:this.state.height.toString(),
      pendingOrders:Number(this.orders.height-this.state.height),
      orderingHead:this.orders.headHash,executedStateRoot:this.state.stateRoot,
      parallelWorkers:this.parallelWorkers,
      signatureWorkers:this.signatureWorkers,
      prefetchSignatures:this.prefetchSignatures,
      minParallelTransactions:this.minParallelTransactions,
      authorizedByOrderingOnly:false};
  }

  async prepareExecution(){
    if(this.closed||this.running||this.parallelWorkers===0){
      throw new ProtocolError('Execution worker warmup unavailable');
    }
    if(!this.executionPool){
      this.executionPool=new ParallelExecutionPool({workers:this.parallelWorkers});
    }
    const tasks=[this.executionPool.ready()];
    if(this.signatureWorkers>0){
      if(!this.verificationPool){
        this.verificationPool=new SignatureVerificationPool({workers:this.signatureWorkers});
      }
      tasks.push(this.verificationPool.ready());
    }
    await Promise.all(tasks);
    return {executionWorkers:this.parallelWorkers,signatureWorkers:this.signatureWorkers};
  }

  async orderCertified(certified){
    if(this.closed||this.running)throw new ProtocolError('Ordering lab unavailable or busy');
    // Verification + fsync durable ordering certificate does not touch balance,
    // nonces or state. The independent execution lane may remain behind.
    this.running=true;
    try{return await this.orders.accept(certified);}
    finally{this.running=false;}
  }

  #prefetchNextSignatures(currentIndex){
    if(!this.prefetchSignatures||this.signatureWorkers===0||
        !this.verificationPool||this.prefetch)return;
    const next=this.orders.records[currentIndex+1];
    if(!next||next.certified.proposal.transactions.length<this.minParallelTransactions)return;
    // CRYPTO ONLY: never pre-execute state or authorize/commit the next height.
    // Store a settled outcome to avoid unhandled rejections while a different
    // certified order is executing. The cache keys contain ALL signed bytes.
    const task=this.execution.preverifyTransactionsAsync(
      next.certified.proposal.transactions,this.verificationPool)
      .then(()=>({ok:true}),error=>({ok:false,error}));
    this.prefetch={height:BigInt(currentIndex+2),orderHash:next.hash,task};
  }

  async executeNext(){
    if(this.closed||this.running)throw new ProtocolError('Execution lane unavailable or busy');
    if(this.state.height>=this.orders.height){
      throw new ProtocolError('No certified ordering awaiting execution');
    }
    this.running=true;
    try{
      const startMs=performance.now();
      const index=Number(this.state.height);
      const record=this.orders.records[index];
      if(!record)throw new ProtocolError('Certified ordering record missing');
      const transactions=record.certified.proposal.transactions;
      let candidate;
      let executionMode='serial';
      let signatureVerificationMode='main-thread';
      let prefetchedSignatureBatch=false;
      if(this.parallelWorkers>0&&transactions.length>=this.minParallelTransactions){
        if(this.signatureWorkers>0){
          if(!this.verificationPool){
            this.verificationPool=new SignatureVerificationPool({workers:this.signatureWorkers});
          }
          // Full ML-DSA verification happens on trusted bounded CPU workers.
          // Verified results are bound to every canonical signed byte and
          // chain ID; serial balance/nonce replay remains mandatory below.
          if(this.prefetch){
            const pending=this.prefetch;
            if(pending.height!==this.state.height+1n||pending.orderHash!==record.hash){
              throw new ProtocolError('Stale preverified ordering batch');
            }
            const outcome=await pending.task;
            this.prefetch=null;
            if(!outcome.ok)throw outcome.error;
            prefetchedSignatureBatch=true;
          }else{
            await this.execution.preverifyTransactionsAsync(transactions,this.verificationPool);
          }
          signatureVerificationMode='parallel-workers';
          // Overlap NEXT block's independent ML-DSA verification with the
          // current block's stateful execution and fsync, when available.
          this.#prefetchNextSignatures(index);
        }
        if(!this.executionPool){
          this.executionPool=new ParallelExecutionPool({workers:this.parallelWorkers});
        }
        const dispatchedBefore=this.executionPool.sequence;
        // Partition by all touched senders/recipients. Dependent transfers
        // remain ordered in ONE worker component; independent groups may run
        // concurrently. Worker results NEVER grant independent finality.
        // Start the worker computation first; independently run the canonical
        // serial interpreter WHILE those workers are busy. Do not wait for
        // workers and then spend a second, additive serial-execution phase.
        // All outcomes are joined before returning, including on bad input.
        const parallelTask=this.execution.simulateParallel(transactions,this.executionPool);
        const serialTask=Promise.resolve().then(()=>this.execution.simulate(transactions));
        const [parallelOutcome,serialOutcome]=await Promise.allSettled([parallelTask,serialTask]);
        if(serialOutcome.status==='rejected')throw serialOutcome.reason;
        if(parallelOutcome.status==='rejected')throw parallelOutcome.reason;
        const parallel=parallelOutcome.value;
        const serial=serialOutcome.value;
        // Treat the existing sequential interpreter as the independent oracle:
        // a worker error or ANY different state root fails the entire height.
        if(parallel.stateRoot!==serial.stateRoot){
          throw new ProtocolError('Parallel transaction result differs from serial canonical state');
        }
        candidate=serial;
        executionMode=this.executionPool.sequence>dispatchedBefore?
          'parallel-serial-crosschecked':'serial-conflict-fallback';
      }else{
        candidate=this.execution.simulate(transactions);
      }
      const verifiedAndExecutedMs=performance.now();
      const result=await this.state.commit({previousOrderHash:this.state.lastOrderHash,
        orderHash:record.hash,accounts:candidate.accounts});
      const committedMs=performance.now();
      if(result.stateRoot!==candidate.stateRoot){
        throw new ProtocolError('Persisted executed state root mismatch');
      }
      // Publish the execution state only after durable state fsync succeeds.
      this.execution.accounts=candidate.accounts;
      this.execution.height++;
      this.execution.headHash=record.hash;
      return {...result,executionMode,signatureVerificationMode,prefetchedSignatureBatch,
        serialCrossChecked:executionMode==='parallel-serial-crosschecked',
        elapsedMs:{verifyAndExecute:Number((verifiedAndExecutedMs-startMs).toFixed(3)),
          stateCommit:Number((committedMs-verifiedAndExecutedMs).toFixed(3))},
        orderingAhead:this.orders.height>this.state.height};
    }finally{this.running=false;}
  }

  async close(){
    if(this.closed)return;
    if(this.running)throw new ProtocolError('Cannot close during an ordering or execution write');
    this.closed=true;
    if(this.prefetch)await this.prefetch.task;
    const outcomes=await Promise.allSettled([this.orders.close(),this.state.close(),
      this.executionPool?.close(),this.verificationPool?.close()]);
    const failed=outcomes.find(item=>item.status==='rejected');
    if(failed)throw failed.reason;
  }
}
