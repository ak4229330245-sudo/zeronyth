/** Portable browser/Node hash-work primitive. This is NOT proof of useful remote computing. */
export function hexToBytes(value) {
  if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError('Expected a canonical 32-byte lowercase hex seed');
  }
  const result=new Uint8Array(32);
  for(let i=0;i<32;i++) result[i]=parseInt(value.slice(i*2,i*2+2),16);
  return result;
}

export function bytesToHex(bytes) {
  if(!(bytes instanceof Uint8Array)||bytes.length!==32) {
    throw new TypeError('Expected exactly 32 digest bytes');
  }
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}

export async function hashIterations(seed,iterations,{subtle=globalThis.crypto?.subtle,signal}={}) {
  if(!Number.isInteger(iterations)||iterations<1||iterations>512) {
    throw new RangeError('Browser work requires 1..512 SHA-256 iterations');
  }
  if(!subtle||typeof subtle.digest!=='function') throw new Error('Web Crypto unavailable');
  let current=hexToBytes(seed);
  for(let i=0;i<iterations;i++){
    if(signal?.aborted) throw new Error('Work aborted');
    current=new Uint8Array(await subtle.digest('SHA-256',current));
  }
  return bytesToHex(current);
}

export function makeLocalJob(iterations,{getRandomValues=globalThis.crypto?.getRandomValues?.bind(globalThis.crypto)}={}) {
  if(typeof getRandomValues!=='function') throw new Error('Secure random generator unavailable');
  if(!Number.isInteger(iterations)||iterations<1||iterations>512) throw new RangeError('Invalid job size');
  const entropy=new Uint8Array(32);
  getRandomValues(entropy);
  const seed=bytesToHex(entropy);
  return {id:seed,seed,iterations};
}
