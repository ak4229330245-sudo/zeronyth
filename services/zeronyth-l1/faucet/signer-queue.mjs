// Per-signer nonce manager / send queue (ethers v6). Fixes nonce races when the same key is used concurrently
// inside one process (async callers) AND across processes (e.g. faucet + scripts, demo + coordinator).
//
//  - in-process: one promise chain per (chainId,address) -> sends are strictly serialized
//  - cross-process: an atomic mkdir lock in ZERONYTH_NONCE_LOCK_DIR (default /tmp/zeronyth-nonce-locks), held only
//    while choosing the nonce + broadcasting (not while waiting for receipts); stale locks (dead pid / >30 s) are broken
//  - nonce = max(chain 'pending' count, last nonce recorded by any process + 1 if recorded < 60 s ago); old records are
//    ignored so a dropped tx can never leave a permanent gap
//  - on "nonce too low / replacement underpriced / known transaction" -> resync from chain and retry (max 4 attempts)
//  - "already known" for the exact same signed tx is treated as success (no duplicate send)
// No keys are stored or logged here; only {nonce, ts, pid} per address.
// The same file is copied to faucet/signer-queue.mjs (the faucet is a standalone package); keep them identical.
import { AbstractSigner, Transaction, getAddress } from 'ethers';
import { mkdirSync, rmSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

const LOCK_DIR = process.env.ZERONYTH_NONCE_LOCK_DIR || '/tmp/zeronyth-nonce-locks'; // fixed path, not os.tmpdir() (TMPDIR differs per process)
const STALE_LOCK_MS = 30_000, RECORD_TTL_MS = 60_000, MAX_ATTEMPTS = 4;
const chains = new Map(); // key -> Promise (in-process serialization, shared by all QueuedSigner instances)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isNonceError(e) {
  const s = `${e?.code || ''} ${e?.shortMessage || ''} ${e?.message || ''} ${e?.info?.error?.message || ''} ${e?.error?.message || ''}`.toLowerCase();
  return /nonce_expired|replacement_underpriced|nonce too low|nonce is too low|replacement transaction underpriced|known transaction|already known|incorrect nonce|transaction_nonce_too_low|nonce has already been used/.test(s);
}
const isAlreadyKnown = (e) => /already known|known transaction/i.test(`${e?.message || ''} ${e?.info?.error?.message || ''} ${e?.error?.message || ''}`);

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

async function withFileLock(key, fn) {
  mkdirSync(LOCK_DIR, { recursive: true, mode: 0o700 });
  const lock = path.join(LOCK_DIR, `${key}.lock`);
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { mkdirSync(lock); writeFileSync(path.join(lock, 'owner'), JSON.stringify({ pid: process.pid, ts: Date.now() })); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let stale = false;
      try {
        const o = JSON.parse(readFileSync(path.join(lock, 'owner'), 'utf8'));
        stale = Date.now() - o.ts > STALE_LOCK_MS || (o.pid !== process.pid && !pidAlive(o.pid));
      } catch { try { stale = Date.now() - statSync(lock).mtimeMs > 2_000; } catch { /* vanished */ } }
      if (stale) { rmSync(lock, { recursive: true, force: true }); continue; }
      if (Date.now() > deadline) throw new Error('nonce lock timeout');
      await sleep(15 + Math.random() * 25);
    }
  }
  try { return await fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
}

function readRecord(key) { try { return JSON.parse(readFileSync(path.join(LOCK_DIR, `${key}.json`), 'utf8')); } catch { return null; } }
function writeRecord(key, nonce) {
  const f = path.join(LOCK_DIR, `${key}.json`);
  writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify({ nonce, ts: Date.now(), pid: process.pid }), { mode: 0o600 });
  renameSync(`${f}.${process.pid}.tmp`, f);
}

export class QueuedSigner extends AbstractSigner {
  #key = null;
  constructor(signer, { chainId } = {}) {
    super(signer.provider);
    this.signer = signer; this.chainId = chainId; this.stats = { sent: 0, retries: 0, alreadyKnown: 0 };
  }
  connect(provider) { return new QueuedSigner(this.signer.connect(provider), { chainId: this.chainId }); }
  getAddress() { return this.signer.getAddress(); }
  signTransaction(tx) { return this.signer.signTransaction(tx); }
  signMessage(m) { return this.signer.signMessage(m); }
  signTypedData(d, t, v) { return this.signer.signTypedData(d, t, v); }
  reset() { /* compatibility with ethers NonceManager; state is always resynced from chain */ }
  async getNonce(blockTag) { return blockTag === 'pending' || blockTag === undefined ? this.#nextNonce(await this.#keyOf()) : this.signer.getNonce(blockTag); }

  async #keyOf() {
    if (this.#key) return this.#key;
    // chainId alone is not unique here (box test chain and live testnet are both 9127) -> include the genesis hash
    const cid = this.chainId ?? Number((await this.provider.getNetwork()).chainId);
    const genesis = (await this.provider.getBlock(0))?.hash || '0x';
    this.#key = `${cid}-${genesis.slice(2, 14)}-${getAddress(await this.signer.getAddress()).toLowerCase()}`;
    return this.#key;
  }
  async #nextNonce(key) {
    const pending = await this.provider.getTransactionCount(await this.signer.getAddress(), 'pending');
    const r = readRecord(key);
    const fromRecord = r && Date.now() - r.ts < RECORD_TTL_MS ? r.nonce + 1 : 0;
    return Math.max(pending, fromRecord);
  }

  async sendTransaction(tx) {
    const key = await this.#keyOf();
    const prev = chains.get(key) || Promise.resolve();
    const run = prev.then(() => this.#send(key, tx), () => this.#send(key, tx));
    chains.set(key, run.catch(() => undefined));
    return run;
  }

  async #send(key, txIn) {
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await withFileLock(key, async () => {
          const nonce = await this.#nextNonce(key);
          const pop = await this.signer.populateTransaction({ ...txIn, nonce });
          const raw = await this.signer.signTransaction(pop);
          let resp;
          try { resp = await this.provider.broadcastTransaction(raw); } catch (e) {
            if (!isAlreadyKnown(e)) throw e;
            this.stats.alreadyKnown++;
            const hash = Transaction.from(raw).hash; // exact same tx is already in the pool -> not a duplicate send
            for (let i = 0; i < 20 && !resp; i++) { resp = await this.provider.getTransaction(hash); if (!resp) await sleep(100); }
            if (!resp) throw e;
          }
          writeRecord(key, nonce);
          this.stats.sent++;
          return resp;
        });
      } catch (e) {
        lastErr = e;
        if (!isNonceError(e) || attempt === MAX_ATTEMPTS) throw e;
        this.stats.retries++;
        await sleep(50 * attempt);
      }
    }
    throw lastErr;
  }
}
