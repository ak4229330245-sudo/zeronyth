/** End-to-end signed CPU work over a real loopback HTTP socket + ZNYT-LAB escrow. */
import {ComputeMarket} from './compute-market.mjs';
import {DeviceNodeRegistry} from './device-registry.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {GENESIS_KIND,digest,generateIdentity} from './pq.mjs';
import {LeaseCpuNode} from './lease-cpu-node.mjs';

const validators=Array.from({length:4},()=>generateIdentity());
const provider=generateIdentity(),customer=generateIdentity(),chainId='19127';
const sign=(kind,fields,who)=>signMarket({kind,chainId,...fields},who.privateKey);
const genesis={kind:GENESIS_KIND,chainId,
  validators:validators.map(v=>({publicKey:v.publicKey})),
  allocations:[{address:provider.address,balance:'300'},
    {address:customer.address,balance:'1000'}]};
const registry=new DeviceNodeRegistry(genesis);
const market=new ComputeMarket(genesis,{deviceRegistry:registry,
  znyt:{allocations:[{address:customer.address,balance:'1000'}],
    requireExecutionProof:true,validatorRewardReserve:'0'}});
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
const offer=market.publishRentalOffer(sign(MARKET_KINDS.RENT_OFFER,{
  nonce:market.nextNonce(provider.address),service:'vps',cpuCores:'2',ramMiB:'2048',
  storageGiB:'40',gpuCount:'0',vramMiB:'0',pricePerSlot:'20',
  maxSlots:'5',expiresAtHeight:'10'},provider));
const rental=market.reserveRental(sign(MARKET_KINDS.RENT_REQUEST,{
  nonce:market.nextNonce(customer.address),offerId:offer.offerId,slots:'2'},customer));
const permit=sign(MARKET_KINDS.WORK_PERMIT,{
  rentalId:rental.rentalId,provider:provider.address,customer:customer.address,
  maxJobs:'1',maxTotalIterations:'10000',
  expiresAtUnixMs:String(Date.now()+60000)},provider);
const permitId=digest('ZERONYTH_WORK_PERMIT_ID_V1\0',JSON.stringify(permit));
const order=sign(MARKET_KINDS.WORK_ORDER,{
  rentalId:rental.rentalId,permitId,nonce:'0',
  jobId:digest('ZERONYTH_LEASE_DEMO_WORK\0','job-one'),
  seed:'ab'.repeat(32),iterations:'9000'},customer);
const agent=new LeaseCpuNode({chainId,providerPrivateKey:provider.privateKey});
const {server,url}=await agent.startLoopbackServer();
let result;
try{
  const response=await fetch(`${url}/v1/lease/execute`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({permit,order})});
  if(!response.ok)throw new Error(`Provider rejected work: ${response.status}`);
  result=await response.json();
}finally{await new Promise(resolve=>server.close(resolve));}

const proof=market.recordVerifiedRentalWork(permit,order,result.signedReceipt);
market.advanceHeight('1');registry.advanceHeight('1');
const usage={rentalId:rental.rentalId,usedSlots:'1'};
const payment=market.settleRental(
  sign(MARKET_KINDS.RENT_METER,usage,provider),
  sign(MARKET_KINDS.RENT_METER,usage,customer));
console.log(JSON.stringify({version:'1.8.25',researchOnly:true,
  realCpuThreadExecuted:result.actualCpuThreadRan,
  physicalMachineIdentityProven:false,realVpsCreated:false,
  realZnytTransferred:false,realAiInference:false,
  providerHttpListenerWasLoopbackOnly:true,
  proof,payment,providerZnytLabBalance:market.znytBalance(provider.address),
  customerZnytLabBalance:market.znytBalance(customer.address),
  audit:market.audit()},null,2));
