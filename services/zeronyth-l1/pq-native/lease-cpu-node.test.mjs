import test from 'node:test';
import assert from 'node:assert/strict';
import {GENESIS_KIND,generateIdentity,digest} from './pq.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {DeviceNodeRegistry} from './device-registry.mjs';
import {ComputeMarket,hashWork} from './compute-market.mjs';
import {LeaseCpuNode} from './lease-cpu-node.mjs';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function fixture(){
  const validators=Array.from({length:4},()=>generateIdentity());
  const provider=generateIdentity(),customer=generateIdentity(),attacker=generateIdentity();
  const chainId='19127';
  const genesis={kind:GENESIS_KIND,chainId,
    validators:validators.map(v=>({publicKey:v.publicKey})),
    allocations:[{address:provider.address,balance:'300'},
      {address:customer.address,balance:'500'}]};
  const sign=(kind,fields,identity)=>signMarket({kind,chainId,...fields},identity.privateKey);
  const registry=new DeviceNodeRegistry(genesis);
  const market=new ComputeMarket(genesis,{deviceRegistry:registry,
    znyt:{allocations:[{address:customer.address,balance:'1000'}],
      validatorRewardPerVote:'2',requireExecutionProof:true}});
  const profile=registry.register(sign(MARKET_KINDS.DEVICE,{
    nonce:'0',deviceClass:'server',platform:'linux',runtime:'native',role:'compute',
    maxCpuPct:'40',foregroundOnly:false},provider));
  registry.heartbeat(sign(MARKET_KINDS.HEARTBEAT,{
    deviceId:profile.deviceId,sequence:'0',observedAtHeight:'0',foreground:true,
    charging:true,unmetered:true,batteryPct:'100',thermal:'normal'},provider));
  const registration=sign(MARKET_KINDS.REGISTER,{
    nonce:'0',cpuCores:'4',ramMiB:'4096',gpuCount:'0',stake:'100'},provider);
  const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',JSON.stringify(registration));
  market.registerProvider(registration,validators.slice(0,3).map(v=>sign(MARKET_KINDS.CAPACITY,{
    provider:provider.address,registrationId,cpuCores:'4',ramMiB:'4096',
    gpuCount:'0',expiresAtHeight:'20'},v)));
  const offer=market.publishRentalOffer(sign(MARKET_KINDS.RENT_OFFER,{
    nonce:market.nextNonce(provider.address),service:'vps',cpuCores:'2',ramMiB:'2048',
    storageGiB:'40',gpuCount:'0',vramMiB:'0',pricePerSlot:'20',
    maxSlots:'5',expiresAtHeight:'10'},provider));
  const reservation=market.reserveRental(sign(MARKET_KINDS.RENT_REQUEST,{
    nonce:market.nextNonce(customer.address),offerId:offer.offerId,slots:'2'},customer));
  const permit=sign(MARKET_KINDS.WORK_PERMIT,{
    rentalId:reservation.rentalId,customer:customer.address,provider:provider.address,
    maxJobs:'2',maxTotalIterations:'2000',
    expiresAtUnixMs:String(Date.now()+60000)},provider);
  const permitId=digest('ZERONYTH_WORK_PERMIT_ID_V1\0',JSON.stringify(permit));
  const order=(nonce='0',overrides={})=>sign(MARKET_KINDS.WORK_ORDER,{
    rentalId:reservation.rentalId,permitId,nonce,
    jobId:digest('ZERONYTH_REAL_CPU_TEST_JOB\0',nonce),
    seed:'ab'.repeat(32),iterations:'1000',...overrides},customer);
  const node=new LeaseCpuNode({chainId,providerPrivateKey:provider.privateKey});
  const rentalMeter=(who)=>sign(MARKET_KINDS.RENT_METER,{
    rentalId:reservation.rentalId,usedSlots:'1'},who);
  return {node,market,registry,provider,customer,attacker,permit,permitId,order,
    rentalMeter,reservation,sign};
}

test('actual bounded CPU worker produces signed hash; verified receipt unlocks ZNYT-LAB rental settlement',async()=>{
  const x=fixture();
  const {server,url}=await x.node.startLoopbackServer();
  try{
    const health=await (await fetch(`${url}/health`)).json();
    assert.equal(health.loopbackOnly,true);
    assert.equal(health.realVps,false);
    assert.equal(x.market.znytBalance(x.customer.address),'960');
    x.market.advanceHeight('1');x.registry.advanceHeight('1');
    assert.throws(()=>x.market.settleRental(x.rentalMeter(x.provider),
      x.rentalMeter(x.customer)),/Verified executed work or hosted resource receipt required/);
    const order=x.order();
    const response=await fetch(`${url}/v1/lease/execute`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({permit:x.permit,order})});
    assert.equal(response.status,200);
    const completed=await response.json();
    assert.equal(completed.actualCpuThreadRan,true);
    assert.equal(completed.realZnytTransferred,false);
    assert.equal(completed.signedReceipt.output,hashWork(order.seed,1000));
    const signedFake=x.sign(MARKET_KINDS.WORK_RECEIPT,{
      rentalId:x.reservation.rentalId,permitId:x.permitId,
      orderId:digest('ZERONYTH_WORK_ORDER_ID_V1\0',JSON.stringify(order)),
      jobId:order.jobId,seed:order.seed,iterations:'1000',
      output:'00'.repeat(32),runTimeMs:'1'},x.provider);
    assert.throws(()=>x.market.recordVerifiedRentalWork(x.permit,order,signedFake),
      /Invalid or mismatched reproducible CPU/);
    const confirmed=x.market.recordVerifiedRentalWork(x.permit,order,completed.signedReceipt);
    assert.equal(confirmed.workHashVerified,true);
    assert.equal(x.market.verifiedRentalWork(x.reservation.rentalId),1);
    assert.throws(()=>x.market.recordVerifiedRentalWork(x.permit,order,completed.signedReceipt),
      /Replayed CPU/);
    assert.throws(()=>x.market.recordVerifiedRentalWork(x.permit,order,{
      ...completed.signedReceipt,output:'00'.repeat(32)}),/Invalid market ML-DSA/);
    const settled=x.market.settleRental(x.rentalMeter(x.provider),
      x.rentalMeter(x.customer));
    assert.equal(settled.paymentUnit,'ZNYT_LAB_NOT_REAL_TOKEN');
    assert.equal(settled.paid,'19');
    assert.equal(x.market.znytBalance(x.customer.address),'980');
    assert.equal(x.market.znytBalance(x.provider.address),'19');
    assert.equal(x.market.audit().znyt.conserved,true);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('loopback agent rejects forged customer, tampered permit, replay and permit job quota',async()=>{
  const x=fixture();
  const first=x.order();
  await assert.rejects(x.node.execute({...x.permit,maxJobs:'99'},first),/signature/);
  const fake=x.sign(MARKET_KINDS.WORK_ORDER,{
    rentalId:x.reservation.rentalId,permitId:x.permitId,nonce:'0',
    jobId:first.jobId,seed:first.seed,iterations:first.iterations},x.attacker);
  await assert.rejects(x.node.execute(x.permit,fake),/binding/);
  const one=await x.node.execute(x.permit,first);
  assert.equal(one.actualCpuThreadRan,true);
  await assert.rejects(x.node.execute(x.permit,first),/replay, nonce/);
  const second=x.order('1');
  await x.node.execute(x.permit,second);
  await assert.rejects(x.node.execute(x.permit,x.order('2')),/quota exceeded/);
  assert.equal(x.market.znytBalance(x.customer.address),'960');
  assert.equal(x.market.audit().znyt.conserved,true);
});

test('bad or expired lease tasks never consume worker quota; server accepts signed JSON only',async()=>{
  const x=fixture();
  const huge=x.order('0',{iterations:'10001'});
  await assert.rejects(x.node.execute(x.permit,huge),/bounded/);
  const order=x.order();
  await assert.rejects(x.node.execute({...x.permit,expiresAtUnixMs:'1'},order),/signature/);
  const good=await x.node.execute(x.permit,order);
  assert.equal(good.signedReceipt.iterations,'1000');
  const {server,url,bindAddress}=await x.node.startLoopbackServer();
  try{
    assert.equal(bindAddress,'127.0.0.1');
    const wrongType=await fetch(`${url}/v1/lease/execute`,{
      method:'POST',headers:{'content-type':'text/plain'},body:'hello'});
    assert.equal(wrongType.status,415);
    const badBody=await fetch(`${url}/v1/lease/execute`,{
      method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(badBody.status,400);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('standalone provider keygen + agent CLI starts with private mode and loopback listener',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'zeronyth-lease-node-cli-'));
  const keyPath=join(dir,'provider-private-key.pem');
  let child;
  try{
    const generated=JSON.parse(execFileSync(process.execPath,[
      'pq-native/lease-node-keygen.mjs',keyPath],{
      cwd:process.cwd(),encoding:'utf8'}));
    assert.equal(generated.privateKeyWritten,keyPath);
    assert.equal(statSync(keyPath).mode&0o777,0o600);
    assert.throws(()=>execFileSync(process.execPath,[
      'pq-native/lease-node-keygen.mjs',keyPath],{
      cwd:process.cwd(),stdio:'pipe'}),/Cannot create provider research key/);
    child=spawn(process.execPath,['pq-native/lease-node-agent.mjs',
      keyPath,'19127','0'],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
    const message=await new Promise((resolve,reject)=>{
      let buffer='';
      const timeout=setTimeout(()=>reject(new Error('Node agent CLI startup timeout')),4000);
      child.stdout.on('data',chunk=>{
        buffer+=chunk.toString('utf8');
        const line=buffer.indexOf('\n');
        if(line!==-1){clearTimeout(timeout);resolve(JSON.parse(buffer.slice(0,line)));}
      });
      child.once('error',error=>{clearTimeout(timeout);reject(error);});
      child.once('exit',code=>{clearTimeout(timeout);
        reject(new Error(`Node agent terminated during startup: ${code}`));});
    });
    assert.equal(message.ready,true);
    assert.equal(message.address,generated.address);
    assert.equal((await (await fetch(`${message.url}/health`)).json()).loopbackOnly,true);
  }finally{
    if(child){child.kill('SIGTERM');await new Promise(resolve=>{
      if(child.exitCode!==null||child.signalCode!==null)resolve();
      else child.once('exit',resolve);
    });}
    rmSync(dir,{recursive:true,force:true});
  }
});
