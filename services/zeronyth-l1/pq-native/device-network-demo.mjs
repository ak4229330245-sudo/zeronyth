/** Four platform classes, one signed device registry. No real mobile app is launched. */
import {DeviceNodeRegistry} from './device-registry.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {GENESIS_KIND,generateIdentity} from './pq.mjs';

const validators=Array.from({length:4},()=>generateIdentity());
const registry=new DeviceNodeRegistry({kind:GENESIS_KIND,chainId:'19127',
  validators:validators.map(v=>({publicKey:v.publicKey})),allocations:[]});
const nodes=[
  {deviceClass:'server',platform:'linux',role:'compute',runtime:'native',foregroundOnly:false},
  {deviceClass:'desktop',platform:'windows',role:'compute',runtime:'native',foregroundOnly:false},
  {deviceClass:'phone',platform:'android',role:'compute',runtime:'native',foregroundOnly:true},
  {deviceClass:'tablet',platform:'ipados',role:'light',runtime:'native',foregroundOnly:true},
];
const result=[];
for(const config of nodes){
  const identity=generateIdentity();
  const record=registry.register(signMarket({kind:MARKET_KINDS.DEVICE,
    chainId:'19127',nonce:'0',...config,maxCpuPct:'25'},identity.privateKey));
  registry.heartbeat(signMarket({kind:MARKET_KINDS.HEARTBEAT,chainId:'19127',
    deviceId:record.deviceId,sequence:'0',observedAtHeight:'0',foreground:true,
    charging:true,unmetered:true,batteryPct:'90',thermal:'normal'},identity.privateKey));
  result.push({deviceClass:config.deviceClass,platform:config.platform,role:config.role,
    testEligibility:registry.assess(identity.address,{role:config.role,iterations:100})});
}
console.log(JSON.stringify({researchOnly:true,simulatedDeviceRegistrations:4,
  actualMobileAppsConnected:0,actualServersConnected:0,
  creditsPaid:0,hardwareVerified:false,participants:result},null,2));
