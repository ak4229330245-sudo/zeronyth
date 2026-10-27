/** Fixed operation only. Never evaluate renter-supplied code. */
import {parentPort,workerData} from 'node:worker_threads';
import {createHash} from 'node:crypto';

let hash=Buffer.from(workerData.seed,'hex');
for(let index=0;index<workerData.iterations;index++){
  hash=createHash('sha256').update(hash).digest();
}
parentPort.postMessage({output:hash.toString('hex')});
