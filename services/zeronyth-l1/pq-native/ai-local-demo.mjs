#!/usr/bin/env node
/** Local browser lab using real localhost Ollama if operator installed it. */
import {AiLocalPortal} from './ai-local-portal.mjs';
import {createAiTestnetLab} from './ai-testnet-fixture.mjs';

const [model='qwen2.5:0.5b',rawPort='18920']=process.argv.slice(2);
try{
  if(!/^\d+$/.test(rawPort))throw new Error('Local port must be numeric');
  const {session}=createAiTestnetLab({model});
  const portal=new AiLocalPortal({session,
    adminToken:process.env.ZERONYTH_AI_ADMIN_TOKEN});
  const {server,url}=await portal.start({port:Number(rawPort)});
  process.stdout.write(JSON.stringify({ready:true,url,model,
    payment:'ZNYT_LAB_LOCAL_TESTNET_SIMULATION',
    providerFreeAiQuota:'20 per 10-block epoch (test)',
    inference:'localhost Ollama must be separately installed',
    remotePromptEgress:false,realToken:false,realGpuAttested:false,
    pilotOnly:true})+'\n');
  for(const signal of ['SIGINT','SIGTERM']){
    process.once(signal,()=>server.close(()=>process.exit(0)));
  }
}catch(error){
  process.stderr.write(`Cannot start AI testnet lab: ${error.message}\n`);
  process.exitCode=1;
}
