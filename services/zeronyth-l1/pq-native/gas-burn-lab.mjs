/**
 * Isolated gas accounting and burn LAB; no integration with an executing L1.
 * Signed validator meters are research claims, not measured EVM/native gas.
 */
import {validateGenesis,requiredValidatorQuorum} from './ledger.mjs';
import {MARKET_KINDS,verifyMarket} from './market-crypto.mjs';
import {ProtocolError,addressOf,assertAddress,digest,uint} from './pq.mjs';

const HEX64=/^[0-9a-f]{64}$/;
const MAX_GAS_UNITS=10000000n;
const MAX_GAS_UNIT_PRICE=1000000000n;

export class GasBurnLab {
  #balances=new Map();
  #nonces=new Map();
  #receipts=new Map();
  #validators=new Set();
  #height=0n;
  #initialSupply=0n;
  #burned=0n;
  #networkFeePool=0n;
  #totalGasUsed=0n;
  #burnBps;

  constructor(genesis,{balances,burnBps='2000'}={}){
    validateGenesis(genesis);
    if(!Array.isArray(balances)||balances.length>128){
      throw new ProtocolError('Explicit bounded GAS-LAB test balances required');
    }
    const pct=uint(burnBps,'gas burn basis points');
    if(pct>10000n)throw new ProtocolError('Gas burn must be 0..10000 basis points');
    this.#burnBps=pct;
    this.chainId=genesis.chainId;
    this.#validators=new Set(genesis.validators.map(v=>addressOf(v.publicKey)));
    for(const item of balances){
      assertAddress(item.address);
      if(this.#balances.has(item.address)){
        throw new ProtocolError('Duplicate GAS-LAB initial account');
      }
      const amount=uint(item.balance,'GAS-LAB initial balance');
      this.#balances.set(item.address,amount);
      this.#initialSupply+=amount;
    }
  }

  balance(address){assertAddress(address);return (this.#balances.get(address)||0n).toString();}
  nextNonce(address){assertAddress(address);return (this.#nonces.get(address)||0n).toString();}

  advanceHeight(value){
    const next=uint(value,'simulated chain height',{min:1n});
    if(next<=this.#height||next>this.#height+10000n){
      throw new ProtocolError('Gas lab height must increase within bounded interval');
    }
    this.#height=next;
    return this.#height.toString();
  }

  chargeGas(signedAuthorization,signedMeters){
    // Both customer consent and a threshold of distinct genesis validators
    // are required. This DOES NOT prove execution of a real transaction.
    const {signer:payer,payload:auth}=verifyMarket(signedAuthorization,
      MARKET_KINDS.GAS_AUTH,this.chainId);
    if(uint(auth.nonce,'gas authorization nonce')!==(this.#nonces.get(payer)||0n)){
      throw new ProtocolError('Gas authorization nonce/replay rejected');
    }
    if(typeof auth.operationId!=='string'||!HEX64.test(auth.operationId)){
      throw new ProtocolError('Invalid signed gas operation ID');
    }
    const gasLimit=uint(auth.gasLimit,'gas authorization limit',{min:1n});
    const maxPrice=uint(auth.maxUnitPrice,'gas authorization max price',{min:1n});
    const expiry=uint(auth.expiresAtHeight,'gas authorization expiry',{min:1n});
    if(gasLimit>MAX_GAS_UNITS||maxPrice>MAX_GAS_UNIT_PRICE||
        expiry<this.#height||expiry>this.#height+10000n||this.#height===0n){
      throw new ProtocolError('Invalid bounded gas authorization terms');
    }
    const minimum=requiredValidatorQuorum(this.#validators.size);
    if(!Array.isArray(signedMeters)||signedMeters.length<minimum||
        signedMeters.length>this.#validators.size){
      throw new ProtocolError(`At least ${minimum} independent gas meter signatures required`);
    }
    const authorizationId=digest('ZERONYTH_GAS_LAB_AUTH_ID_V1\0',
      JSON.stringify(signedAuthorization));
    if(this.#receipts.has(authorizationId))throw new ProtocolError('Gas authorization already settled');
    const seen=new Set();
    let gasUsed=null,unitPrice=null;
    for(const signed of signedMeters){
      const {signer,payload:meter}=verifyMarket(signed,MARKET_KINDS.GAS_METER,this.chainId);
      if(!this.#validators.has(signer)||seen.has(signer)){
        throw new ProtocolError('Unknown or duplicate signed gas meter validator');
      }
      seen.add(signer);
      if(meter.authorizationId!==authorizationId||
          uint(meter.blockHeight,'meter block height')!==this.#height){
        throw new ProtocolError('Gas meter not bound to this simulated inclusion');
      }
      const used=uint(meter.gasUsed,'metered gas used',{min:1n});
      const price=uint(meter.unitPrice,'metered gas unit price',{min:1n});
      if(used>gasLimit||price>maxPrice||used>MAX_GAS_UNITS||
          price>MAX_GAS_UNIT_PRICE){
        throw new ProtocolError('Meter exceeds payer authorized gas bounds');
      }
      if(gasUsed!==null&&(gasUsed!==used||unitPrice!==price)){
        throw new ProtocolError('Conflicting signed gas metering reports');
      }
      gasUsed=used;unitPrice=price;
    }
    const cost=gasUsed*unitPrice;
    const spendable=this.#balances.get(payer)||0n;
    if(cost>spendable)throw new ProtocolError('Insufficient GAS-LAB test balance');
    const burned=cost*this.#burnBps/10000n;
    const networkShare=cost-burned;
    this.#balances.set(payer,spendable-cost);
    this.#burned+=burned;
    this.#networkFeePool+=networkShare;
    this.#totalGasUsed+=gasUsed;
    this.#nonces.set(payer,(this.#nonces.get(payer)||0n)+1n);
    const receipt={authorizationId,payer,blockHeight:this.#height.toString(),
      gasUsed:gasUsed.toString(),unitPrice:unitPrice.toString(),
      paid:cost.toString(),burned:burned.toString(),
      networkFeePoolAdded:networkShare.toString(),
      unit:'GAS_LAB_SIMULATION_ONLY',actualTransactionExecuted:false};
    this.#receipts.set(authorizationId,receipt);
    return structuredClone(receipt);
  }

  audit(){
    const spendable=[...this.#balances.values()].reduce((sum,v)=>sum+v,0n);
    if(spendable+this.#networkFeePool+this.#burned!==this.#initialSupply){
      throw new ProtocolError('GAS-LAB supply accounting violated');
    }
    return {unit:'GAS_LAB_SIMULATION_ONLY',height:this.#height.toString(),
      burnBasisPoints:this.#burnBps.toString(),totalGasUsed:this.#totalGasUsed.toString(),
      spendable:spendable.toString(),networkFeePool:this.#networkFeePool.toString(),
      cumulativeBurned:this.#burned.toString(),
      circulatingSupply:(this.#initialSupply-this.#burned).toString(),
      initialSupply:this.#initialSupply.toString(),gasCharges:this.#receipts.size,
      conserved:true,realGasMarketActive:false};
  }
}
