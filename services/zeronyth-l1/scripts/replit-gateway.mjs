import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { AiWorkerCoordinator } from '../pq-native/ai-worker-coordinator.mjs';
import { createRequire } from 'node:module';
import { createVisitorCounter, summarize, readSiteStats } from './visitor-counter.mjs';

// Defense in depth: never relay raw txs signed by the publicly known Hardhat/Anvil dev keys
// (mnemonic "test test ... junk", accounts 0-19). Anyone can sign with those keys.
const { Transaction: RawTx } = createRequire(new URL('../faucet/server.mjs', import.meta.url))('ethers');
const DEV_KEY_SENDERS = new Set(["0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc", "0x90f79bf6eb2c4f870365e785982e1f101e93b906", "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65", "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc", "0x976ea74026e726554db657fa54763abd0c3a0aa9", "0x14dc79964da2c08b23698b3d3cc7ca32193d9955", "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f", "0xa0ee7a142d267c1f36714e4a8f75612f20a79720", "0xbcd4042de499d14e55001ccbb24a551f3b954096", "0x71be63f3384f5fb98995898a86b02fb2426c5788", "0xfabb0ac9d68b0b445fb7357272ff202c5651694a", "0x1cbd3b2770909d4e10f157cabc84c7264073c9ec", "0xdf3e18d64bc6a983f673ab319ccae4f1a57c7097", "0xcd3b766ccdd6ae721141f452c550ca635964ce71", "0x2546bcd3c84621e976d8185a91a922ae77ecec30", "0xbda5747bfd65f08deb54cb465eb87d40e51b197e", "0xdd2fd4581271e230360230f9337d5c0430bf44c0", "0x8626f6940e2eb28930efb4cef49b2d1f2c9c1199"]);
function rawTxRejection(body) {
  if (!body.includes('eth_sendRawTransaction')) return null;
  let payload;
  try { payload = JSON.parse(body.toString()); } catch { return 'Invalid JSON'; }
  for (const call of [payload].flat()) {
    if (!call || call.method !== 'eth_sendRawTransaction') continue;
    let from;
    try { from = RawTx.from(call.params?.[0]).from?.toLowerCase(); } catch { return 'Unparseable raw transaction'; }
    if (!from) return 'Unsigned raw transaction';
    if (DEV_KEY_SENDERS.has(from)) return 'Transactions from public development keys are blocked';
  }
  return null;
}

const readMethods = new Set([
  'eth_chainId', 'net_version', 'web3_clientVersion', 'eth_blockNumber',
  'net_peerCount', 'qbft_getValidatorsByBlockNumber', 'eth_getBlockByNumber',
  'eth_getBalance', 'eth_getTransactionReceipt', 'eth_getTransactionByHash',
  'eth_getTransactionCount', 'eth_gasPrice', 'eth_estimateGas', 'eth_getCode',
]);
// Public /rpc for wallets (OKX, MetaMask...): reads + signed raw transactions only. No admin_/debug_/txpool_/
// personal_/eth_sendTransaction. Raw txs are rate-limited per IP and dev-key senders are rejected (rawTxRejection).
const walletMethods = new Set([
  ...readMethods,
  'eth_call', 'eth_feeHistory', 'eth_maxPriorityFeePerGas', 'eth_sendRawTransaction',
]);
const swapLabMethods = new Set([
  ...readMethods,
  'eth_call', 'eth_getLogs', 'eth_feeHistory', 'eth_maxPriorityFeePerGas',
  'eth_sendRawTransaction',
]);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.zip': 'application/zip', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};
// Editor/backup leftovers (*.orig, *.bak, *.pqevery.orig ...) are never served from the public web root.
const hiddenStatic = /\.(orig|bak|swp|tmp)$|~$/i;
// Retired pages -> their replacement (permanent redirect).
const retiredPages = new Map([['/swap.html', '/amm.html']]);

// Client IP for rate limits. Forwarded headers are ignored unless ZERONYTH_TRUST_CF=1 AND the TCP peer is
// loopback (i.e. the request arrived through a local cloudflared/Caddy). Otherwise use the socket address.
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const ipRe = /^[0-9a-fA-F:.]{2,45}$/;
function clientIp(req) {
  const peer = req.socket.remoteAddress;
  if (process.env.ZERONYTH_TRUST_CF === '1' && loopback.has(peer)) {
    const h = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (typeof h === 'string' && ipRe.test(h)) return h;
  }
  return peer;
}

// Max distinct (IP, bucket) rate-limit entries; expired ones are pruned every 5 s (was 10k / 60 s, which refused
// new visitors once ~10k distinct IPs arrived within a minute).
const LIMIT_KEYS = Number(process.env.ZERONYTH_LIMIT_KEYS || 100_000);
const headReads = new Set(['eth_blockNumber', 'net_peerCount', 'eth_chainId', 'eth_getBlockByNumber', 'qbft_getValidatorsByBlockNumber', 'eth_gasPrice']);

// Optional RPC load balancing (ZERONYTH_RPC_UPSTREAMS="8545,8647,8648" or full loopback URLs). Unset = the single
// ZERONYTH_RPC_PORT upstream exactly as before. The FIRST entry is the anchor: writes (eth_sendRawTransaction) and any
// 'pending'-tagged read always go there so a wallet sees one consistent tx pool; other reads round-robin over upstreams
// that answered the last health probe and are at most ZERONYTH_RPC_MAX_LAG blocks (default 1) behind the best head.
// Loopback upstreams only. The gateway's method allow-list still applies to every upstream (e.g. an admin port with DEBUG).
function makeRpcBalancer() {
  const raw = (process.env.ZERONYTH_RPC_UPSTREAMS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const anchor = `http://127.0.0.1:${process.env.ZERONYTH_RPC_PORT || 8545}/`;
  const list = raw.length ? raw.map((x) => (/^\d{2,5}$/.test(x) ? `http://127.0.0.1:${x}/` : x)) : [anchor];
  for (const u of list) { const h = new URL(u).hostname; if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(h)) throw new Error(`ZERONYTH_RPC_UPSTREAMS must be loopback: ${u}`); }
  const maxLag = Number(process.env.ZERONYTH_RPC_MAX_LAG ?? 1);
  const st = list.map((url) => ({ url, ok: true, head: 0, served: 0, fails: 0 }));
  let rr = 0;
  async function probe() {
    await Promise.all(st.map(async (u) => {
      try {
        const r = await fetch(u.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}', signal: AbortSignal.timeout(1500) });
        const j = await r.json(); u.head = Number(BigInt(j.result)); u.ok = true;
      } catch { u.ok = false; }
    }));
    const best = Math.max(...st.filter((u) => u.ok).map((u) => u.head), 0);
    for (const u of st) u.healthy = u.ok && best - u.head <= maxLag;
  }
  if (st.length > 1) { probe(); setInterval(probe, Number(process.env.ZERONYTH_RPC_PROBE_MS || 2000)).unref(); }
  return {
    enabled: st.length > 1,
    pick(bodyText) {
      if (st.length === 1 || /eth_sendRawTransaction|"pending"/.test(bodyText)) return st[0];
      const h = st.filter((u) => u.healthy); if (!h.length) return st[0];
      return h[rr++ % h.length];
    },
    anchor: () => st[0],
    status: () => st.map(({ url, healthy, head, served, fails }) => ({ url: url.replace(/^http:\/\/127\.0\.0\.1:/, ':'), healthy: healthy ?? true, head, served, fails })),
  };
}
export function createGateway(dashboard) {
  const rpcLb = makeRpcBalancer();
  const limits = new Map();
  const readCache = new Map();
  const pointsSeen = new Map(); // (address|ip) -> expiry, dedupes the points anti-sybil hook
  const gzCache = new WeakMap();
  const staticCache = new Map();
  const ai = new AiWorkerCoordinator();
  const visits = createVisitorCounter({ site: 'main' }); // aggregate-only page-view counter (no cookies / raw IPs)
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of limits) if (value.until < now) limits.delete(key);
  }, 5_000);
  cleanup.unref();
  const server = http.createServer(async (req, res) => {
    res.on('finish', () => visits.record(req, res));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    // HSTS: only meaningful over HTTPS (Cloudflare edge); browsers ignore it on plain http. No includeSubDomains/preload.
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    res.setHeader('X-Frame-Options', 'DENY');
    const routePath = req.url?.split('?')[0] || '';
    const isAiPage = routePath.endsWith('/ai.html');
    const isEcosystemPage = /\/(networks|multichain-swap|bridge|liquidity|activity)\.html$/.test(routePath);
    res.setHeader('Content-Security-Policy', isAiPage
      ? "default-src 'self'; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net; img-src 'self' data:; style-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self' blob: https://cdn.jsdelivr.net; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      : isEcosystemPage
        ? "default-src 'self'; connect-src 'self' https://ethereum-sepolia-rpc.publicnode.com https://sepolia.base.org https://sepolia-rollup.arbitrum.io https://bsc-testnet-dataseed.bnbchain.org https://rpc.testnet.chain.robinhood.com https://testnet-rpc.monad.xyz https://api.devnet.solana.com; img-src 'self'; style-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        : "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    const reply = (code, data) => {
      if (res.headersSent) return;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      const requestUrl = new URL(req.url, 'http://localhost');
      const pathname = requestUrl.pathname;
      let upstream, maxBytes = 32_768, swapLabRpc = false, swapLabHealth = false, aiRoute = false, econRoute = null, chatRoute = null, accessRoute = null, pointsRoute = null;
      if (pathname === '/api/rpc-lb' && req.method === 'GET') {
        // loopback-only operator view of the RPC balancer (not exposed through the public tunnel's client IPs)
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) return reply(404, { error: 'Not found' });
        return reply(200, { enabled: rpcLb.enabled, upstreams: rpcLb.status() });
      }
      if (pathname === '/api/visitors' && req.method === 'GET') {
        // Public, read-only, aggregates only (JST today / yesterday): uniques, page views, per-hour, top pages, bot / AI counts.
        return reply(200, { timezone: 'Asia/Tokyo', note: 'No cookies or raw IPs; own machines and bots excluded from uniques. Updates every 30 s for scan.',
          main: summarize(visits.stats()), scan: summarize(readSiteStats('scan')) });
      }
      if (pathname === '/rpc') {
        // CORS for browser wallets / dapps; JSON-RPC only, no credentials.
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
          return res.end();
        }
        if (req.method !== 'POST') return reply(405, { error: 'POST required' });
        swapLabRpc = requestUrl.searchParams.get('network') === 'swap-lab';
        if (requestUrl.searchParams.has('network') && !swapLabRpc) return reply(404, { error: 'Unknown network' });
        upstream = swapLabRpc ? 'http://127.0.0.1:8547/' : `http://127.0.0.1:${process.env.ZERONYTH_RPC_PORT || 8545}/`;
        maxBytes = 1_048_576;
      } else if (pathname === '/api/faucet/health' && req.method === 'GET') {
        swapLabHealth = requestUrl.searchParams.get('network') === 'swap-lab';
        if (requestUrl.searchParams.has('network') && !swapLabHealth) return reply(404, { error: 'Unknown network' });
        upstream = swapLabHealth ? 'http://127.0.0.1:8789/health' : `http://127.0.0.1:${process.env.ZERONYTH_FAUCET_PORT || 8787}/health`;
      } else if (pathname === '/api/faucet/claim' && req.method === 'POST') {
        upstream = `http://127.0.0.1:${process.env.ZERONYTH_FAUCET_PORT || 8787}/claim`;
        maxBytes = 8192;
      } else if (pathname.startsWith('/api/p2p/') && ['GET', 'POST'].includes(req.method)) {
        const route = pathname.slice('/api/p2p'.length);
        if (!['/health', '/config', '/join', '/poll', '/signal', '/leave'].includes(route)) {
          return reply(404, { error: 'Unknown signaling route' });
        }
        upstream = `http://127.0.0.1:${process.env.ZERONYTH_SIGNAL_PORT || 8788}${route}`;
      } else if (pathname.startsWith('/api/pq/') && req.method === 'GET') {
        // PQ finality certificates (ML-DSA-65), read-only.
        const route = pathname.slice('/api/pq'.length);
        if (!/^\/(validators|stats|finality\/(latest|\d{1,12}))$/.test(route)) return reply(404, { error: 'Unknown PQ route' });
        upstream = `http://127.0.0.1:${process.env.ZERONYTH_PQ_PORT || 8799}${route}${requestUrl.searchParams.get('summary') === '1' ? '?summary=1' : ''}`;
      } else if (pathname.startsWith('/api/econ/') && ['GET', 'POST'].includes(req.method)) {
        // Token-economy coordinator (contributors + subscription page). Admin-only routes are not exposed.
        const route = pathname.slice('/api/econ'.length);
        const allowedEcon = new Map([['/status', 'GET'], ['/provider/info', 'GET'], ['/provider/challenge', 'GET'], ['/provider/declare', 'POST'],
          ['/provider/heartbeat', 'POST'], ['/l1/jobs/next', 'GET'], ['/l1/jobs/result', 'POST'], ['/ai/jobs/next', 'GET'], ['/ai/jobs/result', 'POST'], ['/rpc', 'POST']]);
        if (allowedEcon.get(route) !== req.method) return reply(404, { error: 'Unknown economy route' });
        const qs = new URLSearchParams();
        for (const k of ['address']) { const v = requestUrl.searchParams.get(k); if (v && /^0x[0-9a-fA-F]{40}$/.test(v)) qs.set(k, v); }
        upstream = `http://127.0.0.1:${process.env.ZERONYTH_ECON_PORT || 8801}${route}${qs.size ? '?' + qs : ''}`;
        maxBytes = route === '/l1/jobs/result' || route === '/rpc' ? 1_048_576 : 65_536;
        econRoute = route;
      } else if (pathname.startsWith('/api/ai/') && ['GET', 'POST'].includes(req.method)) {
        // Chat AI (loopback service -> Ollama). Small bodies; per-IP limits below; the answer is streamed (NDJSON).
        const route = pathname.slice('/api/ai'.length);
        const allowedChat = new Map([['/status', 'GET'], ['/chat', 'POST'], ['/feedback', 'POST']]);
        if (allowedChat.get(route) !== req.method) return reply(404, { error: 'Unknown AI chat route' });
        upstream = `http://127.0.0.1:${process.env.ZERONYTH_AI_CHAT_PORT || 8803}${route}`;
        maxBytes = route === '/chat' ? 24_576 : 4096;
        chatRoute = route;
      } else if (pathname.startsWith('/api/bridge/') && req.method === 'GET') {
        // Testnet ZNYT<->wZNYT bridge: read-only status/transfers/events/attestations/relayer set from relayer 0 (loopback 9811).
        const route = pathname.slice('/api/bridge'.length);
        if (!['/status', '/invariant', '/transfers', '/transfer', '/events', '/attestations', '/relayers'].includes(route)) return reply(404, { error: 'Unknown bridge route' });
        const qs = new URLSearchParams();
        { const a = requestUrl.searchParams.get('address'); if (a && /^0x[0-9a-fA-F]{40}$/.test(a)) qs.set('address', a); }
        { const i = requestUrl.searchParams.get('id'); if (i && /^\d{1,12}-\d{1,12}$/.test(i)) qs.set('id', i); }
        for (const k of ['since', 'limit']) { const v = requestUrl.searchParams.get(k); if (v && /^\d{1,9}$/.test(v)) qs.set(k, v); }
        upstream = `http://127.0.0.1:${process.env.ZERONYTH_BRIDGE_PORT || 9811}/api/bridge${route}${qs.size ? '?' + qs : ''}`;
        maxBytes = 1024;
      } else if (pathname.startsWith('/api/access/') && ['GET', 'POST'].includes(req.method)) {
        // 10-day ZNYT plans on the main testnet (loopback access service): wallet-signature login (EIP-191 challenge ->
        // 1 h bearer session), plan-tier AI chat (streamed), container VPS. Per-IP limits below; the client IP is set by us.
        const route = pathname.slice('/api/access'.length);
        const allowedAccess = new Map([['/health', 'GET'], ['/plans', 'GET'], ['/accounting', 'GET'], ['/auth/challenge', 'GET'], ['/auth/verify', 'POST'],
          ['/me', 'GET'], ['/ai/chat', 'POST'], ['/vps/status', 'GET'], ['/vps/start', 'POST'], ['/vps/exec', 'POST'], ['/vps/stop', 'POST']]);
        if (allowedAccess.get(route) !== req.method) return reply(404, { error: 'Unknown access route' });
        const qs = new URLSearchParams();
        if (route === '/auth/challenge') { const v = requestUrl.searchParams.get('address'); if (v && /^0x[0-9a-fA-F]{40}$/.test(v)) qs.set('address', v); }
        if (route === '/accounting') qs.set('contract', 'ZnytEconomy');
        upstream = `http://127.0.0.1:${process.env.ZERONYTH_ACCESS_PORT || 9805}${route}${qs.size ? '?' + qs : ''}`;
        maxBytes = route === '/ai/chat' ? 24_576 : 4096;
        accessRoute = route;
      } else if (pathname.startsWith('/api/points/') && ['GET', 'POST'].includes(req.method)) {
        // Testnet points (loopback points service, read-mostly). Login reuses the access-service bearer session.
        const route = pathname.slice('/api/points'.length);
        const allowedPoints = new Map([['/health', 'GET'], ['/rules', 'GET'], ['/leaderboard', 'GET'], ['/me', 'GET'], ['/checkin', 'POST'],
          ['/snapshots', 'GET'], ['/snapshot', 'GET'], ['/proof', 'GET']]);
        if (allowedPoints.get(route) !== req.method) return reply(404, { error: 'Unknown points route' });
        const qs = new URLSearchParams();
        { const n = requestUrl.searchParams.get('n'); if (n && /^\d{1,3}$/.test(n)) qs.set('n', n); }
        { const d = requestUrl.searchParams.get('day'); if (d && /^\d{4}-\d{2}-\d{2}(-partial-\d{13})?$/.test(d)) qs.set('day', d); }
        { const a = requestUrl.searchParams.get('address'); if (a && /^0x[0-9a-fA-F]{40}$/.test(a)) qs.set('address', a); }
        upstream = `http://127.0.0.1:${process.env.ZERONYTH_POINTS_PORT || 9807}${route}${qs.size ? '?' + qs : ''}`;
        maxBytes = 1024;
        pointsRoute = route;
      } else if (pathname.startsWith('/ai-lab/')) {
        aiRoute = true;
      } else if (pathname.startsWith('/api/')) {
        return reply(404, { error: 'Unknown API route' });
      }
      if (aiRoute) {
        const route = pathname.slice('/ai-lab'.length);
        const methods = new Map([
          ['/status', 'GET'],
          ['/evaluation/start', 'POST'],
          ['/training/start', 'POST'],
          ['/worker/join', 'POST'],
          ['/worker/next', 'GET'],
          ['/worker/result', 'POST'],
          ['/worker/gradient', 'POST'],
          ['/worker/leave', 'POST'],
          ['/models/adopt', 'POST'],
        ]);
        if (methods.get(route) !== req.method) return reply(methods.has(route) ? 405 : 404,
          { error: methods.has(route) ? 'Method not allowed' : 'Unknown AI route' });
        if (req.method === 'POST' && req.headers.origin) {
          try {
            const originHost = new URL(req.headers.origin).host;
            const forwardedHost = req.headers['x-forwarded-host']?.split(',')[0].trim();
            const acceptedHost = forwardedHost || req.headers.host;
            if (originHost !== acceptedHost) {
              return reply(403, { error: 'Cross-origin AI requests are not allowed' });
            }
          } catch { return reply(403, { error: 'Invalid request origin' }); }
        }
        if (req.method === 'POST' && req.headers['sec-fetch-site'] &&
            req.headers['sec-fetch-site'] !== 'same-origin') {
          return reply(403, { error: 'Cross-site AI requests are not allowed' });
        }
        const limitsByRoute = {
          '/status': [120, 60_000],
          '/worker/next': [120, 60_000],
          '/worker/join': [8, 60_000],
          '/worker/result': [60, 60_000],
          '/worker/gradient': [10, 60_000],
          '/worker/leave': [8, 60_000],
          '/evaluation/start': [3, 60_000],
          '/training/start': [3, 60_000],
          '/models/adopt': [5, 60_000],
        };
        const [limit, period] = limitsByRoute[route];
        const key = `${clientIp(req)}:ai:${route}`;
        const now = Date.now();
        let count = limits.get(key);
        if (!count || count.until < now) {
          if (limits.size >= LIMIT_KEYS) {
            for (const [savedKey, savedValue] of limits) {
              if (savedValue.until < now) limits.delete(savedKey);
            }
          }
          if (limits.size >= LIMIT_KEYS) return reply(503, { error: 'Please retry later' });
          limits.set(key, count = { n: 0, until: now + period });
        }
        if (++count.n > limit) return reply(429, { error: 'AI lab request limit exceeded' });

        let body = {};
        if (req.method === 'POST') {
          if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'JSON required' });
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 16_384) return reply(413, { error: 'AI request too large' });
            chunks.push(chunk);
          }
          try { body = JSON.parse(Buffer.concat(chunks).toString()); }
          catch { return reply(400, { error: 'Invalid JSON' }); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'JSON object required' });
        }
        const token = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.authorization || '')?.[1];
        try {
          let result;
          if (route === '/status') result = ai.status();
          else if (route === '/worker/join') result = ai.join(body);
          else if (route === '/worker/next') result = { task: ai.nextTask(token) };
          else if (route === '/worker/result') result = ai.submitEvaluation(token, body);
          else if (route === '/worker/gradient') result = ai.submitGradient(token, body);
          else if (route === '/worker/leave') result = ai.leave(token);
          else if (route === '/evaluation/start') result = ai.startEvaluation(body);
          else if (route === '/training/start') result = ai.startTraining(body);
          else if (route === '/models/adopt') result = ai.adopt(body);
          return reply(200, result);
        } catch (error) {
          return reply(400, { error: String(error?.message || 'AI lab request rejected').slice(0, 200) });
        }
      }
      if (upstream) {
        const bucket = pathname.startsWith('/api/bridge/') ? 'bridge' : pathname === '/rpc' ? 'rpc' : pathname === '/api/faucet/claim' ? 'claim'
          : pathname.startsWith('/api/p2p/') ? 'p2p'
            : econRoute === '/rpc' ? 'econ-tx' : econRoute ? 'econ'
            : accessRoute === '/ai/chat' ? 'acc-ai' : accessRoute?.startsWith('/auth/') ? 'acc-auth'
            : accessRoute?.startsWith('/vps/') && req.method === 'POST' ? 'acc-vps' : accessRoute ? 'acc'
            : pointsRoute === '/checkin' ? 'pts-ci' : pointsRoute ? 'pts'
              : chatRoute === '/chat' ? 'ai-chat' : chatRoute === '/feedback' ? 'ai-fb' : chatRoute ? 'ai-status' : null;
        if (bucket) {
          // Bound memory as well as request rates; do not trust forwarded IP headers.
          const key = `${clientIp(req)}:${bucket}`;
          const now = Date.now(), period = ['claim', 'econ-tx', 'ai-chat', 'ai-fb', 'acc-ai', 'acc-auth', 'acc-vps', 'pts-ci'].includes(bucket) ? 60_000 : 1000;
          let count = limits.get(key);
          if (!count || count.until < now) {
            if (limits.size >= LIMIT_KEYS) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
            if (limits.size >= LIMIT_KEYS) return reply(503, { error: 'Please retry later' });
            limits.set(key, count = { n: 0, until: now + period });
          }
          if (++count.n > ({ claim: 6, 'econ-tx': 30, econ: 40, rpc: Number(process.env.ZERONYTH_RPC_RPS || 30), 'ai-chat': Number(process.env.ZERONYTH_AI_CHAT_PER_MIN || 6), 'ai-fb': 30, 'ai-status': 5, 'acc-ai': 10, 'acc-auth': 20, 'acc-vps': 40, acc: 10, bridge: 5, pts: 10, 'pts-ci': 10 }[bucket] ?? 60)) return reply(429, { error: 'Rate limit exceeded' });
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > maxBytes) return reply(413, { error: 'Request too large' });
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        // Points anti-sybil: tell the loopback points service which wallet showed up from which client IP (it keeps
        // only a salted hash). Fire-and-forget, at most once per (address, IP) per hour; never blocks the request.
        if (pathname === '/api/faucet/claim' || econRoute?.startsWith('/provider/')) {
          let addr = requestUrl.searchParams.get('address');
          if (!addr && req.method === 'POST') { try { addr = JSON.parse(body.toString()).address; } catch { /* not JSON */ } }
          if (typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr)) {
            const ip = clientIp(req), k = `${addr.toLowerCase()}|${ip}`, now = Date.now();
            if (!(pointsSeen.get(k) > now)) {
              if (pointsSeen.size > 20_000) pointsSeen.clear();
              pointsSeen.set(k, now + 3_600_000);
              fetch(`http://127.0.0.1:${process.env.ZERONYTH_POINTS_PORT || 9807}/internal/seen`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: addr, ip, src: pathname === '/api/faucet/claim' ? 'faucet' : 'econ' }), signal: AbortSignal.timeout(2000) }).catch(() => {});
            }
          }
        }
        if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json')) {
          return reply(415, { error: 'JSON required' });
        }
        if (req.method === 'POST') {
          const rejected = rawTxRejection(body);
          if (rejected) return reply(403, { error: rejected });
        }
        if (econRoute === '/rpc') {
          let payload;
          try { payload = JSON.parse(body.toString()); } catch { return reply(400, { error: 'Invalid JSON' }); }
          const calls = Array.isArray(payload) ? payload : [payload];
          if (!calls.length || calls.length > 20 || calls.some((c) => !c || c.method !== 'eth_sendRawTransaction')) return reply(403, { error: 'eth_sendRawTransaction only (max 20)' });
        }
        if (pathname === '/rpc') {
          let payload;
          try { payload = JSON.parse(body.toString()); } catch { return reply(400, { error: 'Invalid JSON' }); }
          const calls = Array.isArray(payload) ? payload : [payload];
          const allowed = swapLabRpc ? swapLabMethods : walletMethods;
          if (!calls.length || calls.length > 100 || calls.some((call) => !call || !allowed.has(call.method))) {
            return reply(403, { error: swapLabRpc ? 'Unsupported swap-lab RPC method' : 'Unsupported RPC method' });
          }
          if (swapLabRpc && calls.some((call) => call.method === 'eth_sendTransaction')) {
            return reply(403, { error: 'Wallet-signed raw transactions only' });
          }
          if (calls.some((call) => call.method === 'eth_sendRawTransaction')) {
            const key = `${clientIp(req)}:${swapLabRpc ? 'swap-tx' : 'rpc-tx'}`;
            const now = Date.now();
            let count = limits.get(key);
            if (!count || count.until < now) {
              if (limits.size >= LIMIT_KEYS) return reply(503, { error: 'Please retry later' });
              limits.set(key, count = { n: 0, until: now + 60_000 });
            }
            if (++count.n > Number(process.env.ZERONYTH_RPC_TX_PER_MIN || 30)) return reply(429, { error: 'Transaction rate limit exceeded' });
          }
        }
        // Optional micro-cache (ZERONYTH_READ_CACHE_MS, e.g. 500) for head reads that every page/light node polls each
        // second: identical requests within the window share ONE upstream call (in-flight coalescing). Never caches writes.
        const cacheMs = Number(process.env.ZERONYTH_READ_CACHE_MS || 0);
        let cacheKey = null;
        if (cacheMs > 0 && req.method === 'GET' && pathname.startsWith('/api/pq/')) cacheKey = `${pathname}${requestUrl.search}`;
        if (cacheMs > 0 && pathname === '/rpc' && !swapLabRpc) {
          try {
            const calls = [JSON.parse(body.toString())].flat();
            if (calls.every((c) => headReads.has(c.method) && (c.params || []).every((p) => p === 'latest' || p === false || (typeof p === 'string' && /^0x[0-9a-f]{1,16}$/.test(p))))) cacheKey = `rpc:${body.toString()}`;
          } catch { /* validated above */ }
        }
        // Access service: forward only the bearer session (shape-checked) and the client IP we derived.
        const accessHeaders = accessRoute || pointsRoute ? { 'X-Zeronyth-Client-Ip': clientIp(req),
          ...(/^Bearer [A-Za-z0-9_-]{1,512}\.[A-Za-z0-9_-]{1,128}$/.test(req.headers.authorization || '') ? { Authorization: req.headers.authorization } : {}) } : {};
        if (chatRoute === '/chat' || accessRoute === '/ai/chat') {
          // Stream the answer through; abort the model run if the visitor leaves.
          const ac = new AbortController(); res.on('close', () => ac.abort());
          let response;
          try {
            response = await fetch(upstream, { method: 'POST', headers: { 'Content-Type': 'application/json', ...accessHeaders }, body,
              signal: AbortSignal.any([ac.signal, AbortSignal.timeout(240_000)]) });
          } catch { return reply(502, { error: 'AI service unavailable' }); }
          res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json', 'X-Accel-Buffering': 'no' });
          try { for await (const chunk of response.body) res.write(chunk); } catch { /* client or upstream closed */ }
          res.end();
          return;
        }
        let lbPick = null;
        if (pathname === '/rpc' && !swapLabRpc && rpcLb.enabled) { lbPick = rpcLb.pick(body.toString()); upstream = lbPick.url; }
        const fetchUp = async () => {
          let response;
          try { response = await fetch(upstream, {
            method: req.method,
            headers: { 'Content-Type': 'application/json', ...(pathname.startsWith('/api/pq/') ? { 'Accept-Encoding': 'identity' } : {}),
              // Faucet listens on loopback only; it uses this for its per-IP daily cap (set by us, never by the client).
              ...(pathname === '/api/faucet/claim' ? { 'X-Zeronyth-Client-Ip': clientIp(req) } : {}), ...accessHeaders },
            body: req.method === 'POST' ? body : undefined,
            signal: AbortSignal.timeout(econRoute?.endsWith('/jobs/next') ? 30_000 : 15_000),
          }); } catch (e) {
            // a balanced read whose upstream failed is retried once on the anchor node
            if (!lbPick || lbPick === rpcLb.anchor()) throw e;
            lbPick.fails++; lbPick.healthy = false; lbPick = rpcLb.anchor(); upstream = lbPick.url;
            response = await fetch(upstream, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(15_000) });
          }
          if (lbPick) lbPick.served++;
          return { status: response.status, ctype: response.headers.get('content-type') || 'application/json', raw: Buffer.from(await response.arrayBuffer()) };
        };
        let up;
        if (cacheKey) {
          const now = Date.now(); let hit = readCache.get(cacheKey);
          if (!hit || hit.until < now) {
            if (readCache.size > 2000) readCache.clear();
            hit = { until: now + cacheMs, p: fetchUp() }; readCache.set(cacheKey, hit);
            hit.p.catch(() => readCache.delete(cacheKey));
          }
          up = await hit.p;
          if (up.status >= 500) readCache.delete(cacheKey);
        } else up = await fetchUp();
        if (pathname.startsWith('/api/pq/')) {
          // Pass the (possibly gzip) body through untouched: undici decodes by default, so re-encode if asked.
          const raw = up.raw;
          const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && raw.length > 1024;
          res.writeHead(up.status, { 'Content-Type': 'application/json', ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
          res.end(gz ? (cacheKey ? (gzCache.get(raw) || (gzCache.set(raw, gzipSync(raw, { level: 4 })), gzCache.get(raw))) : gzipSync(raw, { level: 4 })) : raw);
          return;
        }
        if (pathname === '/rpc' && !swapLabRpc && up.status === 200 && /PriorityFee|eth_feeHistory|eth_gasPrice/.test(body.toString())) {
          // Validators enforce --min-gas-price but baseFee is 0, so EIP-1559 wallets (OKX, MetaMask) would compute
          // maxPriorityFee = 0 and be rejected. Raise tip / gas price suggestions to the floor. ZERONYTH_TIP_FLOOR_WEI sets the
          // floor for the gateway only (e.g. on the VPS, whose node4 runs --min-gas-price=0 while box validators need 1 gwei).
          try {
            const fv = process.env.ZERONYTH_TIP_FLOOR_WEI || process.env.ZERONYTH_MIN_GAS_PRICE || '';
            const floor = BigInt(/^\d{1,24}$/.test(fv) ? fv : '0');
            if (floor > 0n) {
              const methods = new Map([JSON.parse(body.toString())].flat().map((c) => [JSON.stringify(c.id), c.method]));
              const fix = (h) => (typeof h === 'string' && /^0x[0-9a-fA-F]*$/.test(h) && BigInt(h) < floor ? '0x' + floor.toString(16) : h);
              const resp = JSON.parse(up.raw.toString());
              for (const r of [resp].flat()) {
                const m = methods.get(JSON.stringify(r?.id));
                if ((m === 'eth_maxPriorityFeePerGas' || m === 'eth_gasPrice') && r.result) r.result = fix(r.result);
                if (m === 'eth_feeHistory' && Array.isArray(r.result?.reward)) r.result.reward = r.result.reward.map((row) => row.map(fix));
              }
              up = { ...up, raw: Buffer.from(JSON.stringify(resp)) };
            }
          } catch { /* pass through unchanged */ }
        }
        res.writeHead(up.status, { 'Content-Type': up.ctype });
        res.end(up.raw);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) return reply(405, { error: 'GET required' });
      if (retiredPages.has(pathname)) {
        res.writeHead(301, { Location: retiredPages.get(pathname) + (requestUrl.search || ''), 'Cache-Control': 'public, max-age=3600' });
        return res.end();
      }
      if (hiddenStatic.test(pathname)) return reply(404, { error: 'Not found' });
      let file;
      try {
        const decoded = decodeURIComponent(pathname);
        const candidate = path.resolve(dashboard, `.${decoded === '/' ? '/index.html' : decoded}`);
        if (!candidate.startsWith(`${dashboard}${path.sep}`)) return reply(403, { error: 'Forbidden' });
        file = candidate;
      } catch { return reply(400, { error: 'Invalid path' }); }
      // Static assets: ETag revalidation, short caching for code, long for images, gzip for text.
      const info = await stat(file);
      // Directories (e.g. /assets/) are not listable: 404 instead of the EISDIR -> 502 path.
      if (!info.isFile()) return reply(404, { error: 'Not found' });
      const ext = path.extname(file);
      const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', ext === '.html' ? 'no-cache'
        : ext === '.png' || ext === '.svg' ? 'public, max-age=86400'
          : 'public, max-age=60, stale-while-revalidate=600');
      if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
      const type = mime[ext] || 'application/octet-stream';
      const textual = /^(text\/|application\/json|image\/svg)/.test(type) || ext === '.json' || ext === '.md';
      const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      let data = staticCache.get(file);
      if (!data || data.etag !== etag) {
        const raw = await readFile(file);
        data = { etag, raw, gz: textual && raw.length > 1024 ? gzipSync(raw, { level: 6 }) : null };
        staticCache.set(file, data);
      }
      const body = wantsGzip && data.gz ? data.gz : data.raw;
      const headers = { 'Content-Type': type, 'Content-Length': body.length };
      if (body === data.gz) headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      const missing = ['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code);
      reply(missing ? 404 : 502, {
        error: missing ? 'Not found' : 'Local testnet service unavailable',
      });
    }
  });
  server.requestTimeout = 20_000;
  server.on('close', () => clearInterval(cleanup));
  return server;
}
