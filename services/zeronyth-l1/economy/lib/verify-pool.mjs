// Fixed-size worker_threads pool. threads = contributor's L1 share of its CPUs (never 0).
import { Worker } from 'node:worker_threads';
export class VerifyPool {
  constructor(threads) {
    this.workers = Array.from({ length: Math.max(1, threads) }, () => new Worker(new URL('./verify-worker.mjs', import.meta.url)));
    this.next = 0; this.seq = 0; this.waiting = new Map();
    for (const w of this.workers) w.on('message', ({ id, out }) => { const r = this.waiting.get(id); this.waiting.delete(id); r?.(out); });
  }
  get size() { return this.workers.length; }
  run(type, items) {
    const id = ++this.seq; const w = this.workers[this.next++ % this.workers.length];
    return new Promise((resolve) => { this.waiting.set(id, resolve); w.postMessage({ id, type, items }); });
  }
  /** Split items into one chunk per thread and verify in parallel. */
  async parallel(type, items) {
    if (!items.length) return [];
    const k = Math.min(this.workers.length, items.length); const size = Math.ceil(items.length / k); const parts = [];
    for (let i = 0; i < items.length; i += size) parts.push(this.run(type, items.slice(i, i + size)));
    return (await Promise.all(parts)).flat();
  }
  close() { return Promise.all(this.workers.map((w) => w.terminate())); }
}
