/** ML-DSA ordering-only consensus research. NOT Besu, mainnet or safe view change. */
import { createPublicKey, sign, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { Ledger, MAX_BLOCK_BYTES, MAX_BLOCK_TRANSACTIONS, requiredValidatorQuorum } from './ledger.mjs';
import {
  ProtocolError, addressOf, canonicalTransaction, checkShape, digest,
  publicKeyObject,
} from './pq.mjs';
import { VoteJournal } from './journal.mjs';

export const ORDER_KIND='ZERONYTH_MLDSA_ORDER_ONLY_V1';
const ORDER_HASH_DOMAIN='ZERONYTH_MLDSA_ORDER_HASH_V1\0';
const MAX_LOG_BYTES=256*1024*1024;
const MAX_RECORD_BYTES=18*1024*1024;
const HASH=/^[a-f0-9]{64}$/;

function orderBody(label,hash){return Buffer.from(`${label}\0${hash}`,'utf8');}

function privateSigner(privateKey){
  if(privateKey?.asymmetricKeyType!=='ml-dsa-65'||privateKey.type!=='private'){
    throw new ProtocolError('Native ML-DSA-65 private signer required');
  }
  const publicKey=createPublicKey(privateKey).export({format:'der',type:'spki'}).toString('base64');
  return {privateKey,address:addressOf(publicKey)};
}

function verifiedSignature(label,hash,signature,publicKey){
  if(typeof signature!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)){
    throw new ProtocolError('Order signature is not canonical base64');
  }
  const bytes=Buffer.from(signature,'base64');
  if(bytes.length!==3309||bytes.toString('base64')!==signature||
      !verify(null,orderBody(label,hash),publicKeyObject(publicKey),bytes)){
    throw new ProtocolError('Invalid ML-DSA order signature');
  }
}

function canonicalBatch(transactions){
  if(!Array.isArray(transactions)||transactions.length<1||
      transactions.length>MAX_BLOCK_TRANSACTIONS){
    throw new ProtocolError('Invalid ordered transaction count');
  }
  const snapshot=transactions.map(canonicalTransaction);
  const encoded=JSON.stringify(snapshot);
  if(Buffer.byteLength(encoded,'utf8')>MAX_BLOCK_BYTES){
    throw new ProtocolError('Ordered candidate exceeds maximum transaction bytes');
  }
  return {snapshot,encoded};
}

export function orderGenesisHash(genesis){
  return digest('ZERONYTH_MLDSA_ORDER_GENESIS_V1\0',new Ledger(genesis).headHash);
}

export function hashOrder(header){
  checkShape(header,['kind','chainId','height','previousOrderHash','proposer','transactionsHash'],
    'order header');
  if(header.kind!==ORDER_KIND||!HASH.test(header.previousOrderHash)||
      !HASH.test(header.transactionsHash)||
      typeof header.proposer!=='string'||!/^qspq_[a-f0-9]{64}$/.test(header.proposer)||
      !/^[1-9][0-9]*$/.test(header.height)){
    throw new ProtocolError('Invalid canonical order header');
  }
  return digest(ORDER_HASH_DOMAIN,JSON.stringify(header));
}

export function proposeOrder(genesis,headHash,height,transactions,privateKey,journal){
  if(!(journal instanceof VoteJournal)){
    throw new ProtocolError('Durable proposer equivocation journal required');
  }
  const ledger=new Ledger(genesis);
  if(typeof height!=='bigint'||height<1n||!HASH.test(headHash)){
    throw new ProtocolError('Invalid ordering slot');
  }
  const signer=privateSigner(privateKey);
  const expected=ledger.validatorOrder[Number((height-1n)%BigInt(ledger.validatorOrder.length))];
  if(signer.address!==expected)throw new ProtocolError('Only designated ordering leader may propose');
  const {snapshot,encoded}=canonicalBatch(transactions);
  if(snapshot.some(tx=>tx.chainId!==ledger.genesis.chainId)){
    throw new ProtocolError('Cross-chain ordered transaction rejected');
  }
  const header={kind:ORDER_KIND,chainId:ledger.genesis.chainId,
    height:height.toString(),previousOrderHash:headHash,proposer:signer.address,
    transactionsHash:digest('ZERONYTH_MLDSA_ORDER_TX_LIST_V1\0',encoded)};
  const hash=hashOrder(header);
  journal.record(`${height}:0`,hash);
  const signature=sign(null,orderBody('ZERONYTH_MLDSA_ORDER_PROPOSAL_V1',hash),privateKey)
    .toString('base64');
  return {header,transactions:snapshot,
    proposerSeal:{validator:signer.address,orderHash:hash,signature}};
}

export function verifyOrderProposal(proposal,genesis,headHash,height){
  checkShape(proposal,['header','transactions','proposerSeal'],'order proposal');
  const ledger=new Ledger(genesis);
  const header=proposal.header;
  const hash=hashOrder(header);
  const expected=ledger.validatorOrder[Number((height-1n)%BigInt(ledger.validatorOrder.length))];
  if(header.chainId!==ledger.genesis.chainId||header.height!==height.toString()||
      header.previousOrderHash!==headHash||header.proposer!==expected){
    throw new ProtocolError('Wrong ordering domain, height, parent or leader');
  }
  const {snapshot,encoded}=canonicalBatch(proposal.transactions);
  if(snapshot.some(tx=>tx.chainId!==ledger.genesis.chainId)||
     header.transactionsHash!==digest('ZERONYTH_MLDSA_ORDER_TX_LIST_V1\0',encoded)){
    throw new ProtocolError('Order transaction list/hash mismatch');
  }
  const seal=proposal.proposerSeal;
  checkShape(seal,['validator','orderHash','signature'],'order proposer seal');
  if(seal.validator!==expected||seal.orderHash!==hash){
    throw new ProtocolError('Order proposer identity/hash mismatch');
  }
  verifiedSignature('ZERONYTH_MLDSA_ORDER_PROPOSAL_V1',hash,seal.signature,
    ledger.validators.get(expected));
  return hash;
}

export function voteOrder(proposal,genesis,headHash,height,privateKey,journal){
  if(!(journal instanceof VoteJournal)){
    throw new ProtocolError('Durable order vote journal required');
  }
  const hash=verifyOrderProposal(proposal,genesis,headHash,height);
  const signer=privateSigner(privateKey);
  if(!new Ledger(genesis).validators.has(signer.address)){
    throw new ProtocolError('Unauthorized order voter');
  }
  // An fsync-persisted slot/hash is mandatory BEFORE signing. Distinct votes
  // for the same ordering slot cannot be emitted by one signer.
  journal.record(`${height}:0`,hash);
  const signature=sign(null,orderBody('ZERONYTH_MLDSA_ORDER_VOTE_V1',hash),privateKey)
    .toString('base64');
  return {validator:signer.address,orderHash:hash,signature};
}

export function verifyCertifiedOrder(certified,genesis,headHash,height){
  checkShape(certified,['proposal','votes'],'certified order');
  const hash=verifyOrderProposal(certified.proposal,genesis,headHash,height);
  const validators=new Ledger(genesis).validators;
  const minimum=requiredValidatorQuorum(validators.size);
  if(!Array.isArray(certified.votes)||certified.votes.length<minimum||
      certified.votes.length>validators.size){
    throw new ProtocolError(`Ordering requires at least ${minimum} of ${validators.size} ML-DSA votes`);
  }
  const seen=new Set();
  for(const vote of certified.votes){
    checkShape(vote,['validator','orderHash','signature'],'order vote');
    if(seen.has(vote.validator)||!validators.has(vote.validator)||vote.orderHash!==hash){
      throw new ProtocolError('Duplicate, unknown or mismatched order validator');
    }
    verifiedSignature('ZERONYTH_MLDSA_ORDER_VOTE_V1',hash,vote.signature,
      validators.get(vote.validator));
    seen.add(vote.validator);
  }
  return hash;
}

function recordDigest(record){
  return digest('ZERONYTH_MLDSA_CERTIFIED_ORDER_RECORD_V1\0',JSON.stringify([
    record.kind,record.genesisHash,record.height,record.previousDigest,record.certified,
  ]));
}

export class CertifiedOrderLog{
  constructor(path,genesis){
    if(typeof path!=='string'||!path)throw new ProtocolError('Certified order path required');
    this.path=path;
    this.genesis=genesis;
    this.genesisHash=orderGenesisHash(genesis);
    this.headHash=this.genesisHash;
    this.height=0n;
    this.records=[];
    this.tip='0'.repeat(64);
    this.failed=false;
    this.closed=true;
    this.lock=null;this.file=null;
  }

  static async open(path,genesis){
    const log=new CertifiedOrderLog(path,genesis);
    await log.#open();
    return log;
  }

  async #open(){
    let madeLock=false;
    const nofollow=constants.O_NOFOLLOW||0;
    try{
      this.lock=await open(`${this.path}.lock`,
        constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|nofollow,0o600);
      madeLock=true;
      await this.lock.writeFile(`pid=${process.pid}\n`);
      await this.lock.sync();
      this.file=await open(this.path,
        constants.O_RDWR|constants.O_CREAT|constants.O_APPEND|nofollow,0o600);
      const stat=await this.file.stat();
      if(!stat.isFile()||(process.platform!=='win32'&&(stat.mode&0o077)!==0)||
          stat.size>MAX_LOG_BYTES)throw new ProtocolError('Unsafe or oversized certified order log');
      const contents=await this.file.readFile('utf8');
      if(contents&&!contents.endsWith('\n'))throw new ProtocolError('Truncated certified order log');
      for(const line of contents.split('\n').filter(Boolean)){
        if(Buffer.byteLength(line,'utf8')>MAX_RECORD_BYTES){
          throw new ProtocolError('Oversized certified order record');
        }
        let item;
        try{item=JSON.parse(line);}catch{throw new ProtocolError('Corrupt certified order JSON');}
        checkShape(item,['kind','genesisHash','height','previousDigest','certified','digest'],
          'certified order record');
        if(item.kind!==ORDER_KIND||item.genesisHash!==this.genesisHash||
            item.height!==(this.height+1n).toString()||item.previousDigest!==this.tip||
            item.digest!==recordDigest(item)){
          throw new ProtocolError('Certified order log chain mismatch');
        }
        const hash=verifyCertifiedOrder(item.certified,this.genesis,this.headHash,this.height+1n);
        this.records.push({hash,certified:item.certified});
        this.height++;
        this.headHash=hash;
        this.tip=item.digest;
      }
      this.closed=false;
    }catch(error){
      await this.file?.close().catch(()=>{});
      await this.lock?.close().catch(()=>{});
      if(madeLock)await unlink(`${this.path}.lock`).catch(()=>{});
      this.file=null;this.lock=null;
      throw error;
    }
  }

  async accept(certified){
    if(this.closed||this.failed||this.writing){
      throw new ProtocolError('Certified order log is unavailable or busy');
    }
    this.writing=true;
    try{
      const hash=verifyCertifiedOrder(certified,this.genesis,this.headHash,this.height+1n);
      const record={kind:ORDER_KIND,genesisHash:this.genesisHash,
        height:(this.height+1n).toString(),previousDigest:this.tip,
        certified:structuredClone(certified)};
      record.digest=recordDigest(record);
      const payload=Buffer.from(`${JSON.stringify(record)}\n`);
      if(payload.length>MAX_RECORD_BYTES||
          (await this.file.stat()).size+payload.length>MAX_LOG_BYTES){
        throw new ProtocolError('Certified order log capacity exceeded');
      }
      try{
        let offset=0;
        while(offset<payload.length){
          const {bytesWritten}=await this.file.write(payload,offset,payload.length-offset);
          if(bytesWritten<1)throw new ProtocolError('Certified order log write failed');
          offset+=bytesWritten;
        }
        await this.file.sync();
      }catch(error){this.failed=true;throw error;}
      this.tip=record.digest;
      this.records.push({hash,certified:record.certified});
      this.height++;
      this.headHash=hash;
      return {height:this.height.toString(),orderHash:hash,executed:false};
    }finally{this.writing=false;}
  }

  async close(){
    if(this.closed)return;
    if(this.writing)throw new ProtocolError('Cannot close certified log during fsync');
    this.closed=true;
    await this.file.close();
    await this.lock.close();
    this.file=null;this.lock=null;
    await unlink(`${this.path}.lock`);
  }
}
