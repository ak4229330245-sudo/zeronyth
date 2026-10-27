/** Best-effort crash-safe anti-equivocation journal for *local lab* validators. */
import { closeSync, fstatSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { checkShape, digest, ProtocolError } from './pq.mjs';

const GENESIS_RECORD_HASH = '0'.repeat(64);
const MAX_JOURNAL_BYTES = 128 * 1024 * 1024;

export class VoteJournal {
  constructor(filePath) {
    if (!filePath || typeof filePath !== 'string') throw new ProtocolError('Vote journal path required');
    this.fd = openSync(filePath, 'a+', 0o600);
    this.entries = new Map();
    this.tip = GENESIS_RECORD_HASH;
    try {
      const stat = fstatSync(this.fd);
      if (process.platform !== 'win32' && (stat.mode & 0o077)) {
        throw new ProtocolError('Vote journal must be owner-only (chmod 600)');
      }
      if (stat.size > MAX_JOURNAL_BYTES) throw new ProtocolError('Vote journal size limit reached');
      const bytes = readFileSync(filePath, 'utf8');
      if (bytes && !bytes.endsWith('\n')) throw new ProtocolError('Truncated vote journal');
      for (const line of bytes.split('\n').filter(Boolean)) {
        const record = JSON.parse(line);
        checkShape(record, ['slot','blockHash','previous','digest'], 'journal entry');
        if (!/^([1-9][0-9]*):0$/.test(record.slot) ||
            !/^[a-f0-9]{64}$/.test(record.blockHash) ||
            record.previous !== this.tip || this.entries.has(record.slot)) {
          throw new ProtocolError('Corrupt or reordered vote journal');
        }
        const expected = digest('ZERONYTH_PQ_VOTE_JOURNAL_V1\0',
          JSON.stringify([record.slot, record.blockHash, record.previous]));
        if (record.digest !== expected) throw new ProtocolError('Vote journal digest mismatch');
        this.entries.set(record.slot, record.blockHash);
        this.tip = expected;
      }
    } catch (error) {
      closeSync(this.fd);
      throw error;
    }
  }

  record(slot, blockHash) {
    if (!/^([1-9][0-9]*):0$/.test(slot) || !/^[a-f0-9]{64}$/.test(blockHash)) {
      throw new ProtocolError('Invalid vote journal slot/hash');
    }
    const previous = this.entries.get(slot);
    if (previous) {
      if (previous !== blockHash) throw new ProtocolError('Persistent double-sign protection');
      return;
    }
    const record = {
      slot, blockHash, previous:this.tip,
      digest:digest('ZERONYTH_PQ_VOTE_JOURNAL_V1\0',
        JSON.stringify([slot, blockHash, this.tip])),
    };
    const payload = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
    if (fstatSync(this.fd).size + payload.length > MAX_JOURNAL_BYTES) {
      throw new ProtocolError('Vote journal full: fail closed');
    }
    let offset = 0;
    while (offset < payload.length) {
      const written = writeSync(this.fd, payload, offset, payload.length-offset);
      if (written < 1) throw new ProtocolError('Vote journal write failed: refuse signature');
      offset += written;
    }
    fsyncSync(this.fd); // do not authorize a new signature until journal write is durable
    this.entries.set(slot, blockHash);
    this.tip = record.digest;
  }

  close() { if (this.fd !== undefined) { closeSync(this.fd); this.fd = undefined; } }
}
