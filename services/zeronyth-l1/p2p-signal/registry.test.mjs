import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SignalingRegistry,SignalError} from './registry.mjs';
import {createSignalingServer} from './server.mjs';

const ROOM='abcd'.repeat(8);
const ROOM2='0123'.repeat(8);
const sdp={type:'offer',sdp:'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\n'};

test('ephemeral invite room discovery isolates peer IDs and bearer tokens',()=>{
  const directory=new SignalingRegistry();
  const a=directory.join({room:ROOM});
  const b=directory.join({room:ROOM});
  const c=directory.join({room:ROOM2});
  assert.deepEqual(a.peers,[]);
  assert.deepEqual(b.peers,[a.peerId]);
  assert.deepEqual(directory.poll(a).peers,[b.peerId]);
  assert.deepEqual(directory.poll(c).peers,[]);
  assert.match(a.peerId,/^[0-9a-f]{32}$/);
  assert.match(a.token,/^[0-9a-f]{64}$/);
  assert.notEqual(a.token,b.token);
  assert.equal(directory.status().participants,3);
});

test('signaling requires participant token and never lets sender spoof from identity',()=>{
  const directory=new SignalingRegistry();
  const a=directory.join({room:ROOM});
  const b=directory.join({room:ROOM});
  assert.throws(()=>directory.poll({...a,token:b.token}),/Unknown or expired/);
  assert.throws(()=>directory.signal({...a,to:a.peerId,type:'offer',payload:sdp}),/signal self/);
  assert.throws(()=>directory.signal({...a,to:'e'.repeat(32),type:'offer',payload:sdp}),/Destination/);
  assert.deepEqual(directory.signal({...a,to:b.peerId,type:'offer',payload:sdp}),{accepted:true});
  assert.deepEqual(directory.poll(b).messages,[{from:a.peerId,type:'offer',payload:sdp}]);
  assert.equal(directory.poll(b).messages.length,0);
  assert.throws(()=>directory.poll({...b,room:ROOM2}),/Unknown or expired/);
});

test('payloads, admission limits, queues and signaling rate are capped',()=>{
  const directory=new SignalingRegistry();
  const first=directory.join({room:ROOM});
  const second=directory.join({room:ROOM});
  for(let i=0;i<4;i++)directory.join({room:ROOM});
  assert.throws(()=>directory.join({room:ROOM}),/Room is full/);
  assert.throws(()=>directory.signal({...first,to:second.peerId,type:'offer',payload:{...sdp,sdp:'a'.repeat(160)}}),/Invalid SDP/);
  assert.throws(()=>directory.signal({...first,to:second.peerId,type:'candidate',payload:{candidate:3,sdpMid:null,sdpMLineIndex:0}}),/Invalid ICE/);
  for(let i=0;i<32;i++)directory.signal({...first,to:second.peerId,type:'offer',payload:sdp});
  assert.throws(()=>directory.signal({...first,to:second.peerId,type:'offer',payload:sdp}),/queue saturated/);
  assert.equal(directory.poll(second).messages.length,32);
  for(let i=0;i<58;i++){
    if(i%24===0)directory.poll(second);
    directory.signal({...first,to:second.peerId,type:'offer',payload:sdp});
  }
  assert.throws(()=>directory.signal({...first,to:second.peerId,type:'offer',payload:sdp}),/Rate limit exceeded/);
});

test('expired participants cannot be impersonated or counted as live nodes',()=>{
  let t=100;
  const directory=new SignalingRegistry({now:()=>t});
  const a=directory.join({room:ROOM});
  t+=30_100;
  assert.equal(directory.status().participants,0);
  assert.throws(()=>directory.poll(a),/Unknown or expired/);
  const b=directory.join({room:ROOM});
  assert.deepEqual(b.peers,[]);
  assert.equal(directory.leave(b).left,true);
  assert.equal(directory.status().rooms,0);
});

test('HTTP service applies strict JSON/endpoint limits and relays only authenticated SDP',async()=>{
  const server=createSignalingServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const base=`http://127.0.0.1:${port}`;
  const post=async(route,value,headers={'Content-Type':'application/json'})=>{
    const response=await fetch(`${base}${route}`,{method:'POST',headers,body:JSON.stringify(value)});
    return {status:response.status,data:await response.json()};
  };
  try{
    const config=await(await fetch(`${base}/config`)).json();
    assert.deepEqual(config.iceServers,[]);
    assert.equal(config.publicMainnet,false);
    assert.equal((await post('/join',{room:'bad'})).status,400);
    assert.equal((await post('/join',{room:ROOM},{})).status,415);
    assert.equal((await post('/join',{room:ROOM,extra:'x'})).status,400);
    const a=(await post('/join',{room:ROOM})).data;
    const b=(await post('/join',{room:ROOM})).data;
    assert.equal((await post('/signal',{
      room:ROOM,peerId:a.peerId,token:a.token,to:b.peerId,type:'offer',payload:sdp,
    })).status,200);
    const poll=await post('/poll',{room:ROOM,peerId:b.peerId,token:b.token});
    assert.equal(poll.data.messages[0].from,a.peerId);
    assert.equal((await post('/leave',{room:ROOM,peerId:a.peerId,token:a.token})).status,200);
    assert.equal((await post('/poll',{room:ROOM,peerId:a.peerId,token:a.token})).status,403);
    assert.equal((await(await fetch(`${base}/weird`)).status),404);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
