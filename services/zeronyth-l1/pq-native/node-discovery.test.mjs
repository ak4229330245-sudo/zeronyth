import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateIdentity} from './pq.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {NodeDiscoveryRegistry} from './node-discovery-registry.mjs';
import {ProviderNodeClient} from './provider-node-client.mjs';
import {NodeJoinCoordinator} from './node-join-coordinator.mjs';

const TIME=1_782_000_000_000;
const CHAIN='19127';
const user=()=>generateIdentity();
const joinSigned=(id,nonce='0',fields={})=>signMarket({
  kind:MARKET_KINDS.NODE_JOIN,chainId:CHAIN,nonce,issuedAtMs:String(TIME),
  deviceClass:'server',cpuCores:'8',ramMiB:'16384',gpuCount:'1',
  gpuSummary:'RTX TEST GPU (provider claimed)',l1Percent:'20',
  aiPercent:'20',rentalPercent:'60',termsAccepted:true,...fields},id.privateKey);
const pulseSigned=(id,nonce='1',fields={})=>signMarket({
  kind:MARKET_KINDS.NODE_PULSE,chainId:CHAIN,nonce,issuedAtMs:String(TIME),
  cpuLoadPct:'37',gpuLoadPct:'unknown',...fields},id.privateKey);

test('signed opt-in records resources but neither mints ZNYT nor activates real AI/validators',()=>{
  const registry=new NodeDiscoveryRegistry({chainId:CHAIN,now:()=>TIME});
  const id=user();
  const receipt=registry.join(joinSigned(id));
  assert.equal(receipt.acceptedAs,'SIGNED_DISCOVERY_ONLY');
  assert.equal(receipt.znytPaid,false);
  assert.equal(receipt.realAiGranted,false);
  assert.equal(receipt.activeValidator,false);
  const pulse=registry.pulse(pulseSigned(id));
  assert.equal(pulse.nextNonce,'2');
  const state=registry.snapshot();
  assert.deepEqual([state.online,state.declaredCpuCores,state.declaredGpuCount],[1,8,1]);
  assert.equal(state.nodes[0].cpuLoadPct,37);
  assert.equal(state.nodes[0].aiEntitlement,null);
  assert.equal(state.nodes[0].chainValidator,false);
  assert.equal(state.znytTransfersExecuted,0);
  assert.equal(state.attestedResources,false);
});

test('discovery is elastic, with no fixed node-count configuration',()=>{
  const registry=new NodeDiscoveryRegistry({chainId:CHAIN,now:()=>TIME});
  const providers=Array.from({length:17},user);
  for(const id of providers)registry.join(joinSigned(id));
  assert.equal(registry.snapshot().nodesRegistered,17);
  assert.equal(registry.snapshot().online,17);
});

test('replays, forged signatures, cross-chain payload and pulse-before-join fail closed',()=>{
  const registry=new NodeDiscoveryRegistry({chainId:CHAIN,now:()=>TIME});
  const id=user(),attacker=user();
  assert.throws(()=>registry.pulse(pulseSigned(id,'0')),/prior signed opt-in/);
  const joinEvent=joinSigned(id);
  registry.join(joinEvent);
  assert.throws(()=>registry.join(joinEvent),/nonce\/replay/);
  const forgery={...pulseSigned(id),cpuLoadPct:'2'};
  assert.throws(()=>registry.pulse(forgery),/ML-DSA signature/);
  assert.throws(()=>registry.join(joinSigned(attacker,'0',{chainId:'19128'})),/chain replay/);
  assert.equal(registry.nextNonce(id.address),'1');
});

test('hardware share limits, prior consent, input bounds and timestamps enforced',()=>{
  const id=user();
  const registry=new NodeDiscoveryRegistry({chainId:CHAIN,now:()=>TIME});
  for(const patch of [
    {termsAccepted:false},{l1Percent:'20',aiPercent:'30',rentalPercent:'60'},
    {cpuCores:'0'},{gpuCount:'17'},{gpuSummary:'G'.repeat(257)},
    {issuedAtMs:String(TIME-121000)},{issuedAtMs:String(TIME+121000)}]){
    assert.throws(()=>registry.join(joinSigned(id,'0',patch)));
  }
  assert.equal(registry.snapshot().nodesRegistered,0);
  registry.join(joinSigned(id));
  assert.throws(()=>registry.pulse(pulseSigned(id,'1',{cpuLoadPct:'101'})));
});

test('nodes turn offline without a fresh pulse and totals exclude stale claims',()=>{
  let current=TIME;
  const registry=new NodeDiscoveryRegistry({chainId:CHAIN,now:()=>current});
  const id=user();registry.join(joinSigned(id));
  current+=91000;
  assert.equal(registry.snapshot().online,0);
  assert.equal(registry.snapshot().declaredGpuCount,0);
  registry.pulse(pulseSigned(id,'1',{issuedAtMs:String(current)}));
  assert.equal(registry.snapshot().online,1);
});

test('0600 append-only journal safely revalidates all signed events on restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'zeronyth-node-'));
  try{
    const path=join(dir,'events.jsonl');
    const registry=new NodeDiscoveryRegistry({chainId:CHAIN,journalPath:path,now:()=>TIME});
    const id=user();registry.join(joinSigned(id));registry.pulse(pulseSigned(id));
    assert.equal(statSync(path).mode&0o077,0);
    assert.equal(readFileSync(path,'utf8').trim().split('\n').length,2);
    const restored=new NodeDiscoveryRegistry({chainId:CHAIN,journalPath:path,now:()=>TIME});
    assert.equal(restored.nextNonce(id.address),'2');
    assert.equal(restored.snapshot().nodesRegistered,1);
    assert.equal(restored.snapshot().nodes[0].cpuLoadPct,37);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('agent generates signed discovery and signed load pulse over localhost',async()=>{
  const coordinator=new NodeJoinCoordinator({chainId:CHAIN,
    adminToken:'A'.repeat(40),now:()=>TIME});
  const {server,url}=await coordinator.start();
  try{
    const id=user();
    const client=new ProviderNodeClient({chainId:CHAIN,privateKey:id.privateKey,
      coordinatorUrl:`${url}/`,deviceClass:'laptop',
      clock:()=>TIME,detectHardware:async()=>({cpuCores:4,ramMiB:8192,
        gpuCount:0,gpuSummary:'not-detected'}),loadSample:async()=>52});
    assert.equal(client.address,id.address);
    assert.equal((await client.joinOnce()).acceptedAs,'SIGNED_DISCOVERY_ONLY');
    assert.equal((await client.pulseOnce()).nextNonce,'2');
    const state=coordinator.registry.snapshot();
    assert.deepEqual([state.nodesRegistered,state.nodes[0].cpuLoadPct],[1,52]);
    assert.equal(state.nodes[0].gpuSummary,'not-detected');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('admin inventory stays private, public UI is mobile-first, loopback-only',async()=>{
  const coordinator=new NodeJoinCoordinator({chainId:CHAIN,adminToken:'Z'.repeat(40)});
  const {server,url}=await coordinator.start();
  try{
    assert.match(url,/^http:\/\/127\.0\.0\.1:/);
    assert.equal((await fetch(`${url}/v1/admin/nodes`)).status,401);
    assert.equal((await fetch(`${url}/v1/admin/nodes`,{
      headers:{authorization:`Bearer ${'X'.repeat(40)}`}})).status,401);
    const response=await fetch(`${url}/v1/admin/nodes`,{
      headers:{authorization:`Bearer ${'Z'.repeat(40)}`}});
    assert.equal(response.status,200);
    assert.equal((await response.json()).nodesRegistered,0);
    const html=await (await fetch(url)).text();
    assert.match(html,/viewport-fit=cover/);
    assert.match(html,/dashboard\.js/);
    assert.equal((await fetch(`${url}/dashboard.js`)).status,200);
    assert.equal((await fetch(`${url}/v1/node/nonce?address=not-an-address`)).status,400);
    assert.equal((await fetch(`${url}/health`).then(r=>r.json())).realValidator,false);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('client rejects unsafe remote HTTP, invalid allocation, and wrong identity',()=>{
  const id=user();
  const base={chainId:CHAIN,privateKey:id.privateKey,coordinatorUrl:'http://127.0.0.1:8888/'};
  assert.throws(()=>new ProviderNodeClient({...base,
    coordinatorUrl:'http://example.com/'}),/HTTPS or loopback/);
  assert.throws(()=>new ProviderNodeClient({...base,
    l1Percent:30,aiPercent:20,rentalPercent:60}),/total 100%/);
  assert.throws(()=>new ProviderNodeClient({...base,
    privateKey:null}),/signed identity/);
});
