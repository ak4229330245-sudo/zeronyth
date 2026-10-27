/** Unified ZNYT research economy walkthrough. No real ZNYT, gas or cloud instances. */
import {ComputeMarket} from './compute-market.mjs';
import {DeviceNodeRegistry} from './device-registry.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {GENESIS_KIND,digest,generateIdentity} from './pq.mjs';

const validators=Array.from({length:4},()=>generateIdentity());
const provider=generateIdentity(),customer=generateIdentity(),chainId='19127';
const genesis={kind:GENESIS_KIND,chainId,
  validators:validators.map(v=>({publicKey:v.publicKey})),
  allocations:[{address:provider.address,balance:'300'},
    {address:customer.address,balance:'1000'}]};
const sign=(kind,fields,who)=>signMarket({kind,chainId,...fields},who.privateKey);
const registry=new DeviceNodeRegistry(genesis);
const market=new ComputeMarket(genesis,{deviceRegistry:registry,
  znyt:{allocations:[{address:customer.address,balance:'1000'}],
    validatorRewardPerVote:'2',validatorRewardReserve:'0',gasBurnBasisPoints:'2000'}});

const node=registry.register(sign(MARKET_KINDS.DEVICE,{
  nonce:'0',deviceClass:'server',platform:'linux',runtime:'native',role:'compute',
  maxCpuPct:'40',foregroundOnly:false},provider));
registry.heartbeat(sign(MARKET_KINDS.HEARTBEAT,{
  deviceId:node.deviceId,sequence:'0',observedAtHeight:'0',foreground:true,
  charging:true,unmetered:true,batteryPct:'100',thermal:'normal'},provider));
const registration=sign(MARKET_KINDS.REGISTER,{
  nonce:'0',cpuCores:'4',ramMiB:'4096',gpuCount:'0',stake:'100'},provider);
const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',JSON.stringify(registration));
market.registerProvider(registration,validators.slice(0,3).map(v=>
  sign(MARKET_KINDS.CAPACITY,{provider:provider.address,registrationId,
    cpuCores:'4',ramMiB:'4096',gpuCount:'0',expiresAtHeight:'20'},v)));

const nodeAiEntitlement=market.aiProviderAccess(provider.address);
const offer=market.publishRentalOffer(sign(MARKET_KINDS.RENT_OFFER,{
  nonce:market.nextNonce(provider.address),service:'vps',cpuCores:'2',
  ramMiB:'2048',storageGiB:'40',gpuCount:'0',vramMiB:'0',pricePerSlot:'20',
  maxSlots:'5',expiresAtHeight:'10'},provider));
const reservation=market.reserveRental(sign(MARKET_KINDS.RENT_REQUEST,{
  nonce:market.nextNonce(customer.address),offerId:offer.offerId,slots:'2'},customer));
market.advanceHeight('1');registry.advanceHeight('1');
const meter={rentalId:reservation.rentalId,usedSlots:'1'};
const rentalSettlement=market.settleRental(
  sign(MARKET_KINDS.RENT_METER,meter,provider),
  sign(MARKET_KINDS.RENT_METER,meter,customer));

const gasAuthorization=sign(MARKET_KINDS.GAS_AUTH,{
  nonce:market.nextNonce(customer.address),
  operationId:digest('ZERONYTH_UNIFIED_ZNYT_DEMO\0','one-hypothetical-operation'),
  gasLimit:'50',maxUnitPrice:'20',expiresAtHeight:'5'},customer);
const authorizationId=digest('ZERONYTH_GAS_LAB_AUTH_ID_V1\0',JSON.stringify(gasAuthorization));
const gasReceipt=market.chargeZnytGas(gasAuthorization,validators.slice(0,3).map(v=>
  sign(MARKET_KINDS.GAS_METER,{
    authorizationId,gasUsed:'10',unitPrice:'10',blockHeight:'1'},v)));
const blockId=digest('ZERONYTH_UNIFIED_ZNYT_DEMO_ROUND\0','1');
const validatorRewards=market.awardValidatorRound(validators.slice(0,3).map(v=>
  sign(MARKET_KINDS.VALIDATOR_REWARD,{height:'1',blockId},v)));

const outcome={version:'1.8.24',researchSimulationOnly:true,
  networkChainId:chainId,tokenUnit:'ZNYT_LAB_NOT_REAL_TOKEN',
  realZnytMinted:false,realGasExecuted:false,realRemoteVpsCreated:false,
  realGenerativeAiInference:false,realFundsMoved:false,
  signedNodeAiEntitlement:nodeAiEntitlement,
  rental:{reservation,settlement:rentalSettlement},
  gas:gasReceipt,validatorRewards,
  accountBalances:{renterZnyt:market.znytBalance(customer.address),
    providerZnyt:market.znytBalance(provider.address),
    validator0Znyt:market.znytBalance(validators[0].address),
    renterLegacyDevCredit:market.balance(customer.address)},
  audit:market.audit()};
console.log(JSON.stringify(outcome,null,2));
