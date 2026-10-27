import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiTestnetLab} from './ai-testnet-fixture.mjs';
import {AiLocalPortal} from './ai-local-portal.mjs';
import {AiInferenceWorker} from './ai-inference-worker.mjs';
import {LocalGenerativeAiHost} from './hosted-resource-backends.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {digest,generateIdentity} from './pq.mjs';

const MODEL='qwen2.5:0.5b';
function mockHost({failed=false}={}){
  const prompts=[];
  return {prompts,modelHost:new LocalGenerativeAiHost({allowedModels:[MODEL],
    fetchImpl:async(url,options)=>{
      assert.equal(url,'http://127.0.0.1:11434/api/generate');
      const body=JSON.parse(options.body);
      prompts.push(body.prompt);
      if(failed)throw new Error('Ollama unavailable');
      return new Response(JSON.stringify({model:MODEL,done:true,
        response:`回答: ${body.prompt}`,eval_count:14}),{status:200,
        headers:{'content-type':'application/json'}});
    }})};
}

test('testnet ZNYT escrow waits for real signed AI model response and explicit bilateral approval',async()=>{
  const {modelHost,prompts}=mockHost();
  const lab=createAiTestnetLab({model:MODEL,modelHost});
  const before=lab.session.status();
  assert.equal(before.customerZnytLab,'960');
  assert.equal(before.providerZnytLab,'0');
  assert.equal(before.pendingSettlement,false);
  assert.throws(()=>lab.session.settle(),/Verified generation/);
  assert.throws(()=>lab.market.settleRental(
    signMarket({kind:MARKET_KINDS.RENT_METER,chainId:'19127',
      rentalId:lab.session.rentalId,usedSlots:'1'},lab.provider.privateKey),
    signMarket({kind:MARKET_KINDS.RENT_METER,chainId:'19127',
      rentalId:lab.session.rentalId,usedSlots:'1'},lab.customer.privateKey)),
    /Verified executed work or hosted resource receipt/);
  const response=await lab.session.ask('こんにちは',64);
  assert.equal(response.reply,'回答: こんにちは');
  assert.equal(response.proofVerified,true);
  assert.deepEqual(prompts,['こんにちは']);
  assert.equal(lab.session.status().pendingSettlement,true);
  assert.equal(lab.market.znytBalance(lab.provider.address),'0');
  const settled=lab.session.settle();
  assert.equal(settled.paymentUnit,'ZNYT_LAB_NOT_REAL_TOKEN');
  assert.equal(settled.charged,'20');
  assert.equal(settled.realToken,false);
  assert.equal(lab.session.status().providerZnytLab,'19');
  assert.equal(lab.session.status().customerZnytLab,'980');
  assert.throws(()=>lab.session.settle(),/explicit approval/);
  await assert.rejects(()=>lab.session.ask('again'),/settled/);
  assert.equal(lab.session.status().physicalGpuAttested,false);
  assert.equal(lab.realOnChainTestnetZnyt,false);
});

test('eligible signed node provider can receive actual local AI response using bounded free quota',async()=>{
  const {modelHost}=mockHost();
  const lab=createAiTestnetLab({model:MODEL,modelHost});
  const before=lab.session.status();
  assert.equal(before.providerEligible,true);
  assert.equal(before.providerAiQuota,20);
  const result=await lab.session.askAsProvider('Node provider free AI',64);
  assert.equal(result.reply,'回答: Node provider free AI');
  assert.equal(result.providerBenefit,true);
  assert.equal(result.remaining,19);
  assert.equal(lab.session.status().providerZnytLab,'0');
  assert.equal(lab.session.status().providerAiQuota,19);
  assert.equal(lab.session.status().providerFreeAnswered,1);
});

test('failed real local Ollama call never records a fake answer or settles escrow',async()=>{
  const {modelHost}=mockHost({failed:true});
  const lab=createAiTestnetLab({model:MODEL,modelHost});
  await assert.rejects(()=>lab.session.ask('Anything'),/Ollama model runtime is unavailable/);
  assert.equal(lab.session.status().answered,0);
  assert.equal(lab.session.status().pendingSettlement,false);
  assert.equal(lab.market.verifiedRentalWork(lab.session.rentalId),0);
  assert.equal(lab.session.status().providerZnytLab,'0');
  await assert.rejects(()=>lab.session.askAsProvider('Anything'),/Ollama model runtime is unavailable/);
  assert.equal(lab.session.status().providerAiQuota,20);
});

test('AI inference worker rejects foreign, replayed, changed or unsigned request',async()=>{
  const {modelHost}=mockHost();
  const lab=createAiTestnetLab({model:MODEL,modelHost});
  const permitId=digest('ZERONYTH_HOSTED_SERVICE_PERMIT_ID_V1\0',
    JSON.stringify(lab.signedPermit));
  const fields={kind:MARKET_KINDS.SERVICE_REQUEST,chainId:'19127',
    rentalId:lab.session.rentalId,permitId,
    nonce:'0',operation:'generate',prompt:'hello',maxTokens:'64'};
  const signed=signMarket(fields,lab.customer.privateKey);
  const another=generateIdentity();
  await assert.rejects(()=>lab.worker.execute(lab.signedPermit,
    signMarket(fields,another.privateKey)),/provider\/customer-bound/);
  await assert.rejects(()=>lab.worker.execute(lab.signedPermit,
    {...signed,prompt:'tampered'}),/ML-DSA signature/);
  const first=await lab.worker.execute(lab.signedPermit,signed);
  assert.equal(first.localModelActuallyResponded,true);
  assert.equal(first.physicalGpuUsageVerified,false);
  await assert.rejects(()=>lab.worker.execute(lab.signedPermit,signed),/replayed/);
});

test('AI worker serves verified JSON on loopback only and rejects anonymous calls',async()=>{
  const {modelHost}=mockHost();
  const lab=createAiTestnetLab({model:MODEL,modelHost});
  const {server,url}=await lab.worker.startLoopbackServer();
  try{
    assert.match(url,/^http:\/\/127\.0\.0\.1:/);
    const health=await (await fetch(`${url}/health`)).json();
    assert.equal(health.realZnyt,false);
    const response=await fetch(`${url}/v1/ai/execute`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({request:{prompt:'hi'}})});
    assert.equal(response.status,400);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('iPhone AI portal keeps usage private and requires admin token',async()=>{
  const {modelHost}=mockHost();
  const lab=createAiTestnetLab({model:MODEL,modelHost});
  const portal=new AiLocalPortal({session:lab.session,adminToken:'T'.repeat(40)});
  const {server,url}=await portal.start();
  try{
    const html=await (await fetch(url)).text();
    assert.match(html,/viewport-fit=cover/);
    assert.match(html,/ZNYT TEST/);
    assert.match(html,/ZERONYTH AI/);
    assert.equal((await fetch(`${url}/v1/ai/state`)).status,401);
    const headers={authorization:`Bearer ${'T'.repeat(40)}`};
    const state=await fetch(`${url}/v1/ai/state`,{headers});
    assert.equal(state.status,200);
    assert.equal((await state.json()).customerZnytLab,'960');
    const error=await fetch(`${url}/v1/ai/ask`,{
      method:'POST',headers:{...headers,'content-type':'application/json'},
      body:JSON.stringify({prompt:'hack',maxTokens:100,asProvider:'no'})});
    assert.equal(error.status,400);
    const response=await fetch(`${url}/v1/ai/ask`,{
      method:'POST',headers:{...headers,'content-type':'application/json'},
      body:JSON.stringify({prompt:'元気？',maxTokens:64,asProvider:false})});
    assert.equal(response.status,200);
    assert.equal((await response.json()).reply,'回答: 元気？');
    const settlement=await fetch(`${url}/v1/ai/settle`,{
      method:'POST',headers:{...headers,'content-type':'application/json'},
      body:JSON.stringify({confirm:true})});
    assert.equal(settlement.status,200);
    assert.equal((await settlement.json()).receipt.realToken,false);
    assert.equal((await fetch(`${url}/ai-dashboard.js`)).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
