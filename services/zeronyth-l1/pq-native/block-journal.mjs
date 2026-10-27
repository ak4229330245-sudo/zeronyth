/** Experimental durable, independently replay-verifiable ML-DSA block history. */
import {
  closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync,
  unlinkSync, writeSync,
} from 'node:fs';
import { checkShape, digest, hashBlock, ProtocolError } from './pq.mjs';

export const MAX_BLOCK_JOURNAL_BYTES = 512 * 1024 * 1024;
const MAX_RECORD_BYTES = 18 * 1024 * 1024;
const INITIAL_TIP = '0'.repeat(64);
const KIND = 'ZERONYTH_PQ_DURABLE_BLOCK_V1';

function recordHash(record) {
  return digest('ZERONYTH_PQ_DURABLE_BLOCK_RECORD_V1\0', JSON.stringify([
    record.kind, record.genesisHash, record.height, record.blockHash,
    record.block, record.votes, record.previous,
  ]));
}

export class BlockJournal {
  constructor(filePath, ledger) {
    if (typeof filePath !== 'string' || !filePath || !ledger) {
      throw new ProtocolError('Block journal requires a file path and a genesis ledger');
    }
    this.path = filePath;
    this.lockPath = `${filePath}.lock`;
    this.tip = INITIAL_TIP;
    this.genesisHash = ledger.headHash;
    this.nextHeight = 1n;
    this.failed = false;
    this.fd = undefined;
    this.lockFd = undefined;
    try {
      // EXCL makes accidental concurrent writers fail closed. A process crash
      // leaves this file in place; manual forensic review is required to clear.
      this.lockFd = openSync(this.lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
      writeSync(this.lockFd, Buffer.from(`pid=${process.pid}\n`, 'utf8'));
      fsyncSync(this.lockFd);
      this.fd = openSync(filePath,
        constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW || 0), 0o600);
      const stat = fstatSync(this.fd);
      if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
        throw new ProtocolError('Block journal must be a regular owner-only file (chmod 600)');
      }
      if (stat.size > MAX_BLOCK_JOURNAL_BYTES) throw new ProtocolError('Block journal is over size limit');
      const bytes = readFileSync(this.fd, 'utf8');
      if (bytes && !bytes.endsWith('\n')) throw new ProtocolError('Truncated block journal: refuse recovery');
      const lines = bytes.split('\n');
      lines.pop();
      for (const line of lines) {
        if (!line || Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
          throw new ProtocolError('Corrupt or excessive block journal record');
        }
        let record;
        try { record = JSON.parse(line); }
        catch { throw new ProtocolError('Corrupt JSON in block journal'); }
        checkShape(record, [
          'kind','genesisHash','height','blockHash','block','votes','previous','digest',
        ], 'block journal record');
        if (record.kind !== KIND || record.genesisHash !== this.genesisHash ||
            record.height !== this.nextHeight.toString() || record.previous !== this.tip ||
            record.blockHash !== hashBlock(record.block?.header) ||
            record.digest !== recordHash(record)) {
          throw new ProtocolError('Block journal chain/genesis/integrity mismatch');
        }
        // Replay must verify proposer, every transaction signature, current
        // nonce/balance/state root and the 3-of-4 ML-DSA quorum from scratch.
        const committedHash = ledger.commit(record.block, record.votes);
        if (committedHash !== record.blockHash) {
          throw new ProtocolError('Block journal replay hash mismatch');
        }
        this.tip = record.digest;
        this.nextHeight += 1n;
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  append(block, votes) {
    if (this.fd === undefined || this.failed) {
      throw new ProtocolError('Block journal unavailable: refuse commit');
    }
    if (block?.header?.height !== this.nextHeight.toString() ||
        block.header.previousHash === undefined) {
      throw new ProtocolError('Block journal refusing non-sequential height');
    }
    const record = {
      kind:KIND, genesisHash:this.genesisHash, height:this.nextHeight.toString(),
      blockHash:hashBlock(block.header), block:structuredClone(block),
      votes:structuredClone(votes), previous:this.tip,
    };
    record.digest = recordHash(record);
    const payload = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
    if (payload.length > MAX_RECORD_BYTES ||
        fstatSync(this.fd).size + payload.length > MAX_BLOCK_JOURNAL_BYTES) {
      throw new ProtocolError('Block journal full: refuse commit');
    }
    try {
      let offset = 0;
      while (offset < payload.length) {
        const written = writeSync(this.fd, payload, offset, payload.length - offset);
        if (written < 1) throw new ProtocolError('Block journal write failed');
        offset += written;
      }
      fsyncSync(this.fd); // durability boundary BEFORE any state transition
    } catch (error) {
      // After partial I/O or uncertain fsync, never try another block in this
      // process: an operator must verify the journal before recovery.
      this.failed = true;
      throw error;
    }
    this.tip = record.digest;
    this.nextHeight += 1n;
  }

  close() {
    if (this.fd !== undefined) { closeSync(this.fd); this.fd = undefined; }
    if (this.lockFd !== undefined) {
      closeSync(this.lockFd);
      this.lockFd = undefined;
      unlinkSync(this.lockPath);
    }
  }
}
