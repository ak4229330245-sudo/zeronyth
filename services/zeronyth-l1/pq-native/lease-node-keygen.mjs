#!/usr/bin/env node
/** Explicit research key creation; never overwrite an existing provider key. */
import {writeFileSync} from 'node:fs';
import {generateIdentity} from './pq.mjs';

const [destination,...unexpected]=process.argv.slice(2);
if(!destination||unexpected.length){
  process.stderr.write('Usage: node pq-native/lease-node-keygen.mjs /secure/path/provider-key.pem\n');
  process.exitCode=2;
}else{
  try{
    const identity=generateIdentity();
    const pem=identity.privateKey.export({format:'pem',type:'pkcs8'});
    writeFileSync(destination,pem,{flag:'wx',mode:0o600});
    process.stdout.write(JSON.stringify({address:identity.address,
      publicKey:identity.publicKey,privateKeyWritten:destination,
      note:'Register this exact provider public key in the same research market before offering leases. Never share private-key PEM.'})+'\n');
  }catch(error){
    process.stderr.write(`Cannot create provider research key: ${error.message}\n`);
    process.exitCode=1;
  }
}
