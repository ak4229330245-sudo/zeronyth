/** Private, in-memory VPS + AI GPU booking proof. No VM, GPU execution or real payment. */
import {ComputeMarket} from './compute-market.mjs';
import {DeviceNodeRegistry} from './device-registry.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {GENESIS_KIND,digest,generateIdentity} from './pq.mjs';

const validators=Array.from({length:4},()=>generateIdentity());
const vps=generateIdentity(),gpu=generateIdentity(),customer=generateIdentity();
const chainId='19127';
const genesis={kind:GENESIS_KIND,chainId,
  validators:validators.map(v=>({publicKey:v.publicKey})),
  allocations:[{address:vps.address,balance:'300'},
    {address:gpu.address,balance:'300'},
    {address:customer.address,balance:'1000'}]};
const registry=new DeviceNodeRegistry(genesis);
const market=new ComputeMarket(genesis,{deviceRegistry:registry,
  governance:{allocations:[{address:customer.address,balance:'1000'}],
    validatorRewardReserve:'100',validatorRewardPerVote:'2'}});
const sign=(kind,fields,identity)=>signMarket({kind,chainId,...fields},identity.privateKey);

function onboard(identity,cpu,ram,gpus){
  const joined=registry.register(sign(MARKET_KINDS.DEVICE,{
    nonce:'0',deviceClass:'server',platform:'linux',runtime:'native',
    role:'compute',maxCpuPct:'40',foregroundOnly:false},identity));
  registry.heartbeat(sign(MARKET_KINDS.HEARTBEAT,{
    deviceId:joined.deviceId,sequence:'0',observedAtHeight:'0',
    foreground:true,charging:true,unmetered:true,batteryPct:'100',thermal:'normal'},identity));
  const registration=sign(MARKET_KINDS.REGISTER,{
    nonce:'0',cpuCores:String(cpu),ramMiB:String(ram),
    gpuCount:String(gpus),stake:'100'},identity);
  const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',JSON.stringify(registration));
  const attestations=validators.slice(0,3).map(v=>sign(MARKET_KINDS.CAPACITY,{
    provider:identity.address,registrationId,cpuCores:String(cpu),
    ramMiB:String(ram),gpuCount:String(gpus),expiresAtHeight:'50'},v));
  market.registerProvider(registration,attestations);
}

function rent(identity,service,resources,price){
  const offer=market.publishRentalOffer(sign(MARKET_KINDS.RENT_OFFER,{
    nonce:market.nextNonce(identity.address),service,
    ...resources,pricePerSlot:String(price),maxSlots:'4',expiresAtHeight:'20'},identity));
  const receipt=market.reserveRental(sign(MARKET_KINDS.RENT_REQUEST,{
    nonce:market.nextNonce(customer.address),offerId:offer.offerId,slots:'2'},customer));
  return {offer,receipt,identity};
}

onboard(vps,4,8192,0);
onboard(gpu,8,16384,2);
for(const identity of [vps,gpu]){
  market.publishChainShare(sign(MARKET_KINDS.CHAIN_SHARE,{
    nonce:market.nextNonce(identity.address),cpuPercent:'20',expiresAtHeight:'20'},identity));
  market.publishAiShare(sign(MARKET_KINDS.AI_SHARE,{
    nonce:market.nextNonce(identity.address),aiPercent:'20',expiresAtHeight:'20'},identity));
}
const vpsRental=rent(vps,'vps',{
  cpuCores:'2',ramMiB:'4096',storageGiB:'60',gpuCount:'0',vramMiB:'0'},'20');
const gpuRental=rent(gpu,'ai-gpu',{
  cpuCores:'4',ramMiB:'8192',storageGiB:'0',gpuCount:'1',vramMiB:'12288'},'40');

market.advanceHeight('1');
registry.advanceHeight('1');
function settle({identity,receipt}){
  const usage={rentalId:receipt.rentalId,usedSlots:'1'};
  return market.settleRental(sign(MARKET_KINDS.RENT_METER,usage,identity),
    sign(MARKET_KINDS.RENT_METER,usage,customer));
}
const vpsSettlement=settle(vpsRental);
const gpuSettlement=settle(gpuRental);
const blockId=digest('ZERONYTH_GOV_LAB_DEMO_ROUND\0','first-research-round');
const rewardAttestations=validators.slice(0,3).map(v=>sign(MARKET_KINDS.VALIDATOR_REWARD,
  {height:'1',blockId},v));
const validatorReward=market.awardValidatorRound(rewardAttestations);
const nodeProviderAiAccess=market.requestProviderAi(sign(MARKET_KINDS.AI_ACCESS,{
  nonce:market.nextNonce(vps.address),
  requestId:digest('ZERONYTH_PROVIDER_AI_DEMO\0','permission-check')},vps));
console.log(JSON.stringify({researchOnly:true,realVpsCreated:false,
  realGpuAccessProvided:false,hardwareMeasured:false,realFundsMoved:false,
  market:{vps:{offer:vpsRental.offer,reservation:vpsRental.receipt,
    settlement:vpsSettlement},aiGpu:{offer:gpuRental.offer,
    reservation:gpuRental.receipt,settlement:gpuSettlement}},
  validatorReward,nodeProviderAiAccess,
  nodeProviderAiStatus:market.aiProviderAccess(vps.address),
  customerGovernanceBalance:market.governanceBalance(customer.address),
  customerDevCreditUnchanged:market.balance(customer.address),
  nodeResourceSplits:[market.nodeResourceAllocation(vps.address),
    market.nodeResourceAllocation(gpu.address)],
  futureChainCapacity:market.chainAccelerationStatus(),
  futureGenerativeAiCapacity:market.aiGrowthStatus(),
  creditConservation:market.audit()},null,2));
