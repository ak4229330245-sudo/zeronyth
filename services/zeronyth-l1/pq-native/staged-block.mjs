/** One validated, bounded pending block per validator; votes/commit reference its hash. */
import { ProtocolError, hashBlock } from './pq.mjs';

export class StagedBlockStore {
  #pending = null;

  constructor(replica) { this.replica = replica; }

  stage(block) {
    // Full independent signature, state-root, proposer and parent verification.
    this.replica.ledger.inspect(block);
    return this.#remember(block);
  }

  async stageParallel(block,pool) {
    await this.replica.ledger.inspectParallel(block,pool);
    return this.#remember(block);
  }

  #remember(block) {
    const hash = hashBlock(block.header);
    if (this.#pending && this.#pending.hash !== hash) {
      throw new ProtocolError('Conflicting proposed block for same validator slot');
    }
    if (!this.#pending) {
      this.#pending = {
        hash, block:structuredClone(block),
        height:this.replica.ledger.height, parent:this.replica.ledger.headHash,
      };
    }
    return hash;
  }

  getByHash(hash) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) ||
        this.#pending?.hash !== hash ||
        this.#pending.height !== this.replica.ledger.height ||
        this.#pending.parent !== this.replica.ledger.headHash) {
      throw new ProtocolError('Block not independently validated and staged at current height');
    }
    return this.#pending.block;
  }

  vote(hash) { return this.replica.vote(this.getByHash(hash)); }

  commit(hash, certificate) {
    const block = this.getByHash(hash);
    const committedHash = this.replica.commit(block, certificate);
    this.#pending = null;
    return committedHash;
  }

  clear() { this.#pending = null; }
}
