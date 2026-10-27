// Signed message formats shared by coordinator and contributor nodes (ML-DSA-65 + secp256k1 binding).
import { keccak256, toUtf8Bytes, getBytes, concat, verifyMessage } from 'ethers';
import { ml_dsa65 } from '../../dashboard/assets/vendor-noble.mjs';
import { verifyMldsa65 } from './mldsa.mjs';
export const DOMAINS = { decl: 'ZERONYTH-PROVIDER-DECL-v1', hb: 'ZERONYTH-HEARTBEAT-v1', l1: 'ZERONYTH-L1-RESULT-v1', ai: 'ZERONYTH-AI-RESULT-v1' };
export const DEFAULT_SHARES = Object.freeze({ l1Bps: 4000, aiBps: 3000, rentalBps: 3000 }); // user default: L1 40% / AI 30% / rental 30%
export const b64 = { enc: (u) => Buffer.from(u).toString('base64'), dec: (s) => new Uint8Array(Buffer.from(String(s), 'base64')) };
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export const hashOf = (obj) => keccak256(toUtf8Bytes(canonical(obj)));
export const pqKeyHash = (pk) => keccak256(pk);
export const msgFor = (domain, hash) => getBytes(concat([toUtf8Bytes(domain), getBytes(hash)]));
export const pqSign = (domain, hash, secretKey) => b64.enc(ml_dsa65.sign(msgFor(domain, hash), secretKey));
export function pqVerify(domain, hash, sigB64, pk) {
  try { return verifyMldsa65(b64.dec(sigB64), msgFor(domain, hash), pk instanceof Uint8Array ? pk : new Uint8Array(pk)); } catch { return false; }
}
export function validShares(s) {
  const v = [s?.l1Bps, s?.aiBps, s?.rentalBps];
  return v.every((x) => Number.isInteger(x) && x >= 0 && x <= 10000) && v[0] + v[1] + v[2] === 10000;
}
export function ecdsaSigner(hash, sig) { try { return verifyMessage(getBytes(hash), sig); } catch { return null; } }
