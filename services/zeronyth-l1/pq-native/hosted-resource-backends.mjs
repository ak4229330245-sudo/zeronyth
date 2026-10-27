/** Operator-approved Docker workspaces and a local-only Ollama inference backend.
 * Real execution is opt-in and unavailable without rootless Docker / Ollama.
 * This is not a VM security boundary and does not implement payments.
 */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ProtocolError} from './pq.mjs';

const execFileAsync=promisify(execFile);
const HEX64=/^[0-9a-f]{64}$/;
const PINNED_IMAGE=/^[a-z0-9][a-z0-9._\/-]*@sha256:[0-9a-f]{64}$/;
const GPU_ID=/^GPU-[a-zA-Z0-9-]{16,80}$/;

async function defaultDockerRunner(args){
  const {stdout}=await execFileAsync('docker',args,{
    timeout:20000,maxBuffer:65536,windowsHide:true});
  return stdout.trim();
}

export class HardenedContainerHost {
  #runner;
  #images;
  #gpuIds;
  #active=new Map();
  #pending=new Map();
  #maxCpus;
  #maxMemoryMiB;

  constructor({vpsImage,gpuImage=null,gpuDeviceIds=[],maxCpus=2,
    maxMemoryMiB=4096,runner=defaultDockerRunner}={}){
    if(!PINNED_IMAGE.test(vpsImage||'')||
        (gpuImage!==null&&!PINNED_IMAGE.test(gpuImage))){
      throw new ProtocolError('Only operator-pinned Docker image digests are accepted');
    }
    if(!Array.isArray(gpuDeviceIds)||new Set(gpuDeviceIds).size!==gpuDeviceIds.length||
        gpuDeviceIds.some(id=>!GPU_ID.test(id))){
      throw new ProtocolError('Invalid provider-controlled GPU identifier allowlist');
    }
    if(!Number.isInteger(maxCpus)||maxCpus<1||maxCpus>64||
       !Number.isInteger(maxMemoryMiB)||maxMemoryMiB<512||maxMemoryMiB>262144||
       typeof runner!=='function'){
      throw new ProtocolError('Invalid operator resource limits');
    }
    this.#images={vps:vpsImage,'ai-gpu':gpuImage};
    this.#gpuIds=new Set(gpuDeviceIds);
    this.#maxCpus=maxCpus;
    this.#maxMemoryMiB=maxMemoryMiB;
    this.#runner=runner;
  }

  async #checkRootlessResourceControls(){
    let info;
    try{info=JSON.parse(await this.#runner(['info','--format','{{json .}}']));}
    catch{throw new ProtocolError('Rootless Docker Engine is not available');}
    const options=Array.isArray(info.SecurityOptions)?info.SecurityOptions:[];
    if(info.OSType!=='linux'||!options.some(x=>String(x).includes('rootless'))||
        String(info.CgroupVersion)!=='2'||info.CgroupDriver!=='systemd'){
      throw new ProtocolError('Rootless Linux Docker with cgroup v2/systemd is required');
    }
  }

  async create({rentalId,service,cpuCores,ramMiB,gpuDeviceId='none'}){
    if(!HEX64.test(rentalId)||!['vps','ai-gpu'].includes(service)||
        this.#active.has(rentalId)||this.#pending.has(rentalId)){
      throw new ProtocolError('Invalid or already active rental');
    }
    if(!Number.isInteger(cpuCores)||cpuCores<1||cpuCores>this.#maxCpus||
       !Number.isInteger(ramMiB)||ramMiB<512||ramMiB>this.#maxMemoryMiB){
      throw new ProtocolError('Requested CPU/RAM exceeds provider cap');
    }
    if(service==='ai-gpu'&&(!this.#images['ai-gpu']||!this.#gpuIds.has(gpuDeviceId))){
      throw new ProtocolError('No operator-approved GPU image or device');
    }
    if(service==='vps'&&gpuDeviceId!=='none')throw new ProtocolError('VPS cannot claim GPU');
    if(service==='ai-gpu'&&[...this.#active.values(),...this.#pending.values()]
        .some(x=>x.gpuDeviceId===gpuDeviceId)){
      throw new ProtocolError('GPU already exclusively reserved by this node');
    }
    this.#pending.set(rentalId,{service,gpuDeviceId});
    try{return await this.#createLocked({rentalId,service,cpuCores,ramMiB,gpuDeviceId});}
    finally{this.#pending.delete(rentalId);}
  }

  async #createLocked({rentalId,service,cpuCores,ramMiB,gpuDeviceId}){
    await this.#checkRootlessResourceControls();
    const image=this.#images[service];
    try{await this.#runner(['image','inspect',image,'--format','{{.Id}}']);}
    catch{throw new ProtocolError('Pinned image must already exist locally; no automatic pull');}
    const args=['create','--pull','never','--name',`qsh-${rentalId.slice(0,24)}`,
      '--label','zeronyth.managed=true','--label',`zeronyth.rental=${rentalId}`,
      '--network','none','--read-only','--cap-drop','ALL',
      '--security-opt','no-new-privileges:true','--user','65534:65534',
      '--pids-limit','64','--memory',`${ramMiB}m`,
      '--memory-swap',`${ramMiB}m`,'--cpus',String(cpuCores),
      '--tmpfs','/tmp:rw,noexec,nosuid,size=64m',
      '--restart','no'];
    if(service==='ai-gpu')args.push('--gpus',`device=${gpuDeviceId}`);
    args.push(image,'sleep','3600'); // immutable provider-supplied command
    let containerId=null;
    try{
      containerId=(await this.#runner(args)).trim();
      if(!HEX64.test(containerId))throw new ProtocolError('Invalid Docker container receipt');
      await this.#runner(['start',containerId]);
      const running=(await this.#runner(['inspect','--format',
        '{{.State.Running}}',containerId])).trim();
      if(running!=='true')throw new ProtocolError('Container did not remain running');
    }catch(error){
      if(containerId&&HEX64.test(containerId)){
        try{await this.#runner(['rm','-f',containerId]);}catch{/* best effort */}
      }
      throw error;
    }
    this.#active.set(rentalId,{containerId,service,cpuCores,ramMiB,gpuDeviceId});
    return {rentalId,containerId,service,cpuCores,ramMiB,
      gpuDeviceId,containerActuallyStarted:true,realVmCreated:false,
      actualGpuComputationVerified:false};
  }

  isActive(rentalId,service){
    const x=this.#active.get(rentalId);
    return Boolean(x&&x.service===service);
  }

  get(rentalId){
    const value=this.#active.get(rentalId);
    return value?{...value}:null;
  }

  async stop(rentalId){
    const existing=this.#active.get(rentalId);
    if(!existing)throw new ProtocolError('No managed rental container for stop');
    await this.#runner(['rm','-f',existing.containerId]);
    this.#active.delete(rentalId);
    return {rentalId,containerId:existing.containerId,stopped:true,
      dataPreserved:false};
  }
}

export class LocalGenerativeAiHost {
  #fetch;
  #models;
  constructor({allowedModels=[],fetchImpl=fetch}={}){
    if(!Array.isArray(allowedModels)||allowedModels.length===0||
        allowedModels.some(name=>typeof name!=='string'||
          !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,100}$/.test(name))||
        typeof fetchImpl!=='function'){
      throw new ProtocolError('Explicit operator-allowlisted Ollama model is required');
    }
    this.#models=new Set(allowedModels);
    this.#fetch=fetchImpl;
  }

  async generate({model,prompt,maxTokens}){
    if(!this.#models.has(model)||typeof prompt!=='string'||
        prompt.length<1||prompt.length>1600||
        !Number.isInteger(maxTokens)||maxTokens<1||maxTokens>256){
      throw new ProtocolError('Model, prompt or token budget is not approved');
    }
    let response;
    try{
      response=await this.#fetch('http://127.0.0.1:11434/api/generate',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({model,prompt,stream:false,
          options:{num_predict:maxTokens}}),
        signal:AbortSignal.timeout(60000)});
    }catch{throw new ProtocolError('Local Ollama model runtime is unavailable');}
    if(!response?.ok)throw new ProtocolError('Local Ollama generation failed');
    const reader=response.body?.getReader?.();
    if(!reader)throw new ProtocolError('Model runtime did not return a bounded response');
    let payload='',bytes=0;
    const decoder=new TextDecoder('utf-8',{fatal:true});
    while(true){
      const chunk=await reader.read();
      if(chunk.done)break;
      bytes+=chunk.value.byteLength;
      if(bytes>65536){await reader.cancel();
        throw new ProtocolError('Model response exceeds configured safety limit');}
      payload+=decoder.decode(chunk.value,{stream:true});
    }
    payload+=decoder.decode();
    let result;
    try{result=JSON.parse(payload);}catch{throw new ProtocolError('Malformed model response');}
    if(result.model!==model||result.done!==true||
        typeof result.response!=='string'||result.response.length>16000){
      throw new ProtocolError('Invalid model or unfinished generation result');
    }
    return {model,response:result.response,
      generatedTokens:Number.isSafeInteger(result.eval_count)?result.eval_count:null,
      localModelActuallyResponded:true,physicalGpuUsageVerified:false};
  }
}
