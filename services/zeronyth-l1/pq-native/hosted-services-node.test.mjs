import test from 'node:test';
import assert from 'node:assert/strict';
import {GENESIS_KIND,generateIdentity,digest} from './pq.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {DeviceNodeRegistry} from './device-registry.mjs';
import {ComputeMarket} from './compute-market.mjs';
import {HardenedContainerHost,LocalGenerativeAiHost} from './hosted-resource-backends.mjs';
import {HostedServicesNode} from './hosted-services-node.mjs';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const GPU='GPU-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const VPS_IMAGE=`busybox@sha256:${'a'.repeat(64)}`;
const GPU_IMAGE=`nvidia/cuda@sha256:${'b'.repeat(64)}`;
function fixture(service='vps'){
  const validators=Array.from({length:4},()=>generateIdentity());
  const provider=generateIdentity(),customer=generateIdentity(),attacker=generateIdentity();
  const chainId='19127';
  const sign=(kind,fields,id)=>signMarket({kind,chainId,...fields},id.privateKey);
  const genesis={kind:GENESIS_KIND,chainId,
    validators:validators.map(v=>({publicKey:v.publicKey})),
    allocations:[{address:provider.address,balance:'300'},
      {address:customer.address,balance:'1000'}]};
  const registry=new DeviceNodeRegistry(genesis);
  const market=new ComputeMarket(genesis,{deviceRegistry:registry,
    znyt:{allocations:[{address:customer.address,balance:'1000'}],
      requireExecutionProof:true}});
  const profile=registry.register(sign(MARKET_KINDS.DEVICE,{
    nonce:'0',deviceClass:'server',platform:'linux',runtime:'native',role:'compute',
    maxCpuPct:'40',foregroundOnly:false},provider));
  registry.heartbeat(sign(MARKET_KINDS.HEARTBEAT,{
    deviceId:profile.deviceId,sequence:'0',observedAtHeight:'0',foreground:true,
    charging:true,unmetered:true,batteryPct:'100',thermal:'normal'},provider));
  const registration=sign(MARKET_KINDS.REGISTER,{
    nonce:'0',cpuCores:'4',ramMiB:'4096',gpuCount:'1',stake:'100'},provider);
  const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',JSON.stringify(registration));
  market.registerProvider(registration,validators.slice(0,3).map(v=>sign(MARKET_KINDS.CAPACITY,{
    provider:provider.address,registrationId,cpuCores:'4',ramMiB:'4096',
    gpuCount:'1',expiresAtHeight:'20'},v)));
  const offer=market.publishRentalOffer(sign(MARKET_KINDS.RENT_OFFER,{
    nonce:market.nextNonce(provider.address),service,cpuCores:'2',ramMiB:'2048',
    storageGiB:service==='vps'?'40':'0',gpuCount:service==='vps'?'0':'1',
    vramMiB:service==='vps'?'0':'8192',pricePerSlot:'20',
    maxSlots:'4',expiresAtHeight:'10'},provider));
  const rental=market.reserveRental(sign(MARKET_KINDS.RENT_REQUEST,{
    nonce:market.nextNonce(customer.address),offerId:offer.offerId,slots:'2'},customer));
  const permit=sign(MARKET_KINDS.SERVICE_PERMIT,{
    rentalId:rental.rentalId,customer:customer.address,provider:provider.address,
    service,cpuCores:'1',ramMiB:'512',
    gpuDeviceId:service==='vps'?'none':GPU,
    model:service==='vps'?'none':'local-test',maxRequests:'3',
    expiresAtUnixMs:String(Date.now()+60000)},provider);
  const permitId=digest('ZERONYTH_HOSTED_SERVICE_PERMIT_ID_V1\0',JSON.stringify(permit));
  const request=(nonce='0',operation='create',prompt='',maxTokens='0')=>sign(
    MARKET_KINDS.SERVICE_REQUEST,{
      rentalId:rental.rentalId,permitId,nonce,operation,prompt,maxTokens},customer);
  const dockerCalls=[];
  let containerCounter=0;
  const runner=async(args)=>{
    dockerCalls.push(args);
    if(args[0]==='info')return JSON.stringify({OSType:'linux',
      SecurityOptions:['name=rootless'],CgroupVersion:'2',CgroupDriver:'systemd'});
    if(args[0]==='image'&&args[1]==='inspect')return `sha256:${'a'.repeat(64)}`;
    if(args[0]==='create')return (++containerCounter).toString(16).padStart(64,'0');
    if(args[0]==='inspect'&&args[1]==='--format')return 'true';
    if(['start','rm'].includes(args[0]))return args[1]==='-f'?args[2]:args[1];
    throw new Error('Unexpected docker command');
  };
  const containers=new HardenedContainerHost({vpsImage:VPS_IMAGE,gpuImage:GPU_IMAGE,
    gpuDeviceIds:[GPU],maxCpus:2,maxMemoryMiB:2048,runner});
  const calls=[];
  const ai=new LocalGenerativeAiHost({allowedModels:['local-test'],fetchImpl:async(url,init)=>{
    calls.push({url,body:JSON.parse(init.body)});
    return new Response(JSON.stringify({model:'local-test',response:'生成AIの回答です',
      done:true,eval_count:8}),{status:200,
      headers:{'content-type':'application/json'}});
  }});
  const node=new HostedServicesNode({chainId,providerPrivateKey:provider.privateKey,
    containerHost:containers,modelHost:ai});
  const rentalMeter=id=>sign(MARKET_KINDS.RENT_METER,{
    rentalId:rental.rentalId,usedSlots:'1'},id);
  return {validators,provider,customer,attacker,market,registry,permit,permitId,
    request,dockerCalls,calls,node,containers,ai,sign,rental,rentalMeter};
}

test('provider-signed VPS sandbox creation proof unlocks mutual ZNYT-LAB billing',async()=>{
  const x=fixture();
  x.market.advanceHeight('1');x.registry.advanceHeight('1');
  assert.throws(()=>x.market.settleRental(x.rentalMeter(x.provider),
    x.rentalMeter(x.customer)),/Verified executed work/);
  const signed=x.request();
  const {server,url}=await x.node.startLoopbackServer();
  let completed;
  try{
    const response=await fetch(`${url}/v1/hosted/execute`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({permit:x.permit,request:signed})});
    assert.equal(response.status,200);
    completed=await response.json();
  }finally{await new Promise(resolve=>server.close(resolve));}
  assert.equal(completed.containerActuallyStarted,true);
  assert.equal(completed.realVmCreated,false);
  const argv=x.dockerCalls.find(args=>args[0]==='create');
  for(const hardening of ['--network','none','--read-only','--cap-drop','ALL',
    '--security-opt','no-new-privileges:true','--pids-limit','--memory',
    '--memory-swap','--cpus','--pull','never']){
    assert.ok(argv.includes(hardening),`Missing hardening flag: ${hardening}`);
  }
  assert.equal(argv.includes('--privileged'),false);
  assert.equal(argv.includes('--gpus'),false);
  const proof=x.market.recordVerifiedHostedService(x.permit,signed,
    completed.signedReceipt,completed.output);
  assert.equal(proof.receiptSignatureVerified,true);
  assert.throws(()=>x.market.recordVerifiedHostedService(x.permit,signed,
    completed.signedReceipt,completed.output),/Replayed hosted/);
  const settlement=x.market.settleRental(x.rentalMeter(x.provider),
    x.rentalMeter(x.customer));
  assert.equal(settlement.paid,'19');
  assert.equal(x.market.znytBalance(x.provider.address),'19');
  assert.equal(x.market.audit().znyt.conserved,true);
});

test('GPU device is passed only from signed provider allowlist; Ollama inference runs after reservation',async()=>{
  const x=fixture('ai-gpu');
  const created=await x.node.execute(x.permit,x.request());
  assert.equal(created.containerActuallyStarted,true);
  const argv=x.dockerCalls.find(args=>args[0]==='create');
  assert.equal(argv[argv.indexOf('--gpus')+1],`device=${GPU}`);
  const signedGenerate=x.request('1','generate','こんにちは！','32');
  const inferred=await x.node.execute(x.permit,signedGenerate);
  assert.equal(inferred.localModelActuallyResponded,true);
  assert.equal(inferred.output,'生成AIの回答です');
  assert.equal(inferred.physicalGpuUsageVerified,false);
  assert.equal(x.calls.length,1);
  assert.equal(x.calls[0].url,'http://127.0.0.1:11434/api/generate');
  assert.deepEqual(x.calls[0].body,{model:'local-test',prompt:'こんにちは！',
    stream:false,options:{num_predict:32}});
  x.market.recordVerifiedHostedService(x.permit,signedGenerate,
    inferred.signedReceipt,inferred.output);
  const stop=await x.node.execute(x.permit,x.request('2','stop'));
  assert.equal(stop.stopped,true);
  assert.equal(x.containers.isActive(x.rental.rentalId,'ai-gpu'),false);
  assert.throws(()=>x.market.recordVerifiedHostedService(x.permit,
    x.request('2','stop'),stop.signedReceipt,''),/Active signed hosted reservation/);
  x.market.advanceHeight('1');x.registry.advanceHeight('1');
  assert.equal(x.market.settleRental(x.rentalMeter(x.provider),
    x.rentalMeter(x.customer)).paid,'19');
  assert.equal(x.market.audit().znyt.conserved,true);
});

test('hosted node rejects forged signatures, nonce reuse, unsupported routes and model abuse',async()=>{
  const x=fixture('ai-gpu');
  const first=x.request();
  const fake=x.sign(MARKET_KINDS.SERVICE_REQUEST,{
    rentalId:x.rental.rentalId,permitId:x.permitId,nonce:'0',
    operation:'create',prompt:'',maxTokens:'0'},x.attacker);
  await assert.rejects(x.node.execute(x.permit,fake),/identities/);
  await assert.rejects(x.node.execute({...x.permit,cpuCores:'2'},first),/signature/);
  await assert.rejects(x.node.execute(x.permit,x.request('0','generate','test','16')),
    /Active provider-approved GPU/);
  await x.node.execute(x.permit,first);
  await assert.rejects(x.node.execute(x.permit,first),/nonce, replay/);
  await assert.rejects(x.node.execute(x.permit,x.request('1','generate','', '16')),
    /Invalid signed model prompt/);
  await assert.rejects(x.node.execute(x.permit,x.request('1','generate','hello', '300')),
    /Invalid signed model prompt/);
  await assert.rejects(x.ai.generate({model:'model-that-is-not-approved',
    prompt:'hello',maxTokens:5}),/not approved/);
  assert.equal(x.market.znytBalance(x.customer.address),'960');
});

test('Docker backend rejects rootful daemons, mutable images and unapproved GPU IDs',async()=>{
  assert.throws(()=>new HardenedContainerHost({vpsImage:'busybox:latest'}),/pinned/);
  const rootful=new HardenedContainerHost({vpsImage:VPS_IMAGE,runner:async()=>
    JSON.stringify({OSType:'linux',SecurityOptions:[],CgroupVersion:'2',
      CgroupDriver:'systemd'})});
  await assert.rejects(rootful.create({rentalId:'a'.repeat(64),service:'vps',
    cpuCores:1,ramMiB:512}),/Rootless Linux Docker/);
  const x=fixture('ai-gpu');
  await assert.rejects(x.containers.create({rentalId:'b'.repeat(64),
    service:'ai-gpu',cpuCores:1,ramMiB:512,
    gpuDeviceId:'GPU-unapproved00000000000000'}),/No operator-approved GPU/);
  assert.equal(x.dockerCalls.length,0);
});

test('one provider process cannot assign the same GPU to two concurrent rental containers',async()=>{
  const x=fixture('ai-gpu');
  const first=x.rental.rentalId;
  await x.containers.create({rentalId:first,service:'ai-gpu',
    cpuCores:1,ramMiB:512,gpuDeviceId:GPU});
  const second='d'.repeat(64);
  await assert.rejects(x.containers.create({rentalId:second,service:'ai-gpu',
    cpuCores:1,ramMiB:512,gpuDeviceId:GPU}),/GPU already exclusively reserved/);
  assert.equal(x.containers.isActive(first,'ai-gpu'),true);
  await x.containers.stop(first);
  assert.equal(x.containers.isActive(first,'ai-gpu'),false);
  await x.containers.create({rentalId:second,service:'ai-gpu',
    cpuCores:1,ramMiB:512,gpuDeviceId:GPU});
  assert.equal(x.containers.isActive(second,'ai-gpu'),true);
  await x.containers.stop(second);
});

test('provider-hosted CLI starts only local listener and does not claim Docker/AI readiness',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zeronyth-hosted-cli-'));
  const keyPath=join(directory,'provider.pem'),configPath=join(directory,'config.json');
  const identity=generateIdentity();
  let child;
  try{
    writeFileSync(keyPath,identity.privateKey.export({format:'pem',type:'pkcs8'}),
      {mode:0o600,flag:'wx'});
    writeFileSync(configPath,JSON.stringify({chainId:'19127',keyFile:keyPath,
      vpsImage:VPS_IMAGE,gpuImage:GPU_IMAGE,gpuDeviceIds:[GPU],
      allowedModels:['local-test'],maxCpus:2,maxMemoryMiB:2048,port:0}));
    child=spawn(process.execPath,['pq-native/hosted-node-agent.mjs',configPath],{
      cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
    const line=await new Promise((resolve,reject)=>{
      let output='';
      const timer=setTimeout(()=>reject(new Error('Hosted agent startup timeout')),4000);
      child.stdout.on('data',chunk=>{
        output+=chunk.toString('utf8');
        if(output.includes('\n')){
          clearTimeout(timer);resolve(JSON.parse(output.slice(0,output.indexOf('\n'))));
        }
      });
      child.once('exit',code=>{clearTimeout(timer);
        reject(new Error(`Hosted node terminated: ${code}`));});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
    });
    assert.equal(line.listening,true);
    assert.equal(line.dockerVerifiedAtBoot,false);
    assert.equal(line.ollamaVerifiedAtBoot,false);
    assert.equal(line.realZnytPaymentsEnabled,false);
    const health=await (await fetch(`${line.url}/health`)).json();
    assert.equal(health.loopbackOnly,true);
    assert.equal(health.dockerRuntimeCheckDeferred,true);
  }finally{
    if(child){child.kill('SIGTERM');await new Promise(resolve=>{
      if(child.exitCode!==null||child.signalCode!==null)resolve();
      else child.once('exit',resolve);
    });}
    rmSync(directory,{recursive:true,force:true});
  }
});
