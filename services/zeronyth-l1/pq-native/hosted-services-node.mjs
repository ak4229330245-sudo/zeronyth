/** Provider-authorized, loopback-only hosted container/GPU/model gateway. */
import {createPublicKey} from 'node:crypto';
import {createServer} from 'node:http';
import {MARKET_KINDS,signMarket,verifyMarket} from './market-crypto.mjs';
import {addressOf,digest,ProtocolError,uint} from './pq.mjs';
import {HardenedContainerHost,LocalGenerativeAiHost} from './hosted-resource-backends.mjs';

const HEX64=/^[0-9a-f]{64}$/;
const MAX_BODY_BYTES=65536;
export const SERVICE_OUTPUT_DOMAIN='ZERONYTH_HOSTED_SERVICE_OUTPUT_V1\0';

export class HostedServicesNode {
  #key;
  #containerHost;
  #modelHost;
  #usage=new Map();
  #busy=new Set();

  constructor({chainId,providerPrivateKey,containerHost,modelHost}){
    if(typeof chainId!=='string'||!/^\d+$/.test(chainId)||
        providerPrivateKey?.asymmetricKeyType!=='ml-dsa-65'||
        providerPrivateKey?.type!=='private'||
        !(containerHost instanceof HardenedContainerHost)||
        !(modelHost instanceof LocalGenerativeAiHost)){
      throw new ProtocolError('Hosted node requires chain key and explicit approved backends');
    }
    this.chainId=chainId;
    this.address=addressOf(createPublicKey(providerPrivateKey).export({
      format:'der',type:'spki'}).toString('base64'));
    this.#key=providerPrivateKey;
    this.#containerHost=containerHost;
    this.#modelHost=modelHost;
  }

  async execute(signedPermit,signedRequest){
    const {signer:provider,payload:permit}=verifyMarket(
      signedPermit,MARKET_KINDS.SERVICE_PERMIT,this.chainId);
    const {signer:customer,payload:request}=verifyMarket(
      signedRequest,MARKET_KINDS.SERVICE_REQUEST,this.chainId);
    if(provider!==this.address||permit.provider!==provider||
        permit.customer!==customer||!HEX64.test(permit.rentalId)||
        permit.rentalId!==request.rentalId||!['vps','ai-gpu'].includes(permit.service)){
      throw new ProtocolError('Hosted service permit identities or service mismatch');
    }
    const permitId=digest('ZERONYTH_HOSTED_SERVICE_PERMIT_ID_V1\0',
      JSON.stringify(signedPermit));
    const requestId=digest('ZERONYTH_HOSTED_SERVICE_REQUEST_ID_V1\0',
      JSON.stringify(signedRequest));
    if(request.permitId!==permitId||
        !['create','stop','generate'].includes(request.operation)||
        (request.operation==='generate'&&permit.service!=='ai-gpu')||
        (permit.service==='vps'&&
          (permit.gpuDeviceId!=='none'||permit.model!=='none'))){
      throw new ProtocolError('Unsupported or unbound hosted service operation');
    }
    const expiry=uint(permit.expiresAtUnixMs,'hosted service expiry');
    const maxRequests=uint(permit.maxRequests,'hosted service request cap',{min:1n});
    const cores=uint(permit.cpuCores,'hosted service cores',{min:1n});
    const ram=uint(permit.ramMiB,'hosted service RAM',{min:512n});
    if(expiry<=BigInt(Date.now())||expiry>BigInt(Date.now())+86400000n||
        maxRequests>32n||cores>64n||ram>262144n){
      throw new ProtocolError('Expired or excessive hosted service budget');
    }
    const maxTokens=uint(request.maxTokens,'max output tokens');
    if(typeof request.prompt!=='string'||request.prompt.length>1600||
        (request.operation!=='generate'&&(request.prompt!==''||maxTokens!==0n))||
        (request.operation==='generate'&&
          (request.prompt.length===0||maxTokens<1n||maxTokens>256n))){
      throw new ProtocolError('Invalid signed model prompt or service operation payload');
    }
    const used=this.#usage.get(permitId)||0n;
    if(uint(request.nonce,'hosted request nonce')!==used||used>=maxRequests||
        this.#busy.has(permitId)){
      throw new ProtocolError('Hosted service nonce, replay or concurrent operation rejected');
    }
    this.#busy.add(permitId);
    try{
      let resourceId,output='',result;
      if(request.operation==='create'){
        result=await this.#containerHost.create({rentalId:permit.rentalId,
          service:permit.service,cpuCores:Number(cores),ramMiB:Number(ram),
          gpuDeviceId:permit.gpuDeviceId});
        resourceId=result.containerId;
      }else if(request.operation==='stop'){
        result=await this.#containerHost.stop(permit.rentalId);
        resourceId=result.containerId;
      }else{
        if(!this.#containerHost.isActive(permit.rentalId,'ai-gpu')){
          throw new ProtocolError('Active provider-approved GPU container required before inference');
        }
        result=await this.#modelHost.generate({model:permit.model,
          prompt:request.prompt,maxTokens:Number(maxTokens)});
        resourceId=this.#containerHost.get(permit.rentalId).containerId;
        output=result.response;
      }
      const outputHash=digest(SERVICE_OUTPUT_DOMAIN,JSON.stringify({
        requestId,resourceId,output}));
      const signedReceipt=signMarket({kind:MARKET_KINDS.SERVICE_RECEIPT,
        chainId:this.chainId,rentalId:permit.rentalId,permitId,requestId,
        service:permit.service,operation:request.operation,resourceId,outputHash},
      this.#key);
      this.#usage.set(permitId,used+1n);
      return {signedReceipt,output,...result,realZnytTransferred:false};
    }finally{this.#busy.delete(permitId);}
  }

  async startLoopbackServer({port=0}={}){
    if(!Number.isInteger(port)||port<0||port>65535){
      throw new ProtocolError('Invalid hosted service loopback port');
    }
    const server=createServer(async(req,res)=>{
      const reply=(status,obj)=>{
        if(res.writableEnded||res.destroyed)return;
        res.writeHead(status,{'content-type':'application/json; charset=utf-8',
          'cache-control':'no-store','x-content-type-options':'nosniff'});
        res.end(JSON.stringify(obj));
      };
      if(req.method==='GET'&&req.url==='/health'){
        reply(200,{ready:true,provider:this.address,loopbackOnly:true,
          dockerRuntimeCheckDeferred:true,localModelCheckDeferred:true});return;
      }
      if(req.method!=='POST'||req.url!=='/v1/hosted/execute'){
        reply(404,{error:'Not found'});return;
      }
      if(!String(req.headers['content-type']||'').startsWith('application/json')){
        reply(415,{error:'JSON required'});return;
      }
      try{
        let total=0,body='';
        for await(const chunk of req){
          total+=chunk.length;
          if(total>MAX_BODY_BYTES)throw new ProtocolError('Hosted request too large');
          body+=chunk.toString('utf8');
        }
        const parsed=JSON.parse(body);
        if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
            Object.keys(parsed).sort().join(',')!=='permit,request'){
          throw new ProtocolError('Expected signed hosted permit and request');
        }
        reply(200,await this.execute(parsed.permit,parsed.request));
      }catch(error){
        reply(400,{error:error instanceof ProtocolError?error.message:
          'Hosted service backend failed or is unavailable'});
      }
    });
    try{await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(port,'127.0.0.1',resolve);
    });}catch(error){server.close();throw error;}
    return {server,url:`http://127.0.0.1:${server.address().port}`,
      address:this.address,bindAddress:'127.0.0.1'};
  }
}
