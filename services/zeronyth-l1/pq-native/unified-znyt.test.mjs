import test from 'node:test';
import assert from 'node:assert/strict';
import {GENESIS_KIND,generateIdentity,digest} from './pq.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {DeviceNodeRegistry} from './device-registry.mjs';
import {ComputeMarket} from './compute-market.mjs';

function fixture({burnBps='2000',rewardReserve='0',customerFunds='1000'}={}){
  const validators=Array.from({length:4},()=>generateIdentity());
  const provider=generateIdentity(),customer=generateIdentity(),outsider=generateIdentity();
  const chainId='19127';
  const genesis={kind:GENESIS_KIND,chainId,
    validators:validators.map(v=>({publicKey:v.publicKey})),
    allocations:[{address:provider.address,balance:'300'},
      {address:customer.address,balance:'1000'}]};
  const registry=new DeviceNodeRegistry(genesis);
  const market=new ComputeMarket(genesis,{deviceRegistry:registry,
    znyt:{allocations:[{address:customer.address,balance:customerFunds}],
      validatorRewardReserve:rewardReserve,validatorRewardPerVote:'2',
      gasBurnBasisPoints:burnBps}});
  const sign=(kind,fields,who)=>signMarket({kind,chainId,...fields},who.privateKey);
  const device=registry.register(sign(MARKET_KINDS.DEVICE,{
    nonce:'0',deviceClass:'server',platform:'linux',runtime:'native',role:'compute',
    maxCpuPct:'40',foregroundOnly:false},provider));
  registry.heartbeat(sign(MARKET_KINDS.HEARTBEAT,{
    deviceId:device.deviceId,sequence:'0',observedAtHeight:'0',foreground:true,
    charging:true,unmetered:true,batteryPct:'100',thermal:'normal'},provider));
  const registration=sign(MARKET_KINDS.REGISTER,{
    nonce:'0',cpuCores:'4',ramMiB:'4096',gpuCount:'0',stake:'100'},provider);
  const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',JSON.stringify(registration));
  market.registerProvider(registration,validators.slice(0,3).map(v=>sign(MARKET_KINDS.CAPACITY,{
    provider:provider.address,registrationId,cpuCores:'4',ramMiB:'4096',
    gpuCount:'0',expiresAtHeight:'20'},v)));
  const offer=()=>market.publishRentalOffer(sign(MARKET_KINDS.RENT_OFFER,{
    nonce:market.nextNonce(provider.address),service:'vps',cpuCores:'2',ramMiB:'2048',
    storageGiB:'40',gpuCount:'0',vramMiB:'0',pricePerSlot:'20',
    maxSlots:'5',expiresAtHeight:'10'},provider));
  const reserve=(offerId,slots='2')=>market.reserveRental(sign(MARKET_KINDS.RENT_REQUEST,{
    nonce:market.nextNonce(customer.address),offerId,slots},customer));
  const meterRental=(rentalId,who,usedSlots='1')=>sign(MARKET_KINDS.RENT_METER,{
    rentalId,usedSlots},who);
  const gasAuth=(overrides={})=>sign(MARKET_KINDS.GAS_AUTH,{
    nonce:market.nextNonce(customer.address),
    operationId:digest('ZERONYTH_UNIFIED_ZNYT_OPERATION\0','test'),gasLimit:'50',
    maxUnitPrice:'20',expiresAtHeight:'5',...overrides},customer);
  const gasMeters=(auth,{gasUsed='10',unitPrice='10',height='1'}={})=>{
    const authorizationId=digest('ZERONYTH_GAS_LAB_AUTH_ID_V1\0',JSON.stringify(auth));
    return validators.map(v=>sign(MARKET_KINDS.GAS_METER,{
      authorizationId,gasUsed,unitPrice,blockHeight:height},v));
  };
  const rewardAttestations=(height='1')=>validators.slice(0,3).map(v=>sign(
    MARKET_KINDS.VALIDATOR_REWARD,{height,blockId:digest('ZERONYTH_ZNYT_ROUND\0',height)},v));
  return {validators,provider,customer,outsider,genesis,registry,market,sign,
    offer,reserve,meterRental,gasAuth,gasMeters,rewardAttestations};
}

test('one ZNYT-LAB spendable balance backs rental, gas burn and validator payout',()=>{
  const x=fixture();
  const reserved=x.reserve(x.offer().offerId);
  assert.equal(reserved.paymentUnit,'ZNYT_LAB_NOT_REAL_TOKEN');
  assert.equal(x.market.znytBalance(x.customer.address),'960');
  assert.equal(x.market.governanceBalance(x.customer.address),'960');
  assert.equal(x.market.audit().rentalEscrow,'40');
  x.market.advanceHeight('1');x.registry.advanceHeight('1');
  const settlement=x.market.settleRental(
    x.meterRental(reserved.rentalId,x.provider),
    x.meterRental(reserved.rentalId,x.customer));
  assert.deepEqual({charged:settlement.charged,paid:settlement.paid,
    refunded:settlement.refunded,fee:settlement.fee},
  {charged:'20',paid:'19',refunded:'20',fee:'1'});
  assert.equal(settlement.paymentUnit,'ZNYT_LAB_NOT_REAL_TOKEN');
  assert.equal(x.market.znytBalance(x.customer.address),'980');
  assert.equal(x.market.znytBalance(x.provider.address),'19');
  const authorization=x.gasAuth();
  const gas=x.market.chargeZnytGas(authorization,x.gasMeters(authorization).slice(0,3));
  assert.deepEqual({paid:gas.paid,burned:gas.burned,pool:gas.networkRewardPoolAdded},
    {paid:'100',burned:'20',pool:'80'});
  assert.equal(gas.realGasExecuted,false);
  assert.equal(x.market.znytBalance(x.customer.address),'880');
  assert.equal(x.market.nextNonce(x.customer.address),'2'); // rental + gas
  const reward=x.market.awardValidatorRound(x.rewardAttestations());
  assert.equal(reward.totalReward,'6');
  assert.equal(reward.paidFromGasPool,'6');
  assert.equal(reward.paidFromPrefundedReserve,'0');
  assert.equal(reward.actualConsensusFinalityVerified,false);
  assert.equal(x.market.znytBalance(x.validators[0].address),'2');
  assert.equal(x.market.znytBalance(x.validators[3].address),'0');
  assert.equal(x.market.znytBalance(x.provider.address),'19');
  const znyt=x.market.audit().znyt;
  assert.equal(znyt.unit,'ZNYT_LAB_NOT_REAL_TOKEN');
  assert.deepEqual({spendable:znyt.spendable,escrow:znyt.escrow,
    treasury:znyt.treasury,gasPool:znyt.gasFeePool,burned:znyt.cumulativeBurned,
    circulating:znyt.circulatingSupply,initial:znyt.initialSupply},
  {spendable:'905',escrow:'0',treasury:'1',gasPool:'74',burned:'20',
    circulating:'980',initial:'1000'});
  assert.equal(znyt.conserved,true);
  assert.equal(x.market.audit().governance,undefined);
  assert.equal(x.market.audit().conserved,true);
  assert.equal(x.market.balance(x.customer.address),'1000'); // legacy DEV only
  assert.equal(x.market.aiProviderAccess(x.provider.address).eligible,true);
  assert.equal(x.market.aiProviderAccess(x.provider.address).realInferenceAvailable,false);
  assert.throws(()=>x.market.chargeZnytGas(authorization,x.gasMeters(authorization).slice(0,3)),
    /nonce\/replay/);
  const reSigned=x.gasAuth();
  assert.throws(()=>x.market.chargeZnytGas(reSigned,x.gasMeters(reSigned).slice(0,3)),
    /logical gas operation already charged/);
  assert.equal(x.market.audit().znyt.conserved,true);
});

test('same ZNYT balance blocks spending funds already escrowed by a VPS reservation',()=>{
  const x=fixture({customerFunds:'100'});
  x.reserve(x.offer().offerId,'3');
  assert.equal(x.market.znytBalance(x.customer.address),'40');
  x.market.advanceHeight('1');
  const auth=x.gasAuth();
  assert.throws(()=>x.market.chargeZnytGas(auth,x.gasMeters(auth).slice(0,3)),
    /Insufficient unified ZNYT-LAB/);
  assert.equal(x.market.znytBalance(x.customer.address),'40');
  assert.equal(x.market.audit().rentalEscrow,'60');
  assert.equal(x.market.audit().znyt.conserved,true);
});

test('gas accounting rejects fake receipts, diverging meters, oversized usage and other chains',()=>{
  const x=fixture();x.market.advanceHeight('1');
  const auth=x.gasAuth(),meters=x.gasMeters(auth);
  assert.throws(()=>x.market.chargeZnytGas(auth,meters.slice(0,2)),/At least 3/);
  assert.throws(()=>x.market.chargeZnytGas(auth,[meters[0],meters[0],meters[2]]),
    /duplicated/);
  assert.throws(()=>x.market.chargeZnytGas(auth,[meters[0],meters[1],
    x.gasMeters(auth,{gasUsed:'11'})[2]]),/Conflicting/);
  assert.throws(()=>x.market.chargeZnytGas(auth,x.gasMeters(auth,{gasUsed:'51'}).slice(0,3)),
    /exceeds customer authorization/);
  assert.throws(()=>x.market.chargeZnytGas(auth,x.gasMeters(auth,{height:'2'}).slice(0,3)),
    /Unbound/);
  const forged=x.sign(MARKET_KINDS.GAS_METER,{
    authorizationId:digest('ZERONYTH_GAS_LAB_AUTH_ID_V1\0',JSON.stringify(auth)),
    gasUsed:'10',unitPrice:'10',blockHeight:'1'},x.outsider);
  assert.throws(()=>x.market.chargeZnytGas(auth,[meters[0],meters[1],forged]),/Unknown/);
  assert.throws(()=>x.market.chargeZnytGas({...auth,gasLimit:'500'},meters.slice(0,3)),
    /signature/);
  assert.throws(()=>x.market.chargeZnytGas({...auth,chainId:'19128'},meters.slice(0,3)),
    /replay/);
  assert.equal(x.market.znytBalance(x.customer.address),'1000');
  assert.equal(x.market.audit().znyt.conserved,true);
});

test('ZNYT-LAB is opt-in and cannot be double configured with separate GOV-LAB',()=>{
  const x=fixture();
  assert.throws(()=>new ComputeMarket(x.genesis,{znyt:{allocations:[]},
    governance:{allocations:[]}}),/exactly one/);
  assert.throws(()=>new ComputeMarket(x.genesis,{znyt:{allocations:[],
    gasBurnBasisPoints:'10001'}}),/0..10000/);
  assert.throws(()=>new ComputeMarket(x.genesis,{znyt:{allocations:[
    {address:x.customer.address,balance:'1'},{address:x.customer.address,balance:'1'}]}}),
    /Duplicate/);
  const legacy=new ComputeMarket(x.genesis);
  assert.equal(legacy.audit().znyt,undefined);
  assert.throws(()=>legacy.chargeZnytGas({},[]),/not configured/);
  assert.equal(legacy.audit().conserved,true);
});

test('validator rewards exhaust only available pre-funded reserve plus collected gas, never mint',()=>{
  const x=fixture({rewardReserve:'0',burnBps:'10000'});
  x.market.advanceHeight('1');
  const auth=x.gasAuth();
  x.market.chargeZnytGas(auth,x.gasMeters(auth).slice(0,3));
  assert.equal(x.market.audit().znyt.gasFeePool,'0');
  assert.throws(()=>x.market.awardValidatorRound(x.rewardAttestations()),/reserve exhausted/);
  assert.equal(x.market.audit().znyt.conserved,true);
  assert.equal(x.market.audit().znyt.cumulativeBurned,'100');
  const y=fixture({rewardReserve:'10'});
  y.market.advanceHeight('1');
  assert.equal(y.market.awardValidatorRound(y.rewardAttestations()).paidFromPrefundedReserve,'6');
  assert.equal(y.market.audit().znyt.validatorRewardReserve,'4');
  assert.equal(y.market.audit().znyt.conserved,true);
});
