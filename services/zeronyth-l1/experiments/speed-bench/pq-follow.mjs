// Bench copy of scripts/pq-finality.mjs's per-block work, UNCHANGED crypto: for every block it re-verifies the
// ECDSA header + committed seals, has all N validators' ML-DSA-65 keys sign the finality message, and verifies the
// full certificate (quorum) -- no sampling, no skipping, no caching. Keys are throwaway (in memory, test chain only).
// Adds lag instrumentation: per block, ms from first-seen-at-head to certificate done; max backlog in blocks.
// usage: RPC_URL=... PORT=... KEYDIR=/tmp/zbench/net/keys node pq-follow.mjs
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { verifyHeader, decodeExtra, validatorSetHash, hexToBytes, bytesToHex } from '../../dashboard/assets/light-client.mjs';
import { ml_dsa65, keccak_256, SCHEME, b64, finalityMessage, pqSetHash, signBinding, verifyRegistry, verifyCertificate, pqQuorum } from '../../dashboard/assets/pq-finality-core.mjs';
const RPC = process.env.RPC_URL; const PORT = Number(process.env.PORT); const KEYDIR = process.env.KEYDIR;
const POLL = Number(process.env.PQ_POLL_MS || 200); // production value: 200 ms
async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }), signal: AbortSignal.timeout(5000) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
}
const dirs = readdirSync(KEYDIR).sort(); const signers = [], entries = [];
for (const [i, d] of dirs.entries()) {
  const kp = ml_dsa65.keygen(new Uint8Array(randomBytes(32)));
  let pub = readFileSync(path.join(KEYDIR, d, 'key.pub'), 'utf8').trim().replace(/^0x/, ''); if (pub.length === 130) pub = pub.slice(2);
  const address = bytesToHex(keccak_256(hexToBytes(pub)).subarray(12));
  const ecdsaPriv = hexToBytes(readFileSync(path.join(KEYDIR, d, 'key'), 'utf8').trim());
  entries.push({ index: i, node: `node${i + 1}`, address, publicKey: b64.enc(kp.publicKey), ...signBinding(address, ecdsaPriv, kp.secretKey, kp.publicKey) });
  signers.push(kp.secretKey);
}
const reg = { scheme: SCHEME, chainId: 9127, epoch: 0, quorum: pqQuorum(entries.length), validators: entries };
reg.setHash = pqSetHash(entries.map((e) => e.publicKey)); verifyRegistry(reg);
let trustedValidators = null, verifiedParent = null;
const seen = new Map(); const lags = []; let skips = 0, maxBacklog = 0, blocks = 0, failures = 0, signMs = 0, verifyMs = 0, ecdsaMs = 0, lastErr = '';
async function certify(height) {
  const block = await rpc('eth_getBlockByNumber', ['0x' + height.toString(16), false]);
  if (!block) throw Object.assign(new Error('block not yet served by RPC'), { retry: true }); // transient; retried next poll, never skipped
  if (!trustedValidators) { const parent = height > 0 ? await rpc('eth_getBlockByNumber', ['0x' + (height - 1).toString(16), false]) : block; trustedValidators = decodeExtra(parent.extraData).validators; }
  let t = performance.now();
  const h = verifyHeader(block, trustedValidators, verifiedParent && verifiedParent.number === height - 1 ? verifiedParent : null); ecdsaMs += performance.now() - t;
  const cert = { scheme: SCHEME, chainId: 9127, height, blockHash: block.hash.toLowerCase(), parentHash: block.parentHash.toLowerCase(), timestamp: parseInt(block.timestamp, 16),
    validatorSetHash: validatorSetHash(h.nextValidators), pqSetHash: reg.setHash, ecdsaSigners: h.signers.length, signatures: [] };
  const msg = finalityMessage(cert);
  t = performance.now(); for (const [index, sk] of signers.entries()) cert.signatures.push({ index, signature: b64.enc(ml_dsa65.sign(msg, sk)) }); signMs += performance.now() - t;
  t = performance.now(); verifyCertificate(cert, reg); verifyMs += performance.now() - t;
  trustedValidators = h.nextValidators; verifiedParent = { number: height, hash: block.hash }; blocks++;
  const s = seen.get(height); if (s !== undefined) { lags.push(performance.now() - s); seen.delete(height); }
}
let next = null, busy = false;
setInterval(async () => {
  if (busy) return; busy = true;
  try {
    const top = parseInt(await rpc('eth_blockNumber'), 16); const now = performance.now();
    for (let k = (next ?? top); k <= top; k++) if (!seen.has(k)) seen.set(k, now);
    if (next !== null && top - next > 50) skips++;
    if (next === null || top - next > 50) { next = Math.max(1, top - 5); trustedValidators = null; verifiedParent = null; }
    maxBacklog = Math.max(maxBacklog, top - next + 1);
    while (next <= top) { await certify(next); next++; }
  } catch (e) { if (e.retry) return; failures++; lastErr = String(e.message).slice(0, 200); trustedValidators = null; verifiedParent = null; }
  finally { busy = false; }
}, POLL);
http.createServer((req, res) => {
  if (req.url === "/reset") { lags.length = 0; skips = 0; maxBacklog = 0; blocks = 0; failures = 0; signMs = verifyMs = ecdsaMs = 0; }
  const s = [...lags].sort((a, b) => a - b); const p = (q) => s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]) : null;
  res.end(JSON.stringify({ blocks, failures, skips, lastErr, maxBacklog, lagMs: { p50: p(0.5), p95: p(0.95), max: s.length ? Math.round(s.at(-1)) : null },
    perBlockMs: blocks ? { sign4: +(signMs / blocks).toFixed(1), verifyCert: +(verifyMs / blocks).toFixed(1), ecdsaHeader: +(ecdsaMs / blocks).toFixed(1) } : null }));
}).listen(PORT, '127.0.0.1');
