/** Bounded, fail-closed ML-DSA signature workers; no cryptographic shortcuts. */
import { Worker } from 'node:worker_threads';
import { ProtocolError } from './pq.mjs';

export class SignatureVerificationPool {
  constructor({ workers = 2, timeoutMs = 30_000 } = {}) {
    if (!Number.isInteger(workers) || workers < 1 || workers > 16) {  // raised; still full ML-DSA verify
      throw new ProtocolError('Signature worker count must be 1..16');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
      throw new ProtocolError('Invalid ML-DSA verification timeout');
    }
    const startups=[];
    this.workers = Array.from({ length:workers }, () => {
      const worker=new Worker(new URL('./verification-worker.mjs', import.meta.url),
        { resourceLimits:{ maxOldGenerationSizeMb:96, maxYoungGenerationSizeMb:16 } });
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
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.closed = false;
    this.busy = false;
  }

  async ready(){
    if(this.closed)throw new ProtocolError('ML-DSA signature pool unavailable');
    const online=await this.startup;
    if(!online.every(Boolean)||this.closed){
      await this.close();
      throw new ProtocolError('ML-DSA signature worker failed to start');
    }
    return this.workers.length;
  }

  async verifyTransactions(transactions, chainId) {
    if (this.closed || this.busy) throw new ProtocolError('ML-DSA signature pool unavailable');
    if (!Array.isArray(transactions) || transactions.length < 1 || transactions.length > 1536) {
      throw new ProtocolError('Invalid bounded verification batch');
    }
    this.busy = true;
    try {
      const jobs = [];
      // Preserve deterministic input ordering when aggregating independent CPU workers.
      const chunkSize = Math.ceil(transactions.length / this.workers.length);
      for (let i = 0; i < this.workers.length; i++) {
        const start = i * chunkSize;
        const part = transactions.slice(start, start + chunkSize);
        if (part.length) jobs.push(this.#verifyOnWorker(this.workers[i], part, chainId));
      }
      // Wait for all dispatched workers even if one input is invalid. Otherwise
      // a malicious request could leave a prior job running into the next one.
      const outcomes = await Promise.allSettled(jobs);
      const rejected = outcomes.find(result => result.status === 'rejected');
      if (rejected) throw rejected.reason;
      const parts = outcomes.map(result => result.value);
      const combined = parts.flat();
      if (combined.length !== transactions.length) throw new ProtocolError('Worker response count mismatch');
      return combined;
    } finally { this.busy = false; }
  }

  #verifyOnWorker(worker, transactions, chainId) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let completed = false;
      const cleanup = () => {
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      const fail = (message, fatal = false) => {
        if (completed) return;
        completed = true;
        cleanup();
        // A malicious signed transaction MUST NOT permanently disable a node.
        // Only worker crashes/timeouts mark the pool unusable.
        if (fatal) {
          this.closed = true;
          void this.close();
        }
        reject(new ProtocolError(message));
      };
      const onMessage = result => {
        if (result?.id !== id) return;
        if (result.error) return fail(`ML-DSA verification rejected: ${result.error}`);
        if (!Array.isArray(result.verified) || result.verified.length !== transactions.length) {
          return fail('Invalid ML-DSA worker response');
        }
        if (completed) return;
        completed = true;
        cleanup();
        resolve(result.verified);
      };
      const onError = () => fail('ML-DSA worker error: no signatures accepted', true);
      const onExit = () => fail('ML-DSA worker stopped before verification', true);
      const timer = setTimeout(() => fail('ML-DSA verification timeout', true), this.timeoutMs);
      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      try { worker.postMessage({ id, transactions, chainId }); }
      catch { fail('Unable to dispatch ML-DSA verification', true); }
    });
  }

  async close() {
    this.closed = true;
    await Promise.allSettled(this.workers.map(worker => worker.terminate()));
  }
}
