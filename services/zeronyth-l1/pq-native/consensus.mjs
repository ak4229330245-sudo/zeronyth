/** Quorum-certificate laboratory: no network/view-change, NOT production QBFT. */
import { createPublicKey } from 'node:crypto';
import { Ledger } from './ledger.mjs';
import { DurableLedger } from './durable-ledger.mjs';
import { ProtocolError, addressOf, hashBlock, signProposal, signVote } from './pq.mjs';

export class ValidatorReplica {
  constructor(genesis, privateKey, { journal = null, blockStore = null } = {}) {
    if (privateKey?.asymmetricKeyType !== 'ml-dsa-65') {
      throw new ProtocolError('Validator must use ML-DSA-65 private key');
    }
    this.privateKey = privateKey;
    this.publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
    this.id = addressOf(this.publicKey);
    this.ledger = blockStore === null ? new Ledger(genesis) : new DurableLedger(genesis, blockStore);
    if (!this.ledger.validators.has(this.id)) {
      this.ledger.close?.();
      throw new ProtocolError('Validator identity not included in genesis');
    }
    this.signed = new Map();
    this.journal = journal;
  }

  propose(transactions) {
    if (this.id !== this.ledger.expectedProposer()) {
      throw new ProtocolError('Only designated proposer may propose');
    }
    const block = this.ledger.propose(transactions);
    const slot = `${block.header.height}:${block.header.round}`;
    const previous = this.signed.get(slot);
    if (previous && previous.hash !== hashBlock(block.header)) {
      throw new ProtocolError('Proposer equivocation rejected');
    }
    this.journal?.record(slot, hashBlock(block.header));
    const sealed = { ...block, proposalSeal: signProposal(block.header, this.privateKey) };
    this.vote(sealed);
    return sealed;
  }

  async proposeParallel(transactions,pool) {
    if (this.id!==this.ledger.expectedProposer()) {
      throw new ProtocolError('Only designated proposer may propose');
    }
    const block=await this.ledger.proposeParallel(transactions,pool);
    const slot=`${block.header.height}:${block.header.round}`;
    const hash=hashBlock(block.header);
    const previous=this.signed.get(slot);
    if (previous && previous.hash!==hash) throw new ProtocolError('Proposer equivocation rejected');
    this.journal?.record(slot,hash);
    const sealed={...block,proposalSeal:signProposal(block.header,this.privateKey)};
    this.vote(sealed);
    return sealed;
  }

  vote(block) {
    this.ledger.inspect(block);
    const slot = `${block.header.height}:${block.header.round}`;
    const hash = hashBlock(block.header);
    const previous = this.signed.get(slot);
    if (previous && previous.hash !== hash) {
      throw new ProtocolError('Validator double-sign/equivocation rejected');
    }
    if (previous) return previous.vote;
    this.journal?.record(slot, hash);
    const vote = signVote(block.header, this.privateKey);
    this.signed.set(slot, { hash, vote });
    return vote;
  }

  commit(block, certificate) { return this.ledger.commit(block, certificate); }
}

export function oneRoundCommit(replicas, transactions, { participating = null } = {}) {
  if (!Array.isArray(replicas) || !replicas.length ||
      replicas.length!==replicas[0].ledger.validatorOrder.length) {
    throw new ProtocolError('A complete genesis validator committee is required');
  }
  const reference = replicas[0].ledger;
  const identities=new Set(replicas.map(replica=>replica.id));
  if(identities.size!==replicas.length||
      replicas.some(replica=>!reference.validators.has(replica.id)||
        replica.ledger.validatorOrder.join(',')!==reference.validatorOrder.join(','))){
    throw new ProtocolError('Duplicate, missing or inconsistent validator committee identity');
  }
  if (replicas.some(replica => replica.ledger.height !== reference.height ||
      replica.ledger.headHash !== reference.headHash)) {
    throw new ProtocolError('Replica parent divergence: refuse partial commit');
  }
  const leader = replicas.find(replica => replica.id === replicas[0].ledger.expectedProposer());
  if (!leader) throw new ProtocolError('No expected leader');
  const block = leader.propose(transactions);
  const participatingIndices=participating===null?replicas.map((_,index)=>index):participating;
  if(!Array.isArray(participatingIndices))throw new ProtocolError('Invalid validator participation list');
  const votes = participatingIndices.map(index => {
    if (!Number.isInteger(index) || index < 0 || index >= replicas.length) {
      throw new ProtocolError('Invalid validator index');
    }
    return replicas[index].vote(block);
  });
  leader.ledger.verifyCertificate(block, votes);
  // The runner supplies a verified certificate to all replicas. There is no P2P protocol.
  for (const replica of replicas) replica.commit(block, votes);
  return { block, votes, hash: hashBlock(block.header) };
}
