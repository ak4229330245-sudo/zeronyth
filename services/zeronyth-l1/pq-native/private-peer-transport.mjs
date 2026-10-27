/** Explicit private-VPN, mutually authenticated TLS peer transport laboratory.
 * Transport certificates are classical TLS; consensus/transaction signatures
 * remain independently checked ML-DSA-65. This is NOT production BFT. */
import { Agent, request as httpsRequest } from 'node:https';
import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { ProtocolError } from './pq.mjs';

const PEER_KIND='ZERONYTH_PQ_PRIVATE_VALIDATORS_V1';
const FINGERPRINT=/^([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/;
const NAME=/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const MAX_RESPONSE=18*1024*1024;

export function privateIp(ip){
  const family=isIP(ip);
  if(family===6)return /^(?:f[cd][0-9a-f]{2}:|::1$)/i.test(ip);
  if(family!==4)return false;
  const [a,b]=ip.split('.').map(Number);
  return a===10 || a===127 || (a===172&&b>=16&&b<=31) ||
    (a===192&&b===168) || (a===100&&b>=64&&b<=127);
}

function readProtected(path,label){
  if(typeof path!=='string'||!path.startsWith('/'))throw new ProtocolError(`${label} needs absolute file path`);
  const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
    const status=fstatSync(fd);
    if(!status.isFile()||status.size>1024*1024||
        (process.platform!=='win32'&&(status.mode&0o077)!==0)){
      throw new ProtocolError(`${label} must be a bounded, regular owner-only 0600 file`);
    }
    return readFileSync(fd);
  }finally{
    closeSync(fd);
  }
}

function hex(fp){return fp.toUpperCase();}

export function validatePrivatePeerConfig(input,genesis,validatorPublicKey,listenPort){
  const count=genesis?.validators?.length;
  if(!input||input.kind!==PEER_KIND||!Number.isInteger(input.validatorIndex)||
      !Number.isSafeInteger(count)||count<4||
      input.validatorIndex<0||input.validatorIndex>=count||
      !Array.isArray(input.peers)||input.peers.length!==count||
      !privateIp(input.listenAddress)||input.listenAddress==='0.0.0.0'||
      !Number.isInteger(input.port)||input.port!==listenPort||
      !input.tls||typeof input.tls!=='object'){
    throw new ProtocolError('Invalid explicit private validator TLS configuration');
  }
  if(genesis.validators[input.validatorIndex]?.publicKey!==validatorPublicKey){
    throw new ProtocolError('TLS peer index does not match validator genesis identity');
  }
  const endpoints=new Set(),fingerprints=new Set();
  for(let index=0;index<count;index++){
    const peer=input.peers[index];
    if(peer?.validatorIndex!==index||!privateIp(peer.host)||
        !Number.isInteger(peer.port)||peer.port<1024||peer.port>65535||
        typeof peer.serverName!=='string'||!NAME.test(peer.serverName)||
        typeof peer.certSha256!=='string'||!FINGERPRINT.test(peer.certSha256)){
      throw new ProtocolError('Invalid genesis-ordered private peer address or certificate pin');
    }
    const endpoint=`${peer.host}:${peer.port}`;
    const fp=hex(peer.certSha256);
    if(endpoints.has(endpoint)||fingerprints.has(fp)){
      throw new ProtocolError('Duplicate private peer endpoint or TLS certificate');
    }
    endpoints.add(endpoint);fingerprints.add(fp);
  }
  const self=input.peers[input.validatorIndex];
  if(self.host!==input.listenAddress||self.port!==listenPort){
    throw new ProtocolError('Private listener must match its genesis peer entry');
  }
  return true;
}

export function openPrivatePeerTransport(configPath,genesis,validatorPublicKey,listenPort){
  // The configuration can reveal operator endpoints and trust pins; keep it 0600.
  const config=JSON.parse(readProtected(configPath,'private peer config').toString('utf8'));
  validatePrivatePeerConfig(config,genesis,validatorPublicKey,listenPort);
  const cert=readProtected(config.tls.certPath,'TLS certificate');
  const key=readProtected(config.tls.keyPath,'TLS private key');
  const ca=readProtected(config.tls.caPath,'TLS private CA');
  const x509=new X509Certificate(cert);
  if(hex(x509.fingerprint256)!==hex(config.peers[config.validatorIndex].certSha256)){
    throw new ProtocolError('Local TLS certificate does not match pinned genesis peer');
  }
  const keyPublic=createPublicKey(createPrivateKey(key)).export({type:'spki',format:'der'});
  const certPublic=x509.publicKey.export({type:'spki',format:'der'});
  if(!keyPublic.equals(certPublic))throw new ProtocolError('TLS key/certificate mismatch');
  const known=new Set(config.peers.map(peer=>hex(peer.certSha256)));
  const agents=new Map();
  for(const peer of config.peers){
    if(peer.validatorIndex===config.validatorIndex)continue;
    agents.set(peer.validatorIndex,new Agent({
      keepAlive:true,maxSockets:2,ca,cert,key,rejectUnauthorized:true,
      checkServerIdentity:(name,remoteCert)=>{
        const error=checkServerIdentity(peer.serverName,remoteCert);
        if(error)return error;
        if(hex(remoteCert.fingerprint256||'')!==hex(peer.certSha256)){
          return Error('Private peer TLS certificate pin mismatch');
        }
        return undefined;
      },
    }));
  }
  return {
    ownIndex:config.validatorIndex, bindAddress:config.listenAddress,
    serverOptions:{cert,key,ca,requestCert:true,rejectUnauthorized:true,
      minVersion:'TLSv1.3'},
    authorize(socket){
      const fp=socket.getPeerCertificate()?.fingerprint256;
      return socket.authorized===true&&typeof fp==='string'&&known.has(hex(fp));
    },
    async requestPeer(index,route,value){
      const peer=config.peers[index],agent=agents.get(index);
      if(!agent||!['/p2p/stage-vote','/commit'].includes(route)){
        throw new ProtocolError('Unauthorized remote validator peer request');
      }
      const body=Buffer.from(JSON.stringify(value));
      if(body.length>MAX_RESPONSE)throw new ProtocolError('Outgoing peer request too large');
      return new Promise((resolve,reject)=>{
        const req=httpsRequest({hostname:peer.host,port:peer.port,path:route,
          servername:peer.serverName,method:'POST',agent,
          headers:{'Content-Type':'application/json','Content-Length':body.length},
          timeout:30_000},res=>{
          const buffers=[];let size=0;
          res.on('data',chunk=>{
            size+=chunk.length;
            if(size>MAX_RESPONSE){req.destroy(Error('Peer response too large'));return;}
            buffers.push(chunk);
          });
          res.on('end',()=>{
            try{
              const response=JSON.parse(Buffer.concat(buffers).toString('utf8'));
              if(res.statusCode!==200)throw Error(`Peer ${index} rejected: ${response.error}`);
              resolve(response);
            }catch(error){reject(error);}
          });
          res.on('error',reject);
        });
        req.on('timeout',()=>req.destroy(Error('Private peer timeout')));
        req.on('error',reject);
        req.end(body);
      });
    },
    close(){for(const agent of agents.values())agent.destroy();},
  };
}
