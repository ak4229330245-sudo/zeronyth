/** Experimental real WebRTC data channels: no ML-DSA auth, consensus, ZNYT or hosting. */
import {hashIterations,makeLocalJob} from './node-hash.mjs';

const ID=/^[0-9a-f]{32}$/;
const HASH=/^[0-9a-f]{64}$/;
const MAX_PEERS=5;

export class WebP2PClient{
  #auth=null;
  #peers=new Map();
  #pollTimer=null;
  #generation=0;
  #iceServers=[];
  #closed=false;
  #verified=0;
  #rejected=0;

  constructor({endpoint='/api/p2p',fetchImpl=globalThis.fetch?.bind(globalThis),
    rtcFactory=config=>new RTCPeerConnection(config),
    onUpdate=()=>{},visible=()=>true,canWork=()=>true,
    setTimer=setTimeout,clearTimer=clearTimeout}={}){
    if(!/^\/[a-z0-9/-]+$/i.test(endpoint)||typeof fetchImpl!=='function'||
       [rtcFactory,onUpdate,visible,canWork,setTimer,clearTimer].some(x=>typeof x!=='function')){
      throw new Error('Invalid WebRTC lab configuration');
    }
    Object.assign(this,{endpoint,fetchImpl,rtcFactory,onUpdate,visible,canWork,setTimer,clearTimer});
    this.state='idle';this.error='';this.room='';
    this.#emit();
  }

  snapshot(){
    return {status:this.state,room:this.room,connected:[...this.#peers.entries()]
      .filter(([,p])=>p.channel?.readyState==='open').map(([id])=>id),
      negotiating:[...this.#peers.keys()],verified:this.#verified,rejected:this.#rejected,
      authenticatedMLDSA:false,realZnyt:'0',error:this.error};
  }
  #emit(){this.onUpdate(this.snapshot());}

  async #get(path){
    const response=await this.fetchImpl(`${this.endpoint}/${path}`,{
      method:'GET',cache:'no-store',signal:AbortSignal.timeout(8000),
    });
    const result=await response.json();
    if(!response.ok)throw Error(result?.error||'Signaling configuration failed');
    return result;
  }
  async #post(path,payload){
    const response=await this.fetchImpl(`${this.endpoint}/${path}`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),cache:'no-store',signal:AbortSignal.timeout(8000),
    });
    const result=await response.json();
    if(!response.ok)throw Error(result?.error||`Signaling ${path} failed`);
    return result;
  }

  async join(room){
    if(this.#closed||this.#auth||!ID.test(room)||!this.visible()){
      throw Error('Room code or visible browser state invalid');
    }
    const epoch=++this.#generation;
    this.state='joining';this.room=room;this.error='';this.#emit();
    try{
      const config=await this.#get('config');
      if(epoch!==this.#generation)return;
      if(!Array.isArray(config.iceServers)||config.iceServers.length>3){
        throw Error('Untrusted ICE server configuration');
      }
      for(const item of config.iceServers){
        if(!item||typeof item.urls!=='string'||
          !/^stuns?:[a-z0-9.-]+:[0-9]{1,5}$/i.test(item.urls)){
          throw Error('Invalid optional STUN server');
        }
      }
      this.#iceServers=config.iceServers;
      const joined=await this.#post('join',{room});
      if(epoch!==this.#generation){
        void this.#post('leave',{room,peerId:joined.peerId,token:joined.token}).catch(()=>{});
        return;
      }
      if(!ID.test(joined.peerId)||!HASH.test(joined.token)||!Array.isArray(joined.peers)){
        throw Error('Invalid signaling identity');
      }
      this.#auth={room,peerId:joined.peerId,token:joined.token};
      this.state='joined';this.#emit();
      this.#schedule(epoch,0);
    }catch(e){
      if(epoch!==this.#generation)return;
      this.state='error';this.error=e?.message||'P2P参加に失敗しました';this.#emit();
      throw e;
    }
  }

  #schedule(epoch,delay){
    if(epoch!==this.#generation||!this.#auth)return;
    this.#pollTimer=this.setTimer(()=>{
      this.#pollTimer=null;void this.#poll(epoch);
    },delay);
  }

  async #poll(epoch){
    if(epoch!==this.#generation||!this.#auth)return;
    if(!this.visible()){await this.leave();return;}
    try{
      const {peers=[],messages=[]}=await this.#post('poll',this.#auth);
      if(epoch!==this.#generation||!this.#auth)return;
      if(!Array.isArray(peers)||peers.length>MAX_PEERS||!Array.isArray(messages)||messages.length>32){
        throw Error('Malformed P2P roster');
      }
      const active=new Set(peers.filter(id=>ID.test(id)&&id!==this.#auth.peerId));
      for(const id of [...this.#peers.keys()]){
        if(!active.has(id))this.#closePeer(id);
      }
      for(const message of messages){
        if(!active.has(message?.from))continue;
        await this.#handleSignal(message,epoch);
      }
      for(const id of active){
        if(!this.#peers.has(id)&&this.#auth.peerId.localeCompare(id)<0){
          await this.#openPeer(id,true,epoch);
        }
      }
      this.state='joined';this.error='';this.#emit();
      this.#schedule(epoch,1400);
    }catch(e){
      if(epoch!==this.#generation)return;
      this.state='degraded';this.error=e?.message||'シグナリング一時停止';this.#emit();
      this.#schedule(epoch,5000);
    }
  }

  async #signal(to,type,payload,epoch){
    if(epoch!==this.#generation||!this.#auth)return;
    await this.#post('signal',{...this.#auth,to,type,payload});
  }

  async #openPeer(id,initiator,epoch){
    if(this.#peers.has(id))return this.#peers.get(id);
    if(epoch!==this.#generation||this.#peers.size>=MAX_PEERS)return null;
    let pc;
    try{pc=this.rtcFactory({iceServers:this.#iceServers});}
    catch{throw Error('WebRTC PeerConnectionを生成できません');}
    const state={pc,channel:null,iceQueue:[],challenge:null,timer:null,
      workBusy:false,lastWorkAt:0};
    this.#peers.set(id,state);
    pc.onicecandidate=event=>{
      if(!event.candidate)return;
      const c=event.candidate;
      const payload={candidate:String(c.candidate||''),
        sdpMid:c.sdpMid??null,sdpMLineIndex:c.sdpMLineIndex??null};
      void this.#signal(id,'candidate',payload,epoch).catch(()=>{});
    };
    pc.onconnectionstatechange=()=>{
      if(['failed','closed'].includes(pc.connectionState))this.#closePeer(id);
      this.#emit();
    };
    pc.ondatachannel=event=>this.#attachChannel(id,state,event.channel,epoch);
    if(initiator){
      const dc=pc.createDataChannel('zeronyth-research-v1',{ordered:true});
      this.#attachChannel(id,state,dc,epoch);
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.#signal(id,'offer',{
        type:'offer',sdp:String(pc.localDescription?.sdp||offer.sdp)},epoch);
    }
    return state;
  }

  async #handleSignal({from,type,payload},epoch){
    if(epoch!==this.#generation||!ID.test(from))return;
    if(!['offer','answer','candidate'].includes(type))return;
    let peer=this.#peers.get(from);
    if(!peer){peer=await this.#openPeer(from,false,epoch);}
    if(!peer)return;
    const pc=peer.pc;
    if(type==='offer'){
      if(pc.signalingState!=='stable')return;
      await pc.setRemoteDescription({type:'offer',sdp:payload.sdp});
      const answer=await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.#signal(from,'answer',{
        type:'answer',sdp:String(pc.localDescription?.sdp||answer.sdp)},epoch);
      await this.#applyCandidates(peer);
    }else if(type==='answer'){
      if(pc.signalingState!=='have-local-offer')return;
      await pc.setRemoteDescription({type:'answer',sdp:payload.sdp});
      await this.#applyCandidates(peer);
    }else{
      if(!payload||typeof payload.candidate!=='string')return;
      if(pc.remoteDescription){
        await pc.addIceCandidate(payload);
      }else if(peer.iceQueue.length<32){peer.iceQueue.push(payload);}
    }
  }

  async #applyCandidates(peer){
    for(const candidate of peer.iceQueue.splice(0,32)){
      await peer.pc.addIceCandidate(candidate);
    }
  }

  #attachChannel(id,peer,channel,epoch){
    if(peer.channel&&peer.channel!==channel){channel.close();return;}
    peer.channel=channel;
    channel.onopen=()=>{
      if(epoch!==this.#generation)return;
      this.#emit();
      this.#challenge(id,peer,epoch);
      peer.timer=setInterval(()=>this.#challenge(id,peer,epoch),20000);
    };
    channel.onclose=()=>{if(peer.timer)clearInterval(peer.timer);peer.timer=null;this.#emit();};
    channel.onerror=()=>this.#emit();
    channel.onmessage=event=>{void this.#onPeerData(id,peer,event.data,epoch);};
  }

  #send(peer,message){
    if(peer.channel?.readyState!=='open'||peer.channel.bufferedAmount>16*1024)return false;
    peer.channel.send(JSON.stringify(message));return true;
  }

  #challenge(id,peer,epoch){
    if(epoch!==this.#generation||!this.visible()||!this.canWork())return;
    if(peer.challenge&&Date.now()-peer.challenge.issued>30000){
      peer.challenge=null;this.#rejected++;this.#emit();
    }
    if(peer.challenge)return;
    const job=makeLocalJob(8);
    if(this.#send(peer,{version:1,kind:'challenge',id:job.id,iterations:job.iterations})){
      peer.challenge={...job,issued:Date.now()};
    }
  }

  /** Light-node relay: send a header to every open peer. Receivers verify it themselves. */
  broadcastHeader(header){
    let sent=0;
    for(const peer of this.#peers.values())if(this.#send(peer,{version:1,kind:'header',header}))sent++;
    return sent;
  }
  async #onPeerData(id,peer,raw,epoch){
    if(epoch!==this.#generation||!this.visible()||typeof raw!=='string')return;
    if(raw.length<=8192&&raw.startsWith('{"version":1,"kind":"header"')){
      let msg;try{msg=JSON.parse(raw);}catch{return;}
      if(msg&&typeof msg.header==='object'&&typeof this.onHeader==='function')this.onHeader(id,msg.header);
      return;
    }
    if(!this.canWork()||raw.length>2048)return;
    let data;
    try{data=JSON.parse(raw);}catch{return;}
    if(!data||data.version!==1||!HASH.test(data.id))return;
    if(data.kind==='challenge'){
      if(!Number.isInteger(data.iterations)||data.iterations<1||data.iterations>16)return;
      if(peer.workBusy||Date.now()-peer.lastWorkAt<5000)return;
      peer.workBusy=true;
      peer.lastWorkAt=Date.now();
      try{
        const output=await hashIterations(data.id,data.iterations);
        if(epoch===this.#generation&&this.visible()&&this.canWork()){
          this.#send(peer,{version:1,kind:'proof',id:data.id,output});
        }
      }catch{}finally{peer.workBusy=false;}
    }else if(data.kind==='proof'){
      const job=peer.challenge;
      if(!job||job.id!==data.id||typeof data.output!=='string'||!HASH.test(data.output))return;
      peer.challenge=null;
      if(Date.now()-job.issued>30000){this.#rejected++;this.#emit();return;}
      let good=false;
      try{good=(await hashIterations(job.seed,job.iterations))===data.output;}catch{}
      if(epoch!==this.#generation||!this.visible()||!this.canWork())return;
      if(good)this.#verified++;else this.#rejected++;
      this.#emit();
    }
  }

  #closePeer(id){
    const peer=this.#peers.get(id);
    if(!peer)return;
    this.#peers.delete(id);
    if(peer.timer)clearInterval(peer.timer);
    try{peer.channel?.close();}catch{}
    try{peer.pc.close();}catch{}
  }

  async leave(){
    const auth=this.#auth;
    ++this.#generation;
    if(this.#pollTimer!==null){this.clearTimer(this.#pollTimer);this.#pollTimer=null;}
    this.#auth=null;
    for(const id of [...this.#peers.keys()])this.#closePeer(id);
    this.state='idle';this.error='';this.#emit();
    if(auth){try{await this.#post('leave',auth);}catch{ /* remote lease expires */ }}
  }
}
