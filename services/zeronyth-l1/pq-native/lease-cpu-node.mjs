/** Real bounded CPU work, authenticated with research ML-DSA lease permits.
 *  HTTP exposure is deliberately loopback-only; NO shell, Docker, VM, or AI.
 */
import {createPublicKey} from 'node:crypto';
import {createServer} from 'node:http';
import {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {MARKET_KINDS,signMarket,verifyMarket} from './market-crypto.mjs';
import {addressOf,digest,ProtocolError,uint} from './pq.mjs';

const HEX64=/^[0-9a-f]{64}$/;
const MAX_ITERATIONS_PER_JOB=10000n;
const MAX_PERMIT_TOTAL_ITERATIONS=320000n;
const MAX_PERMIT_JOBS=32n;
const MAX_PERMIT_TTL_MS=24n*60n*60n*1000n;
const MAX_REQUEST_BYTES=65536;

async function runDedicatedCpuThread(seed,iterations){
  const worker=new Worker(new URL('./lease-work-hash-thread.mjs',import.meta.url),{
    workerData:{seed,iterations},resourceLimits:{maxOldGenerationSizeMb:32}});
  return new Promise((resolve,reject)=>{
    let settled=false;
    const done=(error,result)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      if(error)reject(error);else resolve(result);
    };
    const timer=setTimeout(()=>{
      void worker.terminate();
      done(new ProtocolError('CPU work timed out'));
    },5000);
    worker.once('message',message=>done(null,message.output));
    worker.once('error',error=>done(error));
    worker.once('exit',code=>{
      if(code!==0)done(new ProtocolError('CPU worker exited before signed result'));
    });
  });
}

export class LeaseCpuNode {
  #providerPrivateKey;
  #spent=new Map();
  #active=0;

  constructor({chainId,providerPrivateKey,concurrentWorkers=2}){
    if(typeof chainId!=='string'||!/^\d+$/.test(chainId)){
      throw new ProtocolError('Lease CPU node requires decimal chain ID');
    }
    if(providerPrivateKey?.asymmetricKeyType!=='ml-dsa-65'||
        providerPrivateKey?.type!=='private'){
      throw new ProtocolError('Lease CPU node requires ML-DSA private key');
    }
    if(!Number.isInteger(concurrentWorkers)||concurrentWorkers<1||
        concurrentWorkers>4)throw new ProtocolError('Worker concurrency must be 1..4');
    this.chainId=chainId;
    this.address=addressOf(createPublicKey(providerPrivateKey).export({
      format:'der',type:'spki'}).toString('base64'));
    this.concurrentWorkers=concurrentWorkers;
    this.#providerPrivateKey=providerPrivateKey;
  }

  async execute(signedPermit,signedOrder){
    const {signer:provider,payload:permit}=verifyMarket(
      signedPermit,MARKET_KINDS.WORK_PERMIT,this.chainId);
    const {signer:customer,payload:order}=verifyMarket(
      signedOrder,MARKET_KINDS.WORK_ORDER,this.chainId);
    if(provider!==this.address||provider!==permit.provider||
        permit.customer!==customer||!HEX64.test(permit.rentalId)||
        permit.rentalId!==order.rentalId){
      throw new ProtocolError('Invalid CPU lease permit/provider/customer binding');
    }
    const permitId=digest('ZERONYTH_WORK_PERMIT_ID_V1\0',JSON.stringify(signedPermit));
    const orderId=digest('ZERONYTH_WORK_ORDER_ID_V1\0',JSON.stringify(signedOrder));
    if(order.permitId!==permitId||!HEX64.test(order.jobId)||!HEX64.test(order.seed)){
      throw new ProtocolError('Invalid CPU work order binding or input');
    }
    const now=BigInt(Date.now());
    const expiry=uint(permit.expiresAtUnixMs,'permit expiry');
    const maxJobs=uint(permit.maxJobs,'permit max jobs',{min:1n});
    const maxTotal=uint(permit.maxTotalIterations,'permit max iterations',{min:1n});
    const iterations=uint(order.iterations,'work iterations',{min:1n});
    if(expiry<=now||expiry>now+MAX_PERMIT_TTL_MS||
        maxJobs>MAX_PERMIT_JOBS||maxTotal>MAX_PERMIT_TOTAL_ITERATIONS||
        iterations>MAX_ITERATIONS_PER_JOB){
      throw new ProtocolError('CPU work exceeds bounded and unexpired lease permit');
    }
    const spent=this.#spent.get(permitId)||{jobs:0n,iterations:0n,orders:new Set()};
    if(uint(order.nonce,'per-permit work nonce')!==spent.jobs||
        spent.orders.has(orderId)||spent.jobs>=maxJobs||
        spent.iterations+iterations>maxTotal){
      throw new ProtocolError('CPU work replay, nonce or aggregate lease quota exceeded');
    }
    if(this.#active>=this.concurrentWorkers){
      throw new ProtocolError('CPU worker busy; retry same signed order');
    }
    // Reserve the nonce/capacity synchronously before async work so parallel
    // requests cannot race beyond a renter's signed allocation.
    spent.jobs++;spent.iterations+=iterations;spent.orders.add(orderId);
    this.#spent.set(permitId,spent);
    this.#active++;
    const started=performance.now();
    try{
      const output=await runDedicatedCpuThread(order.seed,Number(iterations));
      const runTimeMs=String(Math.max(0,Math.ceil(performance.now()-started)));
      const signedReceipt=signMarket({kind:MARKET_KINDS.WORK_RECEIPT,
        chainId:this.chainId,rentalId:permit.rentalId,permitId,orderId,
        jobId:order.jobId,seed:order.seed,iterations:order.iterations,
        output,runTimeMs},this.#providerPrivateKey);
      return {signedReceipt,actualCpuThreadRan:true,vmProvisioned:false,
        aiInferenceExecuted:false,realZnytTransferred:false};
    }finally{
      this.#active--;
    }
  }

  async startLoopbackServer({port=0}={}){
    if(!Number.isInteger(port)||port<0||port>65535){
      throw new ProtocolError('Invalid loopback port');
    }
    const server=createServer(async(req,res)=>{
      const reply=(code,obj)=>{
        if(res.writableEnded||res.destroyed)return;
        res.writeHead(code,{'content-type':'application/json; charset=utf-8',
          'cache-control':'no-store','x-content-type-options':'nosniff'});
        res.end(JSON.stringify(obj));
      };
      if(req.method==='GET'&&req.url==='/health'){
        reply(200,{running:true,address:this.address,loopbackOnly:true,
          supportedWork:'bounded-sha256',realVps:false});return;
      }
      if(req.method!=='POST'||req.url!=='/v1/lease/execute'){
        reply(404,{error:'Not found'});return;
      }
      if(!String(req.headers['content-type']||'').startsWith('application/json')){
        reply(415,{error:'JSON required'});return;
      }
      try{
        let bytes=0,body='';
        for await(const chunk of req){
          bytes+=chunk.length;
          if(bytes>MAX_REQUEST_BYTES)throw new ProtocolError('Work request too large');
          body+=chunk.toString('utf8');
        }
        const parsed=JSON.parse(body);
        if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
            Object.keys(parsed).sort().join(',')!=='order,permit'){
          throw new ProtocolError('Expected exactly signed permit and order');
        }
        reply(200,await this.execute(parsed.permit,parsed.order));
      }catch(error){
        reply(400,{error:error instanceof ProtocolError?error.message:
          'Invalid or failed CPU work request'});
      }
    });
    try{
      await new Promise((resolve,reject)=>{
        server.once('error',reject);
        server.listen(port,'127.0.0.1',resolve);
      });
    }catch(error){server.close();throw error;}
    return {server,url:`http://127.0.0.1:${server.address().port}`,
      address:this.address,bindAddress:'127.0.0.1'};
  }
}
