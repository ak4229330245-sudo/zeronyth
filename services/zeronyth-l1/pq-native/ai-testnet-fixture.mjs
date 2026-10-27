/** Ephemeral offline ZNYT-LAB balances. Absolutely no actual network token deployment. */
import {GENESIS_KIND,digest,generateIdentity} from './pq.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {DeviceNodeRegistry} from './device-registry.mjs';
import {ComputeMarket} from './compute-market.mjs';
import {LocalGenerativeAiHost} from './hosted-resource-backends.mjs';
import {AiInferenceWorker} from './ai-inference-worker.mjs';
import {AiLocalLabSession} from './ai-local-session.mjs';

export function createAiTestnetLab({model='qwen2.5:0.5b',
  modelHost=null,chainId='19127'}={}){
  const validators=Array.from({length:4},()=>generateIdentity());
  const provider=generateIdentity(),customer=generateIdentity();
  const genesis={kind:GENESIS_KIND,chainId,
    validators:validators.map(v=>({publicKey:v.publicKey})),
    allocations:[{address:provider.address,balance:'300'},
      {address:customer.address,balance:'1000'}]};
  const sign=(kind,fields,actor)=>signMarket({kind,chainId,...fields},actor.privateKey);
  const registry=new DeviceNodeRegistry(genesis);
  const market=new ComputeMarket(genesis,{deviceRegistry:registry,
    znyt:{allocations:[{address:customer.address,balance:'1000'}],
      requireExecutionProof:true,gasBurnBasisPoints:'2000'}});
  const profile=registry.register(sign(MARKET_KINDS.DEVICE,{nonce:'0',
    deviceClass:'server',platform:'linux',runtime:'native',role:'compute',
    maxCpuPct:'40',foregroundOnly:false},provider));
  registry.heartbeat(sign(MARKET_KINDS.HEARTBEAT,{
    deviceId:profile.deviceId,sequence:'0',observedAtHeight:'0',
    foreground:true,charging:true,unmetered:true,batteryPct:'100',
    thermal:'normal'},provider));
  const registration=sign(MARKET_KINDS.REGISTER,{nonce:'0',
    cpuCores:'4',ramMiB:'4096',gpuCount:'1',stake:'100'},provider);
  const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',
    JSON.stringify(registration));
  market.registerProvider(registration,validators.slice(0,3).map(v=>
    sign(MARKET_KINDS.CAPACITY,{provider:provider.address,registrationId,
      cpuCores:'4',ramMiB:'4096',gpuCount:'1',expiresAtHeight:'20'},v)));
  const offer=market.publishRentalOffer(sign(MARKET_KINDS.RENT_OFFER,{
    nonce:market.nextNonce(provider.address),service:'ai-gpu',cpuCores:'2',
    ramMiB:'2048',storageGiB:'0',gpuCount:'1',vramMiB:'8192',
    pricePerSlot:'20',maxSlots:'2',expiresAtHeight:'10'},provider));
  const rental=market.reserveRental(sign(MARKET_KINDS.RENT_REQUEST,{
    nonce:market.nextNonce(customer.address),offerId:offer.offerId,
    slots:'2'},customer));
  market.advanceHeight('1');registry.advanceHeight('1');
  const permit=sign(MARKET_KINDS.SERVICE_PERMIT,{
    rentalId:rental.rentalId,customer:customer.address,
    provider:provider.address,service:'ai-gpu',cpuCores:'2',
    ramMiB:'2048',gpuDeviceId:'GPU-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    model,maxRequests:'3',expiresAtUnixMs:String(Date.now()+3600000)},provider);
  const host=modelHost??new LocalGenerativeAiHost({allowedModels:[model]});
  const worker=new AiInferenceWorker({chainId,
    providerPrivateKey:provider.privateKey,modelHost:host});
  const session=new AiLocalLabSession({market,worker,signedPermit:permit,
    customerPrivateKey:customer.privateKey,
    providerPrivateKey:provider.privateKey,modelHost:host});
  return {session,worker,market,registry,provider,customer,signedPermit:permit,
    ephemeralSignedTestProviders:true,actualGpuVerified:false,
    realOnChainTestnetZnyt:false};
}
