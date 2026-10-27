/** Authenticated local-browser portal; AI prompts stay on operator's machine. */
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AiLocalLabSession} from './ai-local-session.mjs';
import {ProtocolError} from './pq.mjs';

const HTML=fileURLToPath(new URL('./ai-local-dashboard.html',import.meta.url));
const JS=fileURLToPath(new URL('./ai-local-dashboard.js',import.meta.url));

function isAuthorized(given,expected){
  if(typeof given!=='string'||!given.startsWith('Bearer '))return false;
  const a=Buffer.from(given.slice(7)),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
function send(res,status,value){
  if(res.writableEnded||res.destroyed)return;
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer'});
  res.end(JSON.stringify(value));
}
async function jsonBody(req){
  if(String(req.headers['content-type']||'').split(';')[0]!=='application/json'){
    throw new ProtocolError('Content-Type application/json required');
  }
  let size=0;const chunks=[];
  for await(const chunk of req){
    size+=chunk.length;
    if(size>8192)throw new ProtocolError('AI request too large');
    chunks.push(chunk);
  }
  let data;
  try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw new ProtocolError('Malformed JSON');}
  if(!data||typeof data!=='object'||Array.isArray(data)){
    throw new ProtocolError('JSON object required');
  }
  return data;
}

export class AiLocalPortal {
  #session;#token;#usage=new Map();
  constructor({session,adminToken}={}){
    if(!(session instanceof AiLocalLabSession)||
      typeof adminToken!=='string'||adminToken.length<32||adminToken.length>256||
      !/^[\x21-\x7e]+$/.test(adminToken)){
      throw new ProtocolError('AI lab portal requires 32+ character private admin token');
    }
    this.#session=session;this.#token=adminToken;
  }
  #limit(req){
    const ip=req.socket.remoteAddress||'unknown';
    const now=Date.now(),old=this.#usage.get(ip);
    const current=!old||now-old.at>=60000?{at:now,requests:0}:old;
    current.requests++;
    this.#usage.set(ip,current);
    if(current.requests>90)throw new ProtocolError('Too many AI portal requests');
  }
  async #serve(req,res){
    try{
      this.#limit(req);
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.method==='GET'&&url.pathname==='/'){
        res.writeHead(200,{'content-type':'text/html; charset=utf-8',
          'cache-control':'no-store','x-content-type-options':'nosniff',
          'x-frame-options':'DENY','referrer-policy':'no-referrer',
          'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
        res.end(readFileSync(HTML));return;
      }
      if(req.method==='GET'&&url.pathname==='/ai-dashboard.js'){
        res.writeHead(200,{'content-type':'text/javascript; charset=utf-8',
          'cache-control':'no-store','x-content-type-options':'nosniff'});
        res.end(readFileSync(JS));return;
      }
      if(req.method==='GET'&&url.pathname==='/health'){
        send(res,200,{alive:true,mode:'LOCAL_AI_LAB',realPayments:false});return;
      }
      if(!isAuthorized(req.headers.authorization,this.#token)){
        send(res,401,{error:'Private AI lab token required'});return;
      }
      if(req.method==='GET'&&url.pathname==='/v1/ai/state'){
        send(res,200,this.#session.status());return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/ai/ask'){
        const body=await jsonBody(req);
        if(typeof body.asProvider!=='boolean'||
           !Number.isInteger(body.maxTokens)){
          throw new ProtocolError('Choose demo user or provider and explicit token limit');
        }
        const result=body.asProvider?
          await this.#session.askAsProvider(body.prompt,body.maxTokens):
          await this.#session.ask(body.prompt,body.maxTokens);
        send(res,200,{...result,state:this.#session.status()});return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/ai/settle'){
        const body=await jsonBody(req);
        if(body.confirm!==true||Object.keys(body).length!==1){
          throw new ProtocolError('Explicit experimental settlement confirmation required');
        }
        const receipt=this.#session.settle();
        send(res,200,{receipt,state:this.#session.status()});return;
      }
      send(res,404,{error:'Unknown AI portal route'});
    }catch(error){
      send(res,error.message?.includes('Too many')?429:400,{error:
        error instanceof ProtocolError?error.message:'Local AI request rejected'});
    }
  }
  async start({port=0}={}){
    if(!Number.isInteger(port)||port<0||port>65535){
      throw new ProtocolError('AI lab portal binds loopback on port 0..65535');
    }
    const server=createServer((req,res)=>{void this.#serve(req,res);});
    try{await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});
    });}catch(error){server.close();throw error;}
    return {server,url:`http://127.0.0.1:${server.address().port}`,
      bound:'127.0.0.1',paymentUnit:'ZNYT_LAB_NOT_REAL_TOKEN'};
  }
}
