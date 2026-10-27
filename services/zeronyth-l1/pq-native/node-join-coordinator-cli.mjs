#!/usr/bin/env node
/** Operator-managed coordinator bound to 127.0.0.1 only. */
import {NodeJoinCoordinator} from './node-join-coordinator.mjs';

const [chainId,journalPath,rawPort='18890']=process.argv.slice(2);
if(!chainId||!journalPath||!/^\d+$/.test(rawPort)){
  process.stderr.write('Usage: ZERONYTH_JOIN_ADMIN_TOKEN=<32+ chars> node pq-native/node-join-coordinator-cli.mjs CHAIN_ID /absolute/node-events.jsonl [LOOPBACK_PORT]\n');
  process.exitCode=2;
}else{
  try{
    const coordinator=new NodeJoinCoordinator({chainId,journalPath,
      adminToken:process.env.ZERONYTH_JOIN_ADMIN_TOKEN});
    const {server,url}=await coordinator.start({port:Number(rawPort)});
    process.stdout.write(JSON.stringify({ready:true,url,chainId,
      binding:'127.0.0.1 only',stage:'SIGNED_DISCOVERY_ONLY',
      znytIssued:false,validatorActivated:false,aiGranted:false})+'\n');
    for(const signal of ['SIGINT','SIGTERM']){
      process.once(signal,()=>server.close(()=>process.exit(0)));
    }
  }catch(error){
    process.stderr.write(`Cannot start node enrollment coordinator: ${error.message}\n`);
    process.exitCode=1;
  }
}
