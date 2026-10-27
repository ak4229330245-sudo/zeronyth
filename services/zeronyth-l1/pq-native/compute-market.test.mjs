import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {ComputeMarket,hashWork} from './compute-market.mjs';
import {MARKET_KINDS,signMarket,verifyMarket} from './market-crypto.mjs';
import {GENESIS_KIND,digest,generateIdentity,ProtocolError} from './pq.mjs';

function fixture(){
  const validators=Array.from({length:4},()=>generateIdentity());
  const provider=generateIdentity();
  const requester=generateIdentity();
  const outsider=generateIdentity();
  const chainId='19127';
  const genesis={kind:GENESIS_KIND,chainId,
    validators:validators.map(({publicKey})=>({publicKey})),
    allocations:[{address:provider.address,balance:'1000'},
      {address:requester.address,balance:'1000'}]};
  const market=new ComputeMarket(genesis);
  const register=signMarket({kind:MARKET_KINDS.REGISTER,chainId,
    nonce:'0',cpuCores:'4',ramMiB:'4096',gpuCount:'0',stake:'100'},provider.privateKey);
  const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',JSON.stringify(register));
  const attest=validators.map(v=>signMarket({kind:MARKET_KINDS.CAPACITY,chainId,
    provider:provider.address,registrationId,cpuCores:'4',ramMiB:'4096',
    gpuCount:'0',expiresAtHeight:'20'},v.privateKey));
  const enroll=()=>market.registerProvider(register,attest.slice(0,3));
  const request=({nonce='0',price='100',expiresAtHeight='15'}={})=>signMarket({
    kind:MARKET_KINDS.REQUEST,chainId,nonce,price,seed:'cd'.repeat(32),
    iterations:'5',expiresAtHeight,
  },requester.privateKey);
  const result=(jobId,output,key=provider.privateKey)=>signMarket({
    kind:MARKET_KINDS.RESULT,chainId,jobId,output,
  },key);
  return {validators,provider,requester,outsider,genesis,market,register,attest,
    enroll,request,result,chainId};
}

test('3-of-4 independent ML-DSA capacity attestations lock stake without credit minting',()=>{
  const x=fixture();
  assert.equal(x.enroll().attestationCount,3);
  assert.equal(x.market.balance(x.provider.address),'900');
  assert.equal(x.market.provider(x.provider.address).stake,'100');
  assert.deepEqual(x.market.audit(),{
    unit:'DEV_CREDIT_NON_TRANSFERABLE_SIMULATION',height:'0',providers:1,jobs:0,
    spendable:'1900',collateral:'100',escrow:'0',treasury:'0',initialSupply:'2000',conserved:true,
  });
  assert.throws(()=>x.enroll(),/nonce\/replay/);
});

test('no two-signature, duplicate, stranger, or mutated capacity certificate can enroll',()=>{
  const x=fixture();
  assert.throws(()=>x.market.registerProvider(x.register,x.attest.slice(0,2)),/At least 3/);
  assert.throws(()=>x.market.registerProvider(x.register,[x.attest[0],x.attest[0],x.attest[2]]),/duplicate/);
  const fraud=signMarket({kind:MARKET_KINDS.CAPACITY,chainId:x.chainId,
    provider:x.provider.address,registrationId:x.attest[0].registrationId,
    cpuCores:'4',ramMiB:'4096',gpuCount:'0',expiresAtHeight:'20'},x.outsider.privateKey);
  assert.throws(()=>x.market.registerProvider(x.register,[x.attest[0],x.attest[1],fraud]),/Unknown/);
  assert.throws(()=>x.market.registerProvider(x.register,[x.attest[0],x.attest[1],
    {...x.attest[2],cpuCores:'64'}]),/Invalid market ML-DSA signature/);
  assert.equal(x.market.audit().conserved,true);
});

test('ECDSA and crosschain signatures are forbidden for compute registration and requests',()=>{
  const x=fixture();
  const ec=generateKeyPairSync('ec',{namedCurve:'secp256k1'});
  assert.throws(()=>signMarket({kind:MARKET_KINDS.REQUEST,chainId:'19127',nonce:'0',
    seed:'cd'.repeat(32),iterations:'5',price:'1',expiresAtHeight:'10'},ec.privateKey),/ML-DSA/);
  assert.throws(()=>verifyMarket(x.register,MARKET_KINDS.REGISTER,'19128'),/replay/);
  assert.throws(()=>verifyMarket({...x.register,signature:'xx'},MARKET_KINDS.REGISTER,x.chainId),/Invalid/);
  assert.throws(()=>verifyMarket({...x.register,hidden:'1'},MARKET_KINDS.REGISTER,x.chainId),/unexpected/);
});

test('signed hash job pays registered node 95% and treasury 5% only after independent proof',()=>{
  const x=fixture();x.enroll();
  const receipt=x.market.submitJob(x.request());
  assert.equal(x.market.balance(x.requester.address),'900');
  assert.equal(x.market.audit().escrow,'100');
  assert.equal(x.market.assignJob(receipt.jobId).provider,x.provider.address);
  const payment=x.market.submitResult(x.result(receipt.jobId,hashWork('cd'.repeat(32),5)));
  assert.equal(payment.paid,'95');
  assert.equal(x.market.provider(x.provider.address).earned,'95');
  assert.equal(x.market.balance(x.provider.address),'995');
  assert.equal(x.market.audit().treasury,'5');
  assert.equal(x.market.audit().conserved,true);
  assert.throws(()=>x.market.submitResult(x.result(receipt.jobId,hashWork('cd'.repeat(32),5))),/unsettled/);
});

test('bad provider result forfeits bounded stake and refunds requester; unsigned forgery cannot slash',()=>{
  const x=fixture();x.enroll();
  const {jobId}=x.market.submitJob(x.request());
  x.market.assignJob(jobId);
  assert.throws(()=>x.market.submitResult(x.result(jobId,'00'.repeat(32),x.outsider.privateKey)),/assigned/);
  assert.throws(()=>x.market.submitResult({...x.result(jobId,'00'.repeat(32)),signature:'bogus'}),/signature/);
  assert.equal(x.market.provider(x.provider.address).stake,'100');
  const outcome=x.market.submitResult(x.result(jobId,'00'.repeat(32)));
  assert.equal(outcome.status,'fraud-refunded');
  assert.equal(x.market.provider(x.provider.address).stake,'0');
  assert.equal(x.market.balance(x.requester.address),'1000');
  assert.equal(x.market.audit().treasury,'100');
  assert.equal(x.market.audit().conserved,true);
  assert.throws(()=>x.market.submitResult(x.result(jobId,'00'.repeat(32))),/unsettled/);
});

test('timeout refunds escrow once, and non-increasing height is rejected',()=>{
  const x=fixture();x.enroll();
  const {jobId}=x.market.submitJob(x.request({expiresAtHeight:'2'}));
  x.market.assignJob(jobId);
  assert.deepEqual(x.market.advanceHeight('2').refundedJobIds,[jobId]);
  assert.equal(x.market.balance(x.requester.address),'1000');
  assert.equal(x.market.provider(x.provider.address).activeJobs,0);
  assert.equal(x.market.audit().escrow,'0');
  assert.throws(()=>x.market.advanceHeight('2'),/increase/);
  assert.throws(()=>x.market.submitResult(x.result(jobId,hashWork('cd'.repeat(32),5))),/unsettled/);
  assert.equal(x.market.audit().conserved,true);
});

test('capacity limits, request replay, price balance and job slot checks reject before mutation',()=>{
  const x=fixture();x.enroll();
  assert.throws(()=>x.market.submitJob(x.request({price:'2000'})),/Insufficient/);
  assert.throws(()=>x.market.submitJob({...x.request(),iterations:'100000000'}),/Invalid market ML-DSA signature/);
  const signed=x.request();
  x.market.submitJob(signed);
  assert.throws(()=>x.market.submitJob(signed),/nonce\/replay/);
  assert.equal(x.market.audit().conserved,true);
});
