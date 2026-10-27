import test from 'node:test';
import assert from 'node:assert/strict';
import {GENESIS_KIND,generateIdentity,digest} from './pq.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {DeviceNodeRegistry} from './device-registry.mjs';
import {ComputeMarket} from './compute-market.mjs';

function setup(){
  const validators=Array.from({length:4},()=>generateIdentity());
  const provider=generateIdentity(),customer=generateIdentity(),other=generateIdentity();
  const chainId='19127';
  const genesis={kind:GENESIS_KIND,chainId,
    validators:validators.map(v=>({publicKey:v.publicKey})),
    allocations:[{address:provider.address,balance:'300'},
      {address:customer.address,balance:'1000'},
      {address:other.address,balance:'1000'}]};
  const registry=new DeviceNodeRegistry(genesis);
  const device=registry.register(signMarket({kind:MARKET_KINDS.DEVICE,chainId,
    nonce:'0',deviceClass:'server',platform:'linux',runtime:'native',role:'compute',
    maxCpuPct:'25',foregroundOnly:false},provider.privateKey));
  const heartbeat=(sequence,opts={})=>signMarket({kind:MARKET_KINDS.HEARTBEAT,
    chainId,deviceId:device.deviceId,sequence:String(sequence),observedAtHeight:'0',
    foreground:true,charging:true,unmetered:true,batteryPct:'100',thermal:'normal',...opts},
    provider.privateKey);
  registry.heartbeat(heartbeat(0));
  const market=new ComputeMarket(genesis,{deviceRegistry:registry,
    governance:{allocations:[{address:customer.address,balance:'1000'},
      {address:other.address,balance:'1000'}],
    validatorRewardReserve:'100',validatorRewardPerVote:'2'}});
  const register=signMarket({kind:MARKET_KINDS.REGISTER,chainId,
    nonce:'0',cpuCores:'4',ramMiB:'4096',gpuCount:'1',stake:'100'},provider.privateKey);
  const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',JSON.stringify(register));
  const certificates=validators.slice(0,3).map(v=>signMarket({kind:MARKET_KINDS.CAPACITY,
    chainId,provider:provider.address,registrationId,cpuCores:'4',ramMiB:'4096',
    gpuCount:'1',expiresAtHeight:'20'},v.privateKey));
  market.registerProvider(register,certificates);
  const offer=(service='vps',overrides={})=>signMarket({kind:MARKET_KINDS.RENT_OFFER,
    chainId,nonce:market.nextNonce(provider.address),service,
    cpuCores:'2',ramMiB:'2048',storageGiB:service==='vps'?'40':'0',
    gpuCount:service==='vps'?'0':'1',vramMiB:service==='vps'?'0':'8192',
    pricePerSlot:'20',maxSlots:'5',expiresAtHeight:'10',...overrides},provider.privateKey);
  const request=(offerId,slots='3',who=customer)=>signMarket({kind:MARKET_KINDS.RENT_REQUEST,
    chainId,nonce:market.nextNonce(who.address),offerId,slots},who.privateKey);
  const meter=(rentalId,usedSlots,who)=>signMarket({kind:MARKET_KINDS.RENT_METER,
    chainId,rentalId,usedSlots:String(usedSlots)},who.privateKey);
  const share=(cpuPercent='20',expiresAtHeight='10')=>signMarket({
    kind:MARKET_KINDS.CHAIN_SHARE,chainId,
    nonce:market.nextNonce(provider.address),cpuPercent,expiresAtHeight},provider.privateKey);
  const aiShare=(aiPercent='20',expiresAtHeight='10')=>signMarket({
    kind:MARKET_KINDS.AI_SHARE,chainId,
    nonce:market.nextNonce(provider.address),aiPercent,expiresAtHeight},provider.privateKey);
  const aiAccess=(requestId,who=provider)=>signMarket({
    kind:MARKET_KINDS.AI_ACCESS,chainId,
    nonce:market.nextNonce(who.address),requestId},who.privateKey);
  return {market,registry,validators,provider,customer,other,offer,request,meter,
    heartbeat,share,aiShare,aiAccess,chainId};
}

test('VPS lease escrows governance research tokens, requires BOTH signatures and refunds unused time',()=>{
  const x=setup();
  const {offerId}=x.market.publishRentalOffer(x.offer());
  const {rentalId}=x.market.reserveRental(x.request(offerId));
  assert.equal(x.market.governanceBalance(x.customer.address),'940');
  assert.equal(x.market.balance(x.customer.address),'1000'); // untouched DEV-CREDIT
  assert.equal(x.market.audit().rentalEscrow,'60');
  assert.equal(x.market.rental(rentalId).status,'reserved');
  assert.equal(x.market.rental(rentalId).resources.storageGiB,40);
  const provided=x.meter(rentalId,1,x.provider);
  const accepted=x.meter(rentalId,1,x.customer);
  assert.throws(()=>x.market.settleRental(provided,accepted),/elapsed slots/);
  x.market.advanceHeight('1');
  assert.throws(()=>x.market.settleRental(provided,x.meter(rentalId,2,x.customer)),/disagree/);
  assert.throws(()=>x.market.settleRental(provided,x.meter(rentalId,1,x.other)),/provider and customer/);
  assert.throws(()=>x.market.settleRental({...provided,usedSlots:'2'},accepted),/Invalid market ML-DSA/);
  const result=x.market.settleRental(provided,accepted);
  assert.deepEqual({charged:result.charged,paid:result.paid,fee:result.fee,refunded:result.refunded},
    {charged:'20',paid:'19',fee:'1',refunded:'40'});
  assert.equal(x.market.governanceBalance(x.customer.address),'980');
  assert.equal(x.market.governanceBalance(x.provider.address),'19');
  assert.equal(x.market.balance(x.provider.address),'200'); // DEV stake, no DEV reward
  assert.equal(x.market.audit().governance.treasury,'1');
  assert.equal(x.market.audit().rentalEscrow,'0');
  assert.equal(x.market.audit().governance.conserved,true);
  assert.throws(()=>x.market.settleRental(provided,accepted),/provider and customer/);
  assert.equal(x.market.rental(rentalId).status,'mutually-settled');
});

test('AI GPU lease reserves claimed GPU capacity and blocks overbooking',()=>{
  const x=setup();
  const {offerId}=x.market.publishRentalOffer(x.offer('ai-gpu'));
  const first=x.market.reserveRental(x.request(offerId,'2'));
  assert.equal(first.service,'ai-gpu');
  assert.equal(first.actualProvisioning,false);
  assert.equal(x.market.rental(first.rentalId).resources.vramMiB,8192);
  assert.throws(()=>x.market.reserveRental(x.request(offerId,'1',x.other)),/overbooking/);
  assert.equal(x.market.governanceBalance(x.other.address),'1000');
  assert.equal(x.market.audit().rentalEscrow,'40');
  const advanced=x.market.advanceHeight('3');
  assert.deepEqual(advanced.refundedRentalIds,[first.rentalId]);
  assert.equal(x.market.governanceBalance(x.customer.address),'1000');
  assert.equal(x.market.audit().rentalEscrow,'0');
  assert.equal(x.market.audit().conserved,true);
  assert.throws(()=>x.market.settleRental(x.meter(first.rentalId,1,x.provider),
    x.meter(first.rentalId,1,x.customer)),/provider and customer/);
});

test('provider cannot self-rent, offer beyond attested capacity, or reserve past expiry',()=>{
  const x=setup();
  assert.throws(()=>x.market.publishRentalOffer(x.offer('ai-gpu',{gpuCount:'2'})),/attested provider capacity/);
  assert.throws(()=>x.market.publishRentalOffer(x.offer('vps',{storageGiB:'0'})),/requires disk/);
  assert.throws(()=>x.market.publishRentalOffer(x.offer('ai-gpu',{vramMiB:'0'})),/requires attested GPU/);
  const {offerId}=x.market.publishRentalOffer(x.offer());
  assert.throws(()=>x.market.reserveRental(x.request(offerId,'1',x.provider)),/Self-rental/);
  assert.throws(()=>x.market.reserveRental(x.request(offerId,'6')),/exceeds advertised/);
  assert.throws(()=>x.market.reserveRental(signMarket({kind:MARKET_KINDS.RENT_REQUEST,
    chainId:'19127',nonce:'0',offerId:'ff'.repeat(32),slots:'1'},
  x.other.privateKey)),/unavailable/);
  assert.equal(x.market.audit().conserved,true);
});

test('signed customer cancellation refunds escrow and prevents replay of old order',()=>{
  const x=setup();
  const {offerId}=x.market.publishRentalOffer(x.offer());
  const signedRequest=x.request(offerId,'2');
  const {rentalId}=x.market.reserveRental(signedRequest);
  const cancel=signMarket({kind:MARKET_KINDS.RENT_CANCEL,chainId:'19127',
    nonce:x.market.nextNonce(x.customer.address),rentalId},x.customer.privateKey);
  assert.throws(()=>x.market.cancelRental({...cancel,rentalId:'00'.repeat(32)}),/Invalid market ML-DSA/);
  assert.equal(x.market.cancelRental(cancel).refunded,'40');
  assert.equal(x.market.governanceBalance(x.customer.address),'1000');
  assert.throws(()=>x.market.cancelRental(cancel),/nonce\/replay/);
  assert.throws(()=>x.market.reserveRental(signedRequest),/nonce\/replay/);
  assert.equal(x.market.audit().conserved,true);
});

test('offline device or legacy market without trusted registry cannot publish rentals',()=>{
  const x=setup();
  x.registry.heartbeat(x.heartbeat(1,{unmetered:false}));
  assert.throws(()=>x.market.publishRentalOffer(x.offer()),/active native/);
  assert.equal(x.market.audit().conserved,true);
});

test('independent clock drift is fail-closed for new offers and reservations',()=>{
  const x=setup();
  const {offerId}=x.market.publishRentalOffer(x.offer());
  x.market.advanceHeight('1');
  assert.throws(()=>x.market.reserveRental(x.request(offerId,'1')),/actively available/);
  assert.throws(()=>x.market.publishRentalOffer(x.offer()),/height must agree/);
  x.registry.advanceHeight('1');
  assert.equal(x.market.reserveRental(x.request(offerId,'1')).status,'reserved');
  assert.equal(x.market.audit().conserved,true);
});

test('governance validator rewards require quorum for one round and pre-funded reserve',()=>{
  const x=setup();
  x.market.advanceHeight('1');
  const blockId='c9'.repeat(32);
  const vote=(validator,id=blockId)=>signMarket({kind:MARKET_KINDS.VALIDATOR_REWARD,
    chainId:x.chainId,height:'1',blockId:id},validator.privateKey);
  const certificates=x.validators.map(v=>vote(v));
  assert.throws(()=>x.market.awardValidatorRound(certificates.slice(0,2)),/Insufficient/);
  assert.throws(()=>x.market.awardValidatorRound([certificates[0],certificates[0],certificates[2]]),/repeated/);
  assert.throws(()=>x.market.awardValidatorRound([certificates[0],certificates[1],
    vote(x.other)]),/Unknown/);
  assert.throws(()=>x.market.awardValidatorRound([certificates[0],certificates[1],
    vote(x.validators[2],'ef'.repeat(32))]),/Inconsistent/);
  const reward=x.market.awardValidatorRound(certificates.slice(0,3));
  assert.equal(reward.rewardedValidators,3);
  assert.equal(reward.totalReward,'6');
  assert.equal(reward.actualConsensusFinalityVerified,false);
  assert.equal(x.market.governanceBalance(x.validators[0].address),'2');
  assert.equal(x.market.governanceBalance(x.validators[3].address),'0');
  assert.equal(x.market.audit().governance.validatorRewardReserve,'94');
  assert.equal(x.market.audit().governance.conserved,true);
  assert.throws(()=>x.market.awardValidatorRound(certificates),/already used/);
});

test('20% signed node share reserves CPU and RAM without altering validator quorum',()=>{
  const x=setup();
  const signed=x.share();
  const report=x.market.publishChainShare(signed);
  assert.equal(report.cpuPercent,20);
  assert.equal(report.cpuMilliCores,800);
  assert.equal(report.ramMiB,820);
  assert.equal(report.consensusQuorumUnchanged,true);
  assert.equal(report.actualChainAcceleration,false);
  assert.equal(x.market.chainShare(x.provider.address).active,true);
  assert.deepEqual(x.market.chainAccelerationStatus(),{
    optedInProviders:1,cpuMilliCores:800,ramMiB:820,
    role:'FUTURE_TX_PREVERIFICATION_AND_RELAY_CAPACITY',
    realRemoteWorkers:0,measuredTpsGain:null,validatorQuorumChanged:false});
  assert.throws(()=>x.market.publishChainShare(signed),/nonce\/replay/);
  assert.throws(()=>x.market.publishRentalOffer(x.offer('vps',{
    cpuCores:'4'})),/overlaps dedicated L1 or AI resource/);
  const {offerId}=x.market.publishRentalOffer(x.offer());
  assert.equal(x.market.reserveRental(x.request(offerId,'2')).status,'reserved');
  assert.equal(x.market.audit().governance.conserved,true);
});

test('opt-in share cannot overbook active rental, is signed, bounded and expires',()=>{
  const x=setup();
  const {offerId}=x.market.publishRentalOffer(x.offer('vps',{cpuCores:'3'}));
  x.market.reserveRental(x.request(offerId,'2'));
  assert.throws(()=>x.market.publishChainShare(x.share('50')),/overbook/);
  assert.throws(()=>x.market.publishChainShare(x.share('81')),/bounded market limit/);
  const signed=x.share('20','1');
  assert.throws(()=>x.market.publishChainShare({...signed,cpuPercent:'0'}),/signature/);
  assert.equal(x.market.publishChainShare(signed).cpuMilliCores,800);
  x.market.advanceHeight('1');
  x.registry.advanceHeight('1');
  assert.equal(x.market.chainShare(x.provider.address).active,false);
  assert.equal(x.market.chainAccelerationStatus().cpuMilliCores,0);
  assert.equal(x.market.audit().conserved,true);
});

test('20/20/60 allocation reserves AI and L1 budgets without claiming AI training',()=>{
  const x=setup();
  const l1=x.market.publishChainShare(x.share());
  const ai=x.market.publishAiShare(x.aiShare());
  assert.equal(l1.cpuMilliCores,800);
  assert.equal(ai.cpuMilliCores,800);
  assert.equal(ai.ramMiB,820);
  assert.equal(ai.gpuMilliUnits,200);
  assert.equal(ai.actualModelTraining,false);
  const split=x.market.nodeResourceAllocation(x.provider.address);
  assert.equal(split.l1Percent,20);
  assert.equal(split.aiPercent,20);
  assert.equal(split.rentalPercentUnreserved,60);
  assert.equal(split.timeSlicingOrProvisioningImplemented,false);
  const status=x.market.aiGrowthStatus();
  assert.equal(status.optedInProviders,1);
  assert.equal(status.actualTrainingRuns,0);
  assert.equal(status.measuredModelQualityGain,null);
  assert.throws(()=>x.market.publishAiShare(x.aiShare('81')),/bounded market limit/);
  assert.throws(()=>x.market.publishAiShare(x.aiShare('80')),/overbook/);
  assert.throws(()=>x.market.publishRentalOffer(x.offer('ai-gpu')),
    /overlaps dedicated L1 or AI resource/);
  const {offerId}=x.market.publishRentalOffer(x.offer());
  assert.equal(x.market.reserveRental(x.request(offerId,'2')).status,'reserved');
  assert.equal(x.market.audit().governance.conserved,true);
  const y=setup();
  y.market.publishChainShare(y.share('80'));
  assert.throws(()=>y.market.publishAiShare(y.aiShare('30')),/exceed 100 percent/);
});

test('every active bonded compute provider receives signed AI access without paying rental tokens',()=>{
  const x=setup();
  const status=x.market.aiProviderAccess(x.provider.address);
  assert.equal(status.eligible,true);
  assert.equal(status.freeResearchRequestsPerEpoch,20);
  assert.equal(status.remaining,20);
  assert.equal(status.realInferenceAvailable,false);
  assert.equal(x.market.aiProviderAccess(x.other.address).eligible,false);
  const request=x.aiAccess('ab'.repeat(32));
  assert.throws(()=>x.market.requestProviderAi({...request,requestId:'cd'.repeat(32)}),/signature/);
  const accepted=x.market.requestProviderAi(request);
  assert.equal(accepted.accessGranted,true);
  assert.equal(accepted.remaining,19);
  assert.equal(accepted.actualModelResponse,null);
  assert.equal(x.market.governanceBalance(x.provider.address),'0');
  assert.throws(()=>x.market.requestProviderAi(request),/nonce\/replay/);
  assert.throws(()=>x.market.requestProviderAi(x.aiAccess('ab'.repeat(32))),/Duplicate AI/);
  assert.throws(()=>x.market.requestProviderAi(x.aiAccess('bc'.repeat(32),x.other)),
    /active bonded native node/);
  assert.equal(x.market.audit().governance.conserved,true);
});

test('AI access quotas fail closed; new height epoch reopens after fresh heartbeat',()=>{
  const x=setup();
  for(let i=0;i<20;i++){
    assert.equal(x.market.requestProviderAi(x.aiAccess(i.toString(16).padStart(64,'0')))
      .remaining,19-i);
  }
  assert.equal(x.market.aiProviderAccess(x.provider.address).remaining,0);
  assert.throws(()=>x.market.requestProviderAi(x.aiAccess('ff'.repeat(32))),/quota exceeded/);
  x.market.advanceHeight('10');
  x.registry.advanceHeight('10');
  assert.equal(x.market.aiProviderAccess(x.provider.address).eligible,false);
  assert.throws(()=>x.market.requestProviderAi(x.aiAccess('ff'.repeat(32))),/active bonded/);
  x.registry.heartbeat(x.heartbeat(1,{observedAtHeight:'10'}));
  assert.equal(x.market.aiProviderAccess(x.provider.address).remaining,20);
  assert.equal(x.market.requestProviderAi(x.aiAccess('ff'.repeat(32))).remaining,19);
  x.registry.heartbeat(x.heartbeat(2,{observedAtHeight:'10',unmetered:false}));
  assert.equal(x.market.aiProviderAccess(x.provider.address).eligible,false);
});
