/** fsync-before-apply durability wrapper for the experimental ML-DSA ledger. */
import { BlockJournal } from './block-journal.mjs';
import { Ledger } from './ledger.mjs';
import { ProtocolError } from './pq.mjs';

export class DurableLedger extends Ledger {
  #journal = null;
  #closed = false;

  constructor(genesis, path) {
    super(genesis);
    // BlockJournal invokes this.commit() to replay every cryptographically
    // certified block. Before the journal is assigned it routes to super.commit
    // and cannot reappend a recovered record.
    this.#journal = new BlockJournal(path, this);
  }

  commit(block, votes) {
    if (this.#closed) throw new ProtocolError('Durable ledger is closed');
    if (this.#journal) {
      // No block is durable merely because the process saw an HTTP response.
      // Validate all signatures and state BEFORE persisting the record.
      this.inspect(block);
      this.verifyCertificate(block, votes);
      this.#journal.append(block, votes);
    }
    // Journal fsync succeeded; now move the in-memory canonical state forward.
    const hash = super.commit(block, votes);
    // Durable blocks remain on disk; retaining all signatures in RAM forever
    // would exhaust a node during continuous execution.
    if (this.history.length > 32) this.history.splice(0, this.history.length - 32);
    return hash;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#journal?.close();
  }
}
