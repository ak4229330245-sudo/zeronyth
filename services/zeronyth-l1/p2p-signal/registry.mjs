/** Bounded, ephemeral WebRTC signaling directory. This is NOT validator consensus. */
import {randomBytes,timingSafeEqual} from 'node:crypto';

export class SignalError extends Error {
  constructor(message,status=400){super(message);this.name='SignalError';this.status=status;}
}

const ROOM=/^[a-f0-9]{32}$/;
const PEER=/^[a-f0-9]{32}$/;
const TOKEN=/^[a-f0-9]{64}$/;
const MAX_ROOMS=16;
const MAX_PEERS=6;
const MAX_MESSAGES=32;
const MAX_PAYLOAD_BYTES=20*1024;
const LEASE_MS=30_000;

function object(value){return value&&typeof value==='object'&&!Array.isArray(value);}
function requireKeys(value,expected,label){
  if(!object(value)||JSON.stringify(Object.keys(value).sort())!==
    JSON.stringify([...expected].sort()))throw new SignalError(`${label}: fields invalid`);
}
function text(value,pattern,label){
  if(typeof value!=='string'||!pattern.test(value))throw new SignalError(`Invalid ${label}`);
  return value;
}
function secureSame(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  const x=Buffer.from(a,'utf8'),y=Buffer.from(b,'utf8');
  return x.length===y.length&&timingSafeEqual(x,y);
}
function validatePayload(type,payload){
  if(!['offer','answer','candidate'].includes(type))throw new SignalError('Unknown WebRTC signal type');
  if(!object(payload))throw new SignalError('Signal payload required');
  if(Buffer.byteLength(JSON.stringify(payload),'utf8')>MAX_PAYLOAD_BYTES){
    throw new SignalError('Signal exceeds bounded payload');
  }
  if(type==='offer'||type==='answer'){
    requireKeys(payload,['type','sdp'],'SDP');
    if(payload.type!==type||typeof payload.sdp!=='string'||
      payload.sdp.length<20||payload.sdp.length>18000||
      !payload.sdp.startsWith('v=0'))throw new SignalError('Invalid SDP signal');
  }else{
    requireKeys(payload,['candidate','sdpMid','sdpMLineIndex'],'ICE');
    if(typeof payload.candidate!=='string'||payload.candidate.length>4000||
      !(payload.sdpMid===null||(typeof payload.sdpMid==='string'&&payload.sdpMid.length<=64))||
      !(payload.sdpMLineIndex===null||(Number.isInteger(payload.sdpMLineIndex)&&
      payload.sdpMLineIndex>=0&&payload.sdpMLineIndex<=32))){
      throw new SignalError('Invalid ICE candidate');
    }
  }
}

export class SignalingRegistry {
  #rooms=new Map();
  constructor({now=()=>Date.now()}={}){this.now=now;}
  #cleanup(){
    for(const [room,peers] of this.#rooms){
      for(const [id,peer] of peers){
        if(this.now()-peer.seen>LEASE_MS)peers.delete(id);
      }
      if(!peers.size)this.#rooms.delete(room);
    }
  }
  #authorized({room,peerId,token}){
    text(room,ROOM,'room');text(peerId,PEER,'peer');text(token,TOKEN,'token');
    this.#cleanup();
    const peer=this.#rooms.get(room)?.get(peerId);
    if(!peer||!secureSame(peer.token,token))throw new SignalError('Unknown or expired participant',403);
    peer.seen=this.now();
    return peer;
  }
  join({room}){
    text(room,ROOM,'room');this.#cleanup();
    let peers=this.#rooms.get(room);
    if(!peers){
      if(this.#rooms.size>=MAX_ROOMS)throw new SignalError('Local signaling room limit reached',429);
      peers=new Map();this.#rooms.set(room,peers);
    }
    if(peers.size>=MAX_PEERS)throw new SignalError('Room is full',429);
    const peerId=randomBytes(16).toString('hex');
    const token=randomBytes(32).toString('hex');
    const existing=[...peers.keys()];
    peers.set(peerId,{token,seen:this.now(),messages:[],sent:0,window:this.now()});
    return {room,peerId,token,peers:existing,leaseMs:LEASE_MS,maxPeers:MAX_PEERS};
  }
  poll({room,peerId,token}){
    const peer=this.#authorized({room,peerId,token});
    const messages=peer.messages.splice(0,MAX_MESSAGES);
    return {peers:[...this.#rooms.get(room).keys()].filter(id=>id!==peerId),messages,
      leaseMs:LEASE_MS};
  }
  signal({room,peerId,token,to,type,payload}){
    const from=this.#authorized({room,peerId,token});
    text(to,PEER,'destination');
    if(to===peerId)throw new SignalError('Cannot signal self');
    validatePayload(type,payload);
    const receiver=this.#rooms.get(room)?.get(to);
    if(!receiver)throw new SignalError('Destination no longer available',404);
    if(this.now()-from.window>=60_000){from.window=this.now();from.sent=0;}
    if(from.sent>=90)throw new SignalError('Rate limit exceeded',429);
    if(receiver.messages.length>=MAX_MESSAGES)throw new SignalError('Receiver queue saturated',429);
    from.sent++;
    receiver.messages.push({from:peerId,type,payload:structuredClone(payload)});
    return {accepted:true};
  }
  leave({room,peerId,token}){
    this.#authorized({room,peerId,token});
    const peers=this.#rooms.get(room);
    peers.delete(peerId);
    if(!peers.size)this.#rooms.delete(room);
    return {left:true};
  }
  status(){this.#cleanup();return {rooms:this.#rooms.size,
    participants:[...this.#rooms.values()].reduce((sum,peers)=>sum+peers.size,0),
    publicMainnet:false};}
}
