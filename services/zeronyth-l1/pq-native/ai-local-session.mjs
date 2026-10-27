/** Local-only AI lab. Customer/provider ML-DSA signatures & ZNYT-LAB accounting.
 * Ephemeral keys are restricted to this operator-controlled test session.
 */
import {createPublicKey,randomBytes} from 'node:crypto';
import {AiInferenceWorker} from './ai-inference-worker.mjs';
import {ComputeMarket} from './compute-market.mjs';
import {MARKET_KINDS,signMarket,verifyMarket} from './market-crypto.mjs';
import {addressOf,digest,ProtocolError} from './pq.mjs';
import {LocalGenerativeAiHost} from './hosted-resource-backends.mjs';

function addr(key){
  if(key?.asymmetricKeyType!=='ml-dsa-65'||key?.type!=='private'){
    throw new ProtocolError('Local AI lab requires ML-DSA-65 private keys');
  }
  return addressOf(createPublicKey(key).export({format:'der',type:'spki'}).toString('base64'));
}

function boundPrompt(prompt,maxTokens){
  if(typeof prompt!=='string'||prompt.length<1||prompt.length>1600||
     !Number.isInteger(maxTokens)||maxTokens<1||maxTokens>256){
    throw new ProtocolError('Prompt must be 1..1600 chars; output budget 1..256 tokens');
  }
}

export class AiLocalLabSession {
  #market;#worker;#permit;#customerKey;#providerKey;#modelHost;
  #used=0n;#busy=false;#settled=false;#messages=0;#providerAnswers=0;
  constructor({market,worker,signedPermit,customerPrivateKey,
    providerPrivateKey,modelHost}={}){
    if(!(market instanceof ComputeMarket)||!(worker instanceof AiInferenceWorker)||
       !(modelHost instanceof LocalGenerativeAiHost)||market.chainId!==worker.chainId){
      throw new ProtocolError('Local AI worker and ZNYT-LAB market must share a chain');
    }
    const proof=verifyMarket(signedPermit,MARKET_KINDS.SERVICE_PERMIT,market.chainId);
    this.customer=addr(customerPrivateKey);this.provider=addr(providerPrivateKey);
    if(proof.payload.customer!==this.customer||proof.payload.provider!==this.provider||
       worker.address!==this.provider||proof.payload.service!=='ai-gpu'){
      throw new ProtocolError('Local AI signed permit or account identity mismatch');
    }
    this.chainId=market.chainId;this.rentalId=proof.payload.rentalId;
    this.model=proof.payload.model;
    this.#market=market;this.#worker=worker;this.#permit=signedPermit;
    this.#providerKey=providerPrivateKey;this.#customerKey=customerPrivateKey;
    this.#modelHost=modelHost;
  }
  status(){
    const perk=this.#market.aiProviderAccess(this.provider);
    return {mode:'ZNYT_LAB_LOCAL_ONLY',chainId:this.chainId,model:this.model,
      customerZnytLab:this.#market.znytBalance(this.customer),
      providerZnytLab:this.#market.znytBalance(this.provider),
      answered:this.#messages,providerFreeAnswered:this.#providerAnswers,
      providerAiQuota:perk.remaining,providerEligible:perk.eligible,
      pendingSettlement:this.#messages>0&&!this.#settled,
      settled:this.#settled,realToken:false,physicalGpuAttested:false,
      remotelySent:false};
  }
  async ask(prompt,maxTokens=128){
    boundPrompt(prompt,maxTokens);
    if(this.#settled||this.#busy){
      throw new ProtocolError('AI rental settled or another request in progress');
    }
    this.#busy=true;
    try{
      const permitId=digest('ZERONYTH_HOSTED_SERVICE_PERMIT_ID_V1\0',
        JSON.stringify(this.#permit));
      const signedRequest=signMarket({kind:MARKET_KINDS.SERVICE_REQUEST,
        chainId:this.chainId,rentalId:this.rentalId,permitId,
        nonce:String(this.#used),operation:'generate',prompt,
        maxTokens:String(maxTokens)},this.#customerKey);
      const result=await this.#worker.execute(this.#permit,signedRequest);
      const proof=this.#market.recordVerifiedHostedService(this.#permit,
        signedRequest,result.signedReceipt,result.output);
      this.#used++;this.#messages++;
      return {reply:result.output,generatedTokens:result.generatedTokens,
        proofVerified:proof.receiptSignatureVerified,paymentStatus:'ESCROW_AWAITING_APPROVAL',
        model:result.model,realToken:false,physicalGpuAttested:false};
    }finally{this.#busy=false;}
  }
  async askAsProvider(prompt,maxTokens=128){
    boundPrompt(prompt,maxTokens);
    if(this.#busy)throw new ProtocolError('Local AI lab is processing another request');
    const allowance=this.#market.aiProviderAccess(this.provider);
    if(!allowance.eligible||allowance.remaining===0){
      throw new ProtocolError('No currently bonded eligible AI-provider free quota');
    }
    this.#busy=true;
    try{
      const result=await this.#modelHost.generate({model:this.model,prompt,maxTokens});
      const signed=signMarket({kind:MARKET_KINDS.AI_ACCESS,
        chainId:this.chainId,nonce:this.#market.nextNonce(this.provider),
        requestId:randomBytes(32).toString('hex')},this.#providerKey);
      const benefit=this.#market.requestProviderAi(signed);
      this.#providerAnswers++;
      return {reply:result.response,generatedTokens:result.generatedTokens,
        model:result.model,providerBenefit:true,remaining:benefit.remaining,
        realToken:false,physicalGpuAttested:false};
    }finally{this.#busy=false;}
  }
  settle(){
    if(this.#busy||this.#settled||this.#messages===0){
      throw new ProtocolError('Verified generation and one explicit approval required');
    }
    const signMeter=key=>signMarket({kind:MARKET_KINDS.RENT_METER,
      chainId:this.chainId,rentalId:this.rentalId,usedSlots:'1'},key);
    const receipt=this.#market.settleRental(
      signMeter(this.#providerKey),signMeter(this.#customerKey));
    this.#settled=true;
    return {...receipt,realToken:false};
  }
}
