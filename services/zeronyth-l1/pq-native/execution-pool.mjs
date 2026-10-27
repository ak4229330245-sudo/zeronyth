/** Research CPU pool: only account-disjoint components may execute in parallel. */
import { Worker } from 'node:worker_threads';
import { ProtocolError } from './pq.mjs';

export class ParallelExecutionPool {
  constructor({ workers=2, timeoutMs=30_000 }={}) {
    if (!Number.isInteger(workers) || workers < 1 || workers > 16 ||  // raised for stronger parallel execution
        !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
      throw new ProtocolError('Invalid bounded execution worker configuration');
    }
    const startups=[];
    this.workers = Array.from({length:workers},()=>{
      const worker=new Worker(new URL('./execution-worker.mjs',import.meta.url),
        {resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:16}});
      // An explicit bounded warmup may await the ONLINE event BEFORE timing
      // execution. Do not mistake worker construction for worker readiness.
      startups.push(new Promise(resolve=>{
        const done=ok=>{
          worker.off('online',onOnline);worker.off('error',onFailure);
          worker.off('exit',onFailure);resolve(ok);
        };
        const onOnline=()=>done(true);
        const onFailure=()=>done(false);
        worker.once('online',onOnline);
        worker.once('error',onFailure);
        worker.once('exit',onFailure);
      }));
      return worker;
    });
    this.startup=Promise.all(startups);
    this.timeoutMs=timeoutMs;
    this.sequence=0;
    this.closed=false;
    this.busy=false;
  }

  async ready(){
    if(this.closed)throw new ProtocolError('Execution pool unavailable');
    const online=await this.startup;
    if(!online.every(Boolean)||this.closed){
      await this.close();
      throw new ProtocolError('Execution worker failed to start');
    }
    return this.workers.length;
  }

  async execute(groups) {
    if (this.closed || this.busy) throw new ProtocolError('Execution pool unavailable');
    if (!Array.isArray(groups) || groups.length < 1 || groups.length > 1536) {
      throw new ProtocolError('Invalid execution group count');
    }
    this.busy=true;
    try {
      const buckets=Array.from({length:this.workers.length},()=>({groups:[],weight:0}));
      const prioritized=[...groups].sort((a,b)=>
        b.transfers.length-a.transfers.length || a.id-b.id);
      for (const group of prioritized) {
        buckets.sort((a,b)=>a.weight-b.weight);
        buckets[0].groups.push(group);
        buckets[0].weight+=group.transfers.length;
      }
      const jobs=buckets.map((bucket,index)=>bucket.groups.length ?
        this.#dispatch(this.workers[index],bucket.groups) : Promise.resolve([]));
      const outcomes=await Promise.allSettled(jobs);
      const failed=outcomes.find(item=>item.status==='rejected');
      if (failed) throw failed.reason;
      const results=outcomes.flatMap(item=>item.value);
      if (results.length !== groups.length) throw new ProtocolError('Missing execution component');
      return results.sort((a,b)=>a.id-b.id);
    } finally { this.busy=false; }
  }

  #dispatch(worker,groups) {
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      let done=false;
      const cleanup=()=>{
        clearTimeout(timer);
        worker.off('message',onMessage);
        worker.off('error',onError);
        worker.off('exit',onExit);
      };
      const fail=(reason,fatal=false)=>{
        if (done) return;
        done=true;
        cleanup();
        if (fatal) { this.closed=true; void this.close(); }
        reject(new ProtocolError(reason));
      };
      const onMessage=result=>{
        if (result?.id !== id) return;
        if (result.error) return fail(`Parallel execution rejected: ${result.error}`);
        if (!Array.isArray(result.results) || result.results.length !== groups.length) {
          return fail('Malformed parallel execution response',true);
        }
        if (done) return;
        done=true;
        cleanup();
        resolve(result.results);
      };
      const onError=()=>fail('Execution worker crashed',true);
      const onExit=()=>fail('Execution worker exited unexpectedly',true);
      const timer=setTimeout(()=>fail('Execution worker timed out',true),this.timeoutMs);
      worker.on('message',onMessage);
      worker.once('error',onError);
      worker.once('exit',onExit);
      try { worker.postMessage({id,groups}); }
      catch { fail('Execution worker dispatch failed',true); }
    });
  }

  async close() {
    this.closed=true;
    await Promise.allSettled(this.workers.map(worker=>worker.terminate()));
  }
}
