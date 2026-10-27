/** Isolated, deterministic DEV-CREDIT compute marketplace. NOT a ZNYT token or remote executor. */
import { createHash } from 'node:crypto';
import { validateGenesis, requiredValidatorQuorum } from './ledger.mjs';
import { MARKET_KINDS, verifyMarket } from './market-crypto.mjs';
import { DeviceNodeRegistry } from './device-registry.mjs';
import { ProtocolError, addressOf, assertAddress, digest, uint } from './pq.mjs';

const HEX64=/^[0-9a-f]{64}$/;
const MAX_JOBS=100;
const MAX_ACTIVE_RENTALS=1000;
const AI_ACCESS_REQUESTS_PER_EPOCH=20;
const AI_ACCESS_EPOCH_BLOCKS=10n;
const MAX_ZNYT_GAS_UNITS=10000000n;
const MAX_ZNYT_GAS_PRICE=1000000000n;
const RENTAL_SERVICES=new Set(['vps','ai-gpu']);

function boundedDecimal(value,name,min,max) {
  const n=uint(value,name,{min:BigInt(min)});
  if (n>BigInt(max)) throw new ProtocolError(`${name}: exceeds bounded market limit`);
  return Number(n);
}

export function hashWork(seed,iterations) {
  if (typeof seed!=='string' || !HEX64.test(seed)) throw new ProtocolError('Invalid compute seed');
  if (!Number.isInteger(iterations) || iterations<1 || iterations>10000) {
    throw new ProtocolError('Invalid bounded compute iterations');
  }
  let previous=Buffer.from(seed,'hex');
  for(let i=0;i<iterations;i++) previous=createHash('sha256').update(previous).digest();
  return previous.toString('hex');
}

export class ComputeMarket {
  #balances=new Map();
  #nonces=new Map();
  #providers=new Map();
  #jobs=new Map();
  #rentalOffers=new Map();
  #rentals=new Map();
  #chainShares=new Map();
  #aiShares=new Map();
  #aiAccessUsage=new Map();
  #govBalances=new Map();
  #govInitialSupply=0n;
  #govRewardReserve=0n;
  #govTreasury=0n;
  #validatorRewardPerVote=0n;
  #rewardedHeights=new Set();
  #govEnabled=false;
  #economyUnit='GOV_LAB_NOT_REAL_TOKEN';
  #unifiedZnyt=false;
  #znytGasBurnBps=0n;
  #znytGasBurned=0n;
  #znytGasFeePool=0n;
  #znytGasUsed=0n;
  #znytGasReceipts=new Map();
  #znytChargedOperations=new Set();
  #requireExecutionProof=false;
  #rentalVerifiedWork=new Map();
  #rentalWorkIterations=new Map();
  #rentalVerifiedHostedServices=new Map();
  #validators=new Set();
  #initialSupply=0n;
  #treasury=0n;
  #height=0n;

  constructor(genesis,{minStake='100',deviceRegistry=null,governance=null,znyt=null}={}) {
    validateGenesis(genesis);
    if(governance!==null&&znyt!==null){
      throw new ProtocolError('Use exactly one of legacy governance or unified ZNYT-LAB configuration');
    }
    if(deviceRegistry!==null&&(!(deviceRegistry instanceof DeviceNodeRegistry)||
       deviceRegistry.chainId!==genesis.chainId)){
      throw new ProtocolError('Trusted same-chain device registry required');
    }
    this.deviceRegistry=deviceRegistry;
    this.chainId=genesis.chainId;
    this.minStake=uint(minStake,'minimum stake',{min:1n});
    this.#validators=new Set(genesis.validators.map(v=>addressOf(v.publicKey)));
    for(const {address,balance} of genesis.allocations){
      const amount=uint(balance,'DEV-CREDIT allocation');
      this.#balances.set(address,amount);
      this.#initialSupply+=amount;
    }
    const tokenConfig=znyt??governance;
    if(tokenConfig!==null){
      if(typeof tokenConfig!=='object'||!Array.isArray(tokenConfig.allocations)){
        throw new ProtocolError('Explicit research token allocations required');
      }
      this.#govEnabled=true;
      this.#unifiedZnyt=znyt!==null;
      if(this.#unifiedZnyt){
        this.#economyUnit='ZNYT_LAB_NOT_REAL_TOKEN';
        if(znyt.requireExecutionProof!==undefined&&typeof znyt.requireExecutionProof!=='boolean'){
          throw new ProtocolError('requireExecutionProof must be boolean');
        }
        this.#requireExecutionProof=znyt.requireExecutionProof??false;
        this.#znytGasBurnBps=uint(znyt.gasBurnBasisPoints??'2000','ZNYT burn basis points');
        if(this.#znytGasBurnBps>10000n){
          throw new ProtocolError('ZNYT simulated gas burn must be 0..10000 basis points');
        }
      }
      for(const entry of tokenConfig.allocations){
        assertAddress(entry.address);
        if(this.#govBalances.has(entry.address)){
          throw new ProtocolError('Duplicate research token allocation');
        }
        const amount=uint(entry.balance,'unified research token allocation');
        this.#govBalances.set(entry.address,amount);
        this.#govInitialSupply+=amount;
      }
      this.#govRewardReserve=uint(tokenConfig.validatorRewardReserve??'0',
        'pre-funded validator research reward reserve');
      this.#validatorRewardPerVote=uint(tokenConfig.validatorRewardPerVote??'1',
        'validator research reward per verified signature',{min:1n});
      if(this.#validatorRewardPerVote>1000n){
        throw new ProtocolError('Validator research reward rate exceeds limit');
      }
      this.#govInitialSupply+=this.#govRewardReserve;
    }
  }

  #verify(signed,kind){return verifyMarket(signed,kind,this.chainId);}
  #balanceOf(address){return this.#balances.get(address)||0n;}
  #nonceOf(address){return this.#nonces.get(address)||0n;}
  #requireNonce(address,nonce){
    if(uint(nonce,'market nonce')!==this.#nonceOf(address)) {
      throw new ProtocolError('Market nonce/replay rejected');
    }
  }
  #debit(address,amount){
    if(this.#balanceOf(address)<amount) throw new ProtocolError('Insufficient DEV-CREDIT balance');
    this.#balances.set(address,this.#balanceOf(address)-amount);
  }
  #credit(address,amount){this.#balances.set(address,this.#balanceOf(address)+amount);}
  nextNonce(address){assertAddress(address);return this.#nonceOf(address).toString();}
  #govBalanceOf(address){return this.#govBalances.get(address)||0n;}
  #govDebit(address,amount){
    if(!this.#govEnabled)throw new ProtocolError('Governance research token is not configured');
    if(this.#govBalanceOf(address)<amount){
      throw new ProtocolError('Insufficient GOV-LAB research token balance');
    }
    this.#govBalances.set(address,this.#govBalanceOf(address)-amount);
  }
  #govCredit(address,amount){
    this.#govBalances.set(address,this.#govBalanceOf(address)+amount);
  }
  governanceBalance(address){assertAddress(address);return this.#govBalanceOf(address).toString();}
  znytBalance(address){
    if(!this.#unifiedZnyt)throw new ProtocolError('Unified ZNYT-LAB accounting not configured');
    assertAddress(address);
    return this.#govBalanceOf(address).toString();
  }

  chargeZnytGas(signedAuthorization,signedMeters){
    // A single simulated ZNYT balance now backs gas, rentals and validator
    // incentives. Meter signatures do NOT establish real L1 gas execution.
    if(!this.#unifiedZnyt)throw new ProtocolError('Unified ZNYT-LAB gas accounting not configured');
    const {signer:payer,payload:auth}=this.#verify(signedAuthorization,MARKET_KINDS.GAS_AUTH);
    this.#requireNonce(payer,auth.nonce);
    if(typeof auth.operationId!=='string'||!HEX64.test(auth.operationId)){
      throw new ProtocolError('Invalid ZNYT gas operation identifier');
    }
    const limit=uint(auth.gasLimit,'ZNYT gas limit',{min:1n});
    const maxPrice=uint(auth.maxUnitPrice,'ZNYT gas price maximum',{min:1n});
    const expiry=uint(auth.expiresAtHeight,'ZNYT gas expiry',{min:1n});
    if(limit>MAX_ZNYT_GAS_UNITS||maxPrice>MAX_ZNYT_GAS_PRICE||
        this.#height===0n||expiry<this.#height||expiry>this.#height+10000n){
      throw new ProtocolError('Invalid bounded ZNYT gas authorization');
    }
    const minimum=requiredValidatorQuorum(this.#validators.size);
    if(!Array.isArray(signedMeters)||signedMeters.length<minimum||
        signedMeters.length>this.#validators.size){
      throw new ProtocolError(`At least ${minimum} independent ZNYT gas validators required`);
    }
    const authId=digest('ZERONYTH_GAS_LAB_AUTH_ID_V1\0',JSON.stringify(signedAuthorization));
    if(this.#znytGasReceipts.has(authId))throw new ProtocolError('ZNYT gas operation already charged');
    // Nonce prevents replay of a signature; this also forbids charging the
    // same logical operation a second time with a freshly signed nonce.
    const operationKey=`${payer}:${auth.operationId}`;
    if(this.#znytChargedOperations.has(operationKey)){
      throw new ProtocolError('ZNYT logical gas operation already charged');
    }
    const signedValidators=new Set();
    let gasUsed=null,unitPrice=null;
    for(const signed of signedMeters){
      const {signer,payload:meter}=this.#verify(signed,MARKET_KINDS.GAS_METER);
      if(!this.#validators.has(signer)||signedValidators.has(signer)){
        throw new ProtocolError('Unknown or duplicated ZNYT gas validator');
      }
      signedValidators.add(signer);
      if(meter.authorizationId!==authId||
          uint(meter.blockHeight,'ZNYT gas meter height')!==this.#height){
        throw new ProtocolError('Unbound ZNYT gas meter certificate');
      }
      const used=uint(meter.gasUsed,'ZNYT measured gas',{min:1n});
      const price=uint(meter.unitPrice,'ZNYT measured unit price',{min:1n});
      if(used>limit||price>maxPrice||
          used>MAX_ZNYT_GAS_UNITS||price>MAX_ZNYT_GAS_PRICE){
        throw new ProtocolError('ZNYT gas meter exceeds customer authorization');
      }
      if(gasUsed!==null&&(gasUsed!==used||unitPrice!==price)){
        throw new ProtocolError('Conflicting validator ZNYT gas meter certificates');
      }
      gasUsed=used;unitPrice=price;
    }
    const paid=gasUsed*unitPrice;
    if(this.#govBalanceOf(payer)<paid){
      throw new ProtocolError('Insufficient unified ZNYT-LAB balance for gas');
    }
    const burned=paid*this.#znytGasBurnBps/10000n;
    const retained=paid-burned;
    this.#govDebit(payer,paid);
    this.#znytGasBurned+=burned;
    this.#znytGasFeePool+=retained;
    this.#znytGasUsed+=gasUsed;
    this.#nonces.set(payer,this.#nonceOf(payer)+1n);
    this.#znytChargedOperations.add(operationKey);
    const receipt={authorizationId:authId,payer,paid:paid.toString(),
      burned:burned.toString(),networkRewardPoolAdded:retained.toString(),
      gasUsed:gasUsed.toString(),unitPrice:unitPrice.toString(),
      paymentUnit:this.#economyUnit,realGasExecuted:false};
    this.#znytGasReceipts.set(authId,receipt);
    return structuredClone(receipt);
  }

  awardValidatorRound(signedAttestations){
    // Signature quorum for a *self-declared research block ID*. There is no
    // actual network-ledger finality proof or permissionless emission here.
    if(!this.#govEnabled)throw new ProtocolError('Governance research token is not configured');
    if(!Array.isArray(signedAttestations)||
        signedAttestations.length<requiredValidatorQuorum(this.#validators.size)||
        signedAttestations.length>this.#validators.size){
      throw new ProtocolError('Insufficient or excessive validator reward signatures');
    }
    if(this.#height===0n||this.#rewardedHeights.has(this.#height.toString())){
      throw new ProtocolError('Validator research reward height already used or unavailable');
    }
    const signers=new Set();
    let blockId=null;
    for(const signed of signedAttestations){
      const {signer,payload}=this.#verify(signed,MARKET_KINDS.VALIDATOR_REWARD);
      if(!this.#validators.has(signer)||signers.has(signer)){
        throw new ProtocolError('Unknown or repeated validator research signature');
      }
      if(uint(payload.height,'reward round height')!==this.#height||
          typeof payload.blockId!=='string'||!HEX64.test(payload.blockId)||
          (blockId!==null&&payload.blockId!==blockId)){
        throw new ProtocolError('Inconsistent validator research round');
      }
      blockId=payload.blockId;
      signers.add(signer);
    }
    const total=this.#validatorRewardPerVote*BigInt(signers.size);
    const paidFromGasPool=this.#unifiedZnyt&&this.#znytGasFeePool<total?
      this.#znytGasFeePool:(this.#unifiedZnyt?total:0n);
    const paidFromReserve=total-paidFromGasPool;
    if(this.#govRewardReserve<paidFromReserve){
      throw new ProtocolError('Pre-funded validator reward reserve exhausted');
    }
    this.#znytGasFeePool-=paidFromGasPool;
    this.#govRewardReserve-=paidFromReserve;
    for(const signer of signers)this.#govCredit(signer,this.#validatorRewardPerVote);
    this.#rewardedHeights.add(this.#height.toString());
    return {height:this.#height.toString(),blockId,
      rewardedValidators:signers.size,rewardPerValidator:this.#validatorRewardPerVote.toString(),
      totalReward:total.toString(),unit:this.#economyUnit,
      paidFromGasPool:paidFromGasPool.toString(),
      paidFromPrefundedReserve:paidFromReserve.toString(),
      actualConsensusFinalityVerified:false};
  }

  #rentedCapacity(address){
    const used={cpuCores:0,ramMiB:0,gpuCount:0};
    for(const rental of this.#rentals.values()){
      if(rental.status!=='reserved'||rental.provider!==address)continue;
      for(const field of Object.keys(used))used[field]+=rental.resources[field];
    }
    return used;
  }

  #chainReserved(address){
    const p=this.#providers.get(address);
    const share=this.#chainShares.get(address);
    if(!p||!share||share.expiresAtHeight<=this.#height){
      return {cpuMilliCores:0,ramMiB:0};
    }
    return {cpuMilliCores:Math.ceil(p.cpuCores*1000*share.cpuPercent/100),
      ramMiB:Math.ceil(p.ramMiB*share.cpuPercent/100)};
  }

  #aiReserved(address){
    const p=this.#providers.get(address);
    const share=this.#aiShares.get(address);
    if(!p||!share||share.expiresAtHeight<=this.#height){
      return {cpuMilliCores:0,ramMiB:0,gpuMilliUnits:0};
    }
    return {cpuMilliCores:Math.ceil(p.cpuCores*1000*share.aiPercent/100),
      ramMiB:Math.ceil(p.ramMiB*share.aiPercent/100),
      gpuMilliUnits:Math.ceil(p.gpuCount*1000*share.aiPercent/100)};
  }

  #dedicatedResources(address){
    const chain=this.#chainReserved(address),ai=this.#aiReserved(address);
    return {cpuMilliCores:chain.cpuMilliCores+ai.cpuMilliCores,
      ramMiB:chain.ramMiB+ai.ramMiB,gpuMilliUnits:ai.gpuMilliUnits};
  }

  #requireActiveSharingProvider(provider){
    const p=this.#providers.get(provider);
    if(!p||p.stake<this.minStake||p.expiresAtHeight<=this.#height){
      throw new ProtocolError('Only bonded, current compute providers can pledge capacity');
    }
    if(!(this.deviceRegistry instanceof DeviceNodeRegistry)||
        this.deviceRegistry.height!==this.#height.toString()||
        this.deviceRegistry.get(provider)?.heartbeat?.unmetered!==true||
        !this.deviceRegistry.assess(provider,{role:'compute',iterations:1}).eligible){
      throw new ProtocolError('Online trusted device registry required for node resource split');
    }
    return p;
  }

  #checkDedicatedCapacity(provider,chain,ai){
    const p=this.#providers.get(provider);
    const rented=this.#rentedCapacity(provider);
    if(rented.cpuCores*1000+p.activeJobs*1000+
        chain.cpuMilliCores+ai.cpuMilliCores>p.cpuCores*1000||
        rented.ramMiB+p.activeJobs*512+chain.ramMiB+ai.ramMiB>p.ramMiB||
        rented.gpuCount*1000+ai.gpuMilliUnits>p.gpuCount*1000){
      throw new ProtocolError('Resource sharing would overbook rentals or existing jobs');
    }
  }

  publishChainShare(signedAllocation){
    // Reserve a signed *budget* for future L1 preverification/relay work.
    // This does not execute work or change validator quorum/consensus.
    const {signer:provider,payload}=this.#verify(signedAllocation,MARKET_KINDS.CHAIN_SHARE);
    this.#requireNonce(provider,payload.nonce);
    const p=this.#requireActiveSharingProvider(provider);
    const percent=boundedDecimal(payload.cpuPercent,'chain CPU percent',0,80);
    const expiry=uint(payload.expiresAtHeight,'chain share expiry',{min:1n});
    if(expiry<=this.#height||expiry>this.#height+10000n||expiry>p.expiresAtHeight){
      throw new ProtocolError('Chain share must expire inside provider attestation');
    }
    const cpuMilliCores=Math.ceil(p.cpuCores*1000*percent/100);
    const ramMiB=Math.ceil(p.ramMiB*percent/100);
    const ai=this.#aiReserved(provider);
    const aiPercent=this.#aiShares.get(provider)?.expiresAtHeight>this.#height?
      this.#aiShares.get(provider).aiPercent:0;
    if(percent+aiPercent>100)throw new ProtocolError('L1 and AI shares exceed 100 percent');
    this.#checkDedicatedCapacity(provider,{cpuMilliCores,ramMiB},ai);
    this.#chainShares.set(provider,{cpuPercent:percent,expiresAtHeight:expiry});
    this.#nonces.set(provider,this.#nonceOf(provider)+1n);
    return {provider,cpuPercent:percent,cpuMilliCores,ramMiB,
      rentalCpuMilliCoresRemaining:p.cpuCores*1000-cpuMilliCores,
      expiresAtHeight:expiry.toString(),
      actualChainAcceleration:false,consensusQuorumUnchanged:true};
  }

  chainShare(address){
    assertAddress(address);
    const share=this.#chainShares.get(address);
    if(!share)return null;
    const resources=this.#chainReserved(address);
    return {provider:address,cpuPercent:share.cpuPercent,
      expiresAtHeight:share.expiresAtHeight.toString(),
      active:share.expiresAtHeight>this.#height&&share.cpuPercent>0,
      ...resources,actualChainAcceleration:false};
  }

  chainAccelerationStatus(){
    let participants=0,cpuMilliCores=0,ramMiB=0;
    for(const [address,share] of this.#chainShares){
      if(share.cpuPercent===0||share.expiresAtHeight<=this.#height)continue;
      const resources=this.#chainReserved(address);
      participants++;
      cpuMilliCores+=resources.cpuMilliCores;
      ramMiB+=resources.ramMiB;
    }
    return {optedInProviders:participants,cpuMilliCores,ramMiB,
      role:'FUTURE_TX_PREVERIFICATION_AND_RELAY_CAPACITY',
      realRemoteWorkers:0,measuredTpsGain:null,validatorQuorumChanged:false};
  }

  publishAiShare(signedAllocation){
    // Reserve CPU/RAM and theoretical GPU duty-cycle fractions for future
    // native model fine-tuning/inference; NO model is run or trained.
    const {signer:provider,payload}=this.#verify(signedAllocation,MARKET_KINDS.AI_SHARE);
    this.#requireNonce(provider,payload.nonce);
    const p=this.#requireActiveSharingProvider(provider);
    const percent=boundedDecimal(payload.aiPercent,'AI growth percent',0,80);
    const expiry=uint(payload.expiresAtHeight,'AI resource share expiry',{min:1n});
    if(expiry<=this.#height||expiry>this.#height+10000n||expiry>p.expiresAtHeight){
      throw new ProtocolError('AI share must expire inside provider attestation');
    }
    const chain=this.#chainReserved(provider);
    const chainPercent=this.#chainShares.get(provider)?.expiresAtHeight>this.#height?
      this.#chainShares.get(provider).cpuPercent:0;
    if(chainPercent+percent>100)throw new ProtocolError('L1 and AI shares exceed 100 percent');
    const ai={cpuMilliCores:Math.ceil(p.cpuCores*1000*percent/100),
      ramMiB:Math.ceil(p.ramMiB*percent/100),
      gpuMilliUnits:Math.ceil(p.gpuCount*1000*percent/100)};
    this.#checkDedicatedCapacity(provider,chain,ai);
    this.#aiShares.set(provider,{aiPercent:percent,expiresAtHeight:expiry});
    this.#nonces.set(provider,this.#nonceOf(provider)+1n);
    return {provider,aiPercent:percent,...ai,
      expiresAtHeight:expiry.toString(),actualModelTraining:false};
  }

  aiGrowthStatus(){
    let participants=0,cpuMilliCores=0,ramMiB=0,gpuMilliUnits=0;
    for(const [address,share] of this.#aiShares){
      if(share.aiPercent===0||share.expiresAtHeight<=this.#height)continue;
      const resources=this.#aiReserved(address);
      participants++;
      cpuMilliCores+=resources.cpuMilliCores;
      ramMiB+=resources.ramMiB;
      gpuMilliUnits+=resources.gpuMilliUnits;
    }
    return {optedInProviders:participants,cpuMilliCores,ramMiB,gpuMilliUnits,
      purpose:'FUTURE_COMMUNITY_GENERATIVE_AI_TRAINING_AND_INFERENCE',
      actualTrainingRuns:0,measuredModelQualityGain:null};
  }

  nodeResourceAllocation(address){
    assertAddress(address);
    const p=this.#providers.get(address);
    if(!p)return null;
    const chain=this.#chainShares.get(address),ai=this.#aiShares.get(address);
    const l1Percent=chain?.expiresAtHeight>this.#height?chain.cpuPercent:0;
    const aiPercent=ai?.expiresAtHeight>this.#height?ai.aiPercent:0;
    return {provider:address,l1Percent,aiPercent,
      rentalPercentUnreserved:100-l1Percent-aiPercent,
      l1:this.#chainReserved(address),ai:this.#aiReserved(address),
      timeSlicingOrProvisioningImplemented:false};
  }

  #eligibleAiProvider(address){
    const p=this.#providers.get(address);
    if(!p||p.stake<this.minStake||p.expiresAtHeight<=this.#height){
      return false;
    }
    if(!(this.deviceRegistry instanceof DeviceNodeRegistry)||
        this.deviceRegistry.height!==this.#height.toString())return false;
    const device=this.deviceRegistry.get(address);
    return !!device&&['server','desktop'].includes(device.profile.deviceClass)&&
      device.profile.runtime==='native'&&device.profile.role==='compute'&&
      device.heartbeat?.unmetered===true&&
      this.deviceRegistry.assess(address,{role:'compute',iterations:1}).eligible;
  }

  aiProviderAccess(address){
    assertAddress(address);
    const eligible=this.#eligibleAiProvider(address);
    const epoch=(this.#height/AI_ACCESS_EPOCH_BLOCKS).toString();
    const record=this.#aiAccessUsage.get(address);
    const used=record?.epoch===epoch?record.requests.size:0;
    return {provider:address,eligible,freeResearchRequestsPerEpoch:AI_ACCESS_REQUESTS_PER_EPOCH,
      epoch,used,remaining:eligible?AI_ACCESS_REQUESTS_PER_EPOCH-used:0,
      providerAccessGranted:eligible,realInferenceAvailable:false};
  }

  requestProviderAi(signedRequest){
    // A signed future-inference access entitlement, not an AI completion.
    // Never store a user prompt or report text as if it was AI-generated.
    const {signer:provider,payload}=this.#verify(signedRequest,MARKET_KINDS.AI_ACCESS);
    this.#requireNonce(provider,payload.nonce);
    if(!this.#eligibleAiProvider(provider)){
      throw new ProtocolError('AI entitlement requires an active bonded native node provider');
    }
    if(typeof payload.requestId!=='string'||!HEX64.test(payload.requestId)){
      throw new ProtocolError('Invalid private AI access request identifier');
    }
    const epoch=(this.#height/AI_ACCESS_EPOCH_BLOCKS).toString();
    const previous=this.#aiAccessUsage.get(provider);
    const requests=previous?.epoch===epoch?previous.requests:new Set();
    if(requests.has(payload.requestId)){
      throw new ProtocolError('Duplicate AI access request identifier');
    }
    if(requests.size>=AI_ACCESS_REQUESTS_PER_EPOCH){
      throw new ProtocolError('Provider research AI usage quota exceeded');
    }
    requests.add(payload.requestId);
    this.#aiAccessUsage.set(provider,{epoch,requests});
    this.#nonces.set(provider,this.#nonceOf(provider)+1n);
    return {provider,requestId:payload.requestId,accessGranted:true,
      epoch,remaining:AI_ACCESS_REQUESTS_PER_EPOCH-requests.size,
      actualModelResponse:null,simulationOnly:true};
  }

  publishRentalOffer(signedOffer){
    // Merely records an authenticated *claim*; it NEVER provisions a VM,
    // allocates a GPU, exposes a network port or executes customer code.
    if(!this.#govEnabled){
      throw new ProtocolError('Governance research token is not configured');
    }
    const {signer:provider,payload}=this.#verify(signedOffer,MARKET_KINDS.RENT_OFFER);
    this.#requireNonce(provider,payload.nonce);
    const p=this.#providers.get(provider);
    if(!p||p.stake<this.minStake||p.expiresAtHeight<=this.#height){
      throw new ProtocolError('Only bonded, attested, currently valid providers can rent');
    }
    if(!(this.deviceRegistry instanceof DeviceNodeRegistry)){
      throw new ProtocolError('Trusted device registry required for resource rental');
    }
    if(this.deviceRegistry.height!==this.#height.toString()){
      throw new ProtocolError('Rental registry and market height must agree');
    }
    const device=this.deviceRegistry.get(provider);
    if(!device||!['server','desktop'].includes(device.profile.deviceClass)||
        device.profile.runtime!=='native'||device.profile.role!=='compute'||
        device.heartbeat?.unmetered!==true||
        !this.deviceRegistry.assess(provider,{role:'compute',iterations:1}).eligible){
      throw new ProtocolError('Only active native server/desktop compute nodes may offer rentals');
    }
    if(!RENTAL_SERVICES.has(payload.service))throw new ProtocolError('Unsupported resource rental service');
    const resources={
      cpuCores:boundedDecimal(payload.cpuCores,'cpuCores',1,64),
      ramMiB:boundedDecimal(payload.ramMiB,'ramMiB',512,1048576),
      storageGiB:boundedDecimal(payload.storageGiB,'storageGiB',0,65536),
      gpuCount:boundedDecimal(payload.gpuCount,'gpuCount',0,8),
      vramMiB:boundedDecimal(payload.vramMiB,'vramMiB',0,1048576),
    };
    if(resources.cpuCores>p.cpuCores||resources.ramMiB>p.ramMiB||
        resources.gpuCount>p.gpuCount){
      throw new ProtocolError('Rental offer exceeds validator-attested provider capacity');
    }
    const dedicated=this.#dedicatedResources(provider);
    if(resources.cpuCores*1000+dedicated.cpuMilliCores>p.cpuCores*1000||
        resources.ramMiB+dedicated.ramMiB>p.ramMiB||
        resources.gpuCount*1000+dedicated.gpuMilliUnits>p.gpuCount*1000){
      throw new ProtocolError('Rental offer overlaps dedicated L1 or AI resource share');
    }
    if(payload.service==='vps'&&
        (resources.gpuCount!==0||resources.vramMiB!==0||resources.storageGiB<10)){
      throw new ProtocolError('VPS offer requires disk and cannot request GPU');
    }
    if(payload.service==='ai-gpu'&&
        (resources.gpuCount<1||resources.vramMiB<1024)){
      throw new ProtocolError('AI GPU offer requires attested GPU count and declared VRAM');
    }
    const pricePerSlot=uint(payload.pricePerSlot,'rental price per slot',{min:1n});
    const maxSlots=boundedDecimal(payload.maxSlots,'rental max slots',1,1000);
    const expiry=uint(payload.expiresAtHeight,'rental offer expiry',{min:1n});
    if(expiry<=this.#height||expiry>this.#height+10000n||expiry>p.expiresAtHeight){
      throw new ProtocolError('Rental offer must expire within bonded provider attestation');
    }
    const offerId=digest('ZERONYTH_RESOURCE_RENT_OFFER_ID_V1\0',JSON.stringify(signedOffer));
    if(this.#rentalOffers.has(offerId))throw new ProtocolError('Duplicate resource offer');
    // Per-provider rate limit bounds retained claims without imposing a global
    // fixed limit on the number of participating nodes.
    const advertised=[...this.#rentalOffers.values()].filter(offer=>
      offer.provider===provider&&offer.expiry>this.#height).length;
    if(advertised>=8)throw new ProtocolError('Active offer limit per provider reached');
    this.#rentalOffers.set(offerId,{provider,service:payload.service,resources,
      pricePerSlot,maxSlots,expiry});
    this.#nonces.set(provider,this.#nonceOf(provider)+1n);
    return {offerId,provider,service:payload.service,pricePerSlot:pricePerSlot.toString(),
      maxSlots,actualProvisioning:false,hardwareMeasurementVerified:false};
  }

  reserveRental(signedRequest){
    if(!this.#govEnabled){
      throw new ProtocolError('Governance research token is not configured');
    }
    const {signer:customer,payload}=this.#verify(signedRequest,MARKET_KINDS.RENT_REQUEST);
    this.#requireNonce(customer,payload.nonce);
    if(typeof payload.offerId!=='string'||!HEX64.test(payload.offerId)){
      throw new ProtocolError('Invalid resource offer ID');
    }
    const offer=this.#rentalOffers.get(payload.offerId);
    if(!offer||offer.expiry<=this.#height)throw new ProtocolError('Rental offer unavailable or expired');
    if(customer===offer.provider)throw new ProtocolError('Self-rental rejected');
    const slots=boundedDecimal(payload.slots,'rental slots',1,1000);
    if(slots>offer.maxSlots||this.#height+BigInt(slots)>offer.expiry){
      throw new ProtocolError('Rental term exceeds advertised availability');
    }
    const provider=this.#providers.get(offer.provider);
    if(!provider||provider.expiresAtHeight<=this.#height+BigInt(slots)||
        provider.stake<this.minStake){
      throw new ProtocolError('Provider bonded capacity cannot cover rental term');
    }
    if(this.deviceRegistry?.height!==this.#height.toString()||
        this.deviceRegistry?.get(offer.provider)?.heartbeat?.unmetered!==true||
        !this.deviceRegistry?.assess(offer.provider,{role:'compute',iterations:1}).eligible){
      throw new ProtocolError('Rental provider must be actively available');
    }
    const used=this.#rentedCapacity(offer.provider);
    const dedicated=this.#dedicatedResources(offer.provider);
    if((used.cpuCores+provider.activeJobs+offer.resources.cpuCores)*1000+
        dedicated.cpuMilliCores>provider.cpuCores*1000||
        used.ramMiB+provider.activeJobs*512+offer.resources.ramMiB+
          dedicated.ramMiB>provider.ramMiB||
        (used.gpuCount+offer.resources.gpuCount)*1000+
          dedicated.gpuMilliUnits>provider.gpuCount*1000){
      throw new ProtocolError('Provider capacity already reserved; overbooking blocked');
    }
    if([...this.#rentals.values()].filter(r=>r.status==='reserved').length>=MAX_ACTIVE_RENTALS){
      throw new ProtocolError('Active rental accounting capacity reached');
    }
    const escrow=offer.pricePerSlot*BigInt(slots);
    if(escrow>this.#govBalanceOf(customer)){
      throw new ProtocolError(`Insufficient rental ${this.#unifiedZnyt?'ZNYT-LAB':'GOV-LAB'} balance`);
    }
    const rentalId=digest('ZERONYTH_RESOURCE_RENT_RESERVATION_ID_V1\0',
      JSON.stringify(signedRequest));
    if(this.#rentals.has(rentalId))throw new ProtocolError('Duplicate rental reservation');
    this.#govDebit(customer,escrow);
    this.#nonces.set(customer,this.#nonceOf(customer)+1n);
    this.#rentals.set(rentalId,{offerId:payload.offerId,provider:offer.provider,
      customer,service:offer.service,resources:{...offer.resources},escrow,
      pricePerSlot:offer.pricePerSlot,slots,startHeight:this.#height,
      deadline:this.#height+BigInt(slots),status:'reserved',charged:0n,paid:0n,refunded:0n});
    return {rentalId,service:offer.service,slots,escrow:escrow.toString(),
      paymentUnit:this.#economyUnit,
      status:'reserved',actualProvisioning:false};
  }

  settleRental(signedProviderUsage,signedCustomerApproval){
    // Prevent provider-only inflated billing: BOTH distinct ML-DSA identities
    // must sign the same metered reservation ID and usage units.
    const a=this.#verify(signedProviderUsage,MARKET_KINDS.RENT_METER);
    const b=this.#verify(signedCustomerApproval,MARKET_KINDS.RENT_METER);
    if(a.payload.rentalId!==b.payload.rentalId||
        a.payload.usedSlots!==b.payload.usedSlots){
      throw new ProtocolError('Independent rental usage approvals disagree');
    }
    const rental=this.#rentals.get(a.payload.rentalId);
    if(!rental||rental.status!=='reserved'||a.signer!==rental.provider||
        b.signer!==rental.customer){
      throw new ProtocolError('Rental usage must be approved by provider and customer');
    }
    if(this.#requireExecutionProof&&
        !this.#rentalVerifiedWork.get(a.payload.rentalId)?.size&&
        !this.#rentalVerifiedHostedServices.get(a.payload.rentalId)?.size){
      throw new ProtocolError('Verified executed work or hosted resource receipt required before ZNYT-LAB settlement');
    }
    const used=uint(a.payload.usedSlots,'approved rental slots',{min:1n});
    if(used>BigInt(rental.slots)||used>this.#height-rental.startHeight||
        this.#height>rental.deadline){
      throw new ProtocolError('Rental usage exceeds reserved or elapsed slots');
    }
    const charged=used*rental.pricePerSlot;
    const fee=charged/20n;
    const paid=charged-fee;
    const refunded=rental.escrow-charged;
    this.#govCredit(rental.provider,paid);
    this.#govCredit(rental.customer,refunded);
    this.#govTreasury+=fee;
    rental.status='mutually-settled';
    rental.charged=charged;rental.paid=paid;rental.refunded=refunded;
    return {rentalId:a.payload.rentalId,status:rental.status,
      usedSlots:used.toString(),charged:charged.toString(),paid:paid.toString(),
      fee:fee.toString(),refunded:refunded.toString(),realCurrencyPaid:false,
      paymentUnit:this.#economyUnit};
  }

  recordVerifiedRentalWork(signedPermit,signedOrder,signedReceipt){
    // A reproducible CPU-work receipt, not proof of a VM or of trusted
    // physical hardware. This gate is opt-in to preserve old simulations.
    if(!this.#unifiedZnyt)throw new ProtocolError('Unified ZNYT-LAB accounting required');
    const {signer:permittedProvider,payload:permit}=this.#verify(
      signedPermit,MARKET_KINDS.WORK_PERMIT);
    const {signer:orderCustomer,payload:order}=this.#verify(
      signedOrder,MARKET_KINDS.WORK_ORDER);
    const {signer:receiptProvider,payload:receipt}=this.#verify(
      signedReceipt,MARKET_KINDS.WORK_RECEIPT);
    if(permit.provider!==permittedProvider||receiptProvider!==permittedProvider||
        permit.customer!==orderCustomer||permit.rentalId!==order.rentalId||
        permit.rentalId!==receipt.rentalId){
      throw new ProtocolError('Work receipt identity and rental binding mismatch');
    }
    const rental=this.#rentals.get(permit.rentalId);
    if(!rental||rental.status!=='reserved'||rental.service!=='vps'||
        rental.provider!==permittedProvider||rental.customer!==orderCustomer||
        uint(permit.expiresAtUnixMs,'work permit expiry')<BigInt(Date.now())){
      throw new ProtocolError('Active authorized VPS rental required for work settlement');
    }
    const permitId=digest('ZERONYTH_WORK_PERMIT_ID_V1\0',JSON.stringify(signedPermit));
    const orderId=digest('ZERONYTH_WORK_ORDER_ID_V1\0',JSON.stringify(signedOrder));
    const iterations=uint(order.iterations,'work iterations',{min:1n});
    const maxJobs=uint(permit.maxJobs,'work permit maximum jobs',{min:1n});
    const maxIterations=uint(permit.maxTotalIterations,'work permit total iterations',{min:1n});
    const runTimeMs=uint(receipt.runTimeMs,'work execution time');
    if(iterations>10000n||maxJobs>32n||maxIterations>320000n||
        runTimeMs>10000n||
        uint(permit.expiresAtUnixMs,'work permit expiry')>
          BigInt(Date.now())+86400000n||
        !HEX64.test(order.jobId)||!HEX64.test(order.seed)||
        order.permitId!==permitId||receipt.permitId!==permitId||
        receipt.orderId!==orderId||receipt.jobId!==order.jobId||
        receipt.seed!==order.seed||receipt.iterations!==order.iterations||
        receipt.output!==hashWork(order.seed,Number(iterations))){
      throw new ProtocolError('Invalid or mismatched reproducible CPU work receipt');
    }
    const checked=this.#rentalVerifiedWork.get(permit.rentalId)||new Set();
    if(checked.has(orderId))throw new ProtocolError('Replayed CPU work receipt');
    if(BigInt(checked.size)>=maxJobs){
      throw new ProtocolError('CPU work receipt job count limit');
    }
    const usedIterations=this.#rentalWorkIterations.get(permit.rentalId)||0n;
    if(usedIterations+iterations>maxIterations){
      throw new ProtocolError('CPU work receipt total-iteration limit');
    }
    checked.add(orderId);
    this.#rentalVerifiedWork.set(permit.rentalId,checked);
    this.#rentalWorkIterations.set(permit.rentalId,usedIterations+iterations);
    return {rentalId:permit.rentalId,orderId,verifiedJobs:checked.size,
      workHashVerified:true,actualRemoteMachineAttested:false,
      realTokenTransferred:false};
  }

  verifiedRentalWork(rentalId){
    if(typeof rentalId!=='string'||!HEX64.test(rentalId))throw new ProtocolError('Invalid rental ID');
    return this.#rentalVerifiedWork.get(rentalId)?.size??0;
  }

  recordVerifiedHostedService(signedPermit,signedRequest,signedReceipt,output=''){
    if(!this.#unifiedZnyt)throw new ProtocolError('Unified ZNYT-LAB accounting required');
    const {signer:provider,payload:permit}=this.#verify(
      signedPermit,MARKET_KINDS.SERVICE_PERMIT);
    const {signer:customer,payload:request}=this.#verify(
      signedRequest,MARKET_KINDS.SERVICE_REQUEST);
    const {signer:receiptSigner,payload:receipt}=this.#verify(
      signedReceipt,MARKET_KINDS.SERVICE_RECEIPT);
    const rental=this.#rentals.get(permit.rentalId);
    if(!rental||rental.status!=='reserved'||rental.provider!==provider||
        rental.customer!==customer||rental.service!==permit.service||
        permit.provider!==provider||permit.customer!==customer||
        receiptSigner!==provider||request.rentalId!==permit.rentalId||
        receipt.rentalId!==permit.rentalId||receipt.service!==permit.service||
        receipt.operation!==request.operation||
        !['create','generate'].includes(request.operation)||
        (request.operation==='generate'&&permit.service!=='ai-gpu')||
        uint(permit.expiresAtUnixMs,'hosted permit expiry')<BigInt(Date.now())){
      throw new ProtocolError('Active signed hosted reservation and identities required');
    }
    const permitId=digest('ZERONYTH_HOSTED_SERVICE_PERMIT_ID_V1\0',
      JSON.stringify(signedPermit));
    const requestId=digest('ZERONYTH_HOSTED_SERVICE_REQUEST_ID_V1\0',
      JSON.stringify(signedRequest));
    if(receipt.permitId!==permitId||request.permitId!==permitId||
        receipt.requestId!==requestId||!HEX64.test(receipt.resourceId)||
        typeof output!=='string'||output.length>16000||
        (request.operation==='create'&&output!=='')||
        receipt.outputHash!==digest('ZERONYTH_HOSTED_SERVICE_OUTPUT_V1\0',
          JSON.stringify({requestId,resourceId:receipt.resourceId,output}))){
      throw new ProtocolError('Invalid provider hosted service response proof');
    }
    const checked=this.#rentalVerifiedHostedServices.get(permit.rentalId)||new Set();
    if(checked.has(requestId))throw new ProtocolError('Replayed hosted service receipt');
    if(checked.size>=32)throw new ProtocolError('Research hosted receipt cap exceeded');
    checked.add(requestId);
    this.#rentalVerifiedHostedServices.set(permit.rentalId,checked);
    return {rentalId:permit.rentalId,requestId,verifiedServices:checked.size,
      operation:request.operation,receiptSignatureVerified:true,
      remoteHardwareAttested:false,realTokenTransferred:false};
  }

  cancelRental(signedCancellation){
    const {signer:customer,payload}=this.#verify(signedCancellation,MARKET_KINDS.RENT_CANCEL);
    this.#requireNonce(customer,payload.nonce);
    const rental=this.#rentals.get(payload.rentalId);
    if(!rental||rental.status!=='reserved'||rental.customer!==customer||
        rental.startHeight!==this.#height){
      throw new ProtocolError('Only original customer may cancel before rental begins');
    }
    this.#govCredit(customer,rental.escrow);
    this.#nonces.set(customer,this.#nonceOf(customer)+1n);
    rental.refunded=rental.escrow;
    rental.status='cancel-refunded';
    return {rentalId:payload.rentalId,status:rental.status,refunded:rental.refunded.toString()};
  }

  rental(id){
    if(typeof id!=='string'||!HEX64.test(id))throw new ProtocolError('Invalid rental ID');
    const r=this.#rentals.get(id);
    return r?Object.fromEntries(Object.entries(r).map(([key,value])=>
      [key,typeof value==='bigint'?value.toString():structuredClone(value)])):null;
  }

  registerProvider(signedRegistration,capacityAttestations){
    const {signer:provider,payload}=this.#verify(signedRegistration,MARKET_KINDS.REGISTER);
    this.#requireNonce(provider,payload.nonce);
    if(this.#providers.has(provider)) throw new ProtocolError('Provider already registered');
    const cpuCores=boundedDecimal(payload.cpuCores,'cpuCores',1,64);
    const ramMiB=boundedDecimal(payload.ramMiB,'ramMiB',512,1048576);
    const gpuCount=boundedDecimal(payload.gpuCount,'gpuCount',0,8);
    const stake=uint(payload.stake,'stake',{min:this.minStake});
    const registrationId=digest('ZERONYTH_COMPUTE_REGISTRATION_ID_V1\0',JSON.stringify(signedRegistration));
    const minimum=requiredValidatorQuorum(this.#validators.size);
    if(!Array.isArray(capacityAttestations)||capacityAttestations.length<minimum||
        capacityAttestations.length>this.#validators.size){
      throw new ProtocolError(`At least ${minimum} independent capacity attestations required`);
    }
    const seen=new Set();
    let expiresAtHeight=null;
    for(const attestation of capacityAttestations){
      const {signer,payload:a}=this.#verify(attestation,MARKET_KINDS.CAPACITY);
      if(!this.#validators.has(signer)||seen.has(signer)) {
        throw new ProtocolError('Unknown or duplicate capacity attester');
      }
      seen.add(signer);
      if(a.provider!==provider||a.registrationId!==registrationId||
         a.cpuCores!==payload.cpuCores||a.ramMiB!==payload.ramMiB||
         a.gpuCount!==payload.gpuCount){
        throw new ProtocolError('Capacity attestation mismatches provider registration');
      }
      const expiry=uint(a.expiresAtHeight,'capacity expiry',{min:1n});
      if(expiry<=this.#height||expiry>this.#height+10000n){
        throw new ProtocolError('Invalid bounded capacity expiry');
      }
      if(expiresAtHeight!==null&&expiresAtHeight!==expiry){
        throw new ProtocolError('Conflicting capacity expiration attestations');
      }
      expiresAtHeight=expiry;
    }
    this.#debit(provider,stake);
    this.#providers.set(provider,{
      registrationId,cpuCores,ramMiB,gpuCount,stake,earned:0n,penalties:0n,
      expiresAtHeight,activeJobs:0,completedJobs:0,
    });
    this.#nonces.set(provider,this.#nonceOf(provider)+1n);
    return {provider,registrationId,attestationCount:seen.size,lockedStake:stake.toString()};
  }

  submitJob(signedRequest){
    const {signer:requester,payload}=this.#verify(signedRequest,MARKET_KINDS.REQUEST);
    this.#requireNonce(requester,payload.nonce);
    if(this.#jobs.size>=MAX_JOBS) throw new ProtocolError('Job storage limit reached');
    if(typeof payload.seed!=='string'||!HEX64.test(payload.seed)){
      throw new ProtocolError('Invalid hash-work seed');
    }
    const iterations=boundedDecimal(payload.iterations,'iterations',1,10000);
    const price=uint(payload.price,'job price',{min:1n});
    const expiresAtHeight=uint(payload.expiresAtHeight,'job expiry',{min:1n});
    if(expiresAtHeight<=this.#height||expiresAtHeight>this.#height+10000n){
      throw new ProtocolError('Invalid bounded job expiry');
    }
    const jobId=digest('ZERONYTH_COMPUTE_JOB_ID_V1\0',JSON.stringify(signedRequest));
    if(this.#jobs.has(jobId)) throw new ProtocolError('Duplicate compute job');
    this.#debit(requester,price);
    this.#nonces.set(requester,this.#nonceOf(requester)+1n);
    this.#jobs.set(jobId,{
      requester,seed:payload.seed,iterations,price,expiresAtHeight,
      provider:null,status:'queued',output:null,
    });
    return {jobId,escrow:price.toString(),status:'queued'};
  }

  assignJob(jobId){
    if(typeof jobId!=='string'||!HEX64.test(jobId)) throw new ProtocolError('Invalid job identifier');
    const job=this.#jobs.get(jobId);
    if(!job||job.status!=='queued') throw new ProtocolError('Job not available for assignment');
    if(this.#height>=job.expiresAtHeight) throw new ProtocolError('Job expired; settle timeout first');
    // Constant extra memory, instead of sorting and copying every registered
    // provider on each assignment; membership can grow across many batches.
    let provider=null,record=null;
    for(const [id,p] of this.#providers){
      if(p.expiresAtHeight<=this.#height||p.stake<this.minStake||
          (p.activeJobs+this.#rentedCapacity(id).cpuCores+1)*1000+
            this.#dedicatedResources(id).cpuMilliCores>p.cpuCores*1000||p.ramMiB<512||
          (this.deviceRegistry!==null&&!this.deviceRegistry.canRunHashJob(id,job.iterations)))continue;
      if(record===null||p.activeJobs<record.activeJobs||
          (p.activeJobs===record.activeJobs&&id.localeCompare(provider)<0)){
        provider=id;record=p;
      }
    }
    if(record===null) throw new ProtocolError('No attested provider capacity available');
    job.provider=provider;
    job.status='assigned';
    record.activeJobs++;
    return {jobId,provider,status:job.status};
  }

  submitResult(signedResult){
    const {signer,payload}=this.#verify(signedResult,MARKET_KINDS.RESULT);
    const job=this.#jobs.get(payload.jobId);
    if(!job||job.status!=='assigned'||job.provider!==signer) {
      throw new ProtocolError('Result must come from assigned, unsettled provider');
    }
    if(this.#height>=job.expiresAtHeight) throw new ProtocolError('Expired job cannot be rewarded');
    if(typeof payload.output!=='string'||!HEX64.test(payload.output)){
      throw new ProtocolError('Malformed compute result');
    }
    const record=this.#providers.get(signer);
    // Independent, deterministic recomputation: never pay just because a worker claims success.
    const expected=hashWork(job.seed,job.iterations);
    record.activeJobs--;
    if(payload.output!==expected){
      const penalty=record.stake<this.minStake?record.stake:this.minStake;
      record.stake-=penalty;
      record.penalties+=penalty;
      this.#treasury+=penalty;
      this.#credit(job.requester,job.price);
      job.status='fraud-refunded';
      return {jobId:payload.jobId,status:job.status,penalty:penalty.toString(),refund:job.price.toString()};
    }
    const fee=job.price/20n;
    const earned=job.price-fee;
    this.#credit(signer,earned);
    this.#treasury+=fee;
    record.earned+=earned;
    record.completedJobs++;
    job.output=expected;
    job.status='paid';
    return {jobId:payload.jobId,status:job.status,provider:signer,
      paid:earned.toString(),fee:fee.toString()};
  }

  advanceHeight(next){
    const height=uint(next,'testnet simulated block height',{min:1n});
    if(height<=this.#height||height>this.#height+10000n){
      throw new ProtocolError('Height must increase within bounded laboratory interval');
    }
    this.#height=height;
    const expired=[];
    for(const [jobId,job] of this.#jobs){
      if((job.status==='queued'||job.status==='assigned')&&job.expiresAtHeight<=height){
        if(job.status==='assigned') this.#providers.get(job.provider).activeJobs--;
        this.#credit(job.requester,job.price);
        job.status='timeout-refunded';
        expired.push(jobId);
      }
    }
    const refundedRentals=[];
    for(const [rentalId,rental] of this.#rentals){
      if(rental.status==='reserved'&&height>rental.deadline){
        this.#govCredit(rental.customer,rental.escrow);
        rental.refunded=rental.escrow;
        rental.status='timeout-refunded';
        refundedRentals.push(rentalId);
      }
    }
    return {height:height.toString(),refundedJobIds:expired,
      refundedRentalIds:refundedRentals};
  }

  balance(address){assertAddress(address);return this.#balanceOf(address).toString();}
  provider(address){
    assertAddress(address);
    const p=this.#providers.get(address);
    return p?Object.fromEntries(Object.entries(p).map(([key,val])=>
      [key,typeof val==='bigint'?val.toString():val])):null;
  }
  job(id){
    const j=this.#jobs.get(id);
    return j?Object.fromEntries(Object.entries(j).map(([key,val])=>
      [key,typeof val==='bigint'?val.toString():val])):null;
  }
  audit(){
    const spendable=[...this.#balances.values()].reduce((sum,v)=>sum+v,0n);
    const collateral=[...this.#providers.values()].reduce((sum,v)=>sum+v.stake,0n);
    const escrow=[...this.#jobs.values()].reduce((sum,j)=>
      sum+(['queued','assigned'].includes(j.status)?j.price:0n),0n);
    const rentalEscrow=[...this.#rentals.values()].reduce((sum,r)=>
      sum+(r.status==='reserved'?r.escrow:0n),0n);
    const current=spendable+collateral+escrow+this.#treasury;
    if(current!==this.#initialSupply) throw new ProtocolError('DEV-CREDIT conservation violated');
    const original={unit:'DEV_CREDIT_NON_TRANSFERABLE_SIMULATION',height:this.#height.toString(),
      providers:this.#providers.size,jobs:this.#jobs.size,
      spendable:spendable.toString(),collateral:collateral.toString(),
      escrow:escrow.toString(),treasury:this.#treasury.toString(),
      initialSupply:this.#initialSupply.toString(),conserved:true};
    // Preserve the legacy v1.8.19 audit shape for all existing consumers
    // when governance accounting was not explicitly opted into.
    if(!this.#govEnabled)return original;
    const govSpendable=[...this.#govBalances.values()].reduce((sum,v)=>sum+v,0n);
    if(govSpendable+rentalEscrow+this.#govRewardReserve+this.#govTreasury+
        this.#znytGasFeePool+this.#znytGasBurned!==this.#govInitialSupply){
      throw new ProtocolError('Research token supply conservation violated');
    }
    const report={unit:this.#economyUnit,spendable:govSpendable.toString(),
        escrow:rentalEscrow.toString(),validatorRewardReserve:this.#govRewardReserve.toString(),
        treasury:this.#govTreasury.toString(),initialSupply:this.#govInitialSupply.toString(),
        gasFeePool:this.#znytGasFeePool.toString(),cumulativeBurned:this.#znytGasBurned.toString(),
        circulatingSupply:(this.#govInitialSupply-this.#znytGasBurned).toString(),
        gasCharges:this.#znytGasReceipts.size,totalGasUsed:this.#znytGasUsed.toString(),
        realGasMarketActive:false,conserved:true};
    return {...original,rentals:this.#rentals.size,rentalEscrow:rentalEscrow.toString(),
      ...(this.#unifiedZnyt?{znyt:report}:{governance:report})};
  }
}
