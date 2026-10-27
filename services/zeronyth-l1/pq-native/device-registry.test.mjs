import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,GENESIS_KIND,digest} from './pq.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {DeviceNodeRegistry} from './device-registry.mjs';
import {ComputeMarket,hashWork} from './compute-market.mjs';

function fixture(){
  const validators=Array.from({length:4},()=>generateIdentity());
  const server=generateIdentity(),desktop=generateIdentity(),phone=generateIdentity(),tablet=generateIdentity();
  const consumer=generateIdentity();
  const genesis={kind:GENESIS_KIND,chainId:'19127',
    validators:validators.map(v=>({publicKey:v.publicKey})),
    allocations:[...([server,desktop,phone,tablet,consumer].map(v=>({address:v.address,balance:'1000'})))]};
  const registry=new DeviceNodeRegistry(genesis);
  const profile=(identity,opts={})=>signMarket({kind:MARKET_KINDS.DEVICE,
    chainId:'19127',nonce:'0',deviceClass:'server',platform:'linux',runtime:'native',
    role:'compute',maxCpuPct:'25',foregroundOnly:false,...opts},identity.privateKey);
  const report=(identity,deviceId,opts={})=>signMarket({kind:MARKET_KINDS.HEARTBEAT,
    chainId:'19127',deviceId,sequence:'0',observedAtHeight:'0',foreground:true,
    charging:true,unmetered:true,batteryPct:'90',thermal:'normal',...opts},identity.privateKey);
  return {validators,server,desktop,phone,tablet,consumer,genesis,registry,profile,report};
}

test('all four device classes can register signed, scoped and explicitly bounded roles',()=>{
  const x=fixture();
  const items=[
    [x.server,{}],
    [x.desktop,{deviceClass:'desktop',platform:'windows',role:'relay'}],
    [x.phone,{deviceClass:'phone',platform:'ios',role:'light',foregroundOnly:true}],
    [x.tablet,{deviceClass:'tablet',platform:'ipados',role:'light',foregroundOnly:true}],
  ];
  for(const [identity,opts] of items){
    const signed=x.profile(identity,opts);
    const registered=x.registry.register(signed);
    assert.equal(registered.joined,true);
    assert.equal(registered.attestedHardware,false);
    assert.equal(x.registry.get(identity.address).operationalNode,false);
    assert.equal(x.registry.assess(identity.address,{role:opts.role||'compute',iterations:5}).eligible,false);
    x.registry.heartbeat(x.report(identity,registered.deviceId));
    assert.equal(x.registry.assess(identity.address,{role:opts.role||'compute',iterations:5}).eligible,true);
    assert.throws(()=>x.registry.register(signed),/already registered/);
  }
});

test('iOS/iPadOS compute and mobile validators are deliberately prohibited',()=>{
  const x=fixture();
  assert.throws(()=>x.registry.register(x.profile(x.phone,{deviceClass:'phone',platform:'ios',
    role:'compute',foregroundOnly:true})),/iPhone\/iPad/);
  assert.throws(()=>x.registry.register(x.profile(x.phone,{deviceClass:'phone',platform:'ios',
    role:'validator',foregroundOnly:true})),/cannot advertise/);
  assert.throws(()=>x.registry.register(x.profile(x.tablet,{deviceClass:'tablet',platform:'android',
    role:'validator',foregroundOnly:true})),/cannot advertise/);
  assert.throws(()=>x.registry.register(x.profile(x.phone,{deviceClass:'phone',platform:'android',
    role:'compute',foregroundOnly:false})),/foreground-only/);
  assert.throws(()=>x.registry.register(x.profile(x.phone,{deviceClass:'phone',platform:'ios',
    role:'light',foregroundOnly:true,maxCpuPct:'99'})),/CPU budget/);
});

test('mobile signed compute requires battery, Wi-Fi, charging, thermal and short jobs',()=>{
  const x=fixture();
  const node=x.registry.register(x.profile(x.phone,{deviceClass:'phone',platform:'android',
    role:'compute',foregroundOnly:true}));
  x.registry.heartbeat(x.report(x.phone,node.deviceId,{charging:false}));
  assert.equal(x.registry.assess(x.phone.address,{iterations:100}).reason,'mobile-power-or-network-policy');
  x.registry.heartbeat(x.report(x.phone,node.deviceId,{sequence:'1',charging:true,unmetered:false}));
  assert.equal(x.registry.canRunHashJob(x.phone.address,100),false);
  x.registry.heartbeat(x.report(x.phone,node.deviceId,{sequence:'2',batteryPct:'25'}));
  assert.equal(x.registry.canRunHashJob(x.phone.address,100),false);
  x.registry.heartbeat(x.report(x.phone,node.deviceId,{sequence:'3',thermal:'hot'}));
  assert.equal(x.registry.assess(x.phone.address,{iterations:100}).reason,'thermal-throttle');
  x.registry.heartbeat(x.report(x.phone,node.deviceId,{sequence:'4'}));
  assert.equal(x.registry.canRunHashJob(x.phone.address,100),true);
  assert.equal(x.registry.canRunHashJob(x.phone.address,257),false);
  x.registry.heartbeat(x.report(x.phone,node.deviceId,{sequence:'5',foreground:false}));
  assert.equal(x.registry.canRunHashJob(x.phone.address,100),false);
});

test('signed heartbeat cannot be forged, replayed or from future block height',()=>{
  const x=fixture();
  const device=x.registry.register(x.profile(x.phone,{deviceClass:'phone',platform:'ios',
    role:'light',foregroundOnly:true}));
  const heartbeat=x.report(x.phone,device.deviceId);
  assert.throws(()=>x.registry.heartbeat({...heartbeat,foreground:false}),/Invalid market ML-DSA signature/);
  assert.throws(()=>x.registry.heartbeat(x.report(x.desktop,device.deviceId)),/unknown or mismatched/);
  x.registry.heartbeat(heartbeat);
  assert.throws(()=>x.registry.heartbeat(heartbeat),/replayed/);
  assert.throws(()=>x.registry.heartbeat(x.report(x.phone,device.deviceId,{sequence:'1',observedAtHeight:'1'})),/future-height/);
  x.registry.advanceHeight('3');
  assert.equal(x.registry.assess(x.phone.address,{role:'light'}).reason,'device-heartbeat-stale');
});

test('genesis-only validators may advertise validator device class, never a random desktop',()=>{
  const x=fixture();
  assert.throws(()=>x.registry.register(x.profile(x.desktop,{deviceClass:'desktop',
    platform:'linux',role:'validator'})),/already belong/);
  const validator=x.validators[0];
  const enrolled=x.registry.register(x.profile(validator,{deviceClass:'server',
    platform:'linux',role:'validator'}));
  x.registry.heartbeat(x.report(validator,enrolled.deviceId));
  assert.equal(x.registry.assess(validator.address,{role:'validator'}).eligible,true);
  assert.equal(x.registry.assess(x.desktop.address,{role:'validator'}).eligible,false);
});

test('device-aware market refuses offline providers, then pays on authorized short verified job',()=>{
  const x=fixture();
  const market=new ComputeMarket(x.genesis,{deviceRegistry:x.registry});
  const registration=signMarket({kind:MARKET_KINDS.REGISTER,chainId:'19127',
    nonce:'0',cpuCores:'2',ramMiB:'1024',gpuCount:'0',stake:'100'},x.phone.privateKey);
  const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',JSON.stringify(registration));
  const attest=x.validators.slice(0,3).map(v=>signMarket({kind:MARKET_KINDS.CAPACITY,
    chainId:'19127',provider:x.phone.address,registrationId,cpuCores:'2',
    ramMiB:'1024',gpuCount:'0',expiresAtHeight:'20'},v.privateKey));
  market.registerProvider(registration,attest);
  const seed='ef'.repeat(32);
  const {jobId}=market.submitJob(signMarket({kind:MARKET_KINDS.REQUEST,
    chainId:'19127',nonce:'0',seed,iterations:'100',price:'100',expiresAtHeight:'10'},
  x.consumer.privateKey));
  assert.throws(()=>market.assignJob(jobId),/No attested provider capacity/);
  const device=x.registry.register(x.profile(x.phone,{deviceClass:'phone',platform:'android',
    role:'compute',foregroundOnly:true}));
  x.registry.heartbeat(x.report(x.phone,device.deviceId,{foreground:false}));
  assert.throws(()=>market.assignJob(jobId),/No attested provider capacity/);
  x.registry.heartbeat(x.report(x.phone,device.deviceId,{sequence:'1'}));
  assert.equal(market.assignJob(jobId).provider,x.phone.address);
  const payment=market.submitResult(signMarket({kind:MARKET_KINDS.RESULT,
    chainId:'19127',jobId,output:hashWork(seed,100)},x.phone.privateKey));
  assert.equal(payment.paid,'95');
  assert.equal(market.audit().conserved,true);
});
