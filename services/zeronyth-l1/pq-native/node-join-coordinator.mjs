/** Local-only coordinator for signed opt-in node discovery, not consensus. */
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {NodeDiscoveryRegistry} from './node-discovery-registry.mjs';
import {ProtocolError} from './pq.mjs';

const DASHBOARD=fileURLToPath(new URL('./node-join-dashboard.html',import.meta.url));
const MAX_BODY=32768;
const ADDRESS=/^qspq_[0-9a-f]{64}$/;

function send(res,status,body){
  const json=JSON.stringify(body);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer'});
  res.end(json);
}

function authorized(header,expected){
  if(typeof header!=='string'||!header.startsWith('Bearer '))return false;
  const presented=Buffer.from(header.slice(7));
  const secret=Buffer.from(expected);
  return presented.length===secret.length&&timingSafeEqual(presented,secret);
}

async function jsonBody(req){
  if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json'){
    throw new ProtocolError('Content-Type application/json required');
  }
  const parts=[];
  let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_BODY)throw new ProtocolError('Discovery request exceeds size limit');
    parts.push(chunk);
  }
  let data;
  try{data=JSON.parse(Buffer.concat(parts).toString('utf8'));}
  catch{throw new ProtocolError('Invalid JSON discovery request');}
  if(!data||typeof data!=='object'||Array.isArray(data)){
    throw new ProtocolError('Discovery request must be a JSON object');
  }
  return data;
}

export class NodeJoinCoordinator {
  #registry;
  #secret;
  #clock;
  #rate=new Map();

  constructor({chainId,adminToken,journalPath=null,now=()=>Date.now()}={}){
    if(typeof adminToken!=='string'||adminToken.length<32||
       adminToken.length>256||!(/^[\x21-\x7e]+$/.test(adminToken))){
      throw new ProtocolError('Node dashboard requires a private 32..256-character admin token');
    }
    this.#registry=new NodeDiscoveryRegistry({chainId,journalPath,now});
    this.#secret=adminToken;
    this.#clock=now;
  }

  get registry(){return this.#registry;}

  #throttle(req){
    const host=req.socket.remoteAddress||'unknown';
    const now=this.#clock();
    const item=this.#rate.get(host);
    const state=!item||now-item.window>=60000||now<item.window?
      {window:now,count:0}:item;
    state.count++;
    this.#rate.set(host,state);
    if(this.#rate.size>4096){
      for(const [ip,r] of this.#rate){
        if(now-r.window>60000)this.#rate.delete(ip);
      }
    }
    if(state.count>120)throw new ProtocolError('Rate limit: wait before retrying');
  }

  async #serve(req,res){
    try{
      this.#throttle(req);
      const url=new URL(req.url||'/', 'http://127.0.0.1');
      if(req.method==='GET'&&url.pathname==='/'){
        res.writeHead(200,{'content-type':'text/html; charset=utf-8',
          'cache-control':'no-store','x-content-type-options':'nosniff',
          'x-frame-options':'DENY','referrer-policy':'no-referrer',
          'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
        res.end(readFileSync(DASHBOARD));
        return;
      }
      if(req.method==='GET'&&url.pathname==='/dashboard.js'){
        res.writeHead(200,{'content-type':'text/javascript; charset=utf-8',
          'cache-control':'no-store','x-content-type-options':'nosniff',
          'referrer-policy':'no-referrer'});
        res.end(readFileSync(fileURLToPath(new URL('./node-join-dashboard.js',import.meta.url))));
        return;
      }
      if(req.method==='GET'&&url.pathname==='/health'){
        send(res,200,{ok:true,service:'node-discovery-only',realValidator:false});
        return;
      }
      if(req.method==='GET'&&url.pathname==='/v1/admin/nodes'){
        if(!authorized(req.headers.authorization,this.#secret)){
          send(res,401,{error:'Admin token required'});return;
        }
        send(res,200,this.#registry.snapshot());
        return;
      }
      if(req.method==='GET'&&url.pathname==='/v1/node/nonce'){
        const address=url.searchParams.get('address');
        if(!ADDRESS.test(address||'')||[...url.searchParams.keys()].length!==1){
          throw new ProtocolError('Valid qspq_ ML-DSA address required');
        }
        send(res,200,{nextNonce:this.#registry.nextNonce(address),chainId:this.#registry.chainId});
        return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/node/join'){
        send(res,200,this.#registry.join(await jsonBody(req)));
        return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/node/pulse'){
        send(res,200,this.#registry.pulse(await jsonBody(req)));
        return;
      }
      send(res,404,{error:'Unknown discovery endpoint'});
    }catch(error){
      const limit=error.message?.startsWith('Rate limit:');
      send(res,limit?429:400,{error:error instanceof ProtocolError?
        error.message:'Request rejected'});
    }
  }

  async start({port=0}={}){
    if(!Number.isInteger(port)||port<0||port>65535){
      throw new ProtocolError('Loopback port must be 0..65535');
    }
    const server=createServer((req,res)=>{void this.#serve(req,res);});
    try{
      await new Promise((resolve,reject)=>{
        server.once('error',reject);
        server.listen(port,'127.0.0.1',()=>{
          server.off('error',reject);resolve();
        });
      });
    }catch(error){server.close();throw error;}
    return {server,url:`http://127.0.0.1:${server.address().port}`};
  }
}
