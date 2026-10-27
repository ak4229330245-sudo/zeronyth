/** Private/local-only HTTP mailbox for WebRTC SDP + ICE. NO P2P DATA RELAY. */
import {createServer} from 'node:http';
import {SignalingRegistry,SignalError} from './registry.mjs';

const MAX_BODY_BYTES=32*1024;
const JSON_HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
};

async function readJson(req){
  if(!req.headers['content-type']?.startsWith('application/json')){
    throw new SignalError('JSON content type required',415);
  }
  let length=0;
  const buffers=[];
  for await(const chunk of req){
    length+=chunk.length;
    if(length>MAX_BODY_BYTES)throw new SignalError('Signaling body too large',413);
    buffers.push(chunk);
  }
  let value;
  try{value=JSON.parse(Buffer.concat(buffers).toString('utf8'));}
  catch{throw new SignalError('Invalid JSON');}
  if(!value||typeof value!=='object'||Array.isArray(value)){
    throw new SignalError('JSON object required');
  }
  return value;
}

function validateEnvelope(input,keys){
  if(JSON.stringify(Object.keys(input).sort())!==JSON.stringify([...keys].sort())){
    throw new SignalError('Unknown or missing request fields');
  }
}

export function createSignalingServer({registry=new SignalingRegistry(),stunUrls=[]}={}){
  if(!Array.isArray(stunUrls)||stunUrls.length>3||stunUrls.some(url=>
    typeof url!=='string'||!/^stuns?:[a-z0-9.-]+:[0-9]{1,5}$/i.test(url))){
    throw new SignalError('Invalid optional STUN configuration');
  }
  return createServer(async(req,res)=>{
    res.setHeader('Connection','close');
    const respond=(status,payload)=>{
      res.writeHead(status,JSON_HEADERS);
      res.end(JSON.stringify(payload));
    };
    try{
      if(req.url==='/health'&&req.method==='GET'){
        respond(200,{status:'signaling-only',...registry.status()});return;
      }
      if(req.url==='/config'&&req.method==='GET'){
        respond(200,{iceServers:stunUrls.map(url=>({urls:url})),
          trueP2P:true,publicMainnet:false,authentication:'ephemeral-room-token'});return;
      }
      if(req.method!=='POST'||!['/join','/poll','/signal','/leave'].includes(req.url)){
        respond(404,{error:'Not found'});return;
      }
      const input=await readJson(req);
      let result;
      if(req.url==='/join'){
        validateEnvelope(input,['room']);
        result=registry.join(input);
      }else if(req.url==='/poll'){
        validateEnvelope(input,['room','peerId','token']);
        result=registry.poll(input);
      }else if(req.url==='/signal'){
        validateEnvelope(input,['room','peerId','token','to','type','payload']);
        result=registry.signal(input);
      }else{
        validateEnvelope(input,['room','peerId','token']);
        result=registry.leave(input);
      }
      respond(200,result);
    }catch(error){
      respond(error instanceof SignalError?error.status:500,
        {error:error instanceof SignalError?error.message:'Internal signaling error'});
    }
  });
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const port=Number(process.env.PORT||8788);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid P2P signal port');
  const stunUrls=(process.env.ZERONYTH_STUN_URLS||'').split(',').map(s=>s.trim()).filter(Boolean);
  const server=createSignalingServer({stunUrls});
  server.headersTimeout=5000;
  server.requestTimeout=5000;
  server.listen(port,process.env.LISTEN_HOST||'127.0.0.1',()=>{
    process.stdout.write(`Private ZERONYTH WebRTC signaling ready on port ${port}\n`);
  });
}
