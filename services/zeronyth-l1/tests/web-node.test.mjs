import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hashIterations,hexToBytes,bytesToHex,makeLocalJob} from '../dashboard/assets/node-hash.mjs';
import {WebNodeSession} from '../dashboard/assets/node-session.mjs';
import {hashWork} from '../pq-native/compute-market.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));

test('Web Crypto browser work matches independent native hash verifier',async()=>{
  for(const rounds of [1,8,32,128]){
    const seed='a3'.repeat(32);
    assert.equal(await hashIterations(seed,rounds,{subtle:webcrypto.subtle}),hashWork(seed,rounds));
  }
  assert.equal(bytesToHex(hexToBytes('0a'.repeat(32))),'0a'.repeat(32));
  assert.throws(()=>hexToBytes('0Xff'),/canonical/);
  await assert.rejects(hashIterations('a3'.repeat(32),513,{subtle:webcrypto.subtle}),/1\.\.512/);
});

test('random job uses 32 bytes, never a timestamp or guessable counter',()=>{
  const job=makeLocalJob(16,{getRandomValues:b=>b.fill(0xab)});
  assert.deepEqual(job,{id:'ab'.repeat(32),seed:'ab'.repeat(32),iterations:16});
  assert.throws(()=>makeLocalJob(0,{getRandomValues:b=>b}),/Invalid job size/);
});

function fixture({verify=async()=>true}={}){
  let visible=true;
  const workers=[];
  const update=[];
  const now={value:100};
  const session=new WebNodeSession({
    createWorker:()=>{
      const worker={job:null,terminated:false,onmessage:null,onerror:null,
        postMessage(job){this.job=job;},terminate(){this.terminated=true;}};
      workers.push(worker);
      return worker;
    },
    createJob:()=>({id:'b4'.repeat(32),seed:'b4'.repeat(32),iterations:8}),
    verify,
    visible:()=>visible,
    clock:()=>now.value,
    onUpdate:s=>update.push(s),
    setTimer:()=>1,
    clearTimer:()=>{},
    intervalMs:100,
  });
  return {session,workers,update,now,setVisible:v=>{visible=v;}};
}

test('worker work pays only local demo counter AFTER independent proof approval',async()=>{
  const x=fixture();
  x.session.start();
  assert.equal(x.session.snapshot().state,'running');
  assert.equal(x.workers.length,1);
  x.workers[0].onmessage({data:{id:'b4'.repeat(32),output:'f0'.repeat(32)}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(x.session.snapshot().demoCredits,1);
  assert.equal(x.session.snapshot().completed,1);
  assert.equal(x.session.snapshot().realZnyt,'0');
  assert.equal(x.session.snapshot().realNodeConnected,false);
  x.session.stop();
  assert.equal(x.workers[0].terminated,true);
  assert.equal(x.session.snapshot().state,'idle');
});

test('forged worker result or wrong job ID triggers fail-closed stop and zero rewards',async()=>{
  const x=fixture();
  x.session.start();
  x.workers[0].onmessage({data:{id:'wrong',output:'aa'.repeat(32)}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(x.session.snapshot().state,'error');
  assert.equal(x.session.snapshot().demoCredits,0);
  assert.equal(x.workers[0].terminated,true);
  const y=fixture({verify:async()=>false});
  y.session.start();
  y.workers[0].onmessage({data:{id:'b4'.repeat(32),output:'aa'.repeat(32)}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(y.session.snapshot().state,'error');
  assert.equal(y.session.snapshot().demoCredits,0);
});

test('hidden tab terminates CPU worker and resumes only after visible again',()=>{
  const x=fixture();
  x.session.start();
  x.now.value=210;
  x.setVisible(false);
  x.session.visibilityChanged();
  assert.equal(x.session.snapshot().state,'paused');
  assert.equal(x.session.snapshot().activeMs,110);
  assert.equal(x.workers[0].terminated,true);
  x.setVisible(true);
  x.session.visibilityChanged();
  assert.equal(x.session.snapshot().state,'running');
  assert.equal(x.workers.length,2);
  x.session.stop();
  x.setVisible(false);
  x.session.visibilityChanged();
  x.setVisible(true);
  x.session.visibilityChanged();
  assert.equal(x.session.snapshot().state,'idle');
  assert.equal(x.workers.length,2);
});

test('stale asynchronous result after stop cannot generate fake credits',async()=>{
  let finish;
  const x=fixture({verify:()=>new Promise(resolve=>{finish=resolve;})});
  x.session.start();
  x.workers[0].onmessage({data:{id:'b4'.repeat(32),output:'ff'.repeat(32)}});
  await new Promise(resolve=>setImmediate(resolve));
  x.session.stop();
  finish(true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(x.session.snapshot().demoCredits,0);
  assert.equal(x.session.snapshot().state,'idle');
});

test('installed localhost explorer serves CSP-restricted separate node UI without inline scripts',()=>{
  const html=readFileSync(join(root,'dashboard/node.html'),'utf8');
  const index=readFileSync(join(root,'dashboard/index.html'),'utf8');
  const nginx=readFileSync(join(root,'dashboard/nginx.conf'),'utf8');
  const compose=readFileSync(join(root,'docker-compose.yml'),'utf8');
  assert.match(html,/src="assets\/web-node-ui.mjs"/);
  assert.match(html,/id="nodeConsent"/);
  assert.match(html,/id="startNode"/);
  assert.match(html,/id="stopNode"/);
  assert.doesNotMatch(html,/\son[a-z]+\s*=/i);
  assert.doesNotMatch(html,/<script(?![^>]*\bsrc=)/i);
  assert.match(index,/href="node.html"/);
  assert.match(nginx,/worker-src 'self'/);
  assert.match(compose,/dashboard\/node.html:\/usr\/share\/nginx\/html\/node.html:ro/);
  // Copy moved into the i18n catalogs; the page references it by key.
  assert.match(html,/data-i18n="p2p\.reward"/);
  assert.match(html,/id="znytValue"/);
  const ja=readFileSync(join(root,'dashboard/assets/i18n-ja.mjs'),'utf8');
  assert.match(ja,/実際のZNYT/);
});
