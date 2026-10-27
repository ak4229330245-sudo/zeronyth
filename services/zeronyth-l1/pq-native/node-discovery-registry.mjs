/** Signed, opt-in resource discovery. Joining NEVER activates chain validation,
 *  paid rental, ZNYT issuance or real AI entitlement by itself.
 */
import {appendFileSync,existsSync,lstatSync,readFileSync} from 'node:fs';
import {MARKET_KINDS,verifyMarket} from './market-crypto.mjs';
import {ProtocolError,uint} from './pq.mjs';

const MAX_SKEW_MS=120000n;
const ONLINE_MS=90000;
const MAX_JOURNAL_BYTES=64*1024*1024;

function numeric(value,name,max,{min=0n}={}){
  const n=uint(value,name,{min});
  if(n>BigInt(max))throw new ProtocolError(`${name} exceeds allowed discovery bound`);
  return Number(n);
}

export class NodeDiscoveryRegistry {
  #nodes=new Map();
  #now;
  #journalPath;

  constructor({chainId,journalPath=null,now=()=>Date.now()}={}){
    if(typeof chainId!=='string'||!/^\d+$/.test(chainId)||
        typeof now!=='function'||
        (journalPath!==null&&
          (typeof journalPath!=='string'||!journalPath.startsWith('/')))){
      throw new ProtocolError('Node registry requires chain ID and optional absolute journal');
    }
    this.chainId=chainId;
    this.#journalPath=journalPath;
    this.#now=now;
    if(journalPath&&existsSync(journalPath)){
      const stat=lstatSync(journalPath);
      if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||
          stat.size>MAX_JOURNAL_BYTES||
          (typeof process.getuid==='function'&&stat.uid!==process.getuid())){
        throw new ProtocolError('Node journal must be owned mode-0600 regular file within size budget');
      }
      const raw=readFileSync(journalPath,'utf8');
      if(raw&&!raw.endsWith('\n'))throw new ProtocolError('Truncated node journal');
      for(const line of raw.split('\n').filter(Boolean)){
        let event;
        try{event=JSON.parse(line);}catch{throw new ProtocolError('Corrupted node journal');}
        this.#apply(event.signed,{replay:true,receivedAtMs:event.receivedAtMs});
      }
    }
  }

  #apply(signed,{replay=false,receivedAtMs=this.#now()}={}){
    const kind=signed?.kind;
    if(![MARKET_KINDS.NODE_JOIN,MARKET_KINDS.NODE_PULSE].includes(kind)){
      throw new ProtocolError('Unknown signed node discovery kind');
    }
    const {signer,payload}=verifyMarket(signed,kind,this.chainId);
    const previous=this.#nodes.get(signer);
    const nonce=uint(payload.nonce,'node discovery nonce');
    const expected=previous?BigInt(previous.nextNonce):0n;
    if(nonce!==expected)throw new ProtocolError('Node discovery nonce/replay rejected');
    const issued=uint(payload.issuedAtMs,'node discovery issue time',{min:1n});
    if(!Number.isSafeInteger(receivedAtMs)||receivedAtMs<1){
      throw new ProtocolError('Invalid node discovery receipt time');
    }
    const seen=uint(String(receivedAtMs),'registry receipt time',{min:1n});
    if(issued>BigInt(Number.MAX_SAFE_INTEGER)){
      throw new ProtocolError('Node discovery issue time out of JS range');
    }
    if(!replay&&(issued>seen+MAX_SKEW_MS||issued+MAX_SKEW_MS<seen)){
      throw new ProtocolError('Node discovery event timestamp is stale or future');
    }
    let record;
    if(kind===MARKET_KINDS.NODE_JOIN){
      if(payload.termsAccepted!==true||
          !['desktop','laptop','server'].includes(payload.deviceClass)||
          typeof payload.gpuSummary!=='string'||payload.gpuSummary.length>256){
        throw new ProtocolError('Explicit provider opt-in and valid hardware profile required');
      }
      const cpuCores=numeric(payload.cpuCores,'advertised CPU cores',128,{min:1n});
      const ramMiB=numeric(payload.ramMiB,'advertised RAM MiB',1048576,{min:512n});
      const gpuCount=numeric(payload.gpuCount,'advertised GPU count',16);
      const l1Percent=numeric(payload.l1Percent,'L1 percent',100);
      const aiPercent=numeric(payload.aiPercent,'AI percent',100);
      const rentalPercent=numeric(payload.rentalPercent,'rental percent',100);
      if(l1Percent+aiPercent+rentalPercent!==100){
        throw new ProtocolError('Provider resource shares must total exactly 100%');
      }
      record={address:signer,deviceClass:payload.deviceClass,cpuCores,ramMiB,
        gpuCount,gpuSummary:payload.gpuSummary,l1Percent,aiPercent,rentalPercent,
        joinedAtMs:previous?.joinedAtMs??Number(seen),
        cpuLoadPct:previous?.cpuLoadPct??null,
        gpuLoadPct:previous?.gpuLoadPct??null,
        lastSeenAtMs:Number(seen),nextNonce:(nonce+1n).toString(),
        selfReported:true,chainValidator:false,
        znytAccrued:null,aiEntitlement:null,
        rewardState:'AWAITING_BOND_AND_VERIFIED_WORK'};
    }else{
      if(!previous)throw new ProtocolError('Heartbeat requires prior signed opt-in');
      const load=numeric(payload.cpuLoadPct,'CPU load percent',100);
      const gpuLoad=payload.gpuLoadPct==='unknown'?null:
        numeric(payload.gpuLoadPct,'GPU load percent',100);
      record={...previous,cpuLoadPct:load,gpuLoadPct:gpuLoad,
        lastSeenAtMs:Number(seen),nextNonce:(nonce+1n).toString()};
    }
    if(!replay&&this.#journalPath){
      const event=JSON.stringify({receivedAtMs:Number(seen),signed})+'\n';
      if(existsSync(this.#journalPath)){
        const stat=lstatSync(this.#journalPath);
        if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||
          (typeof process.getuid==='function'&&stat.uid!==process.getuid())){
          throw new ProtocolError('Node journal permissions changed');
        }
        if(stat.size+Buffer.byteLength(event)>MAX_JOURNAL_BYTES){
          throw new ProtocolError('Node discovery journal size limit reached');
        }
      }
      appendFileSync(this.#journalPath,event,{encoding:'utf8',flag:'a',mode:0o600});
    }
    this.#nodes.set(signer,record);
    return {address:signer,acceptedAs:'SIGNED_DISCOVERY_ONLY',
      nextNonce:record.nextNonce,activeValidator:false,
      znytPaid:false,realAiGranted:false};
  }

  join(signed){return this.#apply(signed);}
  pulse(signed){return this.#apply(signed);}
  nextNonce(address){return this.#nodes.get(address)?.nextNonce??'0';}

  snapshot(){
    const now=this.#now();
    const nodes=[...this.#nodes.values()].map(n=>({
      ...n,online:now-n.lastSeenAtMs<=ONLINE_MS&&now>=n.lastSeenAtMs}));
    nodes.sort((a,b)=>b.lastSeenAtMs-a.lastSeenAtMs);
    return {chainId:this.chainId,nodesRegistered:nodes.length,
      online:nodes.filter(n=>n.online).length,
      declaredCpuCores:nodes.filter(n=>n.online).reduce((s,n)=>s+n.cpuCores,0),
      declaredGpuCount:nodes.filter(n=>n.online).reduce((s,n)=>s+n.gpuCount,0),
      znytTransfersExecuted:0,realAiEntitlementsGranted:0,
      attestedResources:false,consensusValidatorsAdded:0,nodes};
  }
}
