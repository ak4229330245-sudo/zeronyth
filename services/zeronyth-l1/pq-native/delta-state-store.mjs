/** Experimental asynchronous delta WAL. Not a production database or a consensus authority. */
import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { Ledger, stateHash } from './ledger.mjs';
import { ProtocolError, assertAddress, checkShape, digest, uint } from './pq.mjs';

const KIND='ZERONYTH_PQ_DELTA_STATE_V1';
const MAX_LOG_BYTES=128*1024*1024;
const MAX_RECORD_BYTES=4*1024*1024;
const MAX_ACCOUNTS=100_000;
const MAX_VIEWS=4;
const HASH=/^[a-f0-9]{64}$/;

function copyAccounts(accounts){
  return new Map([...accounts].map(([address,value])=>[address,{...value}]));
}

function checkedAccounts(accounts){
  if(!(accounts instanceof Map)||accounts.size>MAX_ACCOUNTS){
    throw new ProtocolError('Invalid bounded state map');
  }
  const validated=new Map();
  for(const [address,state] of accounts){
    assertAddress(address);
    if(!state||typeof state.balance!=='bigint'||typeof state.nonce!=='bigint'){
      throw new ProtocolError('State balances and nonces must be BigInt');
    }
    uint(state.balance.toString(),'balance');
    uint(state.nonce.toString(),'nonce');
    validated.set(address,{balance:state.balance,nonce:state.nonce});
  }
  return validated;
}

function recordDigest(record){
  return digest('ZERONYTH_PQ_DELTA_WAL_RECORD_V1\0',JSON.stringify([
    record.kind,record.genesisHash,record.height,record.previousOrderHash,
    record.orderHash,record.updates,record.stateRoot,record.previousDigest,
  ]));
}

export class DeltaStateStore {
  constructor(path,genesis){
    if(typeof path!=='string'||!path)throw new ProtocolError('Delta WAL path required');
    const base=new Ledger(genesis);
    this.path=path;
    this.genesisHash=base.headHash;
    this.accounts=copyAccounts(base.accounts);
    this.height=0n;
    this.lastOrderHash=this.genesisHash;
    this.stateRoot=stateHash(this.accounts);
    this.tip='0'.repeat(64);
    this.failed=false;
    this.closed=true;
    this.journal=null;
    this.lock=null;
    this.views=new Map([[0n,copyAccounts(this.accounts)]]);
    this.committed=[];
  }

  static async open(path,genesis){
    const store=new DeltaStateStore(path,genesis);
    await store.#open();
    return store;
  }

  async #open(){
    const nofollow=constants.O_NOFOLLOW||0;
    let madeLock=false;
    try{
      this.lock=await open(`${this.path}.lock`,
        constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|nofollow,0o600);
      madeLock=true;
      await this.lock.writeFile(`pid=${process.pid}\n`);
      await this.lock.sync();
      this.journal=await open(this.path,
        constants.O_RDWR|constants.O_CREAT|constants.O_APPEND|nofollow,0o600);
      const stat=await this.journal.stat();
      if(!stat.isFile()||(process.platform!=='win32'&&(stat.mode&0o077)!==0)||
          stat.size>MAX_LOG_BYTES)throw new ProtocolError('Unsafe, public or oversized delta WAL');
      const contents=await this.journal.readFile('utf8');
      if(contents&&!contents.endsWith('\n'))throw new ProtocolError('Truncated delta WAL');
      for(const line of contents.split('\n').filter(Boolean)){
        if(Buffer.byteLength(line,'utf8')>MAX_RECORD_BYTES)throw new ProtocolError('Oversized delta record');
        let record;
        try{record=JSON.parse(line);}catch{throw new ProtocolError('Corrupt JSON in delta WAL');}
        this.#replay(record);
      }
      this.closed=false;
    }catch(error){
      await this.journal?.close().catch(()=>{});
      await this.lock?.close().catch(()=>{});
      if(madeLock)await unlink(`${this.path}.lock`).catch(()=>{});
      this.journal=null;this.lock=null;
      throw error;
    }
  }

  #replay(record){
    checkShape(record,[
      'kind','genesisHash','height','previousOrderHash','orderHash','updates',
      'stateRoot','previousDigest','digest',
    ],'delta WAL record');
    if(record.kind!==KIND||record.genesisHash!==this.genesisHash||
       record.height!==(this.height+1n).toString()||
       record.previousOrderHash!==this.lastOrderHash||!HASH.test(record.orderHash)||
       record.previousDigest!==this.tip||record.digest!==recordDigest(record)||
       !HASH.test(record.stateRoot)||!Array.isArray(record.updates)||
       record.updates.length>3072){
      throw new ProtocolError('Delta WAL hash chain or height mismatch');
    }
    const candidate=new Map(this.accounts);
    let last='';
    for(const item of record.updates){
      checkShape(item,['address','balance','nonce'],'delta update');
      assertAddress(item.address);
      if(item.address<=last)throw new ProtocolError('Unsorted or duplicate state update');
      last=item.address;
      candidate.set(item.address,{
        balance:uint(item.balance,'balance'),nonce:uint(item.nonce,'nonce'),
      });
    }
    if(candidate.size>MAX_ACCOUNTS||stateHash(candidate)!==record.stateRoot){
      throw new ProtocolError('Delta WAL state root mismatch');
    }
    this.accounts=candidate;
    this.stateRoot=record.stateRoot;
    this.lastOrderHash=record.orderHash;
    this.tip=record.digest;
    this.height++;
    this.committed.push({orderHash:record.orderHash,stateRoot:record.stateRoot});
    this.#retainView();
  }

  #retainView(){
    this.views.set(this.height,copyAccounts(this.accounts));
    while(this.views.size>MAX_VIEWS)this.views.delete(this.views.keys().next().value);
  }

  snapshotAt(height=this.height){
    if(typeof height!=='bigint'||!this.views.has(height)){
      throw new ProtocolError('Snapshot not retained at requested height');
    }
    return copyAccounts(this.views.get(height));
  }

  async commit({previousOrderHash,orderHash,accounts}){
    if(this.closed||this.failed)throw new ProtocolError('Delta store unavailable');
    if(this.writing)throw new ProtocolError('Concurrent state writes prohibited');
    this.writing=true;
    try{
      if(previousOrderHash!==this.lastOrderHash||typeof orderHash!=='string'||
         !HASH.test(orderHash))throw new ProtocolError('Out-of-order certified state');
      const next=checkedAccounts(accounts);
      for(const oldAddress of this.accounts.keys()){
        if(!next.has(oldAddress))throw new ProtocolError('State account deletion is forbidden');
      }
      const updates=[];
      for(const [address,value] of next){
        const old=this.accounts.get(address);
        if(!old||old.balance!==value.balance||old.nonce!==value.nonce){
          updates.push({address,balance:value.balance.toString(),nonce:value.nonce.toString()});
        }
      }
      updates.sort((a,b)=>a.address.localeCompare(b.address));
      if(updates.length>3072)throw new ProtocolError('Delta account update budget exceeded');
      const record={kind:KIND,genesisHash:this.genesisHash,
        height:(this.height+1n).toString(),previousOrderHash,orderHash,updates,
        stateRoot:stateHash(next),previousDigest:this.tip};
      record.digest=recordDigest(record);
      const payload=Buffer.from(`${JSON.stringify(record)}\n`);
      if(payload.length>MAX_RECORD_BYTES||
          (await this.journal.stat()).size+payload.length>MAX_LOG_BYTES){
        throw new ProtocolError('Delta WAL capacity exceeded');
      }
      // Durable write + sync BEFORE exposing new state or height.
      try{
        let offset=0;
        while(offset<payload.length){
          const {bytesWritten}=await this.journal.write(payload,offset,payload.length-offset);
          if(bytesWritten<1)throw new ProtocolError('Delta WAL partial write');
          offset+=bytesWritten;
        }
        await this.journal.sync();
      }catch(error){
        this.failed=true;
        throw error;
      }
      this.accounts=next;
      this.height++;
      this.lastOrderHash=orderHash;
      this.stateRoot=record.stateRoot;
      this.tip=record.digest;
      this.committed.push({orderHash,stateRoot:record.stateRoot});
      this.#retainView();
      return {height:this.height.toString(),stateRoot:this.stateRoot,
        deltaAccounts:updates.length,walBytes:payload.length};
    }finally{this.writing=false;}
  }

  async close(){
    if(this.closed)return;
    if(this.writing)throw new ProtocolError('Cannot close delta WAL during fsync');
    this.closed=true;
    await this.journal?.close();
    await this.lock?.close();
    this.journal=null;this.lock=null;
    await unlink(`${this.path}.lock`);
  }
}
