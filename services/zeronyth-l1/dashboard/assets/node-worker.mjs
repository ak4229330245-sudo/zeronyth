/** Voluntary, capped foreground research job. No external server, wallet or token. */
import {hashIterations} from './node-hash.mjs';

self.onmessage=async({data})=>{
  try {
    if(!data||typeof data.id!=='string'||data.id!==data.seed) throw new Error('Invalid job binding');
    const output=await hashIterations(data.seed,data.iterations);
    self.postMessage({id:data.id,output});
  }catch{
    self.postMessage({id:data?.id??'',error:'Work could not be verified'});
  }
};
