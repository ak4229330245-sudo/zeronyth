/** Executes only disjoint transfer/account components verified by the parent. */
import { parentPort } from 'node:worker_threads';
import { executeComponent } from './transfer-engine.mjs';

if (!parentPort) throw Error('Execution worker must run on a worker thread');
parentPort.on('message', ({ id, groups }) => {
  try { parentPort.postMessage({ id, results:groups.map(executeComponent) }); }
  catch (error) {
    parentPort.postMessage({ id, error:error instanceof Error ? error.message : 'Execution rejected' });
  }
});
