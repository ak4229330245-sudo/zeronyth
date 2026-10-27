#!/usr/bin/env node
/** Operator-only localhost gateway. Docker and Ollama are probed upon execution. */
import {createPrivateKey} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {HardenedContainerHost,LocalGenerativeAiHost} from './hosted-resource-backends.mjs';
import {HostedServicesNode} from './hosted-services-node.mjs';

const [configPath,...unexpected]=process.argv.slice(2);
if(!configPath||unexpected.length){
  process.stderr.write('Usage: node pq-native/hosted-node-agent.mjs /absolute/path/operator-config.json\n');
  process.exitCode=2;
}else{
  try{
    if(!isAbsolute(configPath))throw new Error('Operator config path must be absolute');
    const config=JSON.parse(readFileSync(configPath,'utf8'));
    const allowed=['chainId','keyFile','vpsImage','gpuImage','gpuDeviceIds',
      'allowedModels','maxCpus','maxMemoryMiB','port'];
    if(!config||typeof config!=='object'||Array.isArray(config)||
        Object.keys(config).some(key=>!allowed.includes(key))||
        typeof config.keyFile!=='string'||!isAbsolute(config.keyFile)){
      throw new Error('Invalid operator configuration');
    }
    const stats=lstatSync(config.keyFile);
    if(!stats.isFile()||stats.isSymbolicLink()||(stats.mode&0o077)!==0||
        (typeof process.getuid==='function'&&stats.uid!==process.getuid())){
      throw new Error('ML-DSA private key must be owned, regular and mode 0600');
    }
    const providerPrivateKey=createPrivateKey(readFileSync(config.keyFile));
    const containerHost=new HardenedContainerHost({
      vpsImage:config.vpsImage,gpuImage:config.gpuImage??null,
      gpuDeviceIds:config.gpuDeviceIds??[],maxCpus:config.maxCpus??2,
      maxMemoryMiB:config.maxMemoryMiB??4096});
    const modelHost=new LocalGenerativeAiHost({allowedModels:config.allowedModels});
    const node=new HostedServicesNode({chainId:config.chainId,
      providerPrivateKey,containerHost,modelHost});
    const {server,url,address}=await node.startLoopbackServer({port:config.port??18889});
    process.stdout.write(JSON.stringify({listening:true,address,url,
      binding:'127.0.0.1',dockerVerifiedAtBoot:false,
      ollamaVerifiedAtBoot:false,realZnytPaymentsEnabled:false})+'\n');
    for(const signal of ['SIGINT','SIGTERM']){
      process.once(signal,()=>server.close(()=>process.exit(0)));
    }
  }catch(error){
    process.stderr.write(`Hosted node could not start: ${error.message}\n`);
    process.exitCode=1;
  }
}
