// ZERONYTH PQ finality service. For every ECDSA-sealed QBFT block it (1) re-verifies the
// header and committed seals, (2) has each validator's ML-DSA-65 key sign the finality
// message, (3) checks the quorum and serves the certificate on 127.0.0.1 (gateway: /api/pq/*).
// Private keys stay in node-data/node*/pq-mldsa65.seed (0600) and are never logged or served.
import http from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile, appendFile, mkdir, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { verifyHeader, decodeExtra, validatorSetHash, hexToBytes, bytesToHex } from '../dashboard/assets/light-client.mjs';
import { ml_dsa65, keccak_256, SCHEME, b64, finalityMessage, pqSetHash, signBinding, verifyRegistry, verifyCertificate, pqQuorum } from '../dashboard/assets/pq-finality-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545/';
const PORT = Number(process.env.PORT || 8799);
const CHAIN_ID = 9127;
const N = Number(process.env.PQ_VALIDATORS || 4);
const RING = Number(process.env.PQ_RING || 600), CHECKPOINT_EVERY = Number(process.env.PQ_CHECKPOINT_EVERY || 100);
const outDir = path.join(root, '../../generated-artifacts/pq-finality');
const log = (m) => process.stdout.write(`[PQ-FINALITY] ${m}\n`);

async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }), signal: AbortSignal.timeout(5000) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
}

async function loadKeys() {
  const signers = [], entries = [];
  for (let i = 1; i <= N; i++) {
    const dir = path.join(root, `node-data/node${i}`);
    const seedFile = path.join(dir, 'pq-mldsa65.seed');
    if (!existsSync(seedFile)) { await writeFile(seedFile, randomBytes(32), { mode: 0o600 }); log(`generated ML-DSA-65 key for node${i} (seed kept local, 0600)`); }
    await chmod(seedFile, 0o600);
    const kp = ml_dsa65.keygen(new Uint8Array(await readFile(seedFile)));
    let pub = (await readFile(path.join(dir, 'key.pub'), 'utf8')).trim().replace(/^0x/, '');
    if (pub.length === 130) pub = pub.slice(2);
    const address = bytesToHex(keccak_256(hexToBytes(pub)).subarray(12));
    const ecdsaPriv = hexToBytes((await readFile(path.join(dir, 'key'), 'utf8')).trim());
    entries.push({ index: i - 1, node: `node${i}`, address, publicKey: b64.enc(kp.publicKey), ...signBinding(address, ecdsaPriv, kp.secretKey, kp.publicKey) });
    ecdsaPriv.fill(0);
    signers.push(kp.secretKey);
  }
  const reg = { scheme: SCHEME, chainId: CHAIN_ID, epoch: 0, quorum: pqQuorum(N), validators: entries };
  reg.setHash = pqSetHash(entries.map((e) => e.publicKey));
  return { signers, reg };
}

const certs = new Map(); let latest = null, verifiedParent = null, trustedValidators = null;
const stats = { blocks: 0, failures: 0, lastError: '', signMsPerBlock: 0, verifyMsPerBlock: 0, ecdsaVerifyMs: 0, startedAt: new Date().toISOString() };
const ewma = (old, x) => (old ? old * 0.9 + x * 0.1 : x);

async function certify(height, signers, reg) {
  const block = await rpc('eth_getBlockByNumber', ['0x' + height.toString(16), false]);
  if (!trustedValidators) {
    const parent = height > 0 ? await rpc('eth_getBlockByNumber', ['0x' + (height - 1).toString(16), false]) : block;
    trustedValidators = decodeExtra(parent.extraData).validators;
  }
  let t = performance.now();
  const h = verifyHeader(block, trustedValidators, verifiedParent && verifiedParent.number === height - 1 ? verifiedParent : null);
  stats.ecdsaVerifyMs = ewma(stats.ecdsaVerifyMs, performance.now() - t);
  const cert = { scheme: SCHEME, chainId: CHAIN_ID, height, blockHash: block.hash.toLowerCase(), parentHash: block.parentHash.toLowerCase(), timestamp: parseInt(block.timestamp, 16),
    validatorSetHash: validatorSetHash(h.nextValidators), pqSetHash: reg.setHash, ecdsaSigners: h.signers.length, signatures: [] };
  const msg = finalityMessage(cert);
  t = performance.now();
  // Each validator's attester signs independently (co-located on this host for the testnet).
  for (const [index, sk] of signers.entries()) cert.signatures.push({ index, signature: b64.enc(ml_dsa65.sign(msg, sk)) });
  stats.signMsPerBlock = ewma(stats.signMsPerBlock, performance.now() - t);
  t = performance.now();
  verifyCertificate(cert, reg); // aggregator refuses to publish anything without a valid quorum
  stats.verifyMsPerBlock = ewma(stats.verifyMsPerBlock, performance.now() - t);
  trustedValidators = h.nextValidators;
  verifiedParent = { number: height, hash: block.hash };
  certs.set(height, cert); if (certs.size > RING) certs.delete(certs.keys().next().value);
  latest = cert; stats.blocks++;
  if (height % CHECKPOINT_EVERY === 0) await appendFile(path.join(outDir, 'checkpoints.jsonl'), JSON.stringify(cert) + '\n');
}

async function loadCheckpoint(height) {
  try {
    const lines = (await readFile(path.join(outDir, 'checkpoints.jsonl'), 'utf8')).trim().split('\n');
    for (const l of lines) { const c = JSON.parse(l); if (c.height === height) return c; }
  } catch { /* none yet */ }
  return null;
}

const { signers, reg } = await loadKeys();
verifyRegistry(reg);
await mkdir(outDir, { recursive: true });
await writeFile(path.join(root, 'config/pq-validators.json'), JSON.stringify(reg, null, 2));
log(`registry ready: ${N} ML-DSA-65 attesters, quorum ${reg.quorum}, setHash ${reg.setHash}`);

let next = null, busy = false;
setInterval(async () => {
  if (busy) return; busy = true;
  try {
    const top = parseInt(await rpc('eth_blockNumber'), 16);
    if (next === null || top - next > 50) { next = Math.max(0, top - 5); trustedValidators = null; verifiedParent = null; }
    while (next <= top) { await certify(next, signers, reg); next++; }
  } catch (e) { stats.failures++; stats.lastError = String(e.message).slice(0, 200); trustedValidators = null; verifiedParent = null; }
  finally { busy = false; }
}, 200).unref?.();
setInterval(() => {}, 1 << 30);

const send = (req, res, code, obj) => {
  let body = Buffer.from(JSON.stringify(obj)); const h = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && body.length > 1024) { body = gzipSync(body); h['content-encoding'] = 'gzip'; }
  res.writeHead(code, h); res.end(body);
};
const summary = (c) => c && ({ height: c.height, blockHash: c.blockHash, signers: c.signatures.length, quorum: reg.quorum, scheme: c.scheme, timestamp: c.timestamp });
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method !== 'GET') return send(req, res, 405, { error: 'GET only' });
  if (u.pathname === '/validators') return send(req, res, 200, reg);
  if (u.pathname === '/stats') return send(req, res, 200, { ...stats, latest: summary(latest), certsInMemory: certs.size, rssMB: Math.round(process.memoryUsage().rss / 1048576) });
  const m = /^\/finality\/(latest|\d{1,12})$/.exec(u.pathname);
  if (!m) return send(req, res, 404, { error: 'Unknown PQ route' });
  const c = m[1] === 'latest' ? latest : certs.get(Number(m[1])) || await loadCheckpoint(Number(m[1]));
  if (!c) return send(req, res, 404, { error: 'No certificate for that height (recent ring or checkpoints only)', checkpointEvery: CHECKPOINT_EVERY });
  return send(req, res, 200, u.searchParams.get('summary') === '1' ? summary(c) : c);
}).listen(PORT, process.env.LISTEN_HOST || '127.0.0.1', () => log(`serving on ${process.env.LISTEN_HOST || '127.0.0.1'}:${PORT}`));
