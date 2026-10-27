// ZERONYTH edge (VPS, user solbot). cloudflared -> this -> box gateway via the ssh reverse tunnel.
// Normal: transparent pass-through (all headers incl. CF-Connecting-IP; Host: localhost for the main site, exactly
// what cloudflared's httpHostHeader did). Box unreachable (health probe or a stalled request): serve a local
// fallback with the gateway's security headers/CSP: synced static site, /rpc to VPS validators with the gateway's
// allow-list + rate limits + dev-key rejection, /api/pq from the VPS PQ signer, and a localized maintenance notice
// for box-only features. No admin routes. Loopback only.
import http from 'node:http';
import net from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';

const env = process.env;
const MAIN_UP = { host: '127.0.0.1', port: Number(env.EDGE_MAIN_UP || 22781), hostHeader: 'localhost', name: 'main' };
const SCAN_UP = { host: '127.0.0.1', port: Number(env.EDGE_SCAN_UP || 22815), hostHeader: null, name: 'scan' };
const SITE = path.resolve(env.EDGE_SITE || '/home/solbot/zeronyth-edge/site');
const RPCS = (env.EDGE_RPC_UPSTREAMS || 'http://127.0.0.1:8545/,http://127.0.0.1:8647/,http://127.0.0.1:8648/').split(',');
const PQ_UP = env.EDGE_PQ_UP || 'http://127.0.0.1:9799';
const ETHERS_FROM = env.EDGE_ETHERS_FROM || '/home/solbot/zeronyth/services/zeronyth-l1/faucet/server.mjs';
const log = (m) => process.stdout.write(`${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' })} JST ${m}\n`);

// ---- health ----------------------------------------------------------------------------------------------
for (const up of [MAIN_UP, SCAN_UP]) { up.ok = true; up.fails = 0; }
function probe(up) {
  return new Promise((resolve) => {
    const r = http.request({ host: up.host, port: up.port, method: 'HEAD', path: up === MAIN_UP ? '/robots.txt' : '/', headers: { host: up.hostHeader || 'scan.zeronyth.dpdns.org', 'user-agent': 'zeronyth-edge-probe' }, timeout: 1500 },
      (res) => { res.resume(); resolve(res.statusCode < 500); });
    r.on('timeout', () => { r.destroy(); resolve(false); }); r.on('error', () => resolve(false)); r.end();
  });
}
async function healthLoop(up) {
  const good = await probe(up);
  if (good) { if (!up.ok) log(`${up.name}: box reachable again -> pass-through`); up.ok = true; up.fails = 0; }
  else if (++up.fails >= 2 && up.ok) { up.ok = false; log(`${up.name}: box unreachable -> fallback`); }
  setTimeout(() => healthLoop(up), 2000).unref?.();
}

// ---- gateway policy (copied from scripts/replit-gateway.mjs; keep in sync) ---------------------------------
const readMethods = new Set(['eth_chainId', 'net_version', 'web3_clientVersion', 'eth_blockNumber', 'net_peerCount', 'qbft_getValidatorsByBlockNumber',
  'eth_getBlockByNumber', 'eth_getBalance', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getTransactionCount', 'eth_gasPrice', 'eth_estimateGas', 'eth_getCode']);
const walletMethods = new Set([...readMethods, 'eth_call', 'eth_feeHistory', 'eth_maxPriorityFeePerGas', 'eth_sendRawTransaction']);
const DEV_KEY_SENDERS = new Set(["0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc", "0x90f79bf6eb2c4f870365e785982e1f101e93b906", "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65", "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc", "0x976ea74026e726554db657fa54763abd0c3a0aa9", "0x14dc79964da2c08b23698b3d3cc7ca32193d9955", "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f", "0xa0ee7a142d267c1f36714e4a8f75612f20a79720", "0xbcd4042de499d14e55001ccbb24a551f3b954096", "0x71be63f3384f5fb98995898a86b02fb2426c5788", "0xfabb0ac9d68b0b445fb7357272ff202c5651694a", "0x1cbd3b2770909d4e10f157cabc84c7264073c9ec", "0xdf3e18d64bc6a983f673ab319ccae4f1a57c7097", "0xcd3b766ccdd6ae721141f452c550ca635964ce71", "0x2546bcd3c84621e976d8185a91a922ae77ecec30", "0xbda5747bfd65f08deb54cb465eb87d40e51b197e", "0xdd2fd4581271e230360230f9337d5c0430bf44c0", "0x8626f6940e2eb28930efb4cef49b2d1f2c9c1199"]);
let RawTx = null; // ethers loaded lazily (only when a raw tx arrives during fallback) to keep RAM low
function rawTxRejection(body) {
  if (!body.includes('eth_sendRawTransaction')) return null;
  let payload; try { payload = JSON.parse(body.toString()); } catch { return 'Invalid JSON'; }
  RawTx ||= createRequire(ETHERS_FROM)('ethers').Transaction;
  for (const call of [payload].flat()) {
    if (!call || call.method !== 'eth_sendRawTransaction') continue;
    let from; try { from = RawTx.from(call.params?.[0]).from?.toLowerCase(); } catch { return 'Unparseable raw transaction'; }
    if (!from) return 'Unsigned raw transaction';
    if (DEV_KEY_SENDERS.has(from)) return 'Transactions from public development keys are blocked';
  }
  return null;
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.zip': 'application/zip', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };
const hiddenStatic = /\.(orig|bak|swp|tmp)$|~$/i;
const retiredPages = new Map([['/swap.html', '/amm.html']]);
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const ipRe = /^[0-9a-fA-F:.]{2,45}$/;
function clientIp(req) { // == gateway with ZERONYTH_TRUST_CF=1 (peer is the local cloudflared)
  if (loopback.has(req.socket.remoteAddress)) {
    const h = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (typeof h === 'string' && ipRe.test(h)) return h;
  }
  return req.socket.remoteAddress;
}
function securityHeaders(res, routePath) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'); res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  res.setHeader('X-Frame-Options', 'DENY');
  const isAiPage = routePath.endsWith('/ai.html'), isEcosystemPage = /\/(networks|multichain-swap|bridge|liquidity|activity)\.html$/.test(routePath);
  res.setHeader('Content-Security-Policy', isAiPage
    ? "default-src 'self'; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net; img-src 'self' data:; style-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self' blob: https://cdn.jsdelivr.net; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    : isEcosystemPage
      ? "default-src 'self'; connect-src 'self' https://ethereum-sepolia-rpc.publicnode.com https://sepolia.base.org https://sepolia-rollup.arbitrum.io https://bsc-testnet-dataseed.bnbchain.org https://rpc.testnet.chain.robinhood.com https://testnet-rpc.monad.xyz https://api.devnet.solana.com; img-src 'self'; style-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      : "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Zeronyth-Edge', 'fallback');
}
const limits = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of limits) if (v.until < now) limits.delete(k); }, 5000).unref();
function overLimit(key, max, period) {
  const now = Date.now(); let c = limits.get(key);
  if (!c || c.until < now) { if (limits.size >= 100_000) return true; limits.set(key, c = { n: 0, until: now + period }); }
  return ++c.n > max;
}

// ---- localized maintenance notice ---------------------------------------------------------------------------
const MSG = {
  ja: '一時的にメンテナンス中です。この機能（Faucet・AIチャット・ポイント・スワップ等）はしばらくお待ちください。チェーンとRPCは稼働中です。',
  en: 'Temporarily under maintenance. This feature (faucet, AI chat, points, swap, ...) will be back shortly. The chain and RPC are running.',
  'zh-CN': '系统临时维护中。此功能（水龙头、AI 聊天、积分、兑换等）将很快恢复。链和 RPC 正常运行。',
  ko: '일시적으로 점검 중입니다. 이 기능(Faucet, AI 채팅, 포인트, 스왑 등)은 곧 복구됩니다. 체인과 RPC는 정상 작동 중입니다.',
};
const SCAN_MSG = {
  ja: 'ZERONYTH Scan は一時的にメンテナンス中です。チェーンは稼働しています。しばらくしてから再読み込みしてください。',
  en: 'ZERONYTH Scan is temporarily under maintenance. The chain is running. Please reload in a moment.',
  'zh-CN': 'ZERONYTH Scan 临时维护中。链正常运行。请稍后刷新。', ko: 'ZERONYTH Scan 이 일시 점검 중입니다. 체인은 작동 중입니다. 잠시 후 새로고침하세요.',
};
function norm(v) { v = String(v || '').trim().toLowerCase().replace(/_/g, '-'); return v.startsWith('ja') ? 'ja' : v.startsWith('ko') ? 'ko' : v.startsWith('zh') ? 'zh-CN' : v.startsWith('en') ? 'en' : null; }
function lang(req, url) {
  return norm(url.searchParams.get('lang')) || norm(req.headers['x-zeronyth-lang'])
    || String(req.headers['accept-language'] || '').split(',').map((x) => norm(x.split(';')[0])).find(Boolean) || 'en';
}
function notice(req, res, url) {
  const l = lang(req, url);
  if (res.headersSent) return;
  res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60' });
  res.end(JSON.stringify({ error: MSG[l], maintenance: true, lang: l, messages: MSG }));
}

// ---- fallback handlers ----------------------------------------------------------------------------------------
const reply = (res, code, data) => { if (res.headersSent) return; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
async function rpcCall(body) {
  let last;
  for (const u of RPCS) {
    try { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
      return { status: r.status, raw: Buffer.from(await r.arrayBuffer()) }; } catch (e) { last = e; }
  }
  throw last;
}
async function fallbackMain(req, res, body) {
  const url = new URL(req.url, 'http://localhost'), p = url.pathname;
  securityHeaders(res, p);
  try {
    if (p === '/rpc') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }); return res.end(); }
      if (req.method !== 'POST') return reply(res, 405, { error: 'POST required' });
      if (url.searchParams.has('network')) return url.searchParams.get('network') === 'swap-lab' ? notice(req, res, url) : reply(res, 404, { error: 'Unknown network' });
      if (overLimit(`${clientIp(req)}:rpc`, Number(env.ZERONYTH_RPC_RPS || 30), 1000)) return reply(res, 429, { error: 'Rate limit exceeded' });
      if (body.length > 1_048_576) return reply(res, 413, { error: 'Request too large' });
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(res, 415, { error: 'JSON required' });
      const rejected = rawTxRejection(body); if (rejected) return reply(res, 403, { error: rejected });
      let payload; try { payload = JSON.parse(body.toString()); } catch { return reply(res, 400, { error: 'Invalid JSON' }); }
      const calls = Array.isArray(payload) ? payload : [payload];
      if (!calls.length || calls.length > 100 || calls.some((c) => !c || !walletMethods.has(c.method))) return reply(res, 403, { error: 'Unsupported RPC method' });
      if (calls.some((c) => c.method === 'eth_sendRawTransaction') && overLimit(`${clientIp(req)}:rpc-tx`, Number(env.ZERONYTH_RPC_TX_PER_MIN || 30), 60_000)) return reply(res, 429, { error: 'Transaction rate limit exceeded' });
      const up = await rpcCall(body);
      res.writeHead(up.status, { 'Content-Type': 'application/json' }); return res.end(up.raw);
    }
    if (p.startsWith('/api/pq/') && req.method === 'GET') { // always-on: VPS ML-DSA-65 signer (same keys/registry as the box)
      const route = p.slice('/api/pq'.length);
      if (!/^\/(validators|stats|finality\/(latest|\d{1,12}))$/.test(route)) return reply(res, 404, { error: 'Unknown PQ route' });
      const r = await fetch(`${PQ_UP}${route}${url.searchParams.get('summary') === '1' ? '?summary=1' : ''}`, { headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(5000) });
      const raw = Buffer.from(await r.arrayBuffer()); const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && raw.length > 1024;
      res.writeHead(r.status, { 'Content-Type': 'application/json', ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
      return res.end(gz ? gzipSync(raw, { level: 4 }) : raw);
    }
    if (p.startsWith('/api/') || p.startsWith('/ai-lab/')) return notice(req, res, url); // box-only services
    if (!['GET', 'HEAD'].includes(req.method)) return reply(res, 405, { error: 'GET required' });
    if (retiredPages.has(p)) { res.writeHead(301, { Location: retiredPages.get(p) + (url.search || ''), 'Cache-Control': 'public, max-age=3600' }); return res.end(); }
    if (hiddenStatic.test(p)) return reply(res, 404, { error: 'Not found' });
    let file;
    try { const d = decodeURIComponent(p); file = path.resolve(SITE, `.${d === '/' ? '/index.html' : d}`); if (!file.startsWith(`${SITE}${path.sep}`)) return reply(res, 403, { error: 'Forbidden' }); }
    catch { return reply(res, 400, { error: 'Invalid path' }); }
    const info = await stat(file); if (!info.isFile()) return reply(res, 404, { error: 'Not found' });
    const ext = path.extname(file), type = mime[ext] || 'application/octet-stream';
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : ext === '.png' || ext === '.svg' ? 'public, max-age=86400' : 'public, max-age=60, stale-while-revalidate=600');
    let raw = await readFile(file);
    if (ext === '.html') { // plain-text banner (no inline style/script, so the strict CSP is unchanged)
      const l = lang(req, url);
      raw = Buffer.from(raw.toString().replace(/<body[^>]*>/i, (m) => `${m}<p role="status" lang="${l}">⚠ ${MSG[l]}</p>`));
    }
    const textual = /^(text\/|application\/json|image\/svg)/.test(type) || ext === '.md';
    const gz = textual && raw.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const out = gz ? gzipSync(raw, { level: 4 }) : raw;
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': out.length, ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
    return res.end(req.method === 'HEAD' ? undefined : out);
  } catch (e) {
    const missing = ['ENOENT', 'EISDIR', 'ENOTDIR'].includes(e.code);
    reply(res, missing ? 404 : 502, { error: missing ? 'Not found' : 'Local testnet service unavailable' });
  }
}
function fallbackScan(req, res) {
  const url = new URL(req.url, 'http://localhost'), l = lang(req, url);
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('X-Zeronyth-Edge', 'fallback');
  res.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  if (url.pathname.startsWith('/api/')) { res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '30' }); return res.end(JSON.stringify({ error: SCAN_MSG[l], maintenance: true, lang: l, messages: SCAN_MSG })); }
  res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '30' });
  res.end(`<!doctype html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZERONYTH Scan</title></head><body><h1>ZERONYTH Scan</h1><p>${SCAN_MSG[l]}</p>${l === 'en' ? '' : `<p lang="en">${SCAN_MSG.en}</p>`}<p><a href="https://zeronyth.dpdns.org/">zeronyth.dpdns.org</a></p></body></html>`);
}

// ---- pass-through proxy ---------------------------------------------------------------------------------------
const agent = new http.Agent({ keepAlive: true, maxSockets: 256, keepAliveMsecs: 10_000 });
const hop = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']);
function headerWait(p) { // time to first response byte before we give up on the box for this request
  if (p.startsWith('/api/ai/') || p === '/api/access/ai/chat') return 245_000;
  if (p.startsWith('/api/econ/') || p.startsWith('/api/access/vps/')) return 35_000;
  return Number(env.EDGE_HEADER_WAIT_MS || 6000);
}
const legacyScan = /^\/(tx|address|block|token)\/|^\/explorer\/?$/;
async function handle(req, res, site) {
  const p = (req.url || '/').split('?')[0];
  const up = site === 'scan' || legacyScan.test(p) ? SCAN_UP : MAIN_UP;
  const fallback = up === SCAN_UP ? (b) => fallbackScan(req, res, b) : (b) => fallbackMain(req, res, b);
  // Buffer the (small, size-capped) request body so a request can still be answered locally if the box stalls.
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 1_200_000) return reply(res, 413, { error: 'Request too large' }); chunks.push(c); }
  const body = Buffer.concat(chunks);
  if (!up.ok) return fallback(body);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!hop.has(k)) headers[k] = v;
  if (up.hostHeader) headers.host = up.hostHeader;
  if (body.length) headers['content-length'] = String(body.length); else delete headers['content-length'];
  let done = false;
  const pr = http.request({ host: up.host, port: up.port, method: req.method, path: req.url, headers, agent }, (r) => {
    done = true; clearTimeout(t);
    const h = { ...r.headers }; for (const k of hop) delete h[k];
    res.writeHead(r.statusCode, h); r.pipe(res);
    r.on('error', () => res.destroy());
  });
  const t = setTimeout(() => { if (!done) { pr.destroy(new Error('header timeout')); } }, headerWait(p));
  pr.on('error', (e) => {
    clearTimeout(t);
    if (done || res.headersSent) return res.destroy();
    if (up.ok) { up.fails = 2; up.ok = false; log(`${up.name}: request failed (${e.message}) -> fallback`); }
    fallback(body);
  });
  res.on('close', () => { if (!done) pr.destroy(); });
  pr.end(body);
}
function upgrade(req, sock, head, site) { // WebSocket pass-through (box only)
  const p = (req.url || '/').split('?')[0], up = site === 'scan' || legacyScan.test(p) ? SCAN_UP : MAIN_UP;
  if (!up.ok) return sock.destroy();
  const b = net.connect(up.port, up.host, () => {
    const hs = Object.entries({ ...req.headers, ...(up.hostHeader ? { host: up.hostHeader } : {}) }).map(([k, v]) => `${k}: ${v}`).join('\r\n');
    b.write(`${req.method} ${req.url} HTTP/1.1\r\n${hs}\r\n\r\n`); if (head?.length) b.write(head); b.pipe(sock); sock.pipe(b);
  });
  b.on('error', () => sock.destroy()); sock.on('error', () => b.destroy());
}
for (const [site, port] of [['main', Number(env.EDGE_MAIN_PORT || 22790)], ['scan', Number(env.EDGE_SCAN_PORT || 22791)]]) {
  const s = http.createServer((req, res) => handle(req, res, site).catch(() => reply(res, 502, { error: 'Local testnet service unavailable' })));
  s.requestTimeout = 300_000; s.headersTimeout = 20_000; s.keepAliveTimeout = 65_000;
  s.on('upgrade', (req, sock, head) => upgrade(req, sock, head, site));
  s.listen(port, '127.0.0.1', () => log(`${site} edge listening on 127.0.0.1:${port}`));
}
healthLoop(MAIN_UP); healthLoop(SCAN_UP);
