/** Repeatable local reward-accounting demonstration: no network, no token mint. */
import {ComputeMarket,hashWork} from './compute-market.mjs';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {GENESIS_KIND,digest,generateIdentity} from './pq.mjs';

const validators=Array.from({length:4},()=>generateIdentity());
const worker=generateIdentity();
const customer=generateIdentity();
const chainId='19127';
const market=new ComputeMarket({kind:GENESIS_KIND,chainId,
  validators:validators.map(v=>({publicKey:v.publicKey})),
  allocations:[{address:worker.address,balance:'1000'},
    {address:customer.address,balance:'1000'}]});
const registration=signMarket({kind:MARKET_KINDS.REGISTER,chainId,nonce:'0',
  cpuCores:'4',ramMiB:'8192',gpuCount:'0',stake:'100'},worker.privateKey);
const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',JSON.stringify(registration));
const certificates=validators.slice(0,3).map(v=>signMarket({kind:MARKET_KINDS.CAPACITY,
  chainId,provider:worker.address,registrationId,cpuCores:'4',ramMiB:'8192',
  gpuCount:'0',expiresAtHeight:'50'},v.privateKey));
market.registerProvider(registration,certificates);

const results=[];
for(let i=0;i<10;i++){
  const seed=digest('ZERONYTH_COMPUTE_SEED\0',String(i));
  const receipt=market.submitJob(signMarket({kind:MARKET_KINDS.REQUEST,chainId,
    nonce:String(i),seed,iterations:'100',price:'20',expiresAtHeight:'20'},customer.privateKey));
  market.assignJob(receipt.jobId);
  const output=hashWork(seed,100);
  results.push(market.submitResult(signMarket({kind:MARKET_KINDS.RESULT,
    chainId,jobId:receipt.jobId,output},worker.privateKey)));
}
console.log(JSON.stringify({researchOnly:true,actualZnytMinted:false,
  actualRemoteCompute:false,simulatedCompletedJobs:results.length,
  worker:market.provider(worker.address),balances:{
    worker:market.balance(worker.address),customer:market.balance(customer.address)},
  audit:market.audit()},null,2));
