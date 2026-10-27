import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {webcrypto} from 'node:crypto';
import {createSignalingServer} from '../p2p-signal/server.mjs';
import {WebP2PClient} from '../dashboard/assets/web-p2p.mjs';
import {hashIterations} from '../dashboard/assets/node-hash.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const room='a1'.repeat(16);

test('P2P controls require separate consent; no inline code or exposed signaling port',()=>{
  const page=readFileSync(join(root,'dashboard/node.html'),'utf8');
  const compose=readFileSync(join(root,'docker-compose.yml'),'utf8');
  const nginx=readFileSync(join(root,'dashboard/nginx.conf'),'utf8');
  const ui=readFileSync(join(root,'dashboard/assets/p2p-ui.mjs'),'utf8');
  assert.match(page,/src="assets\/web-p2p\.mjs"|src="assets\/p2p-ui\.mjs"/);
  for(const name of ['p2pConsent','p2pRoom','p2pJoin','p2pLeave','p2pPeers','p2pProofs']){
    assert.match(page,new RegExp(`id="${name}"`));
  }
  assert.match(ui,/visibilitychange/);
  assert.match(ui,/pagehide/);
  // PQ peer-auth disclosure lives in the catalogs and is referenced by key.
  assert.match(page,/data-i18n="p2p\.pq\.value"/);
  for(const lang of ['en','ja','zh-CN','ko']){
    const cat=readFileSync(join(root,`dashboard/assets/i18n-${lang}.mjs`),'utf8');
    assert.match(cat,/'p2p\.pq\.value': '[^']+'/);
  }
  assert.match(readFileSync(join(root,'dashboard/assets/i18n-ja.mjs'),'utf8'),/未実装/);
  assert.doesNotMatch(page,/<script(?![^>]*\bsrc=)/i);
  assert.match(compose,/p2p-signal:[\s\S]+?expose:\s*\n\s*- "8788"/);
  assert.doesNotMatch(compose,/"0\.0\.0\.0:8788:8788"/);
  assert.match(nginx,/proxy_pass http:\/\/p2p-signal:8788\//);
  assert.match(compose,/"127\.0\.0\.1:8080:80"/);
});

test('real local HTTP mailbox supports two WebP2PClient sessions without identity sharing',async()=>{
  const server=createSignalingServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const timers=[];
  const state={offers:0,answers:0,channels:[]};
  const mockedRTC=()=>({
    signalingState:'stable',connectionState:'new',localDescription:null,
    createDataChannel(){
      const channel={readyState:'connecting',sent:[],bufferedAmount:0,
        close(){this.readyState='closed';},send(data){this.sent.push(JSON.parse(data));}};
      state.channels.push(channel);
      return channel;
    },
    async createOffer(){state.offers++;return {type:'offer',sdp:'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\n'};},
    async createAnswer(){state.answers++;return {type:'answer',sdp:'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\n'};},
    async setLocalDescription(value){this.localDescription=value;
      this.signalingState=value.type==='offer'?'have-local-offer':'stable';},
    async setRemoteDescription(value){this.remoteDescription=value;this.signalingState='stable';},
    async addIceCandidate(){},close(){this.connectionState='closed';},
  });
  const clients=[0,1].map(()=>new WebP2PClient({
    fetchImpl:(url,options)=>fetch(`${base}${url.slice('/api/p2p'.length)}`,options),
    rtcFactory:mockedRTC,
    setTimer:(fn,delay)=>{const entry={fn,delay,active:true};timers.push(entry);return entry;},
    clearTimer:timer=>{timer.active=false;},
  }));
  const spin=async()=>{await new Promise(resolve=>setTimeout(resolve,50));};
  const step=async()=>{
    const pending=timers.filter(entry=>entry.active);
    for(const entry of pending){entry.active=false;entry.fn();}
    await spin();
  };
  try{
    await assert.rejects(clients[0].join('wrong'),/Room code/);
    await clients[0].join(room);
    await clients[1].join(room);
    assert.equal(clients[0].snapshot().status,'joined');
    assert.equal(clients[1].snapshot().status,'joined');
    assert.equal(clients[0].snapshot().authenticatedMLDSA,false);
    assert.equal(clients[0].snapshot().realZnyt,'0');
    for(let i=0;i<4;i++)await step();
    assert.ok(state.offers>=1,'a WebRTC offer traversed the room mailbox');
    assert.ok(state.answers>=1,'the responding browser emitted a WebRTC answer');
    assert.equal(clients[0].snapshot().connected.length,0,'signaling is not a connected datachannel');
    assert.equal(clients[1].snapshot().connected.length,0);
    assert.equal(state.channels.length,1);
    state.channels[0].readyState='open';
    state.channels[0].onopen();
    assert.equal(state.channels[0].sent[0].kind,'challenge');
    const challenge=state.channels[0].sent[0];
    const valid=await hashIterations(challenge.id,challenge.iterations,{subtle:webcrypto.subtle});
    state.channels[0].onmessage({data:JSON.stringify({version:1,kind:'proof',id:challenge.id,
      output:valid})});
    await spin();
    const total=clients.reduce((count,client)=>count+client.snapshot().verified,0);
    assert.equal(total,1,'a correct challenge proof is independently verified');
  }finally{
    await Promise.all(clients.map(client=>client.leave()));
    assert.equal(clients[0].snapshot().status,'idle');
    await new Promise(resolve=>server.close(resolve));
  }
});
