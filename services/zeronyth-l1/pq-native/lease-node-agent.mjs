#!/usr/bin/env node
/** Local-only authenticated CPU node. Reach remotely only through an operator-managed tunnel. */
import {createPrivateKey} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {LeaseCpuNode} from './lease-cpu-node.mjs';

const [keyPath,chainId,rawPort='18888']=process.argv.slice(2);
if(!keyPath||!chainId||!/^(0|[1-9]\d{0,4})$/.test(rawPort)){
  process.stderr.write('Usage: node pq-native/lease-node-agent.mjs PRIVATE_PKCS8_PEM CHAIN_ID [LOOPBACK_PORT]\n');
  process.exitCode=2;
}else{
  try{
    const stat=lstatSync(keyPath);
    if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||
       (typeof process.getuid==='function'&&stat.uid!==process.getuid())){
      throw new Error('Private key must be an owned regular file with permissions 0600');
    }
    const providerPrivateKey=createPrivateKey(readFileSync(keyPath));
    const node=new LeaseCpuNode({chainId,providerPrivateKey,concurrentWorkers:2});
    const {server,url,address}=await node.startLoopbackServer({port:Number(rawPort)});
    process.stdout.write(JSON.stringify({ready:true,address,url,
      binding:'loopback-only',realVps:false,work:'fixed bounded sha256'})+'\n');
    for(const signal of ['SIGINT','SIGTERM']){
      process.once(signal,()=>server.close(()=>process.exit(0)));
    }
  }catch(error){
    process.stderr.write(`Cannot start research CPU provider: ${error.message}\n`);
    process.exitCode=1;
  }
}
