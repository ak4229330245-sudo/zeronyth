/** Disposable 4-process mutual-TLS validator benchmark on private loopback. */
import { spawn, execFileSync } from 'node:child_process';
import { createServer as createTcpServer } from 'node:net';
import { Agent, request as httpsRequest } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';
import { checkServerIdentity } from 'node:tls';
import { GENESIS_KIND, exportPrivatePem, generateIdentity, signTransaction } from './pq.mjs';

const count=Number(process.argv[2]||'128');
const blocks=Number(process.argv[3]||'3');
const switches=process.argv.slice(4);
const badPeerPin=switches.includes('--bad-peer-pin');
const badTransaction=switches.includes('--bad-transaction');
const singlePass=switches.includes('--single-pass');
if(!Number.isInteger(count)||count<1||count>1536||
   !Number.isInteger(blocks)||blocks<1||blocks>8||count*blocks>12000||
   switches.some(x=>!['--bad-peer-pin','--single-pass','--bad-transaction'].includes(x))||
   switches.length!==new Set(switches).size){
  throw Error('Usage: node pq-native/private-peer-demo.mjs [1..1536 transfers/block] [1..8 blocks] [--single-pass] [--bad-peer-pin] [--bad-transaction]');
}
const tmp=mkdtempSync(join(tmpdir(),'zeronyth-private-peers-'));
const children=[];
let clientAgents=[];
function openssl(args){execFileSync('openssl',args,{stdio:'ignore',timeout:15_000});}
async function freePort(){
  const server=createTcpServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
async function stop(child){
  if(child.exitCode!==null||child.signalCode!==null)return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Validator did not shut down cleanly')),5000);
    child.once('exit',()=>{clearTimeout(timer);resolve();});
    child.kill('SIGTERM');
  });
}
try{
  const caKey=join(tmp,'ca.key'),caCert=join(tmp,'ca.pem');
  openssl(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1',
    '-nodes','-keyout',caKey,'-out',caCert,'-days','1',
    '-subj','/CN=ZERONYTH Private Peer Demo CA',
    '-addext','basicConstraints=critical,CA:TRUE']);
  chmodSync(caKey,0o600);chmodSync(caCert,0o600);
  const validators=Array.from({length:4},()=>generateIdentity());
  const senders=Array.from({length:32},()=>generateIdentity());
  const recipients=Array.from({length:32},()=>generateIdentity());
  const ports=await Promise.all(validators.map(()=>freePort()));
  if(new Set(ports).size!==4)throw Error('Duplicate ephemeral validator port');
  const tls=[];
  for(let i=0;i<4;i++){
    const name=`validator-${i}.zeronyth.internal`;
    const key=join(tmp,`peer-${i}.key`),csr=join(tmp,`peer-${i}.csr`);
    const cert=join(tmp,`peer-${i}.pem`),ext=join(tmp,`peer-${i}.ext`);
    openssl(['req','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1',
      '-nodes','-keyout',key,'-out',csr,'-subj',`/CN=${name}`]);
    writeFileSync(ext,`basicConstraints=CA:FALSE\nsubjectAltName=DNS:${name}\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth,clientAuth\n`,{mode:0o600});
    openssl(['x509','-req','-in',csr,'-CA',caCert,'-CAkey',caKey,
      '-CAcreateserial','-out',cert,'-days','1','-extfile',ext]);
    chmodSync(key,0o600);chmodSync(cert,0o600);
    tls.push({name,key,cert,pin:new X509Certificate(readFileSync(cert)).fingerprint256});
  }
  const genesis={kind:GENESIS_KIND,chainId:'19127',
    validators:validators.map(v=>({publicKey:v.publicKey})),
    allocations:senders.map(sender=>({address:sender.address,balance:'1000000'}))};
  const genesisPath=join(tmp,'genesis.json');
  writeFileSync(genesisPath,JSON.stringify(genesis),{mode:0o600});
  const clients=tls.map((item,i)=>({validatorIndex:i,host:'127.0.0.1',
    port:ports[i],serverName:item.name,certSha256:item.pin}));
  const keyFiles=[],configs=[];
  for(let i=0;i<4;i++){
    const keyFile=join(tmp,`validator-${i}.pem`);
    writeFileSync(keyFile,exportPrivatePem(validators[i].privateKey),{mode:0o600});
    const configPath=join(tmp,`config-${i}.json`);
    const pinned=structuredClone(clients);
    if(badPeerPin&&i===0){
      // Deliberately swap two otherwise valid pins to test fail-closed TLS.
      [pinned[1].certSha256,pinned[2].certSha256]=
        [pinned[2].certSha256,pinned[1].certSha256];
    }
    writeFileSync(configPath,JSON.stringify({
      kind:'ZERONYTH_PQ_PRIVATE_VALIDATORS_V1',validatorIndex:i,
      listenAddress:'127.0.0.1',port:ports[i],
      tls:{certPath:tls[i].cert,keyPath:tls[i].key,caPath:caCert},peers:pinned,
    }),{mode:0o600});
    keyFiles.push(keyFile);configs.push(configPath);
  }
  const clientCert=readFileSync(tls[0].cert),clientKey=readFileSync(tls[0].key);
  const ca=readFileSync(caCert);
  const agents=tls.map((item,index)=>new Agent({
    keepAlive:true,maxSockets:2,ca,cert:clientCert,key:clientKey,
    rejectUnauthorized:true,minVersion:'TLSv1.3',
    checkServerIdentity:(hostname,cert)=>{
      const error=checkServerIdentity(item.name,cert);
      if(error)return error;
      if(cert.fingerprint256!==item.pin)return Error(`Unpinned validator ${index}`);
      return undefined;
    },
  }));
  clientAgents=agents;
  async function call(index,route,data){
    const json=data===undefined?null:Buffer.from(JSON.stringify(data));
    return new Promise((resolve,reject)=>{
      const req=httpsRequest({hostname:'127.0.0.1',port:ports[index],
        servername:tls[index].name,path:route,method:json?'POST':'GET',
        agent:agents[index],timeout:30_000,
        headers:json?{'Content-Type':'application/json','Content-Length':json.length}:{},
      },res=>{
        let chunks=[],size=0;
        res.on('data',part=>{
          size+=part.length;
          if(size>18*1024*1024){req.destroy(Error('Excessive response'));return;}
          chunks.push(part);
        });
        res.on('end',()=>{
          try{
            const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if(res.statusCode!==200)throw Error(`Validator ${index} ${route}: ${JSON.stringify(result)}`);
            resolve(result);
          }catch(error){reject(error);}
        });
        res.on('error',reject);
      });
      req.on('timeout',()=>req.destroy(Error('Demo TLS request timed out')));
      req.on('error',reject);
      req.end(json);
    });
  }
  for(let i=0;i<4;i++)children.push(spawn(process.execPath,[
    new URL('./server.mjs',import.meta.url).pathname,genesisPath,keyFiles[i],String(ports[i]),
  ],{stdio:'ignore',env:{...process.env,ZERONYTH_PQ_LOCAL_PEER_PORTS:undefined,
    ZERONYTH_PQ_REMOTE_CONFIG_PATH:configs[i],ZERONYTH_PQ_PARALLEL_EXEC:'0'}}));
  for(let i=0;i<4;i++){
    let ready=false;
    for(let retry=0;retry<50;retry++){
      try{await call(i,'/status');ready=true;break;}catch{await pause(100);}
    }
    if(!ready)throw Error(`Authenticated TLS validator ${i} did not start`);
  }
  const began=performance.now();
  let signingMs=0,admissionMs=0,consensusMs=0,lastHash='';
  const phases={proposer:0,peerVerificationAndVotes:0,durableFourNodeCommit:0};
  for(let height=0;height<blocks;height++){
    const beganSign=performance.now();
    const transactions=Array.from({length:count},(_,i)=>{
      const idx=height*count+i,account=idx%32;
      return signTransaction({chainId:'19127',nonce:String(Math.floor(idx/32)),
        to:recipients[account].address,value:'1',memo:'private authenticated TLS demo'},
      senders[account].privateKey);
    });
    if(badTransaction&&height===0){
      // A canonical-length forged ML-DSA signature must be rejected EVEN
      // when there was no independent mempool preverification request.
      transactions[0].signature=Buffer.alloc(3309).toString('base64');
    }
    signingMs+=performance.now()-beganSign;
    if(!singlePass){
      const beganAdmission=performance.now();
      const admissions=await Promise.all([0,1,2,3].map(i=>call(i,'/preverify',{transactions})));
      if(!admissions.every(r=>r.verifiedSignatures===count&&r.consensusApproved===false)){
        throw Error('All four independent validators must cryptographically preverify');
      }
      admissionMs+=performance.now()-beganAdmission;
    }
    const beganRound=performance.now();
    const result=await call(height%4,'/p2p/round',{transactions});
    consensusMs+=performance.now()-beganRound;
    if(result.height!==String(height+1)||result.verifiedValidators!==4||
        result.certificateVotes!==3)throw Error('Private TLS ML-DSA quorum failed');
    for(const key of Object.keys(phases)){
      if(!Number.isFinite(result.phaseMs?.[key])||result.phaseMs[key]<0){
        throw Error('Missing signed quorum phase timing');
      }
      phases[key]+=result.phaseMs[key];
    }
    lastHash=result.headHash;
  }
  const elapsedMs=performance.now()-began;
  const statuses=await Promise.all([0,1,2,3].map(i=>call(i,'/status')));
  if(!statuses.every(x=>x.height===String(blocks)&&x.headHash===lastHash)){
    throw Error('Private TLS validator heads diverged');
  }
  const balances=await Promise.all([0,1,2,3].map(async i=>
    Promise.all(recipients.map(r=>call(i,`/balance?address=${r.address}`)))));
  const expected=Array.from({length:32},(_,i)=>
    String(Math.floor(count*blocks/32)+(i<count*blocks%32?1:0)));
  if(!balances.every(row=>row.every((r,i)=>r.balance===expected[i]))){
    throw Error('Authenticated TLS replicas disagree on balances');
  }
  console.log(JSON.stringify({
    status:'FOUR MUTUALLY AUTHENTICATED PRIVATE LOOPBACK TLS VALIDATORS',
    transport:'TLSv1.3 mutual certificate verification, pinning, private-address only',
    mlDsaValidatorQuorum:'3 of 4',blocks,transactionsPerBlock:count,
    totalTransactions:count*blocks,clientSigningMs:+signingMs.toFixed(2),
    independentlyVerifiedAtEveryValidator:true,
    singlePassAdmission:singlePass,
    fourValidatorAdmissionMs:+admissionMs.toFixed(2),
    authenticatedPeerConsensusMs:+consensusMs.toFixed(2),
    phasesMs:Object.fromEntries(Object.entries(phases).map(([key,value])=>
      [key,+value.toFixed(2)])),
    admissionConsensusFsyncTps:+(1000*count*blocks/(admissionMs+consensusMs)).toFixed(1),
    includingClientSigningTps:+(1000*count*blocks/elapsedMs).toFixed(1),
    committedHeight:String(blocks),allBalancesAgree:true,
    sustained5000TpsVerified:false,
    warning:'All peers still run on ONE MACHINE via 127.0.0.1; TLS uses conventional classical certificates. No independent hosts, WAN latency, public P2P, view-change or audited mainnet.',
  },null,2));
} finally {
  for(const agent of clientAgents)agent.destroy();
  await Promise.allSettled(children.map(stop));
  rmSync(tmp,{recursive:true,force:true});
}
