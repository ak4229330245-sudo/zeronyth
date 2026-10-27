import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Ledger, requiredValidatorQuorum} from './ledger.mjs';
import {ValidatorReplica,oneRoundCommit} from './consensus.mjs';
import {GENESIS_KIND,generateIdentity,signTransaction,digest} from './pq.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {DeviceNodeRegistry} from './device-registry.mjs';
import {ComputeMarket} from './compute-market.mjs';
import {VoteJournal} from './journal.mjs';
import {orderGenesisHash,proposeOrder,voteOrder,verifyCertifiedOrder} from './order-consensus.mjs';
import {validatePrivatePeerConfig} from './private-peer-transport.mjs';

function setup(count,allocations=[]){
  const validators=Array.from({length:count},()=>generateIdentity());
  const genesis={kind:GENESIS_KIND,chainId:'19127',
    validators:validators.map(v=>({publicKey:v.publicKey})),allocations};
  return {validators,genesis};
}

test('elastic genesis committee calculates safe >2/3 quorum for different sizes',()=>{
  assert.deepEqual([4,5,7,10,14].map(requiredValidatorQuorum),[3,4,5,7,10]);
  assert.throws(()=>requiredValidatorQuorum(3),/at least 4/);
  const sender=generateIdentity(),receiver=generateIdentity();
  const x=setup(14,[{address:sender.address,balance:'100'}]);
  const replicas=x.validators.map(v=>new ValidatorReplica(x.genesis,v.privateKey));
  const tx=signTransaction({chainId:'19127',nonce:'0',to:receiver.address,value:'2'},sender.privateKey);
  assert.throws(()=>oneRoundCommit(replicas,[tx],{participating:[0,1,2,3,4,5,6,7,8]}),
    /at least 10 PQ approvals/);
  assert.ok(replicas.every(r=>r.ledger.height===0n));
  // A block produced by the same deterministic leader cannot be changed to
  // skip its journal; a fresh fixture is used for the successful quorum.
  const y=setup(14,[{address:sender.address,balance:'100'}]);
  const peers=y.validators.map(v=>new ValidatorReplica(y.genesis,v.privateKey));
  const committed=oneRoundCommit(peers,[tx],{participating:[0,1,2,3,4,5,6,7,8,9]});
  assert.equal(committed.votes.length,10);
  assert.ok(peers.every(r=>r.ledger.height===1n&&r.ledger.headHash===committed.hash&&
    r.ledger.balance(receiver.address)===2n));
  const tampered=structuredClone(committed.votes);
  tampered[0].signature=Buffer.alloc(3309).toString('base64');
  assert.throws(()=>new Ledger(y.genesis).verifyCertificate(committed.block,tampered),/Invalid ML-DSA/);
});

test('seven-validator signed ordering rotates dynamically and requires five valid votes',()=>{
  const x=setup(7);
  const sender=generateIdentity(),recipient=generateIdentity();
  const tx=signTransaction({chainId:'19127',nonce:'0',to:recipient.address,value:'1'},sender.privateKey);
  const temp=mkdtempSync(join(tmpdir(),'zeronyth-elastic-order-'));
  const journals=[];
  try{
    for(let i=0;i<x.validators.length;i++)journals.push(new VoteJournal(join(temp,`${i}.jsonl`)));
    const height=8n,headHash=orderGenesisHash(x.genesis);
    const proposal=proposeOrder(x.genesis,headHash,height,[tx],x.validators[0].privateKey,journals[0]);
    const votes=x.validators.slice(0,5).map((v,i)=>voteOrder(proposal,x.genesis,headHash,
      height,v.privateKey,journals[i]));
    assert.equal(verifyCertifiedOrder({proposal,votes},x.genesis,headHash,height).length,64);
    assert.throws(()=>verifyCertifiedOrder({proposal,votes:votes.slice(0,4)},x.genesis,
      headHash,height),/at least 5/);
  }finally{
    for(const journal of journals)journal.close();
    rmSync(temp,{recursive:true,force:true});
  }
});

test('signed device participation grows beyond old 128 limit with bounded pages and safe exit/rejoin',()=>{
  const x=setup(4),registry=new DeviceNodeRegistry(x.genesis);
  const members=Array.from({length:129},()=>generateIdentity());
  const signedProfile=(identity,nonce)=>signMarket({kind:MARKET_KINDS.DEVICE,
    chainId:'19127',nonce:String(nonce),deviceClass:'phone',platform:'ios',runtime:'browser',
    role:'light',maxCpuPct:'10',foregroundOnly:true},identity.privateKey);
  const profiles=members.map(id=>signedProfile(id,0));
  const joined=profiles.map(profile=>registry.register(profile));
  assert.equal(joined.length,129);
  assert.equal(registry.size,129);
  const first=registry.list({limit:100});
  const second=registry.list({after:first.nextCursor,limit:100});
  assert.deepEqual([first.items.length,second.items.length,first.registeredCount], [100,29,129]);
  assert.equal(second.nextCursor,null);
  assert.throws(()=>registry.list({limit:101}),/page size/);
  assert.throws(()=>registry.list({after:generateIdentity().address}),/Unknown device pagination cursor/);
  const last=members.at(-1),deviceId=joined.at(-1).deviceId;
  const leave=signMarket({kind:MARKET_KINDS.DEVICE_LEAVE,chainId:'19127',
    deviceId,sequence:'0'},last.privateKey);
  assert.throws(()=>registry.leave({...leave,deviceId:'0'.repeat(64)}),/Invalid market ML-DSA signature/);
  assert.equal(registry.leave(leave).nextRegistrationNonce,'1');
  assert.equal(registry.size,128);
  assert.throws(()=>registry.leave(leave),/unknown or mismatched/i);
  assert.throws(()=>registry.register(profiles.at(-1)),/nonce\/replay/);
  const rejoined=registry.register(signedProfile(last,1));
  assert.notEqual(rejoined.deviceId,deviceId);
  assert.equal(registry.size,129);
  assert.throws(()=>registry.leave(leave),/unknown or mismatched/i);
});

test('DEV-CREDIT registry admits more than 64 signed providers and preserves conservation',()=>{
  const providers=Array.from({length:65},()=>generateIdentity());
  const requester=generateIdentity();
  const x=setup(4,[...providers.map(p=>({address:p.address,balance:'200'})),
    {address:requester.address,balance:'200'}]);
  const market=new ComputeMarket(x.genesis);
  for(const provider of providers){
    const registration=signMarket({kind:MARKET_KINDS.REGISTER,chainId:'19127',
      nonce:'0',cpuCores:'1',ramMiB:'1024',gpuCount:'0',stake:'100'},provider.privateKey);
    const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',JSON.stringify(registration));
    const votes=x.validators.slice(0,3).map(v=>signMarket({kind:MARKET_KINDS.CAPACITY,
      chainId:'19127',provider:provider.address,registrationId,cpuCores:'1',
      ramMiB:'1024',gpuCount:'0',expiresAtHeight:'10'},v.privateKey));
    market.registerProvider(registration,votes);
  }
  assert.equal(market.audit().providers,65);
  const job=signMarket({kind:MARKET_KINDS.REQUEST,chainId:'19127',nonce:'0',
    seed:'ca'.repeat(32),iterations:'5',price:'10',expiresAtHeight:'8'},requester.privateKey);
  const {jobId}=market.submitJob(job);
  const assignment=market.assignJob(jobId);
  assert.ok(providers.some(p=>p.address===assignment.provider));
  assert.equal(market.audit().conserved,true);
});

test('seven-validator provider stake requires a true five-signature capacity certificate',()=>{
  const provider=generateIdentity();
  const x=setup(7,[{address:provider.address,balance:'250'}]);
  const market=new ComputeMarket(x.genesis);
  const register=signMarket({kind:MARKET_KINDS.REGISTER,chainId:'19127',
    nonce:'0',cpuCores:'2',ramMiB:'1024',gpuCount:'0',stake:'100'},provider.privateKey);
  const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',JSON.stringify(register));
  const attest=x.validators.slice(0,5).map(v=>signMarket({kind:MARKET_KINDS.CAPACITY,
    chainId:'19127',provider:provider.address,registrationId,cpuCores:'2',
    ramMiB:'1024',gpuCount:'0',expiresAtHeight:'10'},v.privateKey));
  assert.throws(()=>market.registerProvider(register,attest.slice(0,4)),/At least 5/);
  assert.equal(market.balance(provider.address),'250');
  assert.equal(market.registerProvider(register,attest).attestationCount,5);
  assert.equal(market.balance(provider.address),'150');
  assert.equal(market.audit().conserved,true);
});

test('private validator TLS pin configuration supports non-four genesis committees',()=>{
  const x=setup(7);
  const peers=x.validators.map((_,i)=>({validatorIndex:i,host:`10.0.0.${i+1}`,
    port:12000+i,serverName:`validator-${i}.private.test`,
    certSha256:Array(32).fill((i+1).toString(16).padStart(2,'0')).join(':')}));
  const config={kind:'ZERONYTH_PQ_PRIVATE_VALIDATORS_V1',validatorIndex:0,
    peers,listenAddress:'10.0.0.1',port:12000,tls:{}};
  assert.equal(validatePrivatePeerConfig(config,x.genesis,x.validators[0].publicKey,12000),true);
  assert.throws(()=>validatePrivatePeerConfig({...config,peers:peers.slice(0,4)},x.genesis,
    x.validators[0].publicKey,12000),/Invalid explicit private validator/);
});
