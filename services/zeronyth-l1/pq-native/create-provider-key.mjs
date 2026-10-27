#!/usr/bin/env node
/** Create a new local ML-DSA key without overwriting existing credentials. */
import {writeFileSync} from 'node:fs';
import {generateIdentity} from './pq.mjs';

const [file]=process.argv.slice(2);
if(!file||!file.startsWith('/')){
  process.stderr.write('Usage: node pq-native/create-provider-key.mjs /absolute/provider-private.pem\n');
  process.exitCode=2;
}else{
  try{
    const id=generateIdentity();
    const pem=id.privateKey.export({format:'pem',type:'pkcs8'});
    writeFileSync(file,pem,{flag:'wx',mode:0o600});
    process.stdout.write(JSON.stringify({created:true,file,address:id.address,
      note:'Store private key only on owner host; never send it to coordinator'})+'\n');
  }catch(error){
    process.stderr.write(`Cannot create ML-DSA identity: ${error.message}\n`);
    process.exitCode=1;
  }
}
