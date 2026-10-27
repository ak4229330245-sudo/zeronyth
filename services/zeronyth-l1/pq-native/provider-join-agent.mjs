#!/usr/bin/env node
/** Voluntarily run on hardware owner host; no remote command execution. */
import {createPrivateKey} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {ProviderNodeClient} from './provider-node-client.mjs';

const [configFile,flag]=process.argv.slice(2);
if(!configFile||!(flag===undefined||flag==='--once')){
  process.stderr.write('Usage: node pq-native/provider-join-agent.mjs /absolute/provider-config.json [--once]\n');
  process.exitCode=2;
}else{
  try{
    const config=JSON.parse(readFileSync(configFile,'utf8'));
    if(config.consent!==true){
      throw new Error('Provider must explicitly set consent:true after reviewing enrollment');
    }
    const stat=lstatSync(config.privateKeyFile);
    if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||
       (typeof process.getuid==='function'&&stat.uid!==process.getuid())){
      throw new Error('Private ML-DSA key requires owned regular file mode 0600');
    }
    const interval=config.heartbeatSeconds??30;
    if(!Number.isInteger(interval)||interval<10||interval>300){
      throw new Error('Heartbeat interval must be 10..300 seconds');
    }
    const client=new ProviderNodeClient({...config,
      privateKey:createPrivateKey(readFileSync(config.privateKeyFile))});
    const join=await client.joinOnce();
    process.stdout.write(JSON.stringify({node:client.address,join,
      info:'Discovery only; resources not scheduled; no ZNYT/AI automatically granted'})+'\n');
    if(flag!=='--once'){
      let stopped=false;
      const shutdown=()=>{stopped=true;process.exit(0);};
      process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
      const cycle=async()=>{
        if(stopped)return;
        try{
          const receipt=await client.pulseOnce();
          process.stdout.write(JSON.stringify({node:client.address,pulse:receipt})+'\n');
        }catch(error){
          process.stderr.write(`Node heartbeat rejected: ${error.message}\n`);
        }
        if(!stopped)setTimeout(()=>void cycle(),interval*1000);
      };
      setTimeout(()=>void cycle(),interval*1000);
    }
  }catch(error){
    process.stderr.write(`Cannot enroll resource provider: ${error.message}\n`);
    process.exitCode=1;
  }
}
