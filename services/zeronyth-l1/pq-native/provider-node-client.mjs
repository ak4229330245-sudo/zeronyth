/** Opt-in node discovery client. Never starts mining, staking, VMs or GPUs. */
import {availableParallelism,cpus,totalmem,platform} from 'node:os';
import {createPublicKey} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {MARKET_KINDS,signMarket} from './market-crypto.mjs';
import {addressOf,ProtocolError} from './pq.mjs';

const execFileAsync=promisify(execFile);

function resourcePercent(value,name){
  if(!Number.isInteger(value)||value<0||value>100){
    throw new ProtocolError(`${name} must be a whole percent 0..100`);
  }
  return value;
}

export async function detectNodeHardware(){
  const cpuCores=Math.max(1,Math.min(128,availableParallelism()));
  const ramMiB=Math.max(512,Math.min(1048576,Math.floor(totalmem()/1048576)));
  let gpuCount=0,gpuSummary='not-detected';
  try{
    const {stdout}=await execFileAsync('nvidia-smi',[
      '--query-gpu=name,memory.total','--format=csv,noheader,nounits'],{
      timeout:2000,maxBuffer:4096,windowsHide:true});
    const entries=stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    gpuCount=Math.min(16,entries.length);
    if(gpuCount)gpuSummary=entries.slice(0,16).join(' | ').slice(0,256);
  }catch{/* explicitly unknown/no supported GPU found; do not fabricate */}
  return {cpuCores,ramMiB,gpuCount,gpuSummary,platform:platform(),
    gpuIndependentVerification:false};
}

export async function sampleCpuLoad(durationMs=150){
  if(!Number.isInteger(durationMs)||durationMs<25||durationMs>2000){
    throw new ProtocolError('CPU sample duration must be 25..2000ms');
  }
  const snapshot=()=>cpus().reduce((out,cpu)=>{
    out.idle+=cpu.times.idle;
    out.total+=Object.values(cpu.times).reduce((sum,time)=>sum+time,0);
    return out;
  },{idle:0,total:0});
  const before=snapshot();
  await new Promise(resolve=>setTimeout(resolve,durationMs));
  const after=snapshot();
  const delta=after.total-before.total;
  return delta>0?Math.max(0,Math.min(100,
    Math.round(100*(1-(after.idle-before.idle)/delta)))):0;
}

export class ProviderNodeClient {
  #key;
  #fetch;
  #hardware;
  #clock;

  constructor({chainId,coordinatorUrl,privateKey,
    deviceClass='desktop',l1Percent=20,aiPercent=20,rentalPercent=60,
    fetchImpl=fetch,detectHardware=detectNodeHardware,
    loadSample=sampleCpuLoad,clock=()=>Date.now()}={}){
    if(typeof chainId!=='string'||!/^\d+$/.test(chainId)||
        privateKey?.asymmetricKeyType!=='ml-dsa-65'||privateKey?.type!=='private'||
        !['desktop','laptop','server'].includes(deviceClass)||
        typeof fetchImpl!=='function'||typeof detectHardware!=='function'||
        typeof loadSample!=='function'||typeof clock!=='function'){
      throw new ProtocolError('Node join requires a signed identity and explicit device configuration');
    }
    const url=new URL(coordinatorUrl);
    const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    if((url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))||
        url.username||url.password||url.search||url.hash||url.pathname!=='/'){
      throw new ProtocolError('Coordinator requires HTTPS or loopback HTTP with no embedded credentials');
    }
    const allocated=[l1Percent,aiPercent,rentalPercent].map((n,i)=>resourcePercent(n,
      ['L1','AI','rental'][i]));
    if(allocated.reduce((s,x)=>s+x,0)!==100){
      throw new ProtocolError('L1, AI and rental shares must total 100%');
    }
    this.chainId=chainId;
    this.address=addressOf(createPublicKey(privateKey).export({
      format:'der',type:'spki'}).toString('base64'));
    this.coordinatorUrl=url.origin;
    this.deviceClass=deviceClass;
    [this.l1Percent,this.aiPercent,this.rentalPercent]=allocated;
    this.#key=privateKey;this.#fetch=fetchImpl;
    this.#hardware=detectHardware;this.#clock=clock;
    this.#load=loadSample;
  }

  #load;
  async #request(path,options){
    let response;
    try{response=await this.#fetch(`${this.coordinatorUrl}${path}`,{
      ...options,signal:AbortSignal.timeout(8000)});}
    catch{throw new ProtocolError('Node coordinator unavailable');}
    let result;
    try{result=await response.json();}
    catch{throw new ProtocolError('Malformed coordinator response');}
    if(!response.ok)throw new ProtocolError(result.error||'Node discovery request rejected');
    return result;
  }

  async #nonce(){
    const state=await this.#request(`/v1/node/nonce?address=${this.address}`);
    if(!/^(0|[1-9]\d{0,38})$/.test(state.nextNonce||'')){
      throw new ProtocolError('Invalid coordinator node nonce');
    }
    return state.nextNonce;
  }

  async #send(path,signed){
    return this.#request(path,{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify(signed)});
  }

  async joinOnce(){
    const hardware=await this.#hardware();
    const cpuCores=Math.trunc(hardware.cpuCores),ramMiB=Math.trunc(hardware.ramMiB);
    const gpuCount=Math.trunc(hardware.gpuCount);
    if(!Number.isFinite(cpuCores)||!Number.isFinite(ramMiB)||
        !Number.isFinite(gpuCount)||
        typeof hardware.gpuSummary!=='string'){
      throw new ProtocolError('Invalid local hardware discovery');
    }
    const signed=signMarket({kind:MARKET_KINDS.NODE_JOIN,
      chainId:this.chainId,nonce:await this.#nonce(),
      issuedAtMs:String(this.#clock()),deviceClass:this.deviceClass,
      cpuCores:String(cpuCores),ramMiB:String(ramMiB),
      gpuCount:String(gpuCount),gpuSummary:hardware.gpuSummary,
      l1Percent:String(this.l1Percent),aiPercent:String(this.aiPercent),
      rentalPercent:String(this.rentalPercent),termsAccepted:true},this.#key);
    return this.#send('/v1/node/join',signed);
  }

  async pulseOnce(){
    const load=await this.#load();
    if(!Number.isInteger(load)||load<0||load>100){
      throw new ProtocolError('Invalid measured local CPU load');
    }
    const signed=signMarket({kind:MARKET_KINDS.NODE_PULSE,
      chainId:this.chainId,nonce:await this.#nonce(),
      issuedAtMs:String(this.#clock()),cpuLoadPct:String(load),
      gpuLoadPct:'unknown'},this.#key);
    return this.#send('/v1/node/pulse',signed);
  }
}
