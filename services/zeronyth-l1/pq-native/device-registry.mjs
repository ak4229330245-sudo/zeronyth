/** ML-DSA signed, self-declared device participation for LOCAL research only. */
import {validateGenesis} from './ledger.mjs';
import {evaluateDeviceEligibility,validateDeviceProfile,validateDeviceHeartbeat} from './device-policy.mjs';
import {MARKET_KINDS,verifyMarket} from './market-crypto.mjs';
import {ProtocolError,addressOf,assertAddress,digest,uint} from './pq.mjs';

export class DeviceNodeRegistry{
  #devices=new Map();
  #nextRegistrationNonce=new Map();
  #validatorIds=new Set();
  #height=0n;

  constructor(genesis){
    validateGenesis(genesis);
    this.chainId=genesis.chainId;
    this.#validatorIds=new Set(genesis.validators.map(v=>addressOf(v.publicKey)));
  }

  register(signedProfile){
    const {signer,payload}=verifyMarket(signedProfile,MARKET_KINDS.DEVICE,this.chainId);
    if(this.#devices.has(signer)) throw new ProtocolError('Device identity already registered');
    const expectedNonce=this.#nextRegistrationNonce.get(signer)??0n;
    if(uint(payload.nonce,'device registration nonce')!==expectedNonce){
      throw new ProtocolError('Device registration nonce/replay rejected');
    }
    const profile=Object.fromEntries(['deviceClass','platform','runtime','role',
      'maxCpuPct','foregroundOnly'].map(key=>[key,payload[key]]));
    try{validateDeviceProfile(profile);}catch(e){throw new ProtocolError(e.message);}
    if(profile.role==='validator'&&!this.#validatorIds.has(signer)){
      throw new ProtocolError('Consensus validator must already belong to the fixed genesis set');
    }
    const deviceId=digest('ZERONYTH_PQ_DEVICE_ID_V1\0',JSON.stringify(signedProfile));
    this.#devices.set(signer,{deviceId,profile,heartbeat:null,sequence:-1n,lastHeight:null});
    this.#nextRegistrationNonce.set(signer,expectedNonce+1n);
    return {deviceId,owner:signer,role:profile.role,attestedHardware:false,joined:true};
  }

  leave(signedLeave){
    const {signer,payload}=verifyMarket(signedLeave,MARKET_KINDS.DEVICE_LEAVE,this.chainId);
    const device=this.#devices.get(signer);
    if(!device||payload.deviceId!==device.deviceId){
      throw new ProtocolError('Leave request from unknown or mismatched device');
    }
    const sequence=uint(payload.sequence,'device leave sequence');
    if(sequence<=device.sequence)throw new ProtocolError('Stale or replayed device leave');
    this.#devices.delete(signer);
    return {left:true,owner:signer,deviceId:device.deviceId,
      nextRegistrationNonce:this.#nextRegistrationNonce.get(signer).toString()};
  }

  heartbeat(signedHeartbeat){
    const {signer,payload}=verifyMarket(signedHeartbeat,MARKET_KINDS.HEARTBEAT,this.chainId);
    const device=this.#devices.get(signer);
    if(!device||payload.deviceId!==device.deviceId){
      throw new ProtocolError('Heartbeat from unknown or mismatched device');
    }
    const sequence=uint(payload.sequence,'device heartbeat sequence');
    const height=uint(payload.observedAtHeight,'heartbeat observed height');
    if(sequence<=device.sequence||height!==this.#height){
      throw new ProtocolError('Stale, replayed or future-height heartbeat');
    }
    const heartbeat=Object.fromEntries(['foreground','charging','unmetered',
      'batteryPct','thermal'].map(key=>[key,payload[key]]));
    try{validateDeviceHeartbeat(heartbeat);}catch(e){throw new ProtocolError(e.message);}
    device.sequence=sequence;
    device.lastHeight=height;
    device.heartbeat=heartbeat;
    return {deviceId:device.deviceId,sequence:sequence.toString(),accepted:true};
  }

  advanceHeight(value){
    const height=uint(value,'device registry height',{min:1n});
    if(height<=this.#height||height>this.#height+10000n){
      throw new ProtocolError('Registry height must increase within research bounds');
    }
    this.#height=height;
    return height.toString();
  }

  assess(address,{role='compute',iterations=0}={}){
    assertAddress(address);
    const d=this.#devices.get(address);
    if(!d) return {eligible:false,reason:'device-not-registered'};
    if(!d.heartbeat||d.lastHeight===null||this.#height-d.lastHeight>2n){
      return {eligible:false,reason:'device-heartbeat-stale'};
    }
    return evaluateDeviceEligibility(d.profile,d.heartbeat,{role,iterations});
  }

  canRunHashJob(address,iterations){return this.assess(address,{role:'compute',iterations}).eligible;}
  get height(){return this.#height.toString();}
  get size(){return this.#devices.size;}

  list({after=null,limit=32}={}){
    // A paged view avoids returning the entire participant network in one
    // response even as registration grows. No fixed overall node count.
    if(!Number.isInteger(limit)||limit<1||limit>100){
      throw new ProtocolError('Device page size must be 1..100');
    }
    if(after!==null)assertAddress(after);
    let pastCursor=after===null;
    const records=[];
    for(const [address,record] of this.#devices){
      if(!pastCursor){if(address===after)pastCursor=true;continue;}
      records.push({owner:address,deviceId:record.deviceId,
        role:record.profile.role,deviceClass:record.profile.deviceClass});
      if(records.length>limit)break;
    }
    if(!pastCursor)throw new ProtocolError('Unknown device pagination cursor');
    const more=records.length>limit;
    if(more)records.pop();
    return {registeredCount:this.#devices.size,items:records,
      nextCursor:more?records.at(-1).owner:null};
  }
  get(address){
    assertAddress(address);
    const d=this.#devices.get(address);
    if(!d) return null;
    return {deviceId:d.deviceId,owner:address,profile:structuredClone(d.profile),
      heartbeat:d.heartbeat?structuredClone(d.heartbeat):null,
      lastHeight:d.lastHeight?.toString()??null,
      attestedHardware:false,operationalNode:false};
  }
}
