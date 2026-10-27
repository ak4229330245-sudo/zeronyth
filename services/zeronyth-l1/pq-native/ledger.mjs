/** In-memory research ledger. This is NOT Besu, QBFT or an EVM implementation. */
import {
  BLOCK_KIND, GENESIS_KIND, MAX_UINT, ProtocolError, addressOf, assertAddress,
  canonicalTransaction, chainId, checkShape, digest, hashBlock, publicKeyObject, uint,
  verifyProposal, verifyTransaction, verifyVote,
} from './pq.mjs';
import { SignatureVerificationPool } from './verification-pool.mjs';
import { ParallelExecutionPool } from './execution-pool.mjs';

export function stateHash(accounts) {
  const records = [...accounts.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([address, value]) => [address, value.balance.toString(), value.nonce.toString()]);
  return digest('ZERONYTH_MLDSA_STATE_V1\0', JSON.stringify(records));
}

function account(accounts, address) {
  return accounts.get(address) || { balance: 0n, nonce: 0n };
}

export const MAX_BLOCK_TRANSACTIONS = 1536;
export const MAX_BLOCK_BYTES = 16 * 1024 * 1024;
// Limit genesis payload size, not its number of validator identities. A member
// set is immutable during one genesis/epoch: changing it requires a new,
// independently agreed checkpoint protocol that this lab does not provide.
export const MAX_GENESIS_BYTES = 1024 * 1024;
export function requiredValidatorQuorum(validatorCount) {
  if(!Number.isSafeInteger(validatorCount)||validatorCount<4){
    throw new ProtocolError('Validator committee needs at least 4 members');
  }
  // Any two >2/3 certificates intersect in more than f Byzantine members,
  // with f=floor((N-1)/3). Four validators still require exactly three votes.
  return Math.floor(2*validatorCount/3)+1;
}
const MAX_VERIFIED_TX_CACHE = 3072;

function canonicalTransactions(transactions) {
  if (!Array.isArray(transactions) || transactions.length < 1 || transactions.length > MAX_BLOCK_TRANSACTIONS) {
    throw new ProtocolError(`Block must contain 1 to ${MAX_BLOCK_TRANSACTIONS} transactions`);
  }
  const canonical = JSON.stringify(transactions.map(canonicalTransaction));
  if (Buffer.byteLength(canonical, 'utf8') > MAX_BLOCK_BYTES) {
    throw new ProtocolError('Block exceeds maximum encoded transaction bytes');
  }
  return canonical;
}

export function validateGenesis(genesis) {
  checkShape(genesis, ['kind','chainId','validators','allocations'], 'genesis');
  if(Buffer.byteLength(JSON.stringify(genesis),'utf8')>MAX_GENESIS_BYTES){
    throw new ProtocolError('Genesis exceeds bounded encoded size');
  }
  if (genesis.kind !== GENESIS_KIND) throw new ProtocolError('Invalid PQ genesis kind');
  chainId(genesis.chainId);
  if (!Array.isArray(genesis.validators)) throw new ProtocolError('Missing validator committee');
  requiredValidatorQuorum(genesis.validators.length);
  const ids = new Set();
  for (const item of genesis.validators) {
    checkShape(item, ['publicKey'], 'validator');
    publicKeyObject(item.publicKey);
    const id = addressOf(item.publicKey);
    if (ids.has(id)) throw new ProtocolError('Duplicate validator');
    ids.add(id);
  }
  if (!Array.isArray(genesis.allocations) || genesis.allocations.length > 128) {
    throw new ProtocolError('Invalid genesis allocations');
  }
  const allocated = new Set();
  for (const item of genesis.allocations) {
    checkShape(item, ['address','balance'], 'allocation');
    assertAddress(item.address);
    uint(item.balance, 'genesis balance');
    if (allocated.has(item.address)) throw new ProtocolError('Duplicate genesis allocation');
    allocated.add(item.address);
  }
  return true;
}

export class Ledger {
  #verifiedTx = new Map();
  #proposedCandidate = null;

  constructor(genesis) {
    validateGenesis(genesis);
    this.genesis = {
      kind:GENESIS_KIND, chainId:genesis.chainId,
      validators:genesis.validators.map(({ publicKey }) => ({ publicKey })),
      allocations:genesis.allocations.map(({ address, balance }) => ({ address, balance }))
        .sort((a,b) => a.address.localeCompare(b.address)),
    };
    this.height = 0n;
    this.headHash = digest('ZERONYTH_MLDSA_GENESIS_V1\0', JSON.stringify(this.genesis));
    this.accounts = new Map(genesis.allocations.map(({ address, balance }) => [
      address, { balance: BigInt(balance), nonce: 0n },
    ]));
    this.validators = new Map(genesis.validators.map(({ publicKey }) => [addressOf(publicKey), publicKey]));
    this.validatorOrder = genesis.validators.map(({ publicKey }) => addressOf(publicKey));
    this.history = [];
    this._validatedProposal = null;
    // Positive-only signature cache: each entry is bound to ALL canonical signed
    // transaction fields (including signature and chain ID). A hit only skips
    // repeated cryptography; nonce, balances and block state are NEVER cached.
  }

  balance(address) { assertAddress(address); return account(this.accounts, address).balance; }
  nonce(address) { assertAddress(address); return account(this.accounts, address).nonce; }
  stateRoot() { return stateHash(this.accounts); }

  expectedProposer() {
    return this.validatorOrder[Number(this.height % BigInt(this.validatorOrder.length))];
  }

  #fingerprintOfSignedTx(canonical) {
    return digest('ZERONYTH_PQ_VERIFIED_SIGNED_TX_V1\0', JSON.stringify(canonical));
  }

  #rememberVerified(canonical, verified, fingerprint = this.#fingerprintOfSignedTx(canonical)) {
    if (this.#verifiedTx.has(fingerprint)) this.#verifiedTx.delete(fingerprint);
    if (this.#verifiedTx.size >= MAX_VERIFIED_TX_CACHE) {
      this.#verifiedTx.delete(this.#verifiedTx.keys().next().value);
    }
    this.#verifiedTx.set(fingerprint, Object.freeze(verified));
  }

  #verifySignedTransaction(tx) {
    // Canonical field validation happens even on a cache hit. Including the
    // signature in the fingerprint prevents mutated signatures from inheriting
    // a prior valid verdict. The digest is domain-separated from block hashes.
    const canonical = canonicalTransaction(tx);
    if (canonical.chainId !== this.genesis.chainId) {
      throw new ProtocolError('Cross-chain replay rejected');
    }
    const fingerprint = this.#fingerprintOfSignedTx(canonical);
    const cached = this.#verifiedTx.get(fingerprint);
    if (cached) {
      this.#verifiedTx.delete(fingerprint);
      this.#verifiedTx.set(fingerprint, cached);
      return cached;
    }
    const verified = Object.freeze(verifyTransaction(canonical, this.genesis.chainId));
    this.#rememberVerified(canonical, verified, fingerprint);
    return verified;
  }

  preverifyTransactions(transactions) {
    // Each validator independently verifies its own received signed bytes.
    // This is NOT consensus approval, transaction execution, or a relay trust.
    canonicalTransactions(transactions);
    for (const tx of transactions) this.#verifySignedTransaction(tx);
    return transactions.length;
  }

  async preverifyTransactionsAsync(transactions, pool) {
    canonicalTransactions(transactions);
    if (!(pool instanceof SignatureVerificationPool)) {
      throw new ProtocolError('An ML-DSA verification pool is required');
    }
    // Snapshot complete signed bytes before handing them to asynchronous CPU
    // workers. No network peer is trusted to vouch for signature validity.
    const snapshot = transactions.map(canonicalTransaction);
    const results = await pool.verifyTransactions(snapshot, this.genesis.chainId);
    if (!Array.isArray(results) || results.length !== snapshot.length) {
      throw new ProtocolError('Incomplete ML-DSA batch verification');
    }
    const verified = results.map((record, i) => {
      checkShape(record, ['sender','nonce','value'], 'verified worker result');
      if (record.sender !== addressOf(snapshot[i].publicKey)) {
        throw new ProtocolError('ML-DSA worker signer mismatch');
      }
      const nonce=uint(record.nonce,'nonce');
      const value=uint(record.value,'value',{min:1n});
      if(nonce!==uint(snapshot[i].nonce,'nonce')||
          value!==uint(snapshot[i].value,'value',{min:1n})){
        throw new ProtocolError('ML-DSA worker signed-transaction fields mismatch');
      }
      return Object.freeze({
        sender:record.sender,
        nonce,value,
      });
    });
    for (let i = 0; i < snapshot.length; i++) this.#rememberVerified(snapshot[i], verified[i]);
    return snapshot.length;
  }

  simulate(transactions) {
    canonicalTransactions(transactions);
    const accounts = new Map([...this.accounts].map(([id, state]) => [id, { ...state }]));
    const seen = new Set();
    for (const tx of transactions) {
      const { sender, nonce, value } = this.#verifySignedTransaction(tx);
      // Two transfers from one sender with the same nonce can NEVER both be
      // valid in one ordered batch. Use that already-verified invariant as an
      // exact replay key, avoiding an extra JSON serialization + SHA-256 per
      // transaction without weakening signature or replay checks.
      const nonceKey=`${sender}:${nonce}`;
      if (seen.has(nonceKey)) throw new ProtocolError('Duplicate transaction');
      seen.add(nonceKey);
      const source = account(accounts, sender);
      if (nonce !== source.nonce) throw new ProtocolError('Nonce/replay rejected');
      if (source.nonce === MAX_UINT) throw new ProtocolError('Nonce overflow');
      if (value > source.balance) throw new ProtocolError('Insufficient balance');
      // Distinguish the old source snapshot from the destination to support self-transfers.
      accounts.set(sender, { balance: source.balance - value, nonce: source.nonce + 1n });
      const dest = account(accounts, tx.to);
      if (dest.balance + value > MAX_UINT) throw new ProtocolError('Balance overflow');
      accounts.set(tx.to, { balance: dest.balance + value, nonce: dest.nonce });
    }
    return { accounts, stateRoot: stateHash(accounts) };
  }

  async simulateParallel(transactions, pool) {
    canonicalTransactions(transactions);
    if (!(pool instanceof ParallelExecutionPool) || pool.closed) {
      throw new ProtocolError('A live bounded parallel execution pool is required');
    }
    const originalHeight=this.height;
    const originalHead=this.headHash;
    const originalStateRoot=this.stateRoot();
    const snapshots=transactions.map(canonicalTransaction);
    const verified=snapshots.map(tx=>this.#verifySignedTransaction(tx));
    const seen=new Set();
    for (const record of verified) {
      const nonceKey=`${record.sender}:${record.nonce}`;
      if (seen.has(nonceKey)) throw new ProtocolError('Duplicate transaction');
      seen.add(nonceKey);
    }
    // Union-find by every touched account. Any transfers that may affect each
    // other's nonce or balance MUST execute in original order in ONE component.
    const parents=transactions.map((_,i)=>i);
    const root=i=>{ while(parents[i]!==i){ parents[i]=parents[parents[i]];i=parents[i]; }return i; };
    const union=(i,j)=>{ const a=root(i),b=root(j);if(a!==b)parents[b]=a; };
    const firstTouch=new Map();
    for (let i=0;i<snapshots.length;i++) {
      for (const address of [verified[i].sender,snapshots[i].to]) {
        if (firstTouch.has(address)) union(i,firstTouch.get(address));
        else firstTouch.set(address,i);
      }
    }
    const components=new Map();
    for (let i=0;i<snapshots.length;i++) {
      const r=root(i);
      if (!components.has(r)) components.set(r,[]);
      components.get(r).push(i);
    }
    if (components.size < 2 || transactions.length < 32) return this.simulate(transactions);
    // Transactions are executed in parallel when account-disjoint.
    const groups=[...components.values()].map((indices,id)=>{
      const touched=new Set();
      const transfers=indices.map(index=>{
        const tx=snapshots[index], verification=verified[index];
        touched.add(verification.sender); touched.add(tx.to);
        return {sender:verification.sender,to:tx.to,
          nonce:verification.nonce.toString(),value:verification.value.toString()};
      });
      return {id,transfers,accounts:[...touched].sort().map(address=>({
        address,balance:account(this.accounts,address).balance.toString(),
        nonce:account(this.accounts,address).nonce.toString(),
      }))};
    });
    const results=await pool.execute(groups);
    if (this.height!==originalHeight || this.headHash!==originalHead ||
        this.stateRoot()!==originalStateRoot) {
      throw new ProtocolError('Ledger changed during speculative parallel execution');
    }
    const merged=new Map([...this.accounts].map(([id,state])=>[id,{...state}]));
    for (let i=0;i<groups.length;i++) {
      const result=results[i], group=groups[i];
      checkShape(result,['id','accounts'],'execution result');
      if (result.id!==group.id || !Array.isArray(result.accounts) ||
          result.accounts.length!==group.accounts.length) {
        throw new ProtocolError('Parallel execution result mismatch');
      }
      for (let j=0;j<result.accounts.length;j++) {
        const item=result.accounts[j];
        checkShape(item,['address','balance','nonce'],'executed account');
        if (item.address!==group.accounts[j].address) {
          throw new ProtocolError('Parallel component address substitution');
        }
        merged.set(item.address,{
          balance:uint(item.balance,'balance'),nonce:uint(item.nonce,'nonce'),
        });
      }
    }
    return {accounts:merged,stateRoot:stateHash(merged)};
  }

  propose(transactions) {
    const next = this.simulate(transactions);
    const {stateRoot}=next;
    const txHash=digest('ZERONYTH_MLDSA_TX_LIST_V1\0',canonicalTransactions(transactions));
    // The elected proposer just validated ALL cryptographic signed bytes and
    // executed the exact batch at this parent. Its later stage/commit must
    // still validate the proposal seal, exact transaction-list hash, state
    // root and chain parent, but need not execute the identical batch twice.
    this.#proposedCandidate={height:this.height,parent:this.headHash,
      transactionsHash:txHash,stateRoot,next};
    return {
      header: {
        kind: BLOCK_KIND, chainId: this.genesis.chainId,
        height: (this.height + 1n).toString(), round: '0',
        previousHash: this.headHash, proposer: this.expectedProposer(),
        transactionsHash:txHash,
        stateRoot,
      },
      transactions: structuredClone(transactions),
    };
  }

  async proposeParallel(transactions,pool) {
    const speculative=await this.simulateParallel(transactions,pool);
    // Research safety gate: unreviewed parallel arithmetic may NEVER define
    // consensus state by itself. Cross-check against the trusted serial path.
    const trusted=this.simulate(transactions);
    if (speculative.stateRoot!==trusted.stateRoot) {
      throw new ProtocolError('Parallel proposer state differs from canonical serial state');
    }
    const {stateRoot}=trusted;
    const txHash=digest('ZERONYTH_MLDSA_TX_LIST_V1\0',canonicalTransactions(transactions));
    this.#proposedCandidate={height:this.height,parent:this.headHash,
      transactionsHash:txHash,stateRoot,next:trusted};
    return {
      header:{
        kind:BLOCK_KIND,chainId:this.genesis.chainId,
        height:(this.height+1n).toString(),round:'0',
        previousHash:this.headHash,proposer:this.expectedProposer(),
        transactionsHash:txHash,
        stateRoot,
      },
      transactions:structuredClone(transactions),
    };
  }

  #inspectEnvelope(block) {
    checkShape(block, ['header','transactions','proposalSeal'], 'block');
    const header = block.header;
    checkShape(header, [
      'kind','chainId','height','round','previousHash','proposer','transactionsHash','stateRoot',
    ], 'block header');
    if (header.kind !== BLOCK_KIND || header.chainId !== this.genesis.chainId ||
        header.height !== (this.height + 1n).toString() || header.round !== '0' ||
        header.previousHash !== this.headHash || header.proposer !== this.expectedProposer()) {
      throw new ProtocolError('Invalid block height/parent/leader/domain');
    }
    if (!/^[0-9a-f]{64}$/.test(header.transactionsHash) || !/^[0-9a-f]{64}$/.test(header.stateRoot)) {
      throw new ProtocolError('Invalid block digest encoding');
    }
    const txBytes = canonicalTransactions(block.transactions);
    // The cache is bound to the exact sealed block bytes *and* current parent state.
    // Never reuse a signature verdict for a changed seal, transaction or chain head.
    const proposalFingerprint = digest('ZERONYTH_PQ_VERIFIED_PROPOSAL_V1\0',
      JSON.stringify([hashBlock(header), block.proposalSeal, txBytes]));
    if (this._validatedProposal?.fingerprint === proposalFingerprint &&
        this._validatedProposal?.height === this.height &&
        this._validatedProposal?.parent === this.headHash) {
      return {fingerprint:proposalFingerprint,cached:this._validatedProposal.next};
    }

    verifyProposal(header, block.proposalSeal, this.validators.get(header.proposer));
    if (digest('ZERONYTH_MLDSA_TX_LIST_V1\0', txBytes) !== header.transactionsHash) {
      throw new ProtocolError('Block transaction hash mismatch');
    }
    const candidate=this.#proposedCandidate;
    if(candidate&&candidate.height===this.height&&candidate.parent===this.headHash&&
        candidate.transactionsHash===header.transactionsHash&&
        candidate.stateRoot===header.stateRoot){
      this.#rememberProposal(proposalFingerprint,candidate.next);
      return {fingerprint:proposalFingerprint,cached:candidate.next};
    }
    return {fingerprint:proposalFingerprint,cached:null};
  }

  #rememberProposal(fingerprint,next) {
    this._validatedProposal={fingerprint,height:this.height,parent:this.headHash,next};
  }

  inspect(block) {
    const {fingerprint,cached}=this.#inspectEnvelope(block);
    if (cached) return cached;
    const next=this.simulate(block.transactions);
    if (next.stateRoot!==block.header.stateRoot) throw new ProtocolError('Block state root mismatch');
    this.#rememberProposal(fingerprint,next);
    return next;
  }

  async inspectParallel(block,pool) {
    const {fingerprint,cached}=this.#inspectEnvelope(block);
    if (cached) return cached;
    const speculative=await this.simulateParallel(block.transactions,pool);
    const next=this.simulate(block.transactions);
    if (speculative.stateRoot!==next.stateRoot) {
      throw new ProtocolError('Parallel validator state differs from canonical serial state');
    }
    if (next.stateRoot !== block.header.stateRoot) throw new ProtocolError('Block state root mismatch');
    this.#rememberProposal(fingerprint,next);
    return next;
  }

  verifyCertificate(block, votes) {
    const minimum=requiredValidatorQuorum(this.validators.size);
    if (!Array.isArray(votes) || votes.length < minimum || votes.length > this.validators.size) {
      throw new ProtocolError(`Validator quorum requires at least ${minimum} PQ approvals`);
    }
    const seen = new Set();
    for (const vote of votes) {
      if (typeof vote?.validator !== 'string' || seen.has(vote.validator)) {
        throw new ProtocolError('Duplicate or missing validator identity');
      }
      const publicKey = this.validators.get(vote.validator);
      if (!publicKey) throw new ProtocolError('Vote from unknown validator');
      verifyVote(block.header, vote, publicKey);
      seen.add(vote.validator);
    }
    return true;
  }

  commit(block, votes) {
    const next = this.inspect(block);
    this.verifyCertificate(block, votes);
    this.accounts = next.accounts;
    this.height += 1n;
    this.headHash = hashBlock(block.header);
    this._validatedProposal = null;
    this.#proposedCandidate = null;
    this.history.push({ block: structuredClone(block), votes: structuredClone(votes) });
    return this.headHash;
  }
}
