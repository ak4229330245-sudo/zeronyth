/** Provider-owned Ollama AI execution; real model call, signed result, NO automatic token transfer. */
import {createPublicKey} from 'node:crypto';
import {createServer} from 'node:http';
import {MARKET_KINDS,signMarket,verifyMarket} from './market-crypto.mjs';
import {addressOf,digest,ProtocolError,uint} from './pq.mjs';
import {LocalGenerativeAiHost} from './hosted-resource-backends.mjs';

const ID=/^[0-9a-f]{64}$/;
export class AiInferenceWorker {
  #key;#host;#used=new Map();#pending=new Set();
  constructor({chainId,providerPrivateKey,modelHost}={}){
    if(typeof chainId!=='string'||!/^\d+$/.test(chainId)||
      providerPrivateKey?.asymmetricKeyType!=='ml-dsa-65'||
      providerPrivateKey?.type!=='private'||
      !(modelHost instanceof LocalGenerativeAiHost)){
      throw new ProtocolError('AI worker requires owner ML-DSA key and allowlisted local model');
    }
    this.chainId=chainId;
    this.address=addressOf(createPublicKey(providerPrivateKey).export({format:'der',type:'spki'}).toString('base64'));
    this.#key=providerPrivateKey;this.#host=modelHost;
  }
  async execute(signedPermit,signedRequest){
    const {signer:provider,payload:permit}=verifyMarket(
      signedPermit,MARKET_KINDS.SERVICE_PERMIT,this.chainId);
    const {signer:customer,payload:request}=verifyMarket(
      signedRequest,MARKET_KINDS.SERVICE_REQUEST,this.chainId);
    if(provider!==this.address||provider!==permit.provider||
      customer===provider||customer!==permit.customer||
      permit.service!=='ai-gpu'||request.operation!=='generate'||
      !ID.test(permit.rentalId)||request.rentalId!==permit.rentalId){
      throw new ProtocolError('AI inference requires provider/customer-bound GPU rental permit');
    }
    const permitId=digest('ZERONYTH_HOSTED_SERVICE_PERMIT_ID_V1\0',JSON.stringify(signedPermit));
    const requestId=digest('ZERONYTH_HOSTED_SERVICE_REQUEST_ID_V1\0',JSON.stringify(signedRequest));
    if(request.permitId!==permitId||!['none'].includes(permit.gpuDeviceId)&&
      !/^GPU-[a-zA-Z0-9-]{16,80}$/.test(permit.gpuDeviceId)){
      throw new ProtocolError('AI provider permit mismatch');
    }
    const expiry=uint(permit.expiresAtUnixMs,'AI permit expiry',{min:1n});
    const maxRequests=uint(permit.maxRequests,'AI permit request cap',{min:1n});
    const used=this.#used.get(permitId)||0n;
    const now=BigInt(Date.now());
    if(expiry<=now||expiry>now+86400000n||maxRequests>32n||
      uint(permit.cpuCores,'AI CPU cores',{min:1n})>64n||
      uint(permit.ramMiB,'AI RAM MiB',{min:512n})>262144n||
      uint(request.nonce,'AI request nonce')!==used||used>=maxRequests||
      this.#pending.has(permitId)){
      throw new ProtocolError('AI permit expired, exceeded budget, concurrent or replayed');
    }
    const maxTokens=uint(request.maxTokens,'AI output tokens',{min:1n});
    if(maxTokens>256n||typeof request.prompt!=='string'||
      request.prompt.length<1||request.prompt.length>1600){
      throw new ProtocolError('AI prompt or generation budget invalid');
    }
    this.#pending.add(permitId);
    try{
      // This calls an actual operator-approved localhost Ollama model. It does
      // NOT attest execution was on a physical GPU or inside a paid GPU lease.
      const result=await this.#host.generate({model:permit.model,
        prompt:request.prompt,maxTokens:Number(maxTokens)});
      const resourceId=digest('ZERONYTH_AI_MODEL_WORKER_ID_V1\0',
        `${this.address}:${permit.model}:${permitId}`);
      const outputHash=digest('ZERONYTH_HOSTED_SERVICE_OUTPUT_V1\0',
        JSON.stringify({requestId,resourceId,output:result.response}));
      const signedReceipt=signMarket({kind:MARKET_KINDS.SERVICE_RECEIPT,
        chainId:this.chainId,rentalId:permit.rentalId,permitId,requestId,
        service:'ai-gpu',operation:'generate',resourceId,outputHash},this.#key);
      this.#used.set(permitId,used+1n);
      return {signedReceipt,output:result.response,model:result.model,
        generatedTokens:result.generatedTokens,localModelActuallyResponded:true,
        physicalGpuUsageVerified:false,realZnytTransferred:false};
    }finally{this.#pending.delete(permitId);}
  }
  async startLoopbackServer({port=0}={}){
    if(!Number.isInteger(port)||port<0||port>65535){
      throw new ProtocolError('AI worker loopback port out of range');
    }
    const server=createServer(async(req,res)=>{
      const reply=(code,data)=>{
        if(res.writableEnded||res.destroyed)return;
        res.writeHead(code,{'content-type':'application/json; charset=utf-8',
          'cache-control':'no-store','x-content-type-options':'nosniff',
          'referrer-policy':'no-referrer'});
        res.end(JSON.stringify(data));
      };
      if(req.method==='GET'&&req.url==='/health'){
        reply(200,{ready:true,provider:this.address,mode:'local-model-only',
          physicalGpuAttested:false,realZnyt:false});return;
      }
      if(req.method!=='POST'||req.url!=='/v1/ai/execute'){
        reply(404,{error:'Not found'});return;
      }
      try{
        if(String(req.headers['content-type']||'').split(';')[0]!=='application/json'){
          throw new ProtocolError('JSON required');
        }
        const chunks=[];let size=0;
        for await(const chunk of req){
          size+=chunk.length;
          if(size>65536)throw new ProtocolError('AI request exceeds size limit');
          chunks.push(chunk);
        }
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!body||typeof body!=='object'||Array.isArray(body)||
          Object.keys(body).sort().join(',')!=='permit,request'){
          throw new ProtocolError('Expected signed AI permit and request');
        }
        reply(200,await this.execute(body.permit,body.request));
      }catch(error){
        reply(400,{error:error instanceof ProtocolError?error.message:
          'Invalid AI request or local model unavailable'});
      }
    });
    try{await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});
    });}catch(error){server.close();throw error;}
    return {server,url:`http://127.0.0.1:${server.address().port}`,
      address:this.address,loopbackOnly:true};
  }
}
